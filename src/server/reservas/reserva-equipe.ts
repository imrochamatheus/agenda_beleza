// Reserva manual da equipe com detecção de encaixe (D-029, E3.4). Sem 'use server' e sem next/*: a ação
// (`reservas-equipe.acao.ts`) o chama. Converte data + hora LOCAIS do salão em UTC (só por fuso.ts) e delega
// a `criarReserva` em modo encaixe: a revalidação de disponibilidade é trocada por `decidirEncaixe`, que lê
// jornada, bloqueios e funcionamento NA transação (sob a trava do profissional) com o `r` dela, e só a
// exclusion constraint impede a sobreposição com reserva ativa (RN-4).
import { validarEntradaCliente } from '@/server/clientes/validacao';
import { ehAceite } from '@/server/consentimento/validacao';
import { montarSemana as montarSemanaJornada } from '@/server/jornadas/semana';
import { exigirPermissao } from '@/server/auth/permissoes';
import { repos } from '@/server/repos';
import { ehUuid } from '@/server/repos/ids';
import { montarSemana } from '@/server/semana/montagem';
import type { TenantContext } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';
import { ehDataCivilValida, instanteDeHoraLocal } from '@/server/tempo/fuso';
import type { DataCivil } from '@/server/tempo/fuso';

import { criarReserva } from './criar-reserva';
import { detectarMotivos } from './encaixe';
import { MENSAGENS_RESERVA_EQUIPE } from './tipos';
import type { DependenciasCriarReserva, EntradaReservaEquipe, ResultadoCriarReserva } from './tipos';

const RE_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;
const RE_HORA = /^([01]?\d|2[0-3]):([0-5]\d)$/;

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

export type DependenciasReservaEquipe = Pick<DependenciasCriarReserva, 'enfileirar' | 'politica' | 'aposRevalidar'>;

export async function criarReservaDaEquipe(
  ctx: TenantContext,
  e: EntradaReservaEquipe,
  agora: Date,
  deps: DependenciasReservaEquipe = {},
): Promise<ResultadoCriarReserva> {
  exigirPermissao(ctx, 'reserva.criar');

  // Alvo: id de outro salão, inexistente ou malformado = 404; do mesmo salão mas de outro profissional,
  // com papel profissional = 403 (RN-1). A existência só é consultada dentro do próprio salão.
  if (typeof e.profissionalId !== 'string' || !ehUuid(e.profissionalId)) throw new NaoEncontrado();
  const alvo = await repos().profissionais.buscarPorId(ctx, e.profissionalId);
  exigirPermissao(ctx, 'reserva.criar', { profissionalId: alvo.id });

  const data = lerData(e.data);
  const minutos = lerHora(e.hora);
  if (data === null || minutos === null) {
    const cliente = validarEntradaCliente({ nome: e.nome, telefone: e.telefone });
    return { resultado: 'invalido', erros: { ...(cliente.ok ? {} : cliente.erros), inicio: MENSAGENS_RESERVA_EQUIPE.inicio } };
  }
  const fuso = await repos().bloqueios.fusoDoSalao(ctx);
  const inicio = instanteDeHoraLocal(data, minutos, fuso);
  const confirmou = ehAceite(e.confirmarEncaixe);

  return criarReserva(
    ctx,
    {
      servicoIds: Array.isArray(e.servicoIds) ? (e.servicoIds as string[]) : [],
      profissionalId: alvo.id,
      inicio,
      cliente: { nome: e.nome, telefone: e.telefone },
      aceites: e.aceites,
      chaveRequisicao: typeof e.chaveRequisicao === 'string' && e.chaveRequisicao !== '' ? e.chaveRequisicao : null,
      modo: 'encaixe',
      agora,
    },
    {
      ...deps,
      consentimentoOpcional: true,
      decidirEncaixe: async (c, r, d) => {
        const jornada = montarSemanaJornada(await r.jornadas.listarDoProfissional(c, d.profissionalId));
        const bloqueios = await r.bloqueios.listarNoPeriodo(c, { de: d.inicio, ate: d.fim }, { profissionalId: d.profissionalId });
        const dto = await r.funcionamento.ler(c);
        const funcionamento = dto.definido ? { definido: true as const, semana: montarSemana(dto.linhas) } : { definido: false as const };
        const motivos = detectarMotivos({ inicio: d.inicio, fim: d.fim, fuso: d.fuso, jornada, bloqueios, funcionamento });
        if (motivos.length === 0) return { encaixe: false };
        return confirmou ? { encaixe: true } : { motivos };
      },
    },
  );
}

