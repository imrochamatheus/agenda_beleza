import { describe, expect, it } from 'vitest';

import {
  DIGITOS_ALEATORIOS,
  DIGITOS_RELOGIO,
  IDADE_ORFA_MS,
  instanteDoExec,
  MAX_BASE_DE_TESTE,
  nomeDaBase,
  nomesDaExecucao,
  novoExec,
  RESOLUCAO_RELOGIO_MS,
  selecionarOrfas,
  SUFIXOS_POSSIVEIS,
  urlBancoDeTeste,
  urlComAplicacao,
  urlComBase,
  validarNomeDerivado,
  validarPlanoDeBases,
  type PlanoDeBases,
} from '../../support/banco';

// Testes puros (sem acesso ao banco) da guarda e dos nomes do harness: RN-13, CA-17 e ajustes
// A-4..A-6 do DBA da D-005. Toda chamada recebe um objeto de env explícito (o DATABASE_URL do
// processo de teste já aponta para a base do worker).
const DEV = 'postgresql://agenda:agenda_dev@localhost:5432/agenda_beleza';
const TESTE = 'postgresql://agenda:agenda_dev@localhost:5432/agenda_beleza_test';
const EXEC = 'mwm9q3zfaa';

describe('nomeDaBase', () => {
  it('extrai o nome sem a barra, sem query e sem fragmento', () => {
    expect(nomeDaBase(DEV)).toBe('agenda_beleza');
    expect(nomeDaBase(`${DEV}?schema=public&sslmode=disable`)).toBe('agenda_beleza');
    expect(nomeDaBase(`${DEV}#x`)).toBe('agenda_beleza');
  });

  it('decodifica o nome', () => {
    expect(nomeDaBase('postgresql://a:b@h:5432/base%5Fx')).toBe('base_x');
  });
});

describe('urlBancoDeTeste', () => {
  it('devolve TEST_DATABASE_URL quando a base é diferente da de desenvolvimento', () => {
    expect(urlBancoDeTeste({ DATABASE_URL: DEV, TEST_DATABASE_URL: TESTE })).toBe(TESTE);
  });

  it('aceita TEST_DATABASE_URL sem DATABASE_URL definida', () => {
    expect(urlBancoDeTeste({ DATABASE_URL: '', TEST_DATABASE_URL: TESTE })).toBe(TESTE);
  });

  it('falha nomeando TEST_DATABASE_URL quando ela falta', () => {
    expect(() => urlBancoDeTeste({ DATABASE_URL: DEV })).toThrow(/^TEST_DATABASE_URL não definida/);
  });

  it.each([
    ['a mesma URL', DEV],
    ['127.0.0.1 no lugar de localhost', 'postgresql://agenda:agenda_dev@127.0.0.1:5432/agenda_beleza'],
    ['?schema=public a mais', `${DEV}?schema=public`],
    ['outro usuário, host e porta', 'postgres://outro:x@postgres:5433/agenda_beleza'],
  ])('recusa a mesma base de DATABASE_URL: %s', (_caso, urlTeste) => {
    expect(() => urlBancoDeTeste({ DATABASE_URL: DEV, TEST_DATABASE_URL: urlTeste })).toThrow(
      /mesma base de DATABASE_URL/,
    );
  });
});

describe('urlComBase e urlComAplicacao', () => {
  it('troca só o nome da base e preserva usuário, senha, host, porta e query', () => {
    const u = new URL(urlComBase('postgresql://u:s%40nha@h:5433/velha?sslmode=disable&x=1', 'nova_w1'));
    expect(u.pathname).toBe('/nova_w1');
    expect([u.username, u.password, u.hostname, u.port]).toEqual(['u', 's%40nha', 'h', '5433']);
    expect(u.searchParams.get('sslmode')).toBe('disable');
    expect(u.searchParams.get('x')).toBe('1');
  });

  it('acrescenta application_name sem mexer no resto (A-9)', () => {
    const u = new URL(urlComAplicacao(`${TESTE}?sslmode=disable`, 'harness:schema-de-prova'));
    expect(u.searchParams.get('application_name')).toBe('harness:schema-de-prova');
    expect(u.searchParams.get('sslmode')).toBe('disable');
    expect(nomeDaBase(u.toString())).toBe('agenda_beleza_test');
  });
});

describe('novoExec e instanteDoExec (A-5, revisado no DEF-1)', () => {
  it('gera 10 caracteres [0-9a-z]: 5 do relógio em minutos + 5 aleatórios', () => {
    const agora = Date.UTC(2026, 10, 18, 12, 34, 56, 789);
    const exec = novoExec(agora);
    expect(exec).toMatch(/^[0-9a-z]{10}$/);
    // A idade continua derivável do nome, com resolução de 1 min (arredondada para baixo).
    expect(instanteDoExec(exec)).toBe(Date.UTC(2026, 10, 18, 12, 34));
    expect(exec.slice(0, DIGITOS_RELOGIO)).toBe(novoExec(agora).slice(0, DIGITOS_RELOGIO));
  });

  it('completa com zeros o relógio e o sufixo; o sufixo usa o sorteio inteiro em base 36', () => {
    expect(novoExec(35 * RESOLUCAO_RELOGIO_MS, () => 0)).toBe('0000z00000');
    expect(novoExec(0, () => SUFIXOS_POSSIVEIS - 1)).toBe('00000zzzzz');
    expect(novoExec(0, () => 36 ** 2)).toBe('0000000100');
    expect(instanteDoExec('0000z00000')).toBe(35 * RESOLUCAO_RELOGIO_MS);
  });

  it('falha se o relógio não couber em 5 caracteres ou se o sorteio estiver fora de [0, 36^5)', () => {
    expect(() => novoExec(36 ** 5 * RESOLUCAO_RELOGIO_MS)).toThrow(/10 caracteres/);
    for (const ruim of [-1, SUFIXOS_POSSIVEIS, 1.5, Number.NaN]) {
      expect(() => novoExec(0, () => ruim)).toThrow(/fora de \[0, 36\^5\)/);
    }
  });

  it('DEF-1: 5.000 execs gerados no MESMO instante são (praticamente) todos distintos (crypto.randomInt)', () => {
    const agora = Date.UTC(2026, 10, 18, 12);
    const execs = Array.from({ length: 5000 }, () => novoExec(agora));
    // Paradoxo do aniversário: com 36^5 sufixos, o número esperado de colisões entre 5.000 é ≈ 0,2
    // (Poisson), então exigir 5.000 exatos falharia em ~20% das execuções. O limite ≥ 4.990 separa os
    // dois algoritmos: o antigo (36^2 sufixos por ms) gera no máximo 1.296 distintos; o novo fica abaixo
    // de 4.990 com probabilidade < 1e-20.
    expect(new Set(execs).size).toBeGreaterThanOrEqual(4990);
    // Dois execs no mesmo instante: colidem com probabilidade 1/36^5.
    expect(novoExec(agora)).not.toBe(novoExec(agora));
    // Mesmo relógio para todos: a distinção vem só do sufixo aleatório.
    expect(new Set(execs.map((e) => e.slice(0, DIGITOS_RELOGIO))).size).toBe(1);
    // O sufixo cobre o alfabeto inteiro (não só os 2 últimos caracteres variam).
    for (let pos = DIGITOS_RELOGIO; pos < 10; pos++) {
      expect(new Set(execs.map((e) => e[pos])).size).toBe(36);
    }
  });

  it('DEF-1: o espaço de sufixos por minuto é 36^5 (antes: 36^2 por ms)', () => {
    expect(SUFIXOS_POSSIVEIS).toBe(60_466_176);
    expect(DIGITOS_RELOGIO + DIGITOS_ALEATORIOS).toBe(10);
  });

  it('DEF-1: um nome no formato antigo (relógio em ms) decodifica no futuro, e a varredura o mantém', () => {
    const agora = Date.UTC(2026, 10, 18, 12);
    const formatoAntigo = agora.toString(36).padStart(8, '0') + 'ab';
    expect(instanteDoExec(formatoAntigo)).toBeGreaterThan(agora);
  });
});

describe('nomesDaExecucao', () => {
  const n = nomesDaExecucao('agenda_beleza_test', EXEC);

  it('deriva template e workers com o exec', () => {
    expect(n.template).toBe('agenda_beleza_test_rmwm9q3zfaa_tpl');
    expect(n.worker(3)).toBe('agenda_beleza_test_rmwm9q3zfaa_w3');
  });

  it('o padrão da execução casa só com as bases desta execução', () => {
    expect(n.padraoDaExecucao.test(n.template)).toBe(true);
    expect(n.padraoDaExecucao.test(n.worker(12))).toBe(true);
    expect(n.padraoDaExecucao.test('agenda_beleza_test_rmwme0fjfbb_w1')).toBe(false);
    expect(n.padraoDaExecucao.test(`${n.worker(1)}_copia`)).toBe(false);
  });
});

describe('validarPlanoDeBases: guarda do CA-17 (pura)', () => {
  const ok = { DATABASE_URL: DEV, TEST_DATABASE_URL: TESTE };

  it('CA-17: aceita a configuração do .env.example e devolve o plano', () => {
    expect(validarPlanoDeBases(ok, EXEC, 4)).toEqual({
      urlTeste: TESTE,
      base: 'agenda_beleza_test',
      baseDev: 'agenda_beleza',
      exec: EXEC,
      maxWorkers: 4,
    });
  });

  it('CA-17: aceita DATABASE_URL vazia (CI)', () => {
    expect(validarPlanoDeBases({ TEST_DATABASE_URL: TESTE }, EXEC, 4).baseDev).toBeNull();
  });

  it('CA-17: TEST_DATABASE_URL ausente falha nomeando a variável', () => {
    expect(() => validarPlanoDeBases({ DATABASE_URL: DEV }, EXEC, 4)).toThrow(/^TEST_DATABASE_URL não definida/);
  });

  it('CA-17: TEST_DATABASE_URL com a mesma base de DATABASE_URL falha nomeando as variáveis', () => {
    expect(() =>
      validarPlanoDeBases({ DATABASE_URL: DEV, TEST_DATABASE_URL: `${DEV.replace('localhost', '127.0.0.1')}` }, EXEC, 4),
    ).toThrow(/^TEST_DATABASE_URL aponta para a mesma base de DATABASE_URL/);
  });

  it.each(['postgres', 'template0', 'template1'])('CA-17: base de teste de sistema (%s) é recusada', (base) => {
    expect(() => validarPlanoDeBases({ DATABASE_URL: DEV, TEST_DATABASE_URL: urlComBase(TESTE, base) }, EXEC, 4)).toThrow(
      /^A base de TEST_DATABASE_URL não pode ser uma base de sistema/,
    );
  });

  it.each([
    ['maiúscula', 'Agenda_test'],
    ['hífen', 'agenda-test'],
    ['acento', 'agênda_test'],
    ['vazia', ''],
  ])('CA-17: base de teste com nome inválido (%s) é recusada', (_caso, base) => {
    expect(() => validarPlanoDeBases({ DATABASE_URL: DEV, TEST_DATABASE_URL: urlComBase(TESTE, base) }, EXEC, 4)).toThrow(
      /^A base de TEST_DATABASE_URL tem nome inválido/,
    );
  });

  it('CA-17 (A-4): base de 46 caracteres é aceita e a de 47 é recusada (derivado > 63 seria truncado)', () => {
    const b46 = 'a'.repeat(MAX_BASE_DE_TESTE);
    const plano = validarPlanoDeBases({ TEST_DATABASE_URL: urlComBase(TESTE, b46) }, EXEC, 4);
    expect(nomesDaExecucao(plano.base, EXEC).worker(999)).toHaveLength(63);
    expect(() => validarPlanoDeBases({ TEST_DATABASE_URL: urlComBase(TESTE, `${b46}a`) }, EXEC, 4)).toThrow(
      /^A base de TEST_DATABASE_URL tem mais de 46 caracteres/,
    );
  });

  it('CA-17: nome derivado igual à base de DATABASE_URL é recusado', () => {
    const dev = urlComBase(DEV, `agenda_beleza_test_r${EXEC}_w2`);
    expect(() => validarPlanoDeBases({ DATABASE_URL: dev, TEST_DATABASE_URL: TESTE }, EXEC, 4)).toThrow(
      /coincide com a base de DATABASE_URL/,
    );
  });

  it('CA-17: nome derivado do template igual à base de DATABASE_URL é recusado', () => {
    const dev = urlComBase(DEV, `agenda_beleza_test_r${EXEC}_tpl`);
    expect(() => validarPlanoDeBases({ DATABASE_URL: dev, TEST_DATABASE_URL: TESTE }, EXEC, 1)).toThrow(
      /coincide com a base de DATABASE_URL/,
    );
  });

  it('CA-17: URLs malformadas falham nomeando a variável, sem ecoar o valor', () => {
    expect(() => validarPlanoDeBases({ TEST_DATABASE_URL: 'segredo-nao-url' }, EXEC, 4)).toThrow(
      /^TEST_DATABASE_URL não é uma URL válida$/,
    );
    expect(() => validarPlanoDeBases({ DATABASE_URL: 'segredo-nao-url', TEST_DATABASE_URL: TESTE }, EXEC, 4)).toThrow(
      /^DATABASE_URL não é uma URL válida$/,
    );
  });

  it('CA-17: nenhuma mensagem da guarda traz a senha', () => {
    const erros: string[] = [];
    for (const env of [{}, { DATABASE_URL: DEV, TEST_DATABASE_URL: DEV }, { TEST_DATABASE_URL: urlComBase(TESTE, 'postgres') }]) {
      try {
        validarPlanoDeBases(env, EXEC, 4);
      } catch (e) {
        erros.push((e as Error).message);
      }
    }
    expect(erros).toHaveLength(3);
    expect(erros.join('\n')).not.toContain('agenda_dev');
  });

  it.each([
    ['exec curto', 'abc', 4, /Identificador de execução inválido/],
    ['exec com maiúscula', 'MWM9Q3ZFAA', 4, /Identificador de execução inválido/],
    ['maxWorkers 0', EXEC, 0, /maxWorkers/],
    ['maxWorkers 1000', EXEC, 1000, /maxWorkers/],
    ['maxWorkers fracionário', EXEC, 1.5, /maxWorkers/],
  ])('recusa %s', (_caso, exec, max, erro) => {
    expect(() => validarPlanoDeBases({ TEST_DATABASE_URL: TESTE }, exec, max)).toThrow(erro);
  });
});

describe('validarNomeDerivado', () => {
  const plano = { base: 'agenda_beleza_test', baseDev: 'agenda_beleza' };

  it.each([
    ['inválido', 'x-y', /inválido/],
    ['com 64 caracteres', 'a'.repeat(64), /inválido ou com mais de 63/],
    ['de sistema', 'template1', /base de sistema/],
    ['a base de dev', 'agenda_beleza', /base de DATABASE_URL/],
    ['a própria base administrativa', 'agenda_beleza_test', /base administrativa/],
  ])('recusa nome %s', (_caso, nome, erro) => {
    expect(() => validarNomeDerivado(nome, plano)).toThrow(erro);
  });

  it('aceita um nome derivado comum', () => {
    expect(validarNomeDerivado('agenda_beleza_test_rmwm9q3zfaa_w1', plano)).toBe('agenda_beleza_test_rmwm9q3zfaa_w1');
  });
});

describe('selecionarOrfas: filtro da varredura (CA-17, A-6; casos da dba.md §9.7)', () => {
  const agora = Date.UTC(2026, 10, 18, 12);
  const h = 60 * 60 * 1000;
  const exec = (horasAtras: number, sufixo: string) =>
    novoExec(agora - horasAtras * h).slice(0, DIGITOS_RELOGIO) + sufixo.padStart(DIGITOS_ALEATORIOS, '0');
  const atual = exec(0, 'ab');
  const plano: PlanoDeBases = {
    urlTeste: TESTE,
    base: 'agenda_beleza_test',
    baseDev: 'agenda_beleza',
    exec: atual,
    maxWorkers: 4,
  };
  const velho = exec(7, 'aa');
  const p = (e: string, s: string) => `agenda_beleza_test_r${e}_${s}`;

  it('CA-17: apaga só as bases do padrão com 6 h ou mais, e nunca dev, administrativa, sistema ou alheias', () => {
    const nomes = [
      p(velho, 'tpl'),
      p(velho, 'w1'),
      p(velho, 'w12'),
      p(exec(6, 'dd'), 'w3'), // exatamente 6 h: apaga
      p(exec(5, 'bb'), 'w1'), // 5 h: execução possivelmente em curso
      p(exec(-1, 'cc'), 'w2'), // relógio no futuro: idade negativa
      p(atual, 'tpl'),
      p(atual, 'w1'),
      p(atual, 'w4'),
      `${p(velho, 'w1')}_copia`, // sufixo depois
      `agenda_beleza_test2_r${velho}_w1`, // outra base de teste com prefixo parecido
      `xagenda_beleza_test_r${velho}_w1`, // prefixo antes
      `agenda_beleza_test_r${velho.slice(0, 9)}_w1`, // exec com 9 caracteres
      p(velho, 'w1000'), // worker com 4 dígitos
      'agenda_beleza',
      'agenda_beleza_test',
      'postgres',
      'template1',
    ];
    expect(selecionarOrfas(nomes, plano, agora)).toEqual([
      p(velho, 'tpl'),
      p(velho, 'w1'),
      p(velho, 'w12'),
      p(exec(6, 'dd'), 'w3'),
    ]);
  });

  it('CA-17: uma órfã que colida com a base de dev é mantida pela revalidação da guarda', () => {
    const dev = p(velho, 'w1');
    expect(selecionarOrfas([dev, p(velho, 'w2')], { ...plano, baseDev: dev }, agora)).toEqual([p(velho, 'w2')]);
  });

  it('a idade mínima é de 6 h', () => {
    expect(IDADE_ORFA_MS).toBe(6 * h);
  });
});
