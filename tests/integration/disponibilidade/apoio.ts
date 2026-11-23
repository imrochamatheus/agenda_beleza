import { PrismaPg } from '@prisma/adapter-pg';
import type pg from 'pg';

import { PrismaClient } from '@/generated/prisma/client';
import { configuracaoDoAdaptador } from '@/server/repos/db';
import { criarPublicoContext } from '@/server/tenant/context';
import type { PublicoContext } from '@/server/tenant/context';

import { criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto, SobrescritasSalao } from '../../support/factories';

export { ctxDoGestor } from '../profissionais/apoio';

// Apoio local aos testes de tests/integration/disponibilidade (D-018; D-050: por serviço). Não é arquivo de teste (o glob
// do Vitest só pega *.test.ts). SQL direto pelo driver `pg` na base deste worker, sem mocks de banco.
// Relógio sempre injetado: AGORA fixo, antes do período consultado (DIA, uma terça-feira).

export const UUID_INEXISTENTE = '00000000-0000-4000-8000-000000000000';
/** 20/11/2026 09:00 em São Paulo. */
export const AGORA = new Date('2026-11-20T12:00:00Z');
/** Terça-feira, dentro da janela de 60 dias (dia da semana 2). */
export const DIA = { ano: 2026, mes: 12, dia: 1 } as const;
export const DIA_SEGUINTE = { ano: 2026, mes: 12, dia: 2 } as const;
export const SP = 'America/Sao_Paulo';
export const MANAUS = 'America/Manaus';

export const ctxPublico = (s: SalaoCompleto): PublicoContext => criarPublicoContext(s.salaoId, s.slugAtual);

/** Instante de uma hora local de São Paulo em 2026 (UTC−3 fixo). */
export function sp(data: { ano: number; mes: number; dia: number }, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(data.ano, data.mes - 1, data.dia, h + 3, m));
}

export const mm = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export type Cenario = {
  s: SalaoCompleto;
  /** Serviço A: 30 min, R$ 50,00. */
  A: string;
  /** Serviço B: 45 min, R$ 80,00. */
  B: string;
  /** Ana: a profissional da fábrica (ativa, vinculada a A e B), sem jornada, bloqueio nem reserva. */
  ana: string;
  /** Bia: ativa, vinculada só a A. Sem jornada. */
  bia: string;
};

/**
 * Salão da fábrica "limpo": serviços A (30 min, R$ 50) e B (45 min, R$ 80), Ana (A e B) e Bia (só A),
 * sem jornadas, bloqueios nem reservas (as da fábrica são apagadas). O gestor não tem perfil.
 */
export async function criarCenario(c: pg.Client, sobrescritas: SobrescritasSalao = {}): Promise<Cenario> {
  const s = await criarSalaoCompleto({
    ...sobrescritas,
    gestor: { comPerfil: false, ...sobrescritas.gestor },
    profissional: { nome: 'Ana', ...sobrescritas.profissional },
    servicos: {
      ativos: [
        { nome: 'A', precoCentavos: 5000, duracaoMin: 30 },
        { nome: 'B', precoCentavos: 8000, duracaoMin: 45 },
      ],
    },
  });
  await limparAgenda(c, s.salaoId);
  const bia = await inserirProfissional(c, s.salaoId, 'Bia');
  const [A, B] = s.servicos.ativos;
  await vincular(c, s.salaoId, A, bia);
  return { s, A, B, ana: s.profissional.profissionalId, bia };
}

/** Apaga jornadas, bloqueios e reservas (com itens) do salão. */
export async function limparAgenda(c: pg.Client, salaoId: string): Promise<void> {
  await c.query('DELETE FROM reserva_item WHERE salao_id = $1', [salaoId]);
  await c.query('DELETE FROM reserva WHERE salao_id = $1', [salaoId]);
  await c.query('DELETE FROM bloqueio WHERE salao_id = $1', [salaoId]);
  await c.query('DELETE FROM jornada WHERE salao_id = $1', [salaoId]);
}

export async function inserirProfissional(c: pg.Client, salaoId: string, nome: string, ativo = true): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    'INSERT INTO profissional (salao_id, nome, ativo) VALUES ($1, $2, $3) RETURNING id::text AS id',
    [salaoId, nome, ativo],
  );
  return rows[0].id;
}

export async function vincular(c: pg.Client, salaoId: string, servicoId: string, profissionalId: string): Promise<void> {
  await c.query(
    'INSERT INTO servico_profissional (salao_id, servico_id, profissional_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
    [salaoId, servicoId, profissionalId],
  );
}

/** Jornada nos dias da semana informados (0 = domingo), uma linha por faixa 'HH:MM'. */
export async function inserirJornada(
  c: pg.Client,
  salaoId: string,
  profissionalId: string,
  dias: readonly number[],
  ...faixas: [string, string][]
): Promise<void> {
  for (const dia of dias) {
    for (const [i, f] of faixas) {
      await c.query(
        'INSERT INTO jornada (salao_id, profissional_id, dia_semana, inicio_min, fim_min) VALUES ($1, $2, $3, $4, $5)',
        [salaoId, profissionalId, dia, mm(i), mm(f)],
      );
    }
  }
}

export const TODOS_OS_DIAS = [0, 1, 2, 3, 4, 5, 6] as const;

/** Funcionamento informado (`funcionamento_definido = true`) com as faixas dos dias; dia sem faixa = fechado. */
export async function definirFuncionamento(
  c: pg.Client,
  salaoId: string,
  porDia: Partial<Record<number, [string, string][]>>,
): Promise<void> {
  await c.query('DELETE FROM salao_funcionamento WHERE salao_id = $1', [salaoId]);
  for (const [dia, faixas] of Object.entries(porDia)) {
    for (const [i, f] of faixas ?? []) {
      await c.query(
        'INSERT INTO salao_funcionamento (salao_id, dia_semana, inicio_min, fim_min) VALUES ($1, $2, $3, $4)',
        [salaoId, Number(dia), mm(i), mm(f)],
      );
    }
  }
  await c.query('UPDATE salao SET funcionamento_definido = true WHERE id = $1', [salaoId]);
}

export async function marcarFuncionamentoNaoInformado(c: pg.Client, salaoId: string): Promise<void> {
  await c.query('UPDATE salao SET funcionamento_definido = false WHERE id = $1', [salaoId]);
}

export async function definirRegras(
  c: pg.Client,
  salaoId: string,
  r: Partial<{ fuso: string; grade_min: number; antecedencia_min: number; janela_dias: number; intervalo_min: number }>,
): Promise<void> {
  for (const [coluna, valor] of Object.entries(r)) {
    await c.query(`UPDATE salao SET ${coluna} = $2 WHERE id = $1`, [salaoId, valor]);
  }
}

export async function inserirBloqueio(
  c: pg.Client,
  salaoId: string,
  profissionalId: string | null,
  inicio: Date,
  fim: Date,
  motivo: string | null = null,
): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    'INSERT INTO bloqueio (salao_id, profissional_id, inicio, fim, motivo) VALUES ($1, $2, $3, $4, $5) RETURNING id::text AS id',
    [salaoId, profissionalId, inicio, fim, motivo],
  );
  return rows[0].id;
}

export async function inserirCliente(c: pg.Client, salaoId: string, anonimizada = false): Promise<string> {
  const { rows } = anonimizada
    ? await c.query<{ id: string }>(
        'INSERT INTO cliente (salao_id, nome, telefone_e164, anonimizada_em) VALUES ($1, NULL, NULL, now()) RETURNING id::text AS id',
        [salaoId],
      )
    : await c.query<{ id: string }>(
        `INSERT INTO cliente (salao_id, nome, telefone_e164) VALUES ($1, 'Cliente', '+55119' || lpad((floor(random() * 100000000))::int::text, 8, '0')) RETURNING id::text AS id`,
        [salaoId],
      );
  return rows[0].id;
}

// D-050: a ocupação é do ITEM. `inserirReserva` (formato antigo: reserva de 1 item) e
// `inserirReservaComItens` vêm do suporte comum (tests/support/sql.ts), sem cópia.
export { inserirReserva, inserirReservaComItens } from '../../support/sql';
export type { NovaReserva } from '../../support/sql';

/** Cliente Prisma próprio, com o evento `query` capturado (A-6). `encerrar()` ao fim. */
export function criarClienteComLog(): { cliente: PrismaClient; consultas: string[]; encerrar(): Promise<void> } {
  const consultas: string[] = [];
  const cliente = new PrismaClient({
    adapter: new PrismaPg(configuracaoDoAdaptador(process.env.DATABASE_URL!, { max: 4 })),
    log: [{ emit: 'event', level: 'query' }],
  });
  (cliente as unknown as { $on(e: 'query', f: (x: { query: string }) => void): void }).$on('query', (e) => {
    consultas.push(e.query);
  });
  return { cliente, consultas, encerrar: () => cliente.$disconnect() };
}

export const rotulo = (minutos: number): string =>
  `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;

type ResultadoComServicos = {
  resultado: string;
  servicos?: readonly {
    servicoId: string;
    profissionais: readonly { profissionalId: string; dias: readonly { horarios: readonly { local: { minutosDoDia: number } }[] }[] }[];
  }[];
};

/**
 * Rótulos locais 'HH:MM' dos inícios do `idx`-ésimo profissional na `dia`-ésima data de um resultado
 * 'ok', no `servico`-ésimo serviço calculado (padrão o primeiro).
 */
export function rotulos(r: ResultadoComServicos, idx = 0, dia = 0, servico = 0): string[] {
  if (r.resultado !== 'ok' || !r.servicos) throw new Error(`resultado inesperado: ${r.resultado}`);
  return r.servicos[servico].profissionais[idx].dias[dia].horarios.map((h) => rotulo(h.local.minutosDoDia));
}

/** Rótulos do profissional `profissionalId` no serviço `servicoId` (vazio se ele não é oferecido). */
export function rotulosDe(r: ResultadoComServicos, servicoId: string, profissionalId: string, dia = 0): string[] {
  if (r.resultado !== 'ok' || !r.servicos) throw new Error(`resultado inesperado: ${r.resultado}`);
  const s = r.servicos.find((x) => x.servicoId === servicoId);
  if (!s) throw new Error(`serviço ${servicoId} não calculado`);
  const p = s.profissionais.find((x) => x.profissionalId === profissionalId);
  return p ? p.dias[dia].horarios.map((h) => rotulo(h.local.minutosDoDia)) : [];
}

/** Ids dos profissionais oferecidos para `servicoId`, na ordem do resultado. */
export function profissionaisDe(r: ResultadoComServicos, servicoId: string): string[] {
  if (r.resultado !== 'ok' || !r.servicos) throw new Error(`resultado inesperado: ${r.resultado}`);
  const s = r.servicos.find((x) => x.servicoId === servicoId);
  if (!s) throw new Error(`serviço ${servicoId} não calculado`);
  return s.profissionais.map((p) => p.profissionalId);
}

export function faixa(a: string, b: string, passo = 15): string[] {
  const r: string[] = [];
  for (let m = mm(a); m <= mm(b); m += passo) r.push(rotulo(m));
  return r;
}
