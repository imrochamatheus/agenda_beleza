import type pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { JANELA_MS, LIMITE_FALHAS, MENSAGENS_LOGIN, chaveDeLogin, entrar, inicioDaJanela } from '@/server/auth/login';
import type { ResultadoLogin } from '@/server/auth/login';
import { HASH_FICTICIO, verificarSenha } from '@/server/auth/senha';
import { encerrarSessao } from '@/server/auth/sessao';
import { obterPrisma } from '@/server/repos/db';
import { hashDoToken } from '@/server/tenant/sessao';

import { criarSuperAdmin } from '../../support/auth';
import { SENHA_DE_TESTE, criarSalaoCompleto, hashDaSenhaDeTeste } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar, emailNovo } from '../../support/sql';

// D-010 T-3: serviço de login com PostgreSQL real. CA-2 (mensagem e custo uniformes, verificador
// instrumentado por injeção), CA-5 (desativado), CA-12 (rate limit), CA-15, CA-16 e CA-19.

const CREDENCIAIS: ResultadoLogin = { ok: false, motivo: 'recusado', mensagem: MENSAGENS_LOGIN.credenciais };
const LIMITE: ResultadoLogin = { ok: false, motivo: 'recusado', mensagem: MENSAGENS_LOGIN.limite };
const silencioso = { log: () => {} };

let c: pg.Client;
let s: SalaoCompleto;

beforeAll(async () => {
  c = await conectar();
  s = await criarSalaoCompleto();
});
afterAll(async () => {
  await c.end();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function totalDeSessoes(): Promise<number> {
  return Number((await c.query<{ n: string }>('SELECT count(*) AS n FROM sessao')).rows[0].n);
}

async function contadorDaJanela(email: string, agora: Date): Promise<number | null> {
  const r = await c.query<{ contador: number }>(
    'SELECT contador FROM rate_limit_janela WHERE chave = $1 AND janela_inicio = $2',
    [chaveDeLogin(email), inicioDaJanela(agora)],
  );
  return r.rows[0]?.contador ?? null;
}

/** Verificador real, contando chamadas e os hashes recebidos. */
function verificadorInstrumentado() {
  const fn = vi.fn((hash: string, senha: string) => verificarSenha(hash, senha));
  return fn;
}

describe('CA-2: mensagem genérica idêntica e uma verificação argon2 por tentativa', () => {
  it('CA-2: senha errada, e-mail inexistente, super admin e profissional inativo com senha errada', async () => {
    const inativo = await criarSalaoCompleto({ profissional: { ativo: false } });
    const admin = await criarSuperAdmin();
    const casos: [string, { email: string; senha: string }][] = [
      ['senha errada', { email: s.gestor.email, senha: 'senha errada' }],
      ['e-mail inexistente', { email: emailNovo(), senha: SENHA_DE_TESTE }],
      ['super admin com a senha certa', { email: admin.email, senha: SENHA_DE_TESTE }],
      ['profissional inativo com senha errada', { email: inativo.profissional.email, senha: 'outra' }],
    ];
    const antes = await totalDeSessoes();
    for (const [nome, entrada] of casos) {
      const verificar = verificadorInstrumentado();
      const r = await entrar(entrada, { verificarSenha: verificar, ...silencioso });
      expect(r, nome).toEqual(CREDENCIAIS);
      expect(verificar, nome).toHaveBeenCalledTimes(1);
    }
    expect(await totalDeSessoes()).toBe(antes);
  });

  it('RN-8: e-mail inexistente verifica contra o HASH_FICTICIO; existente, contra o hash do usuário', async () => {
    const verificar = verificadorInstrumentado();
    await entrar({ email: emailNovo(), senha: 'x' }, { verificarSenha: verificar, ...silencioso });
    await entrar({ email: s.gestor.email, senha: 'x' }, { verificarSenha: verificar, ...silencioso });
    expect(verificar.mock.calls.map(([hash]) => hash)).toEqual([HASH_FICTICIO, await hashDaSenhaDeTeste()]);
  });

  it('RN-8: senha_hash inválido no banco → mensagem genérica, sem exceção', async () => {
    const outro = await criarSalaoCompleto();
    await c.query("UPDATE usuario SET senha_hash = 'hash-de-teste-sem-uso' WHERE id = $1", [outro.gestor.usuarioId]);
    expect(await entrar({ email: outro.gestor.email, senha: SENHA_DE_TESTE }, silencioso)).toEqual(CREDENCIAIS);
  });
});

describe('CA-1 (núcleo) e CA-6 (destino): sucesso', () => {
  it('gestor e profissional ativos entram com destino /painel; proximo seguro é respeitado', async () => {
    const g = await entrar({ email: s.gestor.email, senha: SENHA_DE_TESTE }, silencioso);
    expect(g).toMatchObject({ ok: true, destino: '/painel' });
    const p = await entrar(
      { email: s.profissional.email, senha: SENHA_DE_TESTE, proximo: '/painel/agenda?dia=2026-12-01' },
      silencioso,
    );
    expect(p).toMatchObject({ ok: true, destino: '/painel/agenda?dia=2026-12-01' });
    const fora = await entrar({ email: s.gestor.email, senha: SENHA_DE_TESTE, proximo: '//evil.com' }, silencioso);
    expect(fora).toMatchObject({ ok: true, destino: '/painel' });
  });
});

describe('CA-5: profissional desativado não entra', () => {
  it('CA-5: com a senha correta → "acesso desativado", sem sessão', async () => {
    const inativo = await criarSalaoCompleto({ profissional: { ativo: false } });
    const antes = await totalDeSessoes();
    expect(await entrar({ email: inativo.profissional.email, senha: SENHA_DE_TESTE }, silencioso)).toEqual({
      ok: false,
      motivo: 'recusado',
      mensagem: 'Seu acesso está desativado. Fale com a gestão do salão.',
    });
    expect(await totalDeSessoes()).toBe(antes);
  });

  it('CA-5: usuário profissional sem perfil vinculado → desativado (falha fechada)', async () => {
    const email = emailNovo();
    await obterPrisma().usuario.create({
      data: {
        salaoId: s.salaoId,
        papel: 'profissional',
        email,
        nome: 'Sem perfil',
        senhaHash: await hashDaSenhaDeTeste(),
        emailConfirmadoEm: new Date(),
      },
    });
    expect(await entrar({ email, senha: SENHA_DE_TESTE }, silencioso)).toMatchObject({
      mensagem: MENSAGENS_LOGIN.desativado,
    });
  });

  it('gestor com perfil de profissional inativo entra como gestor', async () => {
    const g = await criarSalaoCompleto();
    await c.query('UPDATE profissional SET ativo = false WHERE id = $1', [g.gestor.profissionalId]);
    expect(await entrar({ email: g.gestor.email, senha: SENHA_DE_TESTE }, silencioso)).toMatchObject({ ok: true });
  });
});

describe('CA-15: e-mail não confirmado', () => {
  it('CA-15: gestor e profissional sem confirmação: senha certa → "Confirme seu e-mail"; errada → genérica', async () => {
    const n = await criarSalaoCompleto({ gestor: { emailConfirmado: false }, profissional: { emailConfirmado: false } });
    const antes = await totalDeSessoes();
    for (const email of [n.gestor.email, n.profissional.email]) {
      expect(await entrar({ email, senha: SENHA_DE_TESTE }, silencioso)).toEqual({
        ok: false,
        motivo: 'recusado',
        mensagem: 'Confirme seu e-mail antes de entrar.',
      });
      expect(await entrar({ email, senha: 'errada' }, silencioso)).toEqual(CREDENCIAIS);
    }
    expect(await totalDeSessoes()).toBe(antes);
  });
});

describe('CA-16: normalização e validação da entrada', () => {
  it('CA-16: "  Gestora@Exemplo.COM " entra (trim + minúsculas)', async () => {
    const local = `gestora.${Date.now()}${Math.floor(Math.random() * 1e6)}`;
    const n = await criarSalaoCompleto({ gestor: { email: `${local}@exemplo.com` } });
    const r = await entrar({ email: `  ${local.replace('g', 'G')}@Exemplo.COM `, senha: SENHA_DE_TESTE }, silencioso);
    expect(r).toMatchObject({ ok: true });
    expect(n.gestor.email).toBe(`${local}@exemplo.com`);
  });

  it.each([
    ['e-mail vazio', { email: '', senha: 'x' }, { email: MENSAGENS_LOGIN.emailVazio }],
    ['e-mail só espaços', { email: '   ', senha: 'x' }, { email: MENSAGENS_LOGIN.emailVazio }],
    ['e-mail sem @', { email: 'gestora.exemplo.com', senha: 'x' }, { email: MENSAGENS_LOGIN.emailVazio }],
    ['e-mail com 255 caracteres', { email: `${'a'.repeat(243)}@exemplo.com`, senha: 'x' }, { email: MENSAGENS_LOGIN.emailVazio }],
    ['e-mail não string', { email: 42, senha: 'x' }, { email: MENSAGENS_LOGIN.emailVazio }],
    ['senha vazia', { email: 'a@exemplo.com', senha: '' }, { senha: MENSAGENS_LOGIN.senhaVazia }],
    ['senha com 1025 caracteres', { email: 'a@exemplo.com', senha: 'x'.repeat(1025) }, { senha: MENSAGENS_LOGIN.senhaVazia }],
    ['senha ausente', { email: 'a@exemplo.com', senha: undefined }, { senha: MENSAGENS_LOGIN.senhaVazia }],
    ['ambos vazios', { email: '', senha: '' }, { email: MENSAGENS_LOGIN.emailVazio, senha: MENSAGENS_LOGIN.senhaVazia }],
  ])('CA-16: %s → validação por campo, sem banco, sem argon2 e sem rate limit', async (_nome, entrada, erros) => {
    expect(`${'a'.repeat(243)}@exemplo.com`).toHaveLength(255);
    // Banco inacessível: qualquer consulta viraria erro de conexão em vez do resultado de validação.
    vi.stubEnv('DATABASE_URL', 'postgresql://usuario:senha@127.0.0.1:1/z');
    const verificar = vi.fn(async () => true);
    const log = vi.fn();
    expect(await entrar(entrada, { verificarSenha: verificar, log })).toEqual({ ok: false, motivo: 'validacao', erros });
    expect(verificar).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('CA-16: validação não conta no rate limit', async () => {
    const agora = new Date();
    const email = emailNovo();
    await entrar({ email, senha: '' }, { agora, ...silencioso });
    expect(await contadorDaJanela(email, agora)).toBeNull();
    await entrar({ email, senha: 'errada' }, { agora, ...silencioso });
    expect(await contadorDaJanela(email, agora)).toBe(1);
  });

  it('CA-16: a senha não é aparada', async () => {
    for (const senha of [` ${SENHA_DE_TESTE}`, `${SENHA_DE_TESTE} `]) {
      expect(await entrar({ email: s.profissional.email, senha }, silencioso)).toEqual(CREDENCIAIS);
    }
  });
});

describe('CA-12: limite de 10 falhas por e-mail em janela fixa de 15 min', () => {
  const T = new Date('2026-08-10T14:02:00.000Z');

  it('janela alinhada a 15 min em UTC', () => {
    expect(JANELA_MS).toBe(15 * 60 * 1000);
    expect(LIMITE_FALHAS).toBe(10);
    expect(inicioDaJanela(T)).toEqual(new Date('2026-08-10T14:00:00.000Z'));
    expect(inicioDaJanela(new Date('2026-08-10T14:14:59.999Z'))).toEqual(new Date('2026-08-10T14:00:00.000Z'));
    expect(inicioDaJanela(new Date('2026-08-10T14:15:00.000Z'))).toEqual(new Date('2026-08-10T14:15:00.000Z'));
  });

  it('CA-12: 10 falhas → a 11ª com a senha correta é recusada sem argon2; outro e-mail entra; janela seguinte entra', async () => {
    const e = await criarSalaoCompleto();
    const f = await criarSalaoCompleto();
    for (let i = 0; i < LIMITE_FALHAS; i++) {
      expect(await entrar({ email: e.gestor.email, senha: `errada-${i}` }, { agora: T, ...silencioso })).toEqual(CREDENCIAIS);
    }
    const antes = await totalDeSessoes();
    const verificar = verificadorInstrumentado();
    expect(
      await entrar({ email: e.gestor.email, senha: SENHA_DE_TESTE }, { agora: T, verificarSenha: verificar, ...silencioso }),
    ).toEqual(LIMITE);
    expect(verificar).not.toHaveBeenCalled();
    expect(await totalDeSessoes()).toBe(antes);

    expect(await entrar({ email: f.gestor.email, senha: SENHA_DE_TESTE }, { agora: T, ...silencioso })).toMatchObject({ ok: true });
    const seguinte = new Date(inicioDaJanela(T).getTime() + JANELA_MS);
    expect(await entrar({ email: e.gestor.email, senha: SENHA_DE_TESTE }, { agora: seguinte, ...silencioso })).toMatchObject({
      ok: true,
    });
  });

  it('CA-12: o mesmo limite vale para e-mail inexistente (mesma mensagem na 11ª)', async () => {
    const email = emailNovo();
    for (let i = 0; i < LIMITE_FALHAS; i++) {
      expect(await entrar({ email, senha: 'x' }, { agora: T, ...silencioso })).toEqual(CREDENCIAIS);
    }
    expect(await entrar({ email, senha: 'x' }, { agora: T, ...silencioso })).toEqual(LIMITE);
  });

  it('CA-12: a chave não contém o e-mail em claro; sucesso devolve a reserva sem zerar a janela', async () => {
    const n = await criarSalaoCompleto();
    for (let i = 0; i < 3; i++) {
      await entrar({ email: n.gestor.email, senha: 'errada' }, { agora: T, ...silencioso });
    }
    expect(await entrar({ email: n.gestor.email, senha: SENHA_DE_TESTE }, { agora: T, ...silencioso })).toMatchObject({ ok: true });
    expect(await contadorDaJanela(n.gestor.email, T)).toBe(3);
    expect(chaveDeLogin(n.gestor.email)).toMatch(/^login:[0-9a-f]{64}$/);
    const local = n.gestor.email.split('@')[0];
    const vazou = await c.query('SELECT chave FROM rate_limit_janela WHERE chave ILIKE $1', [`%${local}%`]);
    expect(vazou.rowCount).toBe(0);
  });

  it('CA-12: 10ª e 11ª tentativas em paralelo → contador exato, uma verificação e uma recusa por limite', async () => {
    const n = await criarSalaoCompleto();
    for (let i = 0; i < LIMITE_FALHAS - 1; i++) {
      await entrar({ email: n.gestor.email, senha: 'errada' }, { agora: T, ...silencioso });
    }
    const verificar = verificadorInstrumentado();
    const resultados = await Promise.all(
      [1, 2].map(() => entrar({ email: n.gestor.email, senha: 'errada' }, { agora: T, verificarSenha: verificar, ...silencioso })),
    );
    expect(resultados).toEqual(expect.arrayContaining([CREDENCIAIS, LIMITE]));
    expect(verificar).toHaveBeenCalledTimes(1);
    expect(await contadorDaJanela(n.gestor.email, T)).toBe(LIMITE_FALHAS + 1);
  });
});

describe('CA-19: logs sem senha, token nem token_hash', () => {
  it('CA-19: sucesso, senha errada, inativo, limite e logout não vazam segredos no stdout/stderr/console', async () => {
    const saidas: string[] = [];
    const capturar = (...args: unknown[]) => {
      saidas.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    };
    for (const metodo of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, metodo).mockImplementation(capturar);
    }
    vi.spyOn(process.stdout, 'write').mockImplementation((t: string | Uint8Array) => (capturar(String(t)), true));
    vi.spyOn(process.stderr, 'write').mockImplementation((t: string | Uint8Array) => (capturar(String(t)), true));

    const n = await criarSalaoCompleto();
    const inativo = await criarSalaoCompleto({ profissional: { ativo: false } });
    const senhaErrada = 'Senha-Errada-Unica-9f3e';
    const ok = await entrar({ email: n.gestor.email, senha: SENHA_DE_TESTE });
    await entrar({ email: n.gestor.email, senha: senhaErrada });
    await entrar({ email: inativo.profissional.email, senha: SENHA_DE_TESTE });
    for (let i = 0; i <= LIMITE_FALHAS; i++) {
      await entrar({ email: inativo.gestor.email, senha: senhaErrada });
    }
    expect(ok.ok).toBe(true);
    const token = ok.ok ? ok.token : '';
    await encerrarSessao(token);
    vi.restoreAllMocks();

    const texto = saidas.join('\n');
    const eventos = saidas.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(eventos.map((e) => e.resultado)).toEqual([
      'ok',
      'credenciais',
      'desativado',
      ...Array(LIMITE_FALHAS - 1).fill('credenciais'),
      'credenciais',
      'limite',
    ]);
    expect(eventos.every((e) => e.evento === 'auth.login')).toBe(true);
    expect(eventos.filter((e) => 'usuarioId' in e)).toEqual([expect.objectContaining({ resultado: 'ok', usuarioId: n.gestor.usuarioId })]);
    for (const segredo of [
      SENHA_DE_TESTE,
      senhaErrada,
      token,
      hashDoToken(token),
      n.gestor.email,
      inativo.profissional.email,
      chaveDeLogin(n.gestor.email),
      await hashDaSenhaDeTeste(),
    ]) {
      expect(texto).not.toContain(segredo);
    }
  });
});
