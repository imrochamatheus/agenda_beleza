// Reserva manual da equipe com N itens e detecção de encaixe por item (D-029, E3.4; D-050 §3.11, E3.6).
// Sem 'use server' e sem next/*: a ação (`reservas-equipe.acao.ts`) o chama. Uma data local para todos os
// itens (RN-3); cada item tem serviço, profissional e hora próprios. Converte data + hora LOCAIS do salão em
// UTC (só por fuso.ts) e delega a `criarReserva` em modo encaixe: a revalidação de disponibilidade é trocada
// pelo decisor em LOTE (`decisor-encaixe.ts`, A-11), que lê jornadas, bloqueios e funcionamento NA transação,
// e só a exclusion constraint impede a sobreposição com item ativo (RN-15/RN-16).
//
// Ordem (CA-24): permissão da operação → para CADA profissional distinto dos itens: id malformado ou de
// outro salão = 404 → profissional logado com item de outro = 403. Tudo antes de qualquer escrita.
import { validarEntradaCliente } from '@/server/clientes/validacao';
import { ehAceite } from '@/server/consentimento/validacao';
import { exigirPermissao } from '@/server/auth/permissoes';
import { formatarHora } from '@/lib/format';
import { repos } from '@/server/repos';
import { ehUuid } from '@/server/repos/ids';
import type { TenantContext } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';
import { ehDataCivilValida, instanteDeHoraLocal } from '@/server/tempo/fuso';
import type { DataCivil } from '@/server/tempo/fuso';

import { criarReserva } from './criar-reserva';
import { criarDecisorDeEncaixe } from './decisor-encaixe';
import type {
  CampoDoItem,
  DependenciasCriarReserva,
  EntradaReservaEquipe,
  ErrosReserva,
  ItemPedido,
  ResultadoCriarReserva,
} from './tipos';

const RE_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;
const RE_HORA = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** Máximo de itens por reserva (RN-2). */
export const MAXIMO_ITENS_EQUIPE = 10;

export function lerData(v: unknown): DataCivil | null {
  const m = typeof v === 'string' ? RE_DATA.exec(v.trim()) : null;
  if (!m) return null;
  const d = { ano: Number(m[1]), mes: Number(m[2]), dia: Number(m[3]) };
  return ehDataCivilValida(d) ? d : null;
}

/** Minutos do dia (0..1439) de "HH:MM"/"H:MM"; null se inválido. */
export function lerHora(v: unknown): number | null {
  const m = typeof v === 'string' ? RE_HORA.exec(v.trim()) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Textos dos erros do formulário da equipe (web-design §5.8). "Serviço n" é 1-based, como na tela. */
export const MENSAGENS_FORMULARIO_EQUIPE = Object.freeze({
  data: 'Informe uma data válida.',
  quantidade: 'Inclua de um a dez serviços.',
  servico: 'Escolha o serviço.',
  profissional: 'Escolha o profissional.',
  hora: 'Informe a hora no formato HH:MM.',
  servicoRepetido: (n: number) => `Este serviço já está no Serviço ${n}.`,
  sobreposicao: (n: number, servico: string, faixa: string) => `Este horário se sobrepõe ao Serviço ${n} (${servico}, ${faixa}).`,
});

/** Erros da equipe: os de `criarReserva` + a data única do formulário. `porItem` por índice 0-based. */
export type ErrosReservaEquipe = ErrosReserva & { data?: string };

/**
 * Desfechos da reserva da equipe: os de `criarReserva`, com `invalido` carregando também a data. A
 * sobreposição ENTRE itens (`horario_indisponivel/entre_itens`) volta como `invalido` com o texto no campo
 * hora do item de maior índice do par, porque é um erro de preenchimento do formulário.
 */
export type ResultadoReservaEquipe =
  | Exclude<ResultadoCriarReserva, { resultado: 'invalido' }>
  | { resultado: 'invalido'; erros: ErrosReservaEquipe };

export type DependenciasReservaEquipe = Pick<DependenciasCriarReserva, 'enfileirar' | 'politica' | 'aposRevalidar'>;

type ItemBruto = { servico: string; profissional: string; hora: string };

const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

function lerItens(v: unknown): ItemBruto[] {
  if (!Array.isArray(v)) return [];
  return v.map((i: unknown) => {
    const o = typeof i === 'object' && i !== null ? (i as Record<string, unknown>) : {};
    return { servico: texto(o.servicoId).toLowerCase(), profissional: texto(o.profissionalId).toLowerCase(), hora: texto(o.hora) };
  });
}

function erroNoItem(erros: ErrosReservaEquipe, k: number, campo: CampoDoItem, mensagem: string): void {
  const porItem = erros.porItem ?? {};
  porItem[k] = { ...porItem[k], [campo]: mensagem };
  erros.porItem = porItem;
}

/**
 * Isolamento e papel (CA-24), antes de qualquer escrita: cada profissional distinto informado precisa ser
 * UUID do salão da sessão (senão 404, sem dizer se existe em outro salão) e, para o papel profissional, ser
 * ele mesmo (senão 403). Os 404 são conferidos para todos antes do primeiro 403.
 */
async function conferirProfissionais(ctx: TenantContext, itens: readonly ItemBruto[]): Promise<void> {
  const distintos = [...new Set(itens.map((i) => i.profissional).filter((p) => p !== ''))];
  for (const id of distintos) {
    if (!ehUuid(id)) throw new NaoEncontrado();
  }
  const encontrados = [];
  for (const id of distintos) encontrados.push(await repos().profissionais.buscarPorId(ctx, id));
  for (const p of encontrados) exigirPermissao(ctx, 'reserva.criar', { profissionalId: p.id });
}

export type FormularioValidado =
  | { ok: true; data: DataCivil; itens: { servicoId: string; profissionalId: string; minutos: number }[] }
  | { ok: false; erros: ErrosReservaEquipe };

/**
 * Validação PURA do formulário (sem banco; também usada pela vitrine `/dev/reserva-nova`): quantidade (1..10),
 * data, serviço/profissional/hora de cada item, serviço repetido ("Este serviço já está no Serviço n") e
 * cliente (nome e telefone). Ids em minúsculas; não confere se existem.
 */
export function validarFormularioDaEquipe(e: EntradaReservaEquipe): FormularioValidado {
  const itens = lerItens(e?.itens);
  const erros: ErrosReservaEquipe = {};
  const cliente = validarEntradaCliente({ nome: e?.nome, telefone: e?.telefone });
  if (!cliente.ok) Object.assign(erros, cliente.erros);
  if (itens.length === 0 || itens.length > MAXIMO_ITENS_EQUIPE) erros.itens = MENSAGENS_FORMULARIO_EQUIPE.quantidade;
  const data = lerData(e?.data);
  if (data === null) erros.data = MENSAGENS_FORMULARIO_EQUIPE.data;
  const vistos = new Map<string, number>();
  const horas = itens.map((item, k) => {
    if (item.servico === '') {
      erroNoItem(erros, k, 'servico', MENSAGENS_FORMULARIO_EQUIPE.servico);
    } else if (vistos.has(item.servico)) {
      erroNoItem(erros, k, 'servico', MENSAGENS_FORMULARIO_EQUIPE.servicoRepetido(vistos.get(item.servico)! + 1));
    } else {
      vistos.set(item.servico, k);
    }
    if (item.profissional === '') erroNoItem(erros, k, 'profissional', MENSAGENS_FORMULARIO_EQUIPE.profissional);
    const hora = lerHora(item.hora);
    if (hora === null) erroNoItem(erros, k, 'inicio', MENSAGENS_FORMULARIO_EQUIPE.hora);
    return hora;
  });
  if (Object.keys(erros).length > 0 || data === null) return { ok: false, erros };
  return {
    ok: true,
    data,
    itens: itens.map((item, k) => ({ servicoId: item.servico, profissionalId: item.profissional, minutos: horas[k]! })),
  };
}

/**
 * Sobreposição entre itens (RN-8/RN-9) como erro no campo hora do item de maior índice do par: "Este
 * horário se sobrepõe ao Serviço j (nome, hh:mm–hh:mm)". Pura: o chamador fornece nome e duração dos
 * serviços (por id em minúsculas).
 */
export function errosDeSobreposicao(
  pedidos: readonly ItemPedido[],
  conflitos: Readonly<Record<number, number>>,
  servicos: ReadonlyMap<string, { nome: string; duracaoMin: number }>,
  fuso: string,
): ErrosReservaEquipe {
  const erros: ErrosReservaEquipe = {};
  for (const [k, j] of Object.entries(conflitos).map(([a, b]) => [Number(a), b] as const)) {
    const citado = pedidos[j];
    const servico = servicos.get(citado.servicoId.toLowerCase());
    const fim = new Date(citado.inicio.getTime() + (servico?.duracaoMin ?? 0) * 60_000);
    const faixa = `${formatarHora(citado.inicio, fuso)}–${formatarHora(fim, fuso)}`;
    erroNoItem(erros, k, 'inicio', MENSAGENS_FORMULARIO_EQUIPE.sobreposicao(j + 1, servico?.nome ?? 'serviço', faixa));
  }
  return erros;
}

export async function criarReservaDaEquipe(
  ctx: TenantContext,
  e: EntradaReservaEquipe,
  agora: Date,
  deps: DependenciasReservaEquipe = {},
): Promise<ResultadoReservaEquipe> {
  exigirPermissao(ctx, 'reserva.criar');
  await conferirProfissionais(ctx, lerItens(e?.itens).slice(0, MAXIMO_ITENS_EQUIPE + 1));

  const v = validarFormularioDaEquipe(e);
  if (!v.ok) return { resultado: 'invalido', erros: v.erros };

  const fuso = await repos().bloqueios.fusoDoSalao(ctx);
  const pedidos: ItemPedido[] = v.itens.map((item) => ({
    servicoId: item.servicoId,
    profissionalId: item.profissionalId,
    inicio: instanteDeHoraLocal(v.data, item.minutos, fuso),
  }));

  const r = await criarReserva(
    ctx,
    {
      itens: pedidos,
      cliente: { nome: e.nome, telefone: e.telefone },
      aceites: e.aceites,
      chaveRequisicao: typeof e.chaveRequisicao === 'string' && e.chaveRequisicao !== '' ? e.chaveRequisicao : null,
      modo: 'encaixe',
      agora,
    },
    {
      ...deps,
      consentimentoOpcional: true,
      decidirEncaixe: criarDecisorDeEncaixe(ehAceite(e.confirmarEncaixe)),
    },
  );

  if (r.resultado === 'horario_indisponivel' && r.causa === 'entre_itens' && r.conflitos) {
    // Só no caminho da falha: uma leitura dos serviços do salão para o nome e a duração do item citado.
    const servicos = new Map((await repos().servicos.listar(ctx)).map((s) => [s.id.toLowerCase(), s]));
    return { resultado: 'invalido', erros: errosDeSobreposicao(pedidos, r.conflitos, servicos, fuso) };
  }
  return r;
}
