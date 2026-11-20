import { existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { nomesDaExecucao, novoExec, urlComBase, validarPlanoDeBases, type PlanoDeBases } from '../../support/banco';
import {
  apagarBasesDaExecucao,
  apagarOrfas,
  binarioPrisma,
  executarPrisma,
  prepararTemplate,
  schemaDeProva,
  traduzirErroPg,
  type InicializadorDeSchema,
} from '../../support/db';

// Testes do harness contra o PostgreSQL real: inicializadores de schema (D-1, A-9), teardown (A-3),
// varredura de órfãs (A-6) e tradução de erros. Cada caso usa um `exec` próprio, distinto do desta execução.
const PORTA_FECHADA_TESTE = 'postgresql://agenda:x@localhost:1/agenda_beleza_test';

let admin: pg.Client;

beforeAll(async () => {
  admin = new pg.Client({ connectionString: inject('bancoDeTeste').urlTeste });
  await admin.connect();
});

afterAll(async () => {
  await admin.end();
});

/** Plano com um exec novo, mesmas bases e mesma base de dev capturada no globalSetup. */
function planoAvulso(exec = novoExec()): PlanoDeBases {
  const atual = inject('bancoDeTeste');
  return { ...validarPlanoDeBases({ TEST_DATABASE_URL: atual.urlTeste }, exec, 1), baseDev: atual.baseDev };
}

async function basesDoExec(plano: PlanoDeBases): Promise<string[]> {
  const r = await admin.query<{ datname: string }>('SELECT datname FROM pg_database ORDER BY datname');
  const { padraoDaExecucao } = nomesDaExecucao(plano.base, plano.exec);
  return r.rows.map((x) => x.datname).filter((n) => padraoDaExecucao.test(n));
}

describe('inicializadores de schema e teardown (D-1, A-2, A-3, A-9)', () => {
  it('prepararTemplate aplica migrações e inicializadores; o teardown apaga workers e template (inclusive worker inesperado)', async () => {
    const plano = planoAvulso();
    const nomes = nomesDaExecucao(plano.base, plano.exec);
    try {
      await prepararTemplate(plano, [schemaDeProva]);
      // VITEST_POOL_ID acima do previsto (R-3): o teardown lista o catálogo, não itera até maxWorkers.
      await admin.query(`CREATE DATABASE ${admin.escapeIdentifier(nomes.worker(7))} TEMPLATE ${admin.escapeIdentifier(nomes.template)}`);
      const w = new pg.Client({ connectionString: urlComBase(plano.urlTeste, nomes.worker(7)) });
      await w.connect();
      try {
        const r = await w.query<{ id: number }>('SELECT id FROM harness_extensao.marcador');
        expect(r.rows).toEqual([{ id: 1 }]);
      } finally {
        await w.end();
      }
      expect(await basesDoExec(plano)).toEqual([nomes.template, nomes.worker(7)]);

      // Workers antes do template.
      await expect(apagarBasesDaExecucao(plano)).resolves.toEqual([nomes.worker(7), nomes.template]);
    } finally {
      await apagarBasesDaExecucao(plano);
    }
    expect(await basesDoExec(plano)).toEqual([]);
  }, 60_000);

  it('R-1: inicializador que deixa a conexão aberta faz o preparo falhar nomeando-o, e o template é apagado', async () => {
    const plano = planoAvulso();
    const vazadas: pg.Client[] = [];
    const vazador: InicializadorDeSchema = {
      nome: 'vazador',
      async executar(url) {
        const c = new pg.Client({ connectionString: url });
        // O DROP … WITH (FORCE) do harness encerra a sessão: o erro esperado não pode derrubar o processo.
        c.on('error', () => undefined);
        await c.connect();
        vazadas.push(c);
      },
    };
    try {
      await expect(prepararTemplate(plano, [vazador])).rejects.toThrow(/application_name: harness:vazador/);
      expect(await basesDoExec(plano)).toEqual([]);
    } finally {
      await Promise.all(vazadas.map((c) => c.end().catch(() => undefined)));
      await apagarBasesDaExecucao(plano);
    }
  }, 60_000);

  it('inicializador que lança aborta o preparo com o nome dele, e o template é apagado', async () => {
    const plano = planoAvulso();
    const quebrado: InicializadorDeSchema = {
      nome: 'quebrado',
      async executar() {
        throw new Error('falha proposital');
      },
    };
    try {
      await expect(prepararTemplate(plano, [quebrado])).rejects.toThrow(/^Inicializador de schema "quebrado" falhou$/);
      expect(await basesDoExec(plano)).toEqual([]);
    } finally {
      await apagarBasesDaExecucao(plano);
    }
  }, 60_000);
});

describe('varredura de órfãs contra o catálogo (A-6)', () => {
  it('CA-17: apaga a base de uma execução com 7 h e mantém a de uma execução com 5 h e as desta execução', async () => {
    const agora = Date.now();
    const h = 60 * 60 * 1000;
    const velha = planoAvulso(novoExec(agora - 7 * h));
    const recente = planoAvulso(novoExec(agora - 5 * h));
    const nomeVelha = nomesDaExecucao(velha.base, velha.exec).worker(1);
    const nomeRecente = nomesDaExecucao(recente.base, recente.exec).worker(1);
    try {
      for (const nome of [nomeVelha, nomeRecente]) {
        await admin.query(`CREATE DATABASE ${admin.escapeIdentifier(nome)} TEMPLATE template0`);
      }
      const apagadas = await apagarOrfas(inject('bancoDeTeste'), agora);
      expect(apagadas).toContain(nomeVelha);
      expect(apagadas).not.toContain(nomeRecente);
      expect(await basesDoExec(velha)).toEqual([]);
      expect(await basesDoExec(recente)).toEqual([nomeRecente]);
      // As bases desta execução (template e worker) não foram tocadas.
      expect(await basesDoExec(inject('bancoDeTeste'))).not.toEqual([]);
    } finally {
      await apagarBasesDaExecucao(velha);
      await apagarBasesDaExecucao(recente);
    }
  }, 30_000);
});

describe('tradução de erros do PostgreSQL (dba.md §6)', () => {
  it('base administrativa inexistente vira mensagem própria com SQLSTATE 3D000 e sem a senha', async () => {
    const atual = inject('bancoDeTeste');
    const inexistente = { ...atual, urlTeste: urlComBase(atual.urlTeste, `nao_existe_${novoExec()}`) };
    const erro = await apagarOrfas(inexistente).catch((e: Error) => e);
    expect(erro).toBeInstanceOf(Error);
    expect((erro as Error).message).toMatch(/^Harness \(orfas\): a base de TEST_DATABASE_URL não existe.*SQLSTATE 3D000/);
    expect((erro as Error).message).not.toContain(new URL(atual.urlTeste).password);
    expect(erro).toMatchObject({ code: '3D000' });
  });

  it.each(['55006', '42501', '53300'])('SQLSTATE %s ganha mensagem própria e mantém o code', (code) => {
    const e = traduzirErroPg(Object.assign(new Error('x'), { code }), 'reset');
    expect(e).toMatchObject({ code, message: expect.stringMatching(new RegExp(`^Harness \\(reset\\): .*SQLSTATE ${code}\\)$`)) });
  });

  it('outros erros passam intactos', () => {
    const original = Object.assign(new Error('x'), { code: '23505' });
    expect(traduzirErroPg(original, 'reset')).toBe(original);
    expect(traduzirErroPg(null, 'reset')).toBeNull();
  });
});

describe('executarPrisma', () => {
  it('resolve o binário do Prisma por caminho absoluto existente', () => {
    const bin = binarioPrisma();
    expect(isAbsolute(bin)).toBe(true);
    expect(existsSync(bin)).toBe(true);
  });

  it('sobrescreve DATABASE_URL do ambiente e do .env pela URL recebida', () => {
    const r = executarPrisma(['migrate', 'status'], PORTA_FECHADA_TESTE);
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain('database "agenda_beleza_test"');
    expect(r.stdout).toContain('at "localhost:1"');
    expect(r.stderr).toContain('P1001');
    // Sobe o Prisma CLI num processo filho: com a suíte inteira e a cobertura ligada passou de 5 s na CI (DEF-CI-1 da D-016).
  }, 30_000);
});
