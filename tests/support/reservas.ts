import { randomUUID } from 'node:crypto';

import { PrismaPg } from '@prisma/adapter-pg';
import type pg from 'pg';

import { Prisma, PrismaClient } from '@/generated/prisma/client';
import { configuracaoDoAdaptador, obterPrisma } from '@/server/repos/db';
import { contextoDeSistema, criarTenantContext } from '@/server/tenant/context';
import type { SistemaContext, TenantContext } from '@/server/tenant/context';

import { criarSalaoCompleto } from './factories';
import type { SalaoCompleto, SobrescritasSalao } from './factories';
import { telefoneNovo } from './sql';

// Apoio dos testes de criarReserva (D-025 T-5; D-050 T-2: itens com profissional e horário próprios). Tudo via Prisma e `pg` na base deste worker, sem mocks
// de banco. Não altera factories.ts nem mensagens.ts: parte de criarSalaoCompleto e limpa a agenda.
// Relógio sempre injetado: AGORA fixo, antes de DIA (uma terça-feira, dentro da janela de 60 dias).

/** 20/11/2026 09:00 em São Paulo. */
export const AGORA = new Date('2026-11-20T12:00:00Z');
/** Terça-feira (dia da semana 2). */
export const DIA = { ano: 2026, mes: 12, dia: 1 } as const;
export const DIA_SEGUINTE = { ano: 2026, mes: 12, dia: 2 } as const;
export const MIN_MS = 60_000;

export type DataCivil = { ano: number; mes: number; dia: number };

const minutos = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** Instante de uma hora local de São Paulo em 2026 (UTC−3 fixo, sem horário de verão). */
export function sp(data: DataCivil, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(data.ano, data.mes - 1, data.dia, h + 3, m));
}

export type OpcoesCenarioReserva = {
  fuso?: string;
  gradeMin?: number;
  intervaloMin?: number;
  /** Faixas 'HH:MM' da jornada da Ana em todos os dias da semana (padrão: 09:00–19:00). `[]` = sem jornada. */
  jornada?: [string, string][];
  /** Funcionamento por dia da semana; ausente = "não informado" (a disponibilidade segue a jornada). */
  funcionamento?: Partial<Record<number, [string, string][]>>;
  /** Preço (centavos) e duração (min) dos serviços A e B (padrão: 5000/30 e 7000/45). */
  servicoA?: { precoCentavos: number; duracaoMin: number };
  servicoB?: { precoCentavos: number; duracaoMin: number };
  salao?: SobrescritasSalao['salao'];
};

export type CenarioReserva = {
  s: SalaoCompleto;
  /** Serviço A (padrão R$ 50,00, 30 min) e B (R$ 70,00, 45 min); Ana faz os dois, Bia só A. */
  A: string;
  B: string;
  ana: string;
  bia: string;
  ctxEquipe: TenantContext;
  ctxSistema: SistemaContext;
};

/**
 * Salão da fábrica "limpo" (sem jornada, bloqueio nem reserva) com jornada, funcionamento e regras
 * configuráveis. O gestor não tem perfil de profissional.
 */
export async function criarCenarioReserva(o: OpcoesCenarioReserva = {}): Promise<CenarioReserva> {
  const db = obterPrisma();
  const a = o.servicoA ?? { precoCentavos: 5000, duracaoMin: 30 };
  const b = o.servicoB ?? { precoCentavos: 7000, duracaoMin: 45 };
  const s = await criarSalaoCompleto({
    salao: {
      ...(o.fuso !== undefined && { fuso: o.fuso }),
      ...(o.gradeMin !== undefined && { gradeMin: o.gradeMin }),
      ...(o.intervaloMin !== undefined && { intervaloMin: o.intervaloMin }),
      ...o.salao,
    },
    gestor: { comPerfil: false },
    profissional: { nome: 'Ana' },
    servicos: { ativos: [{ nome: 'A', ...a }, { nome: 'B', ...b }] },
  });
  const salaoId = s.salaoId;
  await db.reservaItem.deleteMany({ where: { salaoId } });
  await db.reserva.deleteMany({ where: { salaoId } });
  await db.bloqueio.deleteMany({ where: { salaoId } });
  await db.jornada.deleteMany({ where: { salaoId } });

  const bia = (await db.profissional.create({ data: { salaoId, nome: 'Bia' }, select: { id: true } })).id;
  const [A, B] = s.servicos.ativos;
  await db.servicoProfissional.create({ data: { salaoId, servicoId: A, profissionalId: bia } });

  const ana = s.profissional.profissionalId;
  await definirJornada(salaoId, ana, o.jornada ?? [['09:00', '19:00']]);
  if (o.funcionamento) await definirFuncionamento(salaoId, o.funcionamento);

  return {
    s,
    A,
    B,
    ana,
    bia,
    ctxEquipe: criarTenantContext({ usuarioId: s.gestor.usuarioId, papel: 'gestor', salaoId, profissionalId: null }),
    ctxSistema: contextoDeSistema(salaoId, 'publico-reserva'),
  };
}

/** Substitui a jornada do profissional: as mesmas faixas nos 7 dias da semana. */
export async function definirJornada(salaoId: string, profissionalId: string, faixas: [string, string][]): Promise<void> {
  const db = obterPrisma();
  await db.jornada.deleteMany({ where: { salaoId, profissionalId } });
  await db.jornada.createMany({
    data: [0, 1, 2, 3, 4, 5, 6].flatMap((diaSemana) =>
      faixas.map(([i, f]) => ({ salaoId, profissionalId, diaSemana, inicioMin: minutos(i), fimMin: minutos(f) })),
    ),
  });
}

/** Funcionamento informado: dia sem faixa = fechado. */
export async function definirFuncionamento(salaoId: string, porDia: Partial<Record<number, [string, string][]>>): Promise<void> {
  const db = obterPrisma();
  await db.salaoFuncionamento.deleteMany({ where: { salaoId } });
  const data = Object.entries(porDia).flatMap(([dia, faixas]) =>
    (faixas ?? []).map(([i, f]) => ({ salaoId, diaSemana: Number(dia), inicioMin: minutos(i), fimMin: minutos(f) })),
  );
  if (data.length > 0) await db.salaoFuncionamento.createMany({ data });
  await db.salao.update({ where: { id: salaoId }, data: { funcionamentoDefinido: true } });
}

/**
 * Entrada de `criarReserva` no formato da D-050 (§3.5: `itens` com serviço, profissional e início
 * próprios). Declarada aqui, e não importada de reservas/tipos.ts, para o suporte não depender da
 * ordem das tarefas: é estruturalmente igual a `EntradaCriarReserva`.
 */
export type EntradaReservaDeTeste = {
  itens: { servicoId: string; profissionalId: string; inicio: Date }[];
  cliente: { nome: unknown; telefone: unknown };
  aceites: unknown;
  chaveRequisicao?: string | null;
  modo?: 'normal' | 'encaixe';
  agora: Date;
};

/** Entrada válida padrão (um item: serviço A com a Ana, terça 10:00 local, telefone novo); sobrescreva o que o caso exige. */
export function entradaReserva(c: CenarioReserva, sobre: Partial<EntradaReservaDeTeste> = {}): EntradaReservaDeTeste {
  return {
    itens: [{ servicoId: c.A, profissionalId: c.ana, inicio: sp(DIA, '10:00') }],
    cliente: { nome: 'Cliente de Teste', telefone: telefoneNovo() },
    aceites: { mensagensReserva: true },
    agora: AGORA,
    ...sobre,
  };
}

/** Contagens por tabela, no salão (para provar "nada persiste" e "uma só vez"). */
export type Contagens = { reserva: number; itens: number; cliente: number; consentimento: number; mensagem: number };

export async function contarLinhas(salaoId: string): Promise<Contagens> {
  const db = obterPrisma();
  const [reserva, itens, cliente, consentimento, mensagem] = await Promise.all([
    db.reserva.count({ where: { salaoId } }),
    db.reservaItem.count({ where: { salaoId } }),
    db.cliente.count({ where: { salaoId } }),
    db.consentimento.count({ where: { salaoId } }),
    db.mensagem.count({ where: { salaoId } }),
  ]);
  return { reserva, itens, cliente, consentimento, mensagem };
}

export type TabelaDeFalha = 'cliente' | 'reserva' | 'reserva_item' | 'consentimento' | 'mensagem';

/**
 * Faz todo INSERT na tabela falhar (trigger BEFORE INSERT … RAISE EXCEPTION), para provar o desfazer
 * de cada etapa (CA-23) sem gancho em produção. Devolve a função que remove o trigger.
 */
export async function instalarFalhaPorTrigger(c: pg.Client, tabela: TabelaDeFalha): Promise<() => Promise<void>> {
  const nome = `falha_teste_${tabela}_${randomUUID().slice(0, 8)}`;
  await c.query(
    `CREATE FUNCTION ${nome}() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'falha forçada pelo teste' USING ERRCODE = 'P0001'; END $f$`,
  );
  await c.query(`CREATE TRIGGER ${nome} BEFORE INSERT ON ${tabela} FOR EACH ROW EXECUTE FUNCTION ${nome}()`);
  return async () => {
    await c.query(`DROP TRIGGER IF EXISTS ${nome} ON ${tabela}`);
    await c.query(`DROP FUNCTION IF EXISTS ${nome}()`);
  };
}

/** Conexões desta base esperando uma trava e cuja consulta contém `marcador`. */
export async function contarEsperando(c: pg.Client, marcador: string): Promise<number> {
  const { rows } = await c.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE $1 AND pid <> pg_backend_pid()`,
    [`%${marcador}%`],
  );
  return rows[0].n;
}

/** Espera, sem sleep fixo, até `n` consultas com `marcador` ficarem bloqueadas em trava. */
export async function esperarTrava(c: pg.Client, marcador: string, n = 1, limiteMs = 10_000): Promise<void> {
  const limite = Date.now() + limiteMs;
  while ((await contarEsperando(c, marcador)) < n) {
    if (Date.now() > limite) throw new Error(`esperava ${n} consulta(s) bloqueada(s) em "${marcador}"`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Barreira de `n` participantes para `deps.aposRevalidar` (CA-2b): todos chegam antes de qualquer um seguir. */
export function criarBarreira(n: number): () => Promise<void> {
  let chegaram = 0;
  let liberar: () => void = () => {};
  const aberta = new Promise<void>((r) => {
    liberar = r;
  });
  return async () => {
    chegaram += 1;
    if (chegaram >= n) liberar();
    await aberta;
  };
}

/**
 * Contador de comandos SQL do cliente Prisma global (CA-25): troca, no cache de `obterPrisma`, o
 * cliente da DATABASE_URL por um com o evento `query`, e devolve o original em `encerrar()`.
 */
export function instalarContadorDeComandos(): { contar(): number; reiniciar(): void; encerrar(): Promise<void> } {
  const url = process.env.DATABASE_URL!;
  obterPrisma(url); // garante o cache e o cliente original
  const cache = (globalThis as unknown as { __clientesPrisma: Map<string, PrismaClient> }).__clientesPrisma;
  const original = cache.get(url);
  const comLog = new PrismaClient({
    adapter: new PrismaPg(configuracaoDoAdaptador(url)),
    log: [{ emit: 'event', level: 'query' }],
  });
  let n = 0;
  (comLog as unknown as { $on(e: 'query', f: () => void): void }).$on('query', () => {
    n += 1;
  });
  cache.set(url, comLog);
  return {
    contar: () => n,
    reiniciar: () => {
      n = 0;
    },
    encerrar: async () => {
      if (original) cache.set(url, original);
      else cache.delete(url);
      await comLog.$disconnect();
    },
  };
}

/**
 * Reserva direta (sem o serviço), com cliente própria e UM item (D-050): simula a agenda já ocupada.
 * O item usa o serviço A (ou `servicoId`), o profissional dado (padrão Ana), `[inicio, fim)` (inteiro de
 * minutos), `ocupadoAte` (padrão `fim`), status e encaixe; a reserva recebe os derivados coerentes.
 * Devolve o id da reserva.
 */
export async function inserirReservaDireta(
  c: CenarioReserva,
  r: {
    inicio: Date;
    fim: Date;
    ocupadoAte?: Date;
    status?: 'confirmado' | 'cancelado' | 'concluido' | 'nao_compareceu';
    profissionalId?: string;
    servicoId?: string;
    encaixe?: boolean;
  },
): Promise<string> {
  const db = obterPrisma();
  const duracaoMin = (r.fim.getTime() - r.inicio.getTime()) / MIN_MS;
  if (!Number.isInteger(duracaoMin)) throw new RangeError('inserirReservaDireta: fim - inicio deve ser inteiro em minutos');
  const status = r.status ?? 'confirmado';
  const cliente = await db.cliente.create({
    data: { salaoId: c.s.salaoId, nome: 'Cliente da agenda', telefoneE164: telefoneNovo() },
    select: { id: true },
  });
  const reserva = await db.reserva.create({
    data: {
      salaoId: c.s.salaoId,
      clienteId: cliente.id,
      inicio: r.inicio,
      fim: r.fim,
      status,
      origem: 'equipe',
      canceladaEm: status === 'cancelado' ? new Date() : null,
      itens: {
        create: {
          // Sem `salaoId`: no create aninhado ele vem da relação com a reserva (Prisma recusa o campo).
          servicoId: r.servicoId ?? c.A,
          profissionalId: r.profissionalId ?? c.ana,
          ordem: 0,
          inicio: r.inicio,
          fim: r.fim,
          ocupadoAte: r.ocupadoAte ?? r.fim,
          status,
          encaixe: r.encaixe ?? false,
          precoCentavos: 5000,
          duracaoMin,
        },
      },
    },
    select: { id: true },
  });
  return reserva.id;
}

type LinhaDerivados = {
  id: string;
  status: string;
  inicio: Date;
  fim: Date;
  cancelada_em: Date | null;
  itens: number;
  status_esperado: string | null;
  inicio_esperado: Date | null;
  fim_esperado: Date | null;
};

/**
 * Verificador de consistência (D-050 R-2, dba.md Q1): confere, por SQL INDEPENDENTE de
 * `derivarReserva`, que cada reserva alvo tem ≥ 1 item, `status` = prioridade dos itens
 * (confirmado > concluido > nao_compareceu > cancelado), `inicio`/`fim` = envelope dos itens não
 * cancelados (de todos, se todos cancelados) e `cancelada_em` preenchido se e só se `cancelado`.
 * Alvo: uma reserva (`reservaId`) ou todas de um salão (`{ salaoId }`). Lança um Error com as
 * divergências; devolve quantas reservas conferiu.
 */
export async function conferirDerivados(alvo: string | { salaoId: string }): Promise<number> {
  const db = obterPrisma();
  const filtro = typeof alvo === 'string' ? Prisma.sql`r.id = ${alvo}::uuid` : Prisma.sql`r.salao_id = ${alvo.salaoId}::uuid`;
  const linhas = await db.$queryRaw<LinhaDerivados[]>`
    SELECT r.id::text AS id, r.status::text AS status, r.inicio, r.fim, r.cancelada_em,
           count(i.id)::int AS itens,
           CASE WHEN bool_or(i.status = 'confirmado') THEN 'confirmado'
                WHEN bool_or(i.status = 'concluido') THEN 'concluido'
                WHEN bool_or(i.status = 'nao_compareceu') THEN 'nao_compareceu'
                WHEN bool_or(i.status = 'cancelado') THEN 'cancelado' END AS status_esperado,
           COALESCE(min(i.inicio) FILTER (WHERE i.status <> 'cancelado'), min(i.inicio)) AS inicio_esperado,
           COALESCE(max(i.fim) FILTER (WHERE i.status <> 'cancelado'), max(i.fim)) AS fim_esperado
      FROM reserva r
      LEFT JOIN reserva_item i ON i.salao_id = r.salao_id AND i.reserva_id = r.id
     WHERE ${filtro}
     GROUP BY r.id`;
  if (typeof alvo === 'string' && linhas.length === 0) throw new Error(`conferirDerivados: reserva ${alvo} não existe`);
  const erros: string[] = [];
  for (const l of linhas) {
    if (l.itens === 0) {
      erros.push(`${l.id}: sem itens`);
      continue;
    }
    if (l.status !== l.status_esperado) erros.push(`${l.id}: status ${l.status} ≠ ${l.status_esperado}`);
    if (l.inicio.getTime() !== l.inicio_esperado!.getTime()) {
      erros.push(`${l.id}: inicio ${l.inicio.toISOString()} ≠ ${l.inicio_esperado!.toISOString()}`);
    }
    if (l.fim.getTime() !== l.fim_esperado!.getTime()) erros.push(`${l.id}: fim ${l.fim.toISOString()} ≠ ${l.fim_esperado!.toISOString()}`);
    if ((l.status === 'cancelado') !== (l.cancelada_em !== null)) {
      erros.push(`${l.id}: cancelada_em ${l.cancelada_em === null ? 'nulo' : 'preenchido'} com status ${l.status}`);
    }
  }
  if (erros.length > 0) throw new Error(`conferirDerivados: ${erros.join('; ')}`);
  return linhas.length;
}

/**
 * Pool Prisma DEDICADO ao teste (D-025 T-6d): troca, no cache de `obterPrisma`, o cliente da DATABASE_URL
 * por um com `max` conexões (o do harness é de 16) e devolve o original em `encerrar()`. O pool novo
 * conta contra `max_connections`; quem chama não deve passar de 24.
 */
export function instalarPoolDedicado(max: number): { encerrar(): Promise<void> } {
  const url = process.env.DATABASE_URL!;
  obterPrisma(url); // garante o cache e o cliente original
  const cache = (globalThis as unknown as { __clientesPrisma: Map<string, PrismaClient> }).__clientesPrisma;
  const original = cache.get(url);
  const dedicado = new PrismaClient({ adapter: new PrismaPg(configuracaoDoAdaptador(url, { max })) });
  cache.set(url, dedicado);
  return {
    encerrar: async () => {
      if (original) cache.set(url, original);
      else cache.delete(url);
      await dedicado.$disconnect();
    },
  };
}
