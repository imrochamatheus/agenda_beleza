import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';
import { inject } from 'vitest';

import {
  nomesDaExecucao,
  selecionarOrfas,
  urlComAplicacao,
  urlComBase,
  validarNomeDerivado,
  type PlanoDeBases,
} from './banco';

// Harness de integração da D-005 (§3.6 do desenho; ajustes A-1..A-3, A-5, A-6 e A-9 do DBA):
// - um TEMPLATE por execução (migrações + inicializadores de schema), criado no globalSetup;
// - uma base por worker do Vitest, RECRIADA a partir do template no início de cada arquivo;
// - teardown e varredura de órfãs por DROP DATABASE … WITH (FORCE).
// RN-14: nada de esvaziar tabelas, de reset ou push de schema pelo Prisma, nem de transação com rollback.
// Nenhuma operação do harness roda dentro de BEGIN: CREATE/DROP DATABASE não aceitam transação.

// Raiz do repositório. fileURLToPath (e não URL.pathname): o caminho tem espaço e acento.
const RAIZ = fileURLToPath(new URL('../..', import.meta.url));

/**
 * Pool do Prisma nos testes (`configurarPool` no setup de cada arquivo). ≥ 12, o maior teste paralelo
 * previsto (CA-2 da E3.2). Orçamento: 4 workers × (16 + 2) ≈ 72 conexões de 100 (dba.md §2.4).
 */
export const POOL_MAX_TESTES = 16;

/** Tempo máximo da conferência de sessões no template antes de falhar (A-9). */
const ESPERA_SESSOES_MS = 2000;

export type InicializadorDeSchema = {
  nome: string;
  /**
   * Recebe a URL do template já com `application_name=harness:<nome>` (A-9). Contrato (dba.md §2.6):
   * roda depois do `migrate deploy`; cria objetos só fora de `public`; AGUARDA o fechamento de todas
   * as conexões que abriu (uma sessão esquecida no template impede a cópia, SQLSTATE 55006).
   */
  executar(urlTemplate: string): Promise<void>;
};

/** Schema de prova do ponto de extensão (D-1): mínimo, sem trigger nem função (dba.md §2.6, item 6). */
export const schemaDeProva: InicializadorDeSchema = {
  nome: 'schema-de-prova',
  async executar(urlTemplate) {
    const c = new pg.Client({ connectionString: urlTemplate });
    await c.connect();
    try {
      await c.query('CREATE SCHEMA harness_extensao');
      await c.query('CREATE TABLE harness_extensao.marcador (id int PRIMARY KEY)');
      await c.query('INSERT INTO harness_extensao.marcador (id) VALUES (1)');
    } finally {
      await c.end();
    }
  },
};

/** Inicializadores executados no template, em ordem. A E0.7 acrescenta o do pg-boss. */
export const INICIALIZADORES: InicializadorDeSchema[] = [schemaDeProva];

/** Caminho absoluto do binário do Prisma CLI (node_modules/.bin/prisma), resolvido a partir da raiz do repo. */
export function binarioPrisma(): string {
  return join(RAIZ, 'node_modules', '.bin', 'prisma');
}

/**
 * Executa o Prisma CLI com DATABASE_URL = url (sobrescrita explícita). Sem shell: o caminho do
 * repositório tem espaço e acento. O prisma.config.ts usa process.loadEnvFile(), que não
 * sobrescreve variáveis já definidas, então a URL passada aqui prevalece sobre o .env.
 */
export function executarPrisma(
  args: string[],
  url: string,
): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(binarioPrisma(), args, {
    cwd: RAIZ,
    env: { ...process.env, DATABASE_URL: url },
    encoding: 'utf8',
  });
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** Mensagens próprias (sem credenciais) para os erros previstos pelo DBA (dba.md §6). */
const MENSAGENS_PG: Record<string, string> = {
  '55006': 'o template da execução está em uso por outra sessão (alguma conexão ficou aberta nele)',
  '42501': 'permissão negada: o papel de TEST_DATABASE_URL precisa de CREATEDB e ser dono das bases do harness',
  '53300': 'conexões esgotadas no PostgreSQL (max_connections): reduza execuções simultâneas ou pare app/worker do compose',
  '3D000': 'a base de TEST_DATABASE_URL não existe: crie-a (docker compose exec postgres createdb -U agenda <base>)',
};

/** Traduz os SQLSTATE conhecidos; os demais erros (inclusive ECONNREFUSED) passam intactos. */
export function traduzirErroPg(e: unknown, operacao: string): unknown {
  const codigo = (e as { code?: unknown } | null)?.code;
  if (typeof codigo === 'string' && codigo in MENSAGENS_PG) {
    const erro = new Error(`Harness (${operacao}): ${MENSAGENS_PG[codigo]} (SQLSTATE ${codigo})`, { cause: e });
    return Object.assign(erro, { code: codigo });
  }
  return e;
}

/** Abre uma conexão administrativa (base de TEST_DATABASE_URL), executa `fn` e fecha. */
async function comAdmin<T>(plano: PlanoDeBases, operacao: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: urlComAplicacao(plano.urlTeste, `harness:${operacao}`) });
  try {
    await c.connect();
    return await fn(c);
  } catch (e) {
    throw traduzirErroPg(e, operacao);
  } finally {
    await c.end().catch(() => undefined);
  }
}

async function apagarBase(c: pg.Client, nome: string): Promise<void> {
  await c.query(`DROP DATABASE IF EXISTS ${c.escapeIdentifier(nome)} WITH (FORCE)`);
}

/** Bases do catálogo cujo dono é o papel atual e que não são template de sistema (A-6). */
async function basesProprias(c: pg.Client): Promise<string[]> {
  const r = await c.query<{ datname: string }>(
    `SELECT datname FROM pg_database
     WHERE NOT datistemplate AND datdba = (SELECT oid FROM pg_roles WHERE rolname = current_user)
     ORDER BY datname`,
  );
  return r.rows.map((x) => x.datname);
}

async function sessoesNaBase(c: pg.Client, nome: string): Promise<string[]> {
  const r = await c.query<{ application_name: string }>(
    'SELECT application_name FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
    [nome],
  );
  return r.rows.map((x) => x.application_name || '(sem application_name)');
}

/**
 * Cria e prepara o template da execução: `CREATE DATABASE … TEMPLATE template0 ENCODING 'UTF8'` (A-1),
 * `migrate deploy`, inicializadores em sequência, conferência de sessões (A-9) e
 * `ALLOW_CONNECTIONS false` (A-2). Em qualquer falha depois do CREATE, apaga o template e relança (A-3).
 */
export async function prepararTemplate(
  plano: PlanoDeBases,
  inicializadores: readonly InicializadorDeSchema[] = INICIALIZADORES,
): Promise<void> {
  const template = validarNomeDerivado(nomesDaExecucao(plano.base, plano.exec).template, plano);
  const urlTemplate = urlComBase(plano.urlTeste, template);

  await comAdmin(plano, 'template', async (c) => {
    await c.query(`CREATE DATABASE ${c.escapeIdentifier(template)} TEMPLATE template0 ENCODING 'UTF8'`);
    try {
      const enc = await c.query<{ e: string }>(
        'SELECT pg_encoding_to_char(encoding) AS e FROM pg_database WHERE datname = $1',
        [template],
      );
      if (enc.rows[0]?.e !== 'UTF8') {
        throw new Error('O template da execução não ficou em UTF8: confira o locale do cluster');
      }

      const r = executarPrisma(['migrate', 'deploy'], urlTemplate);
      if (r.status !== 0) {
        throw new Error(`prisma migrate deploy no template falhou (status ${r.status}):\n${r.stderr}\n${r.stdout}`);
      }

      for (const ini of inicializadores) {
        try {
          await ini.executar(urlComAplicacao(urlTemplate, `harness:${ini.nome}`));
        } catch (e) {
          throw new Error(`Inicializador de schema "${ini.nome}" falhou`, { cause: e });
        }
      }

      // Conferência (A-9): repetida por até 2 s (um autovacuum pode aparecer e sumir).
      const limite = Date.now() + ESPERA_SESSOES_MS;
      let sessoes = await sessoesNaBase(c, template);
      while (sessoes.length > 0 && Date.now() < limite) {
        await new Promise((ok) => setTimeout(ok, 100));
        sessoes = await sessoesNaBase(c, template);
      }
      if (sessoes.length > 0) {
        throw new Error(
          `Sessões abertas no template depois dos inicializadores (application_name: ${[...new Set(sessoes)].join(', ')}). ` +
            'Todo inicializador deve aguardar o fechamento das próprias conexões.',
        );
      }

      // A-2: depois da conferência. Uma conexão indevida ao template passa a falhar na hora.
      await c.query(`ALTER DATABASE ${c.escapeIdentifier(template)} ALLOW_CONNECTIONS false`);
    } catch (e) {
      await apagarBase(c, template).catch(() => undefined);
      throw e;
    }
  });
}

/**
 * Apaga as bases DESTA execução listadas no catálogo (A-3): workers primeiro, template por último.
 * Cobre um VITEST_POOL_ID acima do previsto. Devolve os nomes apagados.
 */
export async function apagarBasesDaExecucao(plano: PlanoDeBases): Promise<string[]> {
  const { padraoDaExecucao, template } = nomesDaExecucao(plano.base, plano.exec);
  return comAdmin(plano, 'teardown', async (c) => {
    const nomes = (await basesProprias(c)).filter((n) => padraoDaExecucao.test(n));
    const ordem = [...nomes.filter((n) => n !== template), ...nomes.filter((n) => n === template)];
    for (const nome of ordem) await apagarBase(c, validarNomeDerivado(nome, plano));
    return ordem;
  });
}

/**
 * Varredura de órfãs de execuções antigas (A-6): só bases do próprio dono, do padrão ancorado, com idade
 * ≥ 6 h. Uma falha individual vira aviso e não aborta a suíte. Devolve os nomes apagados.
 */
export async function apagarOrfas(plano: PlanoDeBases, agora = Date.now()): Promise<string[]> {
  return comAdmin(plano, 'orfas', async (c) => {
    const apagadas: string[] = [];
    for (const nome of selecionarOrfas(await basesProprias(c), plano, agora)) {
      try {
        await apagarBase(c, nome);
        apagadas.push(nome);
      } catch {
        console.warn(`Harness: não foi possível apagar a base órfã ${nome}`);
      }
    }
    return apagadas;
  });
}

/** Plano da execução, repassado pelo globalSetup (só no processo de teste). */
export function planoDaExecucao(): PlanoDeBases {
  return inject('bancoDeTeste');
}

/** Nome da base deste worker do Vitest: `<base>_r<exec>_w<VITEST_POOL_ID>`. */
export function nomeDoWorker(plano: PlanoDeBases = planoDaExecucao()): string {
  const id = Number(process.env.VITEST_POOL_ID);
  if (!Number.isInteger(id) || id < 1) {
    throw new Error('VITEST_POOL_ID ausente: o harness só roda dentro do projeto integration do Vitest');
  }
  // A-4: revalida com a base de dev capturada no globalSetup (DATABASE_URL do processo já é a do worker).
  return validarNomeDerivado(nomesDaExecucao(plano.base, plano.exec).worker(id), plano);
}

/** URL da base deste worker (troca só o nome da base de TEST_DATABASE_URL). */
export function urlDoWorker(): string {
  const plano = planoDaExecucao();
  return urlComBase(plano.urlTeste, nomeDoWorker(plano));
}

/**
 * Recria a base deste worker a partir do template (A-1, A-3): `DROP DATABASE IF EXISTS … WITH (FORCE)` e
 * `CREATE DATABASE … TEMPLATE …`, em instruções separadas, fora de transação. Devolve a URL da base.
 * Feche antes os clientes abertos na base: o FORCE encerra as sessões dela.
 */
export async function recriarBaseDoWorker(): Promise<string> {
  const plano = planoDaExecucao();
  const nome = nomeDoWorker(plano);
  const template = validarNomeDerivado(nomesDaExecucao(plano.base, plano.exec).template, plano);
  await comAdmin(plano, 'reset', async (c) => {
    await apagarBase(c, nome);
    await c.query(`CREATE DATABASE ${c.escapeIdentifier(nome)} TEMPLATE ${c.escapeIdentifier(template)}`);
  });
  return urlComBase(plano.urlTeste, nome);
}
