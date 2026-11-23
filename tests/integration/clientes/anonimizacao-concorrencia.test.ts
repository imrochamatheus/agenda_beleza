import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { anonimizarCliente } from '@/server/clientes/anonimizar';
import type { DepsAnonimizar } from '@/server/clientes/anonimizar';
import { editar, upsertCliente } from '@/server/clientes/servico';
import { enviarMensagem } from '@/server/mensagens/envio';
import { registrarMensagem } from '@/server/mensagens/registrar';
import { reenviarMensagem } from '@/server/mensagens/reenviar';
import { repoMensagemSistema } from '@/server/repos/mensagem-sistema';
import { emTransacao } from '@/server/repos/transacao';
import { NaoEncontrado } from '@/server/tenant/erros';

import { criarSalaoCompleto, instanteFuturo } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { criarMensagem } from '../../support/mensagens';
import { conectar } from '../../support/sql';

import { ctxDoGestor, inserirCliente, inserirReservaComPreco, linhaCliente } from './apoio';

// D-031 T-2: concorrência da anonimização com PostgreSQL real (CA-10, CA-11, R-1). Dez chamadas iguais em
// paralelo; anonimizar × edição de telefone × upsert × registro × envio × reenvio × reconciliação (×10);
// e casos determinísticos com pg_stat_activity (trava do salão, linha da cliente, upsert do número antigo).
// Nenhum caso pode terminar em exceção inesperada, impasse (40P01) ou 23505.

const TIMEOUT = 60_000;
const VEZES = 10;
const AGORA = new Date('2026-11-22T12:00:00Z');

let c: pg.Client;
let trava: pg.Client;
let s: SalaoCompleto;

beforeAll(async () => {
  c = await conectar();
  trava = await conectar();
  s = await criarSalaoCompleto();
});
afterAll(async () => {
  await trava.end();
  await c.end();
});
beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

let seq = 0;
let dia = 100;
const telefone = () => `+55119${String(40_000_000 + ++seq).padStart(8, '0')}`;

async function cenario(): Promise<{ clienteId: string; tel: string; reservaId: string }> {
  const tel = telefone();
  const clienteId = await inserirCliente(c, s.salaoId, 'Concorrente', tel);
  const reservaId = await inserirReservaComPreco(c, {
    salaoId: s.salaoId,
    profissionalId: s.gestor.profissionalId as string,
    clienteId,
    inicio: instanteFuturo((dia += 1), 13),
    status: 'confirmado',
    itens: [{ servicoId: s.servicos.ativos[0], precoCentavos: 9000, duracaoMin: 60 }],
    // D-050: `cancelamento` exige revisão ≥ 1 (cancelar incrementa a revisão antes de registrar).
    revisao: 1,
  });
  return { clienteId, tel, reservaId };
}

const anonimizar = (clienteId: string, deps: DepsAnonimizar = {}) => anonimizarCliente(ctxDoGestor(s), { clienteId }, AGORA, deps);

async function esperando(marcador: string): Promise<number> {
  const { rows } = await c.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND pid <> pg_backend_pid()
        AND wait_event_type = 'Lock' AND query LIKE $1`,
    [`%${marcador}%`],
  );
  return rows[0].n;
}

async function aguardarEsperando(marcador: string, n = 1): Promise<void> {
  const limite = Date.now() + 10_000;
  while ((await esperando(marcador)) < n) {
    if (Date.now() > limite) throw new Error(`esperava ${n} consulta(s) bloqueada(s) em "${marcador}"`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Só `NaoEncontrado` (a edição que chega depois da anonimização) é rejeição aceitável. */
function semFalhaInesperada(rs: PromiseSettledResult<unknown>[]): void {
  for (const r of rs) {
    if (r.status === 'rejected') {
      expect(r.reason, String(r.reason)).toBeInstanceOf(NaoEncontrado);
    }
  }
}

describe('CA-10: dez chamadas em paralelo', () => {
  it('×10: uma anonimização efetiva, nove recusadas, sem erro; anonimizada_em do vencedor', async () => {
    for (let i = 0; i < VEZES; i += 1) {
      const k = await cenario();
      const rs = await Promise.all(Array.from({ length: 10 }, () => anonimizar(k.clienteId)));
      expect(rs.filter((r) => r.resultado === 'anonimizada')).toHaveLength(1);
      expect(rs.filter((r) => r.resultado === 'recusado')).toHaveLength(9);
      expect(await linhaCliente(c, k.clienteId)).toMatchObject({ nome: null, telefone_e164: null });
    }
  }, TIMEOUT);
});

describe('CA-11: anonimizar × edição × upsert × registro × envio × reenvio × reconciliação', () => {
  it('×10: sem impasse; cliente e mensagens da reserva sem dado pessoal; mensagens pendentes/falhou canceladas', async () => {
    for (let i = 0; i < VEZES; i += 1) {
      const k = await cenario();
      const pendente = await criarMensagem({ salaoId: s.salaoId, reservaId: k.reservaId, tipo: 'confirmacao', estado: 'pendente', destinatarioE164: k.tel });
      const falhou = await criarMensagem({ salaoId: s.salaoId, reservaId: k.reservaId, tipo: 'remarcacao', revisao: 1, estado: 'falhou', erroCodigo: 'erro_x', destinatarioE164: k.tel });
      const enviando = await criarMensagem({ salaoId: s.salaoId, reservaId: k.reservaId, tipo: 'convite_avaliacao', estado: 'enviando', destinatarioE164: k.tel, atualizadoEm: new Date(Date.now() - 3_600_000) });
      const whatsapp = { enviarModelo: vi.fn().mockResolvedValue({ provedorMensagemId: 'wamid.T' }) };
      const log = vi.fn();
      const enfileirar = vi.fn().mockResolvedValue({ criado: true, id: 'j' });

      const rs = await Promise.allSettled([
        anonimizar(k.clienteId),
        anonimizar(k.clienteId),
        editar(ctxDoGestor(s), { id: k.clienteId, nome: 'Novo Nome', telefone: telefone() }),
        upsertCliente(ctxDoGestor(s), { telefone: k.tel, nome: 'Outra Pessoa' }),
        emTransacao((r) => registrarMensagem(ctxDoGestor(s), { reservaId: k.reservaId, tipo: 'cancelamento' }, AGORA, r)),
        enviarMensagem(pendente, { atual: 1, maxima: 5 }, { whatsapp: () => whatsapp as never, agora: () => AGORA, log }),
        reenviarMensagem(ctxDoGestor(s), falhou, AGORA, { enfileirar }),
        repoMensagemSistema().expirarEnviandoPresas(new Date(Date.now() - 60_000), 100, AGORA),
      ]);
      semFalhaInesperada(rs);

      expect(await linhaCliente(c, k.clienteId)).toMatchObject({ nome: null, telefone_e164: null });
      const { rows } = await c.query<{ id: string; estado: string; destinatario_e164: string | null; parametros: unknown }>(
        'SELECT id::text AS id, estado::text, destinatario_e164, parametros FROM mensagem WHERE reserva_id = $1',
        [k.reservaId],
      );
      for (const m of rows) {
        expect(m.destinatario_e164, `mensagem ${m.id} (${m.estado})`).toBeNull();
        expect(m.parametros).toBeNull();
        expect(['pendente', 'falhou']).not.toContain(m.estado);
      }
      expect(rows.find((m) => m.id === enviando)).toBeDefined();
      const t = await c.query<{ n: string }>(
        'SELECT count(*) AS n FROM mensagem_tentativa t JOIN mensagem m ON m.id = t.mensagem_id WHERE m.reserva_id = $1 AND t.erro_detalhe ~ $2',
        [k.reservaId, k.tel.slice(3)],
      );
      expect(Number(t.rows[0].n)).toBe(0);
    }
  }, TIMEOUT);
});

describe('casos determinísticos com pg_stat_activity', () => {
  it('a anonimização espera a trava do salão e conclui quando ela é solta', async () => {
    const k = await cenario();
    await trava.query('BEGIN');
    await trava.query('SELECT id FROM salao WHERE id = $1 FOR NO KEY UPDATE', [s.salaoId]);
    try {
      const p = anonimizar(k.clienteId);
      await aguardarEsperando('FROM salao');
      expect((await linhaCliente(c, k.clienteId)).anonimizada_em).toBeNull();
      await trava.query('COMMIT');
      expect(await p).toMatchObject({ resultado: 'anonimizada' });
    } finally {
      await trava.query('ROLLBACK').catch(() => {});
    }
  }, TIMEOUT);

  it('o registro de mensagem (FOR KEY SHARE) espera o FOR UPDATE da anonimização e nasce cancelada_anonimizacao', async () => {
    const k = await cenario();
    let liberar!: () => void;
    const segura = new Promise<void>((ok) => (liberar = ok));
    let chegou!: () => void;
    const noPonto = new Promise<void>((ok) => (chegou = ok));
    const anon = anonimizar(k.clienteId, {
      aposCliente: () => {
        chegou();
        return segura;
      },
    });
    await noPonto;
    const registro = emTransacao((r) => registrarMensagem(ctxDoGestor(s), { reservaId: k.reservaId, tipo: 'cancelamento' }, AGORA, r));
    await aguardarEsperando('FOR KEY SHARE');
    liberar();
    expect(await anon).toMatchObject({ resultado: 'anonimizada' });
    const r = await registro;
    const { rows } = await c.query<{ estado: string; destinatario_e164: string | null }>('SELECT estado::text, destinatario_e164 FROM mensagem WHERE id = $1', [r.mensagemId]);
    expect(rows[0]).toEqual({ estado: 'cancelada_anonimizacao', destinatario_e164: null });
  }, TIMEOUT);

  it('upsert do número antigo espera a anonimização e cria cliente nova, sem 23505', async () => {
    const k = await cenario();
    let liberar!: () => void;
    const segura = new Promise<void>((ok) => (liberar = ok));
    let chegou!: () => void;
    const noPonto = new Promise<void>((ok) => (chegou = ok));
    const anon = anonimizar(k.clienteId, {
      aposCliente: () => {
        chegou();
        return segura;
      },
    });
    await noPonto;
    const up = upsertCliente(ctxDoGestor(s), { telefone: k.tel, nome: 'Dona Nova' });
    await aguardarEsperando('INSERT INTO cliente');
    liberar();
    expect(await anon).toMatchObject({ resultado: 'anonimizada' });
    const r = await up;
    expect(r).toMatchObject({ resultado: 'ok', criada: true });
    if (r.resultado !== 'ok') throw new Error('esperado ok');
    expect(r.cliente.id).not.toBe(k.clienteId);
    expect(await linhaCliente(c, k.clienteId)).toMatchObject({ nome: null, telefone_e164: null });
  }, TIMEOUT);

  it('a edição de telefone que espera a anonimização termina como NaoEncontrado', async () => {
    const k = await cenario();
    let liberar!: () => void;
    const segura = new Promise<void>((ok) => (liberar = ok));
    let chegou!: () => void;
    const noPonto = new Promise<void>((ok) => (chegou = ok));
    const anon = anonimizar(k.clienteId, {
      aposTravar: () => {
        chegou();
        return segura;
      },
    });
    await noPonto;
    const ed = editar(ctxDoGestor(s), { id: k.clienteId, nome: 'Novo', telefone: telefone() });
    const desfecho = ed.then(
      () => 'ok',
      (e: unknown) => e,
    );
    await aguardarEsperando('FROM salao');
    liberar();
    expect(await anon).toMatchObject({ resultado: 'anonimizada' });
    expect(await desfecho).toBeInstanceOf(NaoEncontrado);
  }, TIMEOUT);
});
