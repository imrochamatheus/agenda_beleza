import { createHash } from 'node:crypto';

import { vi } from 'vitest';

import type { Finalidade } from '@/config/termos';
import { obterPrisma } from '@/server/repos/db';
import { repoSimWhatsApp } from '@/server/repos/sim-whatsapp';
import type { LinhaChamada } from '@/server/repos/sim-whatsapp';

import { instanteFuturo } from './factories';
import { slugNovo, telefoneNovo } from './sql';

// Fábricas e leituras dos testes das mensagens de WhatsApp (D-024 T-6). Tudo via Prisma, na base do
// worker do Vitest (obterPrisma() usa a DATABASE_URL do setup-arquivo). Cada chamada gera dados novos.

export type TipoMsg = 'confirmacao' | 'remarcacao' | 'cancelamento' | 'convite_avaliacao';
export type EstadoMsg =
  | 'pendente'
  | 'enviando'
  | 'enviada'
  | 'falhou'
  | 'nao_enviada'
  | 'substituida'
  | 'cancelada_anonimizacao';

export type CenarioMensagem = {
  salaoId: string;
  salaoNome: string;
  fuso: string;
  profissionalId: string;
  profissionalNome: string;
  servicoIds: string[];
  servicoNomes: string[];
  clienteId: string;
  clienteNome: string;
  telefone: string;
  reservaId: string;
  inicio: Date;
};

export type OpcoesCenario = {
  fuso?: string;
  salaoNome?: string;
  status?: 'confirmado' | 'cancelado' | 'concluido' | 'nao_compareceu';
  revisao?: number;
  inicio?: Date;
  /** Consentimento de `mensagens_reserva` (padrão true). */
  consentimentoMensagens?: boolean;
  /** Consentimento de `convite_avaliacao` (padrão false). */
  consentimentoConvite?: boolean;
  anonimizada?: boolean;
  /** Nomes dos serviços da reserva, na ordem (padrão: Corte e Escova). */
  servicos?: string[];
  profissionalNome?: string;
  /** Telefone da cliente (padrão: novo). Dois salões podem ter clientes com o mesmo número. */
  telefone?: string;
};

const SERVICOS_PADRAO = ['Corte', 'Escova'];

/** Salão, profissional, serviços, cliente (com consentimentos) e uma reserva com itens. */
export async function criarCenarioMensagem(o: OpcoesCenario = {}): Promise<CenarioMensagem> {
  const db = obterPrisma();
  const sufixo = slugNovo().slice('salao-'.length);
  const salaoNome = o.salaoNome ?? `Salão ${sufixo}`;
  const fuso = o.fuso ?? 'America/Sao_Paulo';
  const salao = await db.salao.create({ data: { nome: salaoNome, fuso }, select: { id: true } });
  const salaoId = salao.id;
  const profissionalNome = o.profissionalNome ?? `Marina ${sufixo}`;
  const profissional = await db.profissional.create({ data: { salaoId, nome: profissionalNome }, select: { id: true } });

  const nomes = o.servicos ?? SERVICOS_PADRAO;
  const servicoIds: string[] = [];
  for (const nome of nomes) {
    const s = await db.servico.create({ data: { salaoId, nome, precoCentavos: 5000, duracaoMin: 30 }, select: { id: true } });
    servicoIds.push(s.id);
  }

  const telefone = o.telefone ?? telefoneNovo();
  const anonimizada = o.anonimizada === true;
  const clienteNome = `Cliente ${sufixo}`;
  const cliente = await db.cliente.create({
    data: anonimizada
      ? { salaoId, nome: null, telefoneE164: null, anonimizadaEm: new Date() }
      : { salaoId, nome: clienteNome, telefoneE164: telefone },
    select: { id: true },
  });
  await registrarConsentimento(salaoId, cliente.id, 'mensagens_reserva', o.consentimentoMensagens ?? true);
  await registrarConsentimento(salaoId, cliente.id, 'convite_avaliacao', o.consentimentoConvite ?? false);

  const inicio = o.inicio ?? instanteFuturo(7, 13);
  const base = { salaoId, profissionalId: profissional.id, clienteId: cliente.id, servicoIds };
  const reservaId = await criarReserva(base, inicio, o.status ?? 'confirmado', o.revisao ?? 0);
  return {
    salaoId,
    salaoNome,
    fuso,
    profissionalId: profissional.id,
    profissionalNome,
    servicoIds,
    servicoNomes: nomes,
    clienteId: cliente.id,
    clienteNome,
    telefone,
    reservaId,
    inicio,
  };
}

async function registrarConsentimento(salaoId: string, clienteId: string, finalidade: Finalidade, vale: boolean): Promise<void> {
  if (!vale) return;
  await obterPrisma().consentimento.create({
    data: { salaoId, clienteId, finalidade, origem: 'publico', versaoTermos: 'versao-de-teste' },
  });
}

async function criarReserva(
  c: { salaoId: string; profissionalId: string; clienteId: string; servicoIds: string[] },
  inicio: Date,
  status: NonNullable<OpcoesCenario['status']>,
  revisao: number,
): Promise<string> {
  const db = obterPrisma();
  const fim = new Date(inicio.getTime() + c.servicoIds.length * 30 * 60_000);
  const reserva = await db.reserva.create({
    data: {
      salaoId: c.salaoId,
      profissionalId: c.profissionalId,
      clienteId: c.clienteId,
      inicio,
      fim,
      ocupadoAte: fim,
      status,
      origem: 'equipe',
      revisao,
    },
    select: { id: true },
  });
  for (const [ordem, servicoId] of c.servicoIds.entries()) {
    await db.reservaItem.create({
      data: { salaoId: c.salaoId, reservaId: reserva.id, servicoId, ordem, precoCentavos: 5000, duracaoMin: 30 },
    });
  }
  return reserva.id;
}

/** Outra reserva (mesmo salão, profissional, cliente e serviços do cenário), sem sobrepor a primeira. */
export async function criarOutraReserva(
  c: CenarioMensagem,
  o: { status?: NonNullable<OpcoesCenario['status']>; revisao?: number; diasAdiante?: number } = {},
): Promise<string> {
  const inicio = instanteFuturo(o.diasAdiante ?? 14, 13);
  return criarReserva(c, inicio, o.status ?? 'confirmado', o.revisao ?? 0);
}

/** Atualiza status/revisão da reserva (simula remarcação, cancelamento ou conclusão feitos por outra demanda). */
export async function mudarReserva(
  reservaId: string,
  m: { status?: NonNullable<OpcoesCenario['status']>; revisao?: number },
): Promise<void> {
  await obterPrisma().reserva.update({ where: { id: reservaId }, data: m });
}

/** Anonimiza a cliente (nome e telefone nulos), como a E5.2 fará. */
export async function anonimizarCliente(clienteId: string): Promise<void> {
  await obterPrisma().cliente.update({
    where: { id: clienteId },
    data: { nome: null, telefoneE164: null, anonimizadaEm: new Date() },
  });
}

export type NovaMensagemDeTeste = {
  salaoId: string;
  reservaId: string;
  tipo?: TipoMsg;
  revisao?: number;
  estado?: EstadoMsg;
  erroCodigo?: string | null;
  destinatarioE164?: string | null;
  enviadaEm?: Date | null;
  provedorMensagemId?: string | null;
  atualizadoEm?: Date;
  /** Tentativas já existentes, numeradas de 1 (resultado `null` = aberta). */
  tentativas?: { resultado: 'sucesso' | 'falha' | null; erroCodigo?: string | null; iniciadaEm?: Date }[];
};

/** Linha de `mensagem` em qualquer estado, com tentativas opcionais. */
export async function criarMensagem(n: NovaMensagemDeTeste): Promise<string> {
  const db = obterPrisma();
  const atualizadoEm = n.atualizadoEm ?? new Date();
  const m = await db.mensagem.create({
    data: {
      salaoId: n.salaoId,
      reservaId: n.reservaId,
      tipo: n.tipo ?? 'confirmacao',
      revisao: n.revisao ?? 0,
      estado: n.estado ?? 'pendente',
      erroCodigo: n.erroCodigo ?? null,
      destinatarioE164: n.destinatarioE164 ?? null,
      enviadaEm: n.enviadaEm ?? null,
      provedorMensagemId: n.provedorMensagemId ?? null,
      criadoEm: atualizadoEm,
      atualizadoEm,
    },
    select: { id: true },
  });
  for (const [i, t] of (n.tentativas ?? []).entries()) {
    const iniciadaEm = t.iniciadaEm ?? atualizadoEm;
    await db.mensagemTentativa.create({
      data: {
        mensagemId: m.id,
        numero: i + 1,
        iniciadaEm,
        finalizadaEm: t.resultado === null ? null : iniciadaEm,
        resultado: t.resultado,
        erroCodigo: t.erroCodigo ?? null,
      },
    });
  }
  return m.id;
}

export type MensagemLida = {
  id: string;
  salaoId: string;
  reservaId: string;
  tipo: TipoMsg;
  revisao: number;
  estado: EstadoMsg;
  destinatarioE164: string | null;
  parametros: unknown;
  provedorMensagemId: string | null;
  erroCodigo: string | null;
  enviadaEm: Date | null;
  criadoEm: Date;
  atualizadoEm: Date;
};

export async function lerMensagem(id: string): Promise<MensagemLida> {
  return obterPrisma().mensagem.findUniqueOrThrow({ where: { id } }) as Promise<MensagemLida>;
}

export async function mensagensDaReservaDireto(reservaId: string): Promise<MensagemLida[]> {
  return obterPrisma().mensagem.findMany({ where: { reservaId }, orderBy: [{ criadoEm: 'asc' }, { id: 'asc' }] }) as Promise<MensagemLida[]>;
}

export async function lerTentativas(mensagemId: string) {
  return obterPrisma().mensagemTentativa.findMany({ where: { mensagemId }, orderBy: { numero: 'asc' } });
}

/** Chamadas registradas pelo WhatsApp simulado para a chave (`reserva:tipo:revisao`). */
export async function chamadasDaChave(chave: string): Promise<LinhaChamada[]> {
  return repoSimWhatsApp().listarChamadas({ chaveIdempotencia: chave });
}

/** Linhas de cada tabela, para provar que o envio não as altera (CA-3, CA-27). */
export async function checksumDeTabelas(tabelas: readonly string[], salaoId?: string): Promise<Record<string, string>> {
  const db = obterPrisma();
  const saida: Record<string, string> = {};
  for (const t of tabelas) {
    if (!/^[a-z_]+$/.test(t)) throw new Error(`tabela inválida: ${t}`);
    if (salaoId !== undefined && !/^[0-9a-f-]{36}$/.test(salaoId)) throw new Error('salaoId inválido');
    const filtro =
      salaoId === undefined
        ? ''
        : t === 'salao'
          ? `WHERE id = '${salaoId}'`
          : t === 'mensagem_tentativa'
            ? `WHERE mensagem_id IN (SELECT id FROM mensagem WHERE salao_id = '${salaoId}')`
            : `WHERE salao_id = '${salaoId}'`;
    const linhas = await db.$queryRawUnsafe<{ j: string }[]>(
      `SELECT to_jsonb(x)::text AS j FROM ${t} x ${filtro} ORDER BY 1`,
    );
    saida[t] = createHash('sha256').update(linhas.map((l) => l.j).join('\n')).digest('hex');
  }
  return saida;
}

/** Tabelas que o pipeline de mensagens nunca pode alterar (RN-4, CA-27). */
export const TABELAS_INTOCAVEIS = ['reserva', 'reserva_item', 'cliente', 'consentimento', 'salao'] as const;

/** Captura o que `console.log`/`console.error`/`console.warn` receberem, para provar a ausência de dado pessoal. */
export function capturarConsole() {
  const linhas: string[] = [];
  const espioes = (['log', 'error', 'warn', 'info'] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
      linhas.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    }),
  );
  return {
    linhas,
    restaurar: () => espioes.forEach((e) => e.mockRestore()),
  };
}
