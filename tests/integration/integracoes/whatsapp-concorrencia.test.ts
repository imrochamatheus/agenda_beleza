import { randomUUID } from 'node:crypto';

import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ErroEnvioTemporario } from '@/server/integrations/whatsapp/port';
import { criarWhatsAppSimulado } from '@/server/integrations/whatsapp/simulado';

import { conectar, telefoneNovo } from '../../support/sql';

// CA-21 (RN-19): o consumo da falha forçada é atômico entre conexões. N envios concorrentes pela
// porta (pool do Prisma de 16 conexões do harness, aquecido antes do disparo) com F falhas forçadas
// → exatamente F falhas e N − F sucessos, com N linhas registradas e a fila vazia.
// O caso com F = 5 é o que detecta a remoção do `FOR UPDATE SKIP LOCKED` (dba.md §7): com F = 1 o
// DELETE … RETURNING já é atômico por si, e a versão sem trava também daria exatamente 1 falha.
// Sem a trava, os concorrentes escolhem a mesma linha, só um a apaga, e as falhas "sobram".

const N = 12;
const RODADAS = 3;
const wa = criarWhatsAppSimulado();

let c: pg.Client;

beforeAll(async () => {
  c = await conectar();
  // Abre as conexões do pool antes do disparo: nenhum envio começa "atrasado" pela conexão.
  await Promise.all(Array.from({ length: 16 }, () => wa.listarChamadas({ chaveIdempotencia: 'aquecimento' })));
});
afterAll(async () => {
  await c.end();
});

async function falhasPendentes(): Promise<number> {
  const r = await c.query<{ n: number }>('SELECT count(*)::int AS n FROM sim_whatsapp_falha_forcada');
  return r.rows[0].n;
}

/** Dispara N envios concorrentes com a mesma chave (única por rodada) e confere o resultado. */
async function rodada(falhasForcadas: number): Promise<void> {
  expect(await falhasPendentes()).toBe(0);
  await wa.forcarFalhas(falhasForcadas, 'temporaria');
  const chave = `${randomUUID()}:confirmacao:1`;

  const r = await Promise.allSettled(
    Array.from({ length: N }, () =>
      wa.enviarModelo({
        destinatarioE164: telefoneNovo(),
        modelo: 'confirmacao',
        parametros: { nome: 'Ana' },
        chaveIdempotencia: chave,
      }),
    ),
  );

  const falhas = r.filter((x): x is PromiseRejectedResult => x.status === 'rejected');
  const sucessos = r.filter((x) => x.status === 'fulfilled');
  expect(falhas).toHaveLength(falhasForcadas);
  expect(sucessos).toHaveLength(N - falhasForcadas);
  for (const f of falhas) expect(f.reason).toBeInstanceOf(ErroEnvioTemporario);

  const chamadas = await wa.listarChamadas({ chaveIdempotencia: chave });
  expect(chamadas).toHaveLength(N);
  expect(chamadas.filter((x) => x.resultado === 'falha')).toHaveLength(falhasForcadas);
  expect(chamadas.filter((x) => x.resultado === 'sucesso')).toHaveLength(N - falhasForcadas);
  expect(await falhasPendentes()).toBe(0);
}

describe(`CA-21: falha forçada consumida atomicamente com ${N} envios concorrentes`, () => {
  it(`CA-21: 1 falha forçada e ${N} envios concorrentes → exatamente 1 falha, ${N - 1} sucessos e ${N} linhas`, async () => {
    for (let i = 0; i < RODADAS; i++) await rodada(1);
  });

  it(`CA-21: 5 falhas forçadas e ${N} envios concorrentes → exatamente 5 falhas, ${N - 5} sucessos e ${N} linhas`, async () => {
    for (let i = 0; i < RODADAS; i++) await rodada(5);
  });

  it(`CA-21: 20 falhas forçadas e ${N} envios concorrentes → ${N} falhas e 8 falhas ainda pendentes`, async () => {
    expect(await falhasPendentes()).toBe(0);
    await wa.forcarFalhas(20, 'permanente');
    const chave = `${randomUUID()}:cancelamento:1`;
    const r = await Promise.allSettled(
      Array.from({ length: N }, () =>
        wa.enviarModelo({ destinatarioE164: telefoneNovo(), modelo: 'cancelamento', parametros: {}, chaveIdempotencia: chave }),
      ),
    );
    expect(r.filter((x) => x.status === 'rejected')).toHaveLength(N);
    expect(await wa.listarChamadas({ chaveIdempotencia: chave })).toHaveLength(N);
    expect(await falhasPendentes()).toBe(8);
  });
});
