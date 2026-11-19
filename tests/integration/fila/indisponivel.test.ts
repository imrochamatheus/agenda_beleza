import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { type ClienteFila, criarClienteFila } from '@/server/queue/client';
import { ErroFilaIndisponivel } from '@/server/queue/erros';
import { FILA } from '@/server/queue/filas';

import { urlDoWorker } from '../../support/db';
import { envDeTeste } from '../../support/fila';

// CA-16 (RN-12): fila indisponível vira ErroFilaIndisponivel tipado, com motivo, sem a senha da URL na
// mensagem nem na `cause` serializada. Ordem importa: o último caso apaga o schema desta base.

const clientes: ClienteFila[] = [];

afterAll(async () => {
  await Promise.all(clientes.map((c) => c.encerrar()));
});

async function falhaDe(url: string): Promise<ErroFilaIndisponivel> {
  const c = criarClienteFila(envDeTeste({ DATABASE_URL: url }));
  clientes.push(c);
  try {
    await c.enfileirar(FILA.exemplo, {});
  } catch (e) {
    expect(e).toBeInstanceOf(ErroFilaIndisponivel);
    return e as ErroFilaIndisponivel;
  }
  throw new Error('enfileirar deveria ter falhado');
}

function semSenha(erro: ErroFilaIndisponivel, senha: string) {
  expect(senha.length).toBeGreaterThan(3);
  for (const texto of [erro.message, JSON.stringify(erro.cause), JSON.stringify(erro), String(erro.stack)]) {
    expect(texto).not.toContain(senha);
  }
}

const senhaDe = (url: string) => decodeURIComponent(new URL(url).password);

describe('CA-16: fila indisponível', () => {
  it('fila inexistente (o worker nunca rodou nesta base) → fila_inexistente', async () => {
    const erro = await falhaDe(urlDoWorker());
    expect(erro.motivo).toBe('fila_inexistente');
    expect(erro.fila).toBe('exemplo');
    expect(erro.message).toBe('Fila "exemplo" indisponível (fila_inexistente)');
    semSenha(erro, senhaDe(urlDoWorker()));
  });

  it('servidor fora do ar (porta fechada) → conexao', async () => {
    const url = 'postgresql://agenda:senha-porta-fechada@localhost:1/agenda';
    const erro = await falhaDe(url);
    expect(erro.motivo).toBe('conexao');
    expect(erro.codigo).toBe('ECONNREFUSED');
    semSenha(erro, 'senha-porta-fechada');
  }, 30_000);

  it('base sem o schema pgboss → schema_ausente', async () => {
    const c = new pg.Client({ connectionString: urlDoWorker() });
    await c.connect();
    try {
      await c.query('DROP SCHEMA pgboss CASCADE');
    } finally {
      await c.end();
    }
    const erro = await falhaDe(urlDoWorker());
    expect(erro.motivo).toBe('schema_ausente');
    expect(erro.cause).toEqual({ nome: 'Error', codigo: null });
    semSenha(erro, senhaDe(urlDoWorker()));
  });
});
