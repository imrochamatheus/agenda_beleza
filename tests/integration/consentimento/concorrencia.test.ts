import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { editar, upsertCliente } from '@/server/clientes/servico';
import { registrarConsentimento, registrarConsentimentoDaReserva } from '@/server/consentimento/servico';

import { criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar, telefoneNovo } from '../../support/sql';

import { AGORA, ctxDoGestor, ctxPublico, inserirCliente, linhasDe } from './apoio';

// D-023 T-5: concorrência com PostgreSQL real (CA-15, R-1). Dez registros em paralelo, junto com upsert
// e edição de telefone da mesma cliente (cada rodada ×10), e dois casos determinísticos com
// pg_stat_activity: o registro (FOR KEY SHARE) espera o FOR UPDATE da edição/anonimização, e a edição
// espera o registro. Nenhum caso pode terminar em exceção, impasse ou 23505.

const TIMEOUT = 30_000;
const VEZES = 10;
const aceites = { mensagensReserva: true, conviteAvaliacao: true };

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

async function esperando(marcador: string): Promise<number> {
  const { rows } = await c.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND pid <> pg_backend_pid()
        AND wait_event_type = 'Lock' AND query LIKE $1`,
    [`%${marcador}%`],
  );
  return rows[0].n;
}

async function aguardarEsperando(marcador: string, n: number): Promise<void> {
  const limite = Date.now() + 10_000;
  while ((await esperando(marcador)) < n) {
    if (Date.now() > limite) throw new Error(`esperava ${n} consulta(s) bloqueada(s) em "${marcador}"`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('CA-15: registros em paralelo', () => {
  it(
    '10 registros da mesma cliente ×10 rodadas: todos concluem, 2 linhas cada',
    async () => {
      for (let i = 0; i < VEZES; i += 1) {
        const clienteId = await inserirCliente(c, s.salaoId, 'Paralela');
        const rs = await Promise.all(
          Array.from({ length: 10 }, () => registrarConsentimentoDaReserva(ctxPublico(s), { clienteId, aceites, origem: 'publico', agora: AGORA })),
        );
        expect(rs.every((r) => r.ok && r.registrados.length === 2)).toBe(true);
        const linhas = await linhasDe(c, clienteId);
        expect(linhas).toHaveLength(20);
        expect(linhas.filter((l) => l.finalidade === 'mensagens_reserva')).toHaveLength(10);
        expect(linhas.filter((l) => l.finalidade === 'convite_avaliacao')).toHaveLength(10);
      }
    },
    TIMEOUT,
  );

  it(
    '10 registros × upsert × edição de telefone da mesma cliente ×10 rodadas: sem erro, sem impasse, sem 23505',
    async () => {
      for (let i = 0; i < VEZES; i += 1) {
        const antigo = telefoneNovo();
        const novo = telefoneNovo();
        const clienteId = await inserirCliente(c, s.salaoId, 'Mexida', antigo);
        const tarefas: Promise<unknown>[] = Array.from({ length: 10 }, () =>
          registrarConsentimentoDaReserva(ctxPublico(s), { clienteId, aceites, origem: 'publico', agora: AGORA }),
        );
        tarefas.push(
          upsertCliente(ctxPublico(s), { nome: 'Mexida', telefone: antigo }),
          upsertCliente(ctxPublico(s), { nome: 'Mexida', telefone: antigo }),
          editar(ctxDoGestor(s), { id: clienteId, nome: 'Mexida', telefone: novo }),
        );
        const resultados = await Promise.all(tarefas);
        for (const r of resultados.slice(0, 10)) expect(r).toMatchObject({ ok: true });
        expect(await linhasDe(c, clienteId)).toHaveLength(20);
      }
    },
    TIMEOUT,
  );
});

describe('A-4: ordem de espera, determinística', () => {
  it(
    'o registro espera o FOR UPDATE da cliente (edição/anonimização) e conclui quando ela termina',
    async () => {
      const clienteId = await inserirCliente(c, s.salaoId, 'Segurada');
      await trava.query('BEGIN');
      await trava.query('SELECT 1 FROM cliente WHERE id = $1 FOR UPDATE', [clienteId]);
      const registro = registrarConsentimento(ctxPublico(s), { clienteId, finalidade: 'mensagens_reserva', origem: 'publico', agora: AGORA });
      await aguardarEsperando('FOR KEY SHARE', 1);
      expect(await linhasDe(c, clienteId)).toEqual([]);
      await trava.query('COMMIT');
      await expect(registro).resolves.toMatchObject({ finalidade: 'mensagens_reserva' });
      expect(await linhasDe(c, clienteId)).toHaveLength(1);
    },
    TIMEOUT,
  );

  it(
    'anonimização confirmada primeiro: o registro que esperava é recusado (NaoEncontrado), sem linha',
    async () => {
      const clienteId = await inserirCliente(c, s.salaoId, 'Anonimizando');
      await trava.query('BEGIN');
      await trava.query('SELECT 1 FROM cliente WHERE id = $1 FOR UPDATE', [clienteId]);
      const registro = registrarConsentimento(ctxPublico(s), { clienteId, finalidade: 'mensagens_reserva', origem: 'publico', agora: AGORA });
      const desfecho = registro.then(
        () => 'gravou',
        (e: Error) => e.name,
      );
      await aguardarEsperando('FOR KEY SHARE', 1);
      await trava.query('UPDATE cliente SET nome = NULL, telefone_e164 = NULL, anonimizada_em = now() WHERE id = $1', [clienteId]);
      await trava.query('COMMIT');
      expect(await desfecho).toBe('NaoEncontrado');
      expect(await linhasDe(c, clienteId)).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'a edição de telefone espera um registro ainda aberto e depois conclui',
    async () => {
      const clienteId = await inserirCliente(c, s.salaoId, 'Em Registro');
      await trava.query('BEGIN');
      await trava.query('SELECT 1 FROM cliente WHERE id = $1 FOR KEY SHARE', [clienteId]);
      const edicao = editar(ctxDoGestor(s), { id: clienteId, nome: 'Em Registro', telefone: telefoneNovo() });
      await aguardarEsperando('anonimizada_em IS NULL', 1);
      await trava.query('COMMIT');
      await expect(edicao).resolves.toMatchObject({ resultado: 'ok', alterada: true });
    },
    TIMEOUT,
  );
});
