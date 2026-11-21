import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { decifrarSegredo } from '@/server/auth/admin/cifra';
import {
  LIMITE_LOGIN_ADMIN,
  LIMITE_TOTP_ADMIN,
  MENSAGENS_ADMIN,
  cadastrarTotp,
  chaveDeLoginAdmin,
  entrarAdmin,
  obterCadastroTotp,
  verificarTotpAdmin,
} from '@/server/auth/admin/login-admin';
import { encerrarSessaoAdmin } from '@/server/auth/admin/sessao-admin';
import { HASH_FICTICIO } from '@/server/auth/senha';
import { obterPrisma } from '@/server/repos/db';
import { AcessoNegado, NaoAutenticado } from '@/server/tenant/erros';
import { resolverAdmin } from '@/server/tenant/sessao';

import { linhasDeAuditoria } from '../../../support/auditoria';
import { criarSalaoCompleto } from '../../../support/factories';
import { SENHA_DE_TESTE } from '../../../support/factories';
import { conectar, emailNovo } from '../../../support/sql';

import { CHAVE, codigoEm, criarAdmin } from './apoio';

// D-034: login em duas etapas com PostgreSQL real. CA-2, CA-3, CA-5, CA-8, CA-9 (pré-sessão e rotação),
// CA-10 e a uniformidade das respostas (RN-7).

let c: pg.Client;
const logs: string[] = [];
const deps = (agora: Date, extra = {}) => ({ agora, chave: CHAVE, log: (l: string) => logs.push(l), ...extra });
const T0 = new Date('2026-11-21T12:00:07.000Z');
const minutos = (d: Date, n: number) => new Date(d.getTime() + n * 60_000);

beforeAll(async () => {
  c = await conectar();
});
afterAll(async () => {
  await c.end();
});

async function etapa1(email: string, agora = T0) {
  const r = await entrarAdmin({ email, senha: SENHA_DE_TESTE }, deps(agora));
  if (!r.ok) throw new Error('etapa 1 deveria passar');
  return r;
}

describe('etapa 1: e-mail e senha', () => {
  it('senha certa sem TOTP → etapa cadastro; com TOTP → etapa totp; só a pré-sessão nasce, sem auditoria de sucesso', async () => {
    const novo = await criarAdmin('nenhum');
    const ativo = await criarAdmin('ativo');
    const a = await etapa1(novo.email);
    const b = await etapa1(ativo.email);
    expect(a.etapa).toBe('cadastro');
    expect(b.etapa).toBe('totp');
    const sessoes = await c.query(`SELECT totp_verificado_em, expira_em FROM sessao WHERE usuario_id = $1`, [novo.id]);
    expect(sessoes.rows).toEqual([{ totp_verificado_em: null, expira_em: minutos(T0, 10) }]);
    expect(await linhasDeAuditoria(c, 'ator_id = $1', [novo.id])).toEqual([]);
  });

  it('inexistente, gestor e senha errada recebem a MESMA recusa, com uma verificação argon2 cada', async () => {
    const s = await criarSalaoCompleto();
    const admin = await criarAdmin('ativo');
    const chamadas: string[] = [];
    const verificar = async (hash: string) => {
      chamadas.push(hash);
      return false;
    };
    const casos = [emailNovo(), s.gestor.email, admin.email];
    const respostas = [];
    for (const email of casos) {
      respostas.push(await entrarAdmin({ email, senha: 'errada' }, deps(T0, { verificarSenha: verificar })));
    }
    for (const r of respostas) {
      expect(r).toEqual({ ok: false, motivo: 'recusado', mensagem: MENSAGENS_ADMIN.credenciais });
    }
    expect(chamadas).toHaveLength(3);
    expect(chamadas[0]).toBe(HASH_FICTICIO);
    // A senha do gestor nunca abre o admin (mesmo certa).
    const gestor = await entrarAdmin({ email: s.gestor.email, senha: SENHA_DE_TESTE }, deps(T0));
    expect(gestor).toEqual({ ok: false, motivo: 'recusado', mensagem: MENSAGENS_ADMIN.credenciais });
  });

  it('CA-3: senha errada grava login.falha_senha com o e-mail informado e sem a senha', async () => {
    const admin = await criarAdmin('ativo');
    await entrarAdmin({ email: ` ${admin.email.toUpperCase()} `, senha: 'senha-errada-secreta' }, deps(T0));
    const outro = emailNovo();
    await entrarAdmin({ email: outro, senha: 'senha-errada-secreta' }, deps(T0));
    const [linha] = await linhasDeAuditoria(c, 'ator_id = $1', [admin.id]);
    expect(linha).toMatchObject({ acao: 'login.falha_senha', resultado: 'falha', ator_email_informado: admin.email });
    const [anonima] = await linhasDeAuditoria(c, 'ator_email_informado = $1', [outro]);
    expect(anonima).toMatchObject({ acao: 'login.falha_senha', resultado: 'falha', ator_id: null });
    expect(JSON.stringify([linha, anonima])).not.toContain('senha-errada-secreta');
    expect(logs.join('\n')).not.toContain('senha-errada-secreta');
  });

  it('valida campos vazios sem consultar o banco', async () => {
    expect(await entrarAdmin({ email: '', senha: '' }, deps(T0))).toEqual({
      ok: false,
      motivo: 'validacao',
      erros: { email: MENSAGENS_ADMIN.emailVazio, senha: MENSAGENS_ADMIN.senhaVazia },
    });
  });

  it('rate limit: a 11ª tentativa da janela é recusada mesmo com a senha certa; a janela seguinte libera', async () => {
    const admin = await criarAdmin('ativo');
    for (let i = 0; i < LIMITE_LOGIN_ADMIN; i += 1) {
      await entrarAdmin({ email: admin.email, senha: 'errada' }, deps(T0));
    }
    const bloqueada = await entrarAdmin({ email: admin.email, senha: SENHA_DE_TESTE }, deps(T0));
    expect(bloqueada).toEqual({ ok: false, motivo: 'recusado', mensagem: MENSAGENS_ADMIN.limite });
    const proxima = await entrarAdmin({ email: admin.email, senha: SENHA_DE_TESTE }, deps(minutos(T0, 15)));
    expect(proxima.ok).toBe(true);
    // O sucesso devolveu a reserva da janela.
    const r = await c.query<{ contador: number }>('SELECT contador FROM rate_limit_janela WHERE chave = $1 AND janela_inicio = $2', [
      chaveDeLoginAdmin(admin.email),
      new Date(Math.floor(minutos(T0, 15).getTime() / 900_000) * 900_000),
    ]);
    expect(r.rows[0].contador).toBe(0);
  });
});

describe('primeiro acesso: cadastro do TOTP (CA-2, CA-5)', () => {
  it('mostra o mesmo segredo a cada carga, só ativa com código válido e abre a sessão admin', async () => {
    const admin = await criarAdmin('nenhum');
    const { token } = await etapa1(admin.email);

    const primeira = await obterCadastroTotp(token, deps(T0));
    const segunda = await obterCadastroTotp(token, deps(T0));
    expect(primeira).toEqual(segunda);
    if (!primeira.ok) throw new Error('esperava ok');
    expect(primeira.svg).toContain('<svg');
    expect(primeira.svg).not.toMatch(/https?:/);
    const grupos = primeira.chaveAgrupada;
    expect(grupos).toMatch(/^([A-Z2-7]{4} ){7}[A-Z2-7]{4}$/);

    // Pendente: ainda sem ativação, e a sessão só vale como pré-sessão.
    const pendente = await obterPrisma().usuario.findUniqueOrThrow({ where: { id: admin.id } });
    expect(pendente.totpAtivadoEm).toBeNull();
    expect(pendente.totpSegredoCifrado).toMatch(/^v1:/);
    await expect(resolverAdmin({ token }, T0)).rejects.toBeInstanceOf(AcessoNegado);

    const segredo = decifrarSegredo(pendente.totpSegredoCifrado!, admin.id, CHAVE);
    expect(grupos.replace(/ /g, '')).toBe(segredo);
    expect(pendente.totpSegredoCifrado).not.toContain(segredo);

    // Código errado: recusa, nada ativado.
    const errado = await cadastrarTotp(token, codigoEm(segredo, T0, 5), deps(T0));
    expect(errado).toEqual({ ok: false, motivo: 'invalido' });
    expect((await obterPrisma().usuario.findUniqueOrThrow({ where: { id: admin.id } })).totpAtivadoEm).toBeNull();

    // Código certo (janela anterior, ±1): ativa, abre sessão admin com token novo.
    const ok = await cadastrarTotp(token, codigoEm(segredo, T0, -1), deps(T0));
    if (!ok.ok) throw new Error('cadastro deveria passar');
    expect(ok.token).not.toBe(token);
    const ctx = await resolverAdmin({ token: ok.token }, T0);
    expect(ctx).toMatchObject({ tipo: 'admin', usuarioId: admin.id });
    const ativo = await obterPrisma().usuario.findUniqueOrThrow({ where: { id: admin.id } });
    expect(ativo.totpAtivadoEm).toEqual(T0);
    expect(ativo.totpUltimoPasso).not.toBeNull();

    // Pré-sessão antiga revogada (sem fixação), e o cadastro não se repete.
    await expect(resolverAdmin({ token }, T0)).rejects.toBeInstanceOf(NaoAutenticado);
    expect(await obterCadastroTotp(token, deps(T0))).toEqual({ ok: false, motivo: 'sessao' });

    const acoes = (await linhasDeAuditoria(c, 'ator_id = $1', [admin.id])).map((l) => [l.acao, l.resultado, l.entidade_id]);
    expect(acoes).toEqual(
      expect.arrayContaining([
        ['totp.cadastrar', 'sucesso', admin.id],
        ['login.sucesso', 'sucesso', admin.id],
      ]),
    );
  });

  it('com TOTP já ativo, o cadastro é recusado e a tela de cadastro também', async () => {
    const admin = await criarAdmin('ativo');
    const { token } = await etapa1(admin.email);
    expect(await obterCadastroTotp(token, deps(T0))).toEqual({ ok: false, motivo: 'ativado' });
    expect(await cadastrarTotp(token, codigoEm(admin.segredo!, T0), deps(T0))).toEqual({ ok: false, motivo: 'ativado' });
  });

  it('cadastro sem passar pela tela (sem segredo pendente) ou com sessão inválida → sessao', async () => {
    const admin = await criarAdmin('nenhum');
    const { token } = await etapa1(admin.email);
    expect(await cadastrarTotp(token, '123456', deps(T0))).toEqual({ ok: false, motivo: 'sessao' });
    expect(await cadastrarTotp('token-inexistente', '123456', deps(T0))).toEqual({ ok: false, motivo: 'sessao' });
    expect(await obterCadastroTotp('', deps(T0))).toEqual({ ok: false, motivo: 'sessao' });
  });

  it('login com TOTP antes de ativar (ou cadastro com a pré-sessão de quem já ativou) → sessao', async () => {
    const admin = await criarAdmin('pendente');
    const { token } = await etapa1(admin.email);
    expect(await verificarTotpAdmin(token, codigoEm(admin.segredo!, T0), deps(T0))).toEqual({ ok: false, motivo: 'sessao' });
  });
});

describe('etapa 2: código TOTP', () => {
  it('código certo → sessão admin nova, pré-sessão revogada, login.sucesso na transação (CA-9, CA-10)', async () => {
    const admin = await criarAdmin('ativo');
    const { token } = await etapa1(admin.email);
    const r = await verificarTotpAdmin(token, ` ${codigoEm(admin.segredo!, T0)} `, deps(T0));
    if (!r.ok) throw new Error('deveria passar');
    expect(r.token).not.toBe(token);
    expect(await resolverAdmin({ token: r.token }, minutos(T0, 1))).toMatchObject({ usuarioId: admin.id });
    await expect(resolverAdmin({ token }, T0)).rejects.toBeInstanceOf(NaoAutenticado);
    const [sucesso] = await linhasDeAuditoria(c, `ator_id = $1 AND acao = 'login.sucesso'`, [admin.id]);
    expect(sucesso).toMatchObject({ resultado: 'sucesso', entidade: 'usuario', depois: { etapa: 'login' } });
    // Nada de segredo, código ou chave em auditoria nem logs.
    const codigo = codigoEm(admin.segredo!, T0);
    const tudo = JSON.stringify(await linhasDeAuditoria(c, 'ator_id = $1', [admin.id])) + logs.join('\n');
    for (const proibido of [admin.segredo!, codigo, CHAVE.toString('base64'), CHAVE.toString('hex')]) {
      expect(tudo).not.toContain(proibido);
    }
  });

  it('CA-3: código inválido → recusa genérica, sem sessão admin, e login.falha_totp persistido (conexão própria)', async () => {
    const admin = await criarAdmin('ativo');
    const { token } = await etapa1(admin.email);
    const r = await verificarTotpAdmin(token, codigoEm(admin.segredo!, T0, 4), deps(T0));
    expect(r).toEqual({ ok: false, motivo: 'invalido' });
    await expect(resolverAdmin({ token }, T0)).rejects.toBeInstanceOf(AcessoNegado);
    const sessoes = await c.query(`SELECT 1 FROM sessao WHERE usuario_id = $1 AND totp_verificado_em IS NOT NULL`, [admin.id]);
    expect(sessoes.rowCount).toBe(0);
    const [falha] = await linhasDeAuditoria(c, `ator_id = $1 AND acao = 'login.falha_totp'`, [admin.id]);
    expect(falha).toMatchObject({ resultado: 'falha', ator_email_informado: admin.email, entidade_id: admin.id });
    expect(JSON.stringify(falha)).not.toContain(codigoEm(admin.segredo!, T0, 4));
  });

  it('formato inválido é recusado sem tocar no rate limit nem na auditoria', async () => {
    const admin = await criarAdmin('ativo');
    const { token } = await etapa1(admin.email);
    for (const ruim of ['', '12345', 'abcdef', '1234567', null, undefined, 123456]) {
      expect(await verificarTotpAdmin(token, ruim, deps(T0))).toEqual({ ok: false, motivo: 'invalido' });
    }
    expect(await linhasDeAuditoria(c, `ator_id = $1 AND acao = 'login.falha_totp'`, [admin.id])).toEqual([]);
  });

  it('CA-8: 5 falhas e a 6ª é recusada mesmo com o código certo; janela seguinte libera; usuários independentes', async () => {
    const a = await criarAdmin('ativo');
    const b = await criarAdmin('ativo');
    const ta = (await etapa1(a.email)).token;
    const tb = (await etapa1(b.email)).token;
    for (let i = 0; i < LIMITE_TOTP_ADMIN; i += 1) {
      expect(await verificarTotpAdmin(ta, '000000', deps(T0))).toEqual({ ok: false, motivo: 'invalido' });
    }
    expect(await verificarTotpAdmin(ta, codigoEm(a.segredo!, T0), deps(T0))).toEqual({ ok: false, motivo: 'limite' });
    // B não é afetado.
    expect((await verificarTotpAdmin(tb, codigoEm(b.segredo!, T0), deps(T0))).ok).toBe(true);
    // Janela seguinte (15 min depois): a pré-sessão de 10 min expirou, entra de novo e o código passa.
    const depois = minutos(T0, 15);
    const novo = await etapa1(a.email, depois);
    expect((await verificarTotpAdmin(novo.token, codigoEm(a.segredo!, depois), deps(depois))).ok).toBe(true);
  });

  it('o sucesso devolve uma unidade da janela (não pune o uso legítimo)', async () => {
    const admin = await criarAdmin('ativo');
    const { token } = await etapa1(admin.email);
    await verificarTotpAdmin(token, '000000', deps(T0));
    const r = await verificarTotpAdmin(token, codigoEm(admin.segredo!, T0), deps(T0));
    expect(r.ok).toBe(true);
    const linha = await c.query<{ contador: number }>(`SELECT contador FROM rate_limit_janela WHERE chave LIKE 'admin-totp:%' AND contador >= 0
      AND chave = $1`, [`admin-totp:${(await import('node:crypto')).createHash('sha256').update(admin.id).digest('hex')}`]);
    expect(linha.rows[0].contador).toBe(1);
  });

  it('CA-9: pré-sessão expira em 10 min e não acessa nada; logout revoga', async () => {
    const admin = await criarAdmin('ativo');
    const { token } = await etapa1(admin.email);
    const tarde = new Date(minutos(T0, 10).getTime());
    expect(await verificarTotpAdmin(token, codigoEm(admin.segredo!, tarde), deps(tarde))).toEqual({ ok: false, motivo: 'sessao' });

    const outra = (await etapa1(admin.email, minutos(T0, 20))).token;
    const ok = await verificarTotpAdmin(outra, codigoEm(admin.segredo!, minutos(T0, 20)), deps(minutos(T0, 20)));
    if (!ok.ok) throw new Error('deveria passar');
    await encerrarSessaoAdmin(ok.token, minutos(T0, 21));
    await expect(resolverAdmin({ token: ok.token }, minutos(T0, 21))).rejects.toBeInstanceOf(NaoAutenticado);
    await encerrarSessaoAdmin(ok.token);
    await encerrarSessaoAdmin(null);
    await encerrarSessaoAdmin('');
  });
});

describe('CA-10: auditoria na mesma transação', () => {
  it('se o INSERT de login.sucesso falha, a sessão admin e o passo são desfeitos', async () => {
    const admin = await criarAdmin('ativo');
    const { token } = await etapa1(admin.email);
    await c.query(`CREATE FUNCTION falha_login_sucesso() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN IF NEW.acao = 'login.sucesso' THEN RAISE EXCEPTION 'auditoria indisponivel'; END IF; RETURN NEW; END $$`);
    await c.query(`CREATE TRIGGER falha_login_sucesso BEFORE INSERT ON auditoria FOR EACH ROW EXECUTE FUNCTION falha_login_sucesso()`);
    try {
      await expect(verificarTotpAdmin(token, codigoEm(admin.segredo!, T0), deps(T0))).rejects.toThrow();
    } finally {
      await c.query('DROP TRIGGER falha_login_sucesso ON auditoria');
      await c.query('DROP FUNCTION falha_login_sucesso()');
    }
    const sessoes = await c.query(`SELECT 1 FROM sessao WHERE usuario_id = $1 AND totp_verificado_em IS NOT NULL`, [admin.id]);
    expect(sessoes.rowCount).toBe(0);
    const u = await obterPrisma().usuario.findUniqueOrThrow({ where: { id: admin.id } });
    expect(u.totpUltimoPasso).toBeNull();
    // A pré-sessão continua válida e o mesmo código passa depois.
    expect((await verificarTotpAdmin(token, codigoEm(admin.segredo!, T0), deps(T0))).ok).toBe(true);
  });
});
