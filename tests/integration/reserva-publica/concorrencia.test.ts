import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { reservarPelaPagina } from '@/server/reserva-publica/servico';
import type { EntradaReservaPublica } from '@/server/reserva-publica/tipos';
import { obterPrisma } from '@/server/repos/db';

import { contarLinhas } from '../../support/reservas';
import { AGORA, criarCenarioReserva, enfileirar, entradaPublica } from '../../support/reserva-publica';
import { telefoneNovo } from '../../support/sql';

// D-026 T-3: CA-9 (envios simultâneos para o mesmo horário e profissional) e CA-8 em paralelo.
// Pool de testes de 16: 10 envios cabem com folga. Sem sleep: a serialização é da trava do profissional.

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterAll(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const reservar = (e: EntradaReservaPublica) => reservarPelaPagina(e, AGORA, { enfileirar });

describe('CA-9: envios simultâneos', () => {
  it.each([2, 10])('%i envios com chaves e clientes diferentes: uma criada, as outras voltam ao horário, sem 500', async (n) => {
    const c = await criarCenarioReserva();
    const antes = await contarLinhas(c.s.salaoId);
    const resultados = await Promise.all(
      Array.from({ length: n }, () => reservar(entradaPublica(c, { telefone: telefoneNovo(), chaveRequisicao: randomUUID() }))),
    );
    expect(resultados.filter((r) => r.resultado === 'confirmada')).toHaveLength(1);
    const outros = resultados.filter((r) => r.resultado !== 'confirmada');
    expect(outros).toHaveLength(n - 1);
    for (const r of outros) expect(r).toEqual({ resultado: 'voltar', passo: 'horario', aviso: 'horario_indisponivel' });
    const depois = await contarLinhas(c.s.salaoId);
    expect([depois.reserva, depois.itens, depois.mensagem, depois.consentimento]).toEqual([1, 1, 1, 1]);
    expect(depois.cliente - antes.cliente).toBe(1);
    expect(await obterPrisma().reserva.count({ where: { salaoId: c.s.salaoId, status: 'confirmado' } })).toBe(1);
  });

  it('o mesmo envio 10 vezes em paralelo (mesma chave): uma criada, as demais repetidas com a mesma confirmação', async () => {
    const c = await criarCenarioReserva();
    // D-027: 10 envios idênticos antes de qualquer commit consomem 10 do contador do número (padrão 5);
    // o limite sobe aqui para isolar a idempotência (o efeito do limite é coberto em tests/integration/protecao).
    vi.stubEnv('PROTECAO_LIMITE_NUMERO', '1000');
    const e = entradaPublica(c);
    const resultados = await Promise.all(Array.from({ length: 10 }, () => reservar(e)));
    expect(resultados.every((r) => r.resultado === 'confirmada')).toBe(true);
    const confirmadas = resultados.flatMap((r) => (r.resultado === 'confirmada' ? [r] : []));
    expect(confirmadas.filter((r) => !r.repetida)).toHaveLength(1);
    expect(new Set(confirmadas.map((r) => JSON.stringify(r.resumo))).size).toBe(1);
    const n = await contarLinhas(c.s.salaoId);
    expect([n.reserva, n.itens, n.mensagem]).toEqual([1, 1, 1]);
  });

  it('horários diferentes da mesma profissional em paralelo: todas confirmadas', async () => {
    const c = await criarCenarioReserva();
    const base = Date.parse(entradaPublica(c).inicio);
    const resultados = await Promise.all(
      [0, 1, 2, 3].map((i) =>
        reservar(entradaPublica(c, { inicio: new Date(base + i * 60 * 60_000).toISOString(), telefone: telefoneNovo() })),
      ),
    );
    expect(resultados.map((r) => r.resultado)).toEqual(Array(4).fill('confirmada'));
    expect((await contarLinhas(c.s.salaoId)).reserva).toBe(4);
  });
});
