import { randomInt } from 'node:crypto';

// Guarda e nomes das bases dos testes de integração (RN-13, CA-17; ajustes A-4..A-6 do DBA da D-005).
// Funções puras: nada aqui abre conexão.

/** Bases que o harness nunca cria, recria nem apaga. */
export const BASES_DE_SISTEMA = ['postgres', 'template0', 'template1'] as const;

/** Nome aceito pelo harness: só ASCII minúsculo, dígitos e "_", até 63 bytes (limite do PostgreSQL). */
export const NOME_VALIDO = /^[a-z0-9_]{1,63}$/;

/**
 * Comprimento máximo da base de TEST_DATABASE_URL (A-4): 63 − 17, em que 17 é o sufixo mais largo
 * aceito pelo padrão de órfã (`_r` + 10 + `_w999`). Assim nenhum nome derivado é truncado em silêncio.
 */
export const MAX_BASE_DE_TESTE = 46;

/** Maior VITEST_POOL_ID aceito pelo padrão de nomes (`w[0-9]{1,3}`). */
export const MAX_WORKER_ID = 999;

/** Idade mínima (6 h) para a varredura apagar uma base de outra execução (A-6). */
export const IDADE_ORFA_MS = 6 * 60 * 60 * 1000;

/**
 * Identificador da execução (A-5, revisado no DEF-1): 10 caracteres [0-9a-z] = 5 do relógio em MINUTOS,
 * base 36 (36^5 min ≈ 114 anos desde 1970, até 2084) + 5 aleatórios de `crypto.randomInt` (36^5 ≈ 60,5
 * milhões). Antes eram 8 do relógio em ms + 2 de Math.random (1/1296 de colisão no mesmo ms → 42P04).
 */
export const EXEC_VALIDO = /^[0-9a-z]{10}$/;

/** Caracteres do relógio no início do `exec`. */
export const DIGITOS_RELOGIO = 5;
/** Caracteres aleatórios no fim do `exec`. */
export const DIGITOS_ALEATORIOS = 5;
/** Resolução do relógio do `exec`: 1 min (sobra para a idade mínima de 6 h da varredura). */
export const RESOLUCAO_RELOGIO_MS = 60_000;
/** Quantidade de sufixos aleatórios distintos: 36^5. */
export const SUFIXOS_POSSIVEIS = 36 ** DIGITOS_ALEATORIOS;

/** Nome da base de uma URL do PostgreSQL: o caminho sem a "/" inicial, sem query nem fragmento. */
export function nomeDaBase(url: string): string {
  return decodeURIComponent(new URL(url).pathname.slice(1));
}

/** Nome da base, com erro que nomeia a variável sem ecoar o valor (uma URL pode trazer a senha). */
function nomeDaBaseOuErro(url: string, variavel: string): string {
  try {
    return nomeDaBase(url);
  } catch {
    throw new Error(`${variavel} não é uma URL válida`);
  }
}

/**
 * URL do banco administrativo dos testes de integração. Os testes usam só TEST_DATABASE_URL, nunca
 * DATABASE_URL (RN-9 da D-004). Sem a variável, o teste falha (não é pulado).
 *
 * A guarda compara o NOME DA BASE, e não o texto da URL: localhost x 127.0.0.1 ou um `?schema=` a mais
 * apontam para a mesma base de desenvolvimento. É a mesma regra do initdb (docker/postgres/initdb).
 */
export function urlBancoDeTeste(env: Record<string, string | undefined> = process.env): string {
  const url = env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL não definida: suba o PostgreSQL (docker compose up -d postgres) e configure o .env',
    );
  }
  const urlDev = env.DATABASE_URL;
  if (urlDev && nomeDaBaseOuErro(url, 'TEST_DATABASE_URL') === nomeDaBaseOuErro(urlDev, 'DATABASE_URL')) {
    throw new Error(
      'TEST_DATABASE_URL aponta para a mesma base de DATABASE_URL: os testes de integração exigem uma base separada',
    );
  }
  return url;
}

/** Troca só o nome da base da URL; usuário, senha, host, porta e query ficam como estão. */
export function urlComBase(url: string, nome: string): string {
  const u = new URL(url);
  u.pathname = `/${encodeURIComponent(nome)}`;
  return u.toString();
}

/** Acrescenta (ou troca) `application_name` na URL, para identificar a sessão em pg_stat_activity (A-9). */
export function urlComAplicacao(url: string, aplicacao: string): string {
  const u = new URL(url);
  u.searchParams.set('application_name', aplicacao);
  return u.toString();
}

/**
 * Gera o identificador da execução (A-5/DEF-1): relógio em minutos (5 caracteres base 36, com padStart)
 * + 5 caracteres aleatórios. `aleatorio` devolve um inteiro em [0, 36^5); o padrão é `crypto.randomInt`
 * (uniforme, sem viés de módulo). Duas execuções só colidem se começarem no mesmo minuto E sortearem o
 * mesmo sufixo (1 em 60.466.176 por par).
 */
export function novoExec(
  agora = Date.now(),
  aleatorio: () => number = () => randomInt(SUFIXOS_POSSIVEIS),
): string {
  const relogio = Math.floor(agora / RESOLUCAO_RELOGIO_MS).toString(36).padStart(DIGITOS_RELOGIO, '0');
  const sorteio = aleatorio();
  if (!Number.isInteger(sorteio) || sorteio < 0 || sorteio >= SUFIXOS_POSSIVEIS) {
    throw new Error('Sufixo aleatório do identificador de execução fora de [0, 36^5)');
  }
  const exec = relogio + sorteio.toString(36).padStart(DIGITOS_ALEATORIOS, '0');
  if (!EXEC_VALIDO.test(exec)) {
    throw new Error('Identificador de execução inválido: esperados 10 caracteres [0-9a-z]');
  }
  return exec;
}

/**
 * Instante (ms, arredondado para baixo ao minuto) codificado nos 5 primeiros caracteres do `exec`.
 * Um nome no formato antigo (8 caracteres em ms) decodifica como um instante no futuro, e a varredura o
 * mantém (idade negativa): falha para o lado seguro. Esses nomes saem pela limpeza manual do README.
 */
export function instanteDoExec(exec: string): number {
  return Number.parseInt(exec.slice(0, DIGITOS_RELOGIO), 36) * RESOLUCAO_RELOGIO_MS;
}

export type NomesDaExecucao = {
  template: string;
  worker(n: number): string;
  /** Qualquer base derivada de `base`, de qualquer execução (grupo 1 = exec). */
  padraoOrfa: RegExp;
  /** Só as bases desta execução. */
  padraoDaExecucao: RegExp;
};

export function nomesDaExecucao(base: string, exec: string): NomesDaExecucao {
  // `base` e `exec` já validados: só [a-z0-9_], sem metacaracteres de regex.
  const prefixo = `${base}_r${exec}`;
  return {
    template: `${prefixo}_tpl`,
    worker: (n) => `${prefixo}_w${n}`,
    padraoOrfa: new RegExp(`^${base}_r([0-9a-z]{10})_(tpl|w[0-9]{1,3})$`),
    padraoDaExecucao: new RegExp(`^${prefixo}_(tpl|w[0-9]{1,3})$`),
  };
}

/** Dados serializáveis da execução, repassados aos workers por `provide('bancoDeTeste', …)`. */
export type PlanoDeBases = {
  /** URL de TEST_DATABASE_URL: base administrativa (só CREATE/DROP DATABASE e catálogo). */
  urlTeste: string;
  /** Nome da base administrativa. */
  base: string;
  /** Nome da base de DATABASE_URL capturado no início (null se a variável estiver vazia). */
  baseDev: string | null;
  exec: string;
  maxWorkers: number;
};

function ehDeSistema(nome: string): boolean {
  return (BASES_DE_SISTEMA as readonly string[]).includes(nome);
}

/**
 * Revalida um nome que o harness vai criar ou apagar (A-4, A-6). Lança se ele for inválido, longo demais,
 * de sistema, a base de desenvolvimento ou a administrativa. A mensagem nomeia a variável, sem valores.
 */
export function validarNomeDerivado(nome: string, plano: Pick<PlanoDeBases, 'base' | 'baseDev'>): string {
  if (!NOME_VALIDO.test(nome)) {
    throw new Error(
      'Nome de base derivado de TEST_DATABASE_URL inválido ou com mais de 63 caracteres: use só [a-z0-9_]',
    );
  }
  if (ehDeSistema(nome)) {
    throw new Error('Nome de base derivado de TEST_DATABASE_URL coincide com uma base de sistema');
  }
  if (nome === plano.baseDev) {
    throw new Error('Nome de base derivado de TEST_DATABASE_URL coincide com a base de DATABASE_URL');
  }
  if (nome === plano.base) {
    throw new Error('Nome de base derivado coincide com a própria base administrativa de TEST_DATABASE_URL');
  }
  return nome;
}

/**
 * Guarda do CA-17: é a 1ª instrução do globalSetup, antes de qualquer conexão. Lança nomeando a variável
 * (sem credenciais) se TEST_DATABASE_URL faltar, apontar para a base de DATABASE_URL, for de sistema ou
 * inválida, tiver mais de 46 caracteres, ou se algum nome derivado colidir.
 */
export function validarPlanoDeBases(
  env: { TEST_DATABASE_URL?: string; DATABASE_URL?: string },
  exec: string,
  maxWorkers: number,
): PlanoDeBases {
  const urlTeste = urlBancoDeTeste(env);
  const base = nomeDaBaseOuErro(urlTeste, 'TEST_DATABASE_URL');
  const baseDev = env.DATABASE_URL ? nomeDaBaseOuErro(env.DATABASE_URL, 'DATABASE_URL') : null;

  if (!NOME_VALIDO.test(base)) {
    throw new Error('A base de TEST_DATABASE_URL tem nome inválido: use só [a-z0-9_]');
  }
  if (ehDeSistema(base)) {
    throw new Error('A base de TEST_DATABASE_URL não pode ser uma base de sistema (postgres, template0, template1)');
  }
  if (base.length > MAX_BASE_DE_TESTE) {
    throw new Error(`A base de TEST_DATABASE_URL tem mais de ${MAX_BASE_DE_TESTE} caracteres`);
  }
  if (!EXEC_VALIDO.test(exec)) {
    throw new Error('Identificador de execução inválido: esperados 10 caracteres [0-9a-z]');
  }
  if (!Number.isInteger(maxWorkers) || maxWorkers < 1 || maxWorkers > MAX_WORKER_ID) {
    throw new Error(`maxWorkers do projeto integration deve ser inteiro entre 1 e ${MAX_WORKER_ID}`);
  }

  const plano: PlanoDeBases = { urlTeste, base, baseDev, exec, maxWorkers };
  const nomes = nomesDaExecucao(base, exec);
  // O pior sufixo aceito pelo padrão (A-4) e todos os workers previstos.
  const derivados = [nomes.template, nomes.worker(MAX_WORKER_ID)];
  for (let n = 1; n <= maxWorkers; n++) derivados.push(nomes.worker(n));
  for (const nome of derivados) validarNomeDerivado(nome, plano);
  return plano;
}

/**
 * Filtro puro da varredura (A-6). Recebe os nomes já filtrados no catálogo (dono = current_user,
 * NOT datistemplate) e devolve os que casam com o padrão ancorado, passam pela guarda, não são desta
 * execução e têm idade ≥ 6 h (idade negativa, relógio no futuro: mantém).
 */
export function selecionarOrfas(nomes: readonly string[], plano: PlanoDeBases, agora: number): string[] {
  const { padraoOrfa } = nomesDaExecucao(plano.base, plano.exec);
  return nomes.filter((nome) => {
    const m = padraoOrfa.exec(nome);
    if (!m || m[1] === plano.exec) return false;
    try {
      validarNomeDerivado(nome, plano);
    } catch {
      return false;
    }
    return agora - instanteDoExec(m[1]) >= IDADE_ORFA_MS;
  });
}
