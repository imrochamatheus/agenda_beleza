import type pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { MENSAGENS_CONVITE, aceitarConvite, verificarConvite } from '@/server/auth/convite';
import { verificarSenha } from '@/server/auth/senha';
import { gerarToken } from '@/server/auth/sessao';
import { filtroDeProfissional } from '@/server/auth/permissoes';
import { desativarProfissional } from '@/server/profissionais/profissionais.acao';
import { repos } from '@/server/repos';
import { resolverTenant } from '@/server/tenant/sessao';

import { credencialDoGestor, entrarDeVerdade } from '../../support/auth';
import { criarDoisSaloes } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { aplicarSituacao } from '../../support/politica';
import {
  DIA_MS,
  T0,
  convitesDe,
  emitirConvite,
  linhasDeUsuario,
  novoProfissionalSemAcesso,
  pendentes,
} from '../../support/convites';
import { conectar, emailNovo, inserirReserva } from '../../support/sql';
import { ctxDoGestor } from '../profissionais/apoio';

// D-039 CA-2, CA-3, CA-8, CA-9 (aceite), CA-13, RN-9 e RN-11: aceite contra PostgreSQL real, com relógio
// injetado. Nenhum teste aqui mocka o banco.

const SENHA = 'uma-senha-forte-1';

let c: pg.Client;
let a: SalaoCompleto;
let b: SalaoCompleto;
let linhasDeLog: string[];

beforeAll(async () => {
  c = await conectar();
  ({ a, b } = await criarDoisSaloes());
});
afterAll(async () => {
  await c.end();
});
afterEach(() => {
  vi.restoreAllMocks();
});

const em = (ms: number) => new Date(T0.getTime() + ms);
const deps = (agora: Date) => ({ agora, log: (l: string) => linhasDeLog.push(l) });

/** Profissional novo com convite emitido em T0. */
async function convidada(o: { email?: string | null } = {}) {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  linhasDeLog = [];
  const p = await novoProfissionalSemAcesso(c, a.salaoId, o);
  const { token } = await emitirConvite(ctxDoGestor(a), p.id, T0);
  return { ...p, token };
}

const RECUSADO = (detalhe: string) => ({ resultado: 'recusado', mensagem: MENSAGENS_CONVITE.recusado, detalhe });

async function nada(p: { id: string; email: string | null }) {
  expect(await linhasDeUsuario(c, p.email!)).toHaveLength(0);
  const { rows } = await c.query('SELECT usuario_id FROM profissional WHERE id = $1', [p.id]);
  expect(rows[0].usuario_id).toBeNull();
}

describe('CA-2: aceite', () => {
  it('cria o usuário profissional confirmado do salão, vincula o perfil, marca o convite e não cria sessão', async () => {
    const p = await convidada();
    expect(await verificarConvite(p.token, deps(em(1000)))).toEqual({ ok: true });
    const r = await aceitarConvite({ token: p.token, senha: SENHA }, deps(em(2000)));
    expect(r).toEqual({ resultado: 'aceito', mensagem: MENSAGENS_CONVITE.sucesso });

    const [u] = await linhasDeUsuario(c, p.email!);
    expect(u).toMatchObject({ salao_id: a.salaoId, papel: 'profissional', nome: 'Convidada de teste' });
    expect(u.email_confirmado_em?.getTime()).toBe(em(2000).getTime());
    expect(u.senha_hash).toMatch(/^\$argon2id\$/);
    expect(await verificarSenha(u.senha_hash, SENHA)).toBe(true);
    const { rows } = await c.query('SELECT usuario_id::text AS u FROM profissional WHERE id = $1', [p.id]);
    expect(rows[0].u).toBe(u.id);
    const [conv] = await convitesDe(c, p.id);
    expect(conv.aceito_em?.getTime()).toBe(em(2000).getTime());
    expect(pendentes(await convitesDe(c, p.id))).toHaveLength(0);
    const sessoes = await c.query('SELECT 1 FROM sessao WHERE usuario_id = $1', [u.id]);
    expect(sessoes.rows).toHaveLength(0);
    expect(linhasDeLog.join('\n')).not.toContain(SENHA);
    expect(linhasDeLog.join('\n')).not.toContain(p.token);
    expect(linhasDeLog.join('\n')).not.toContain(p.email!);
  });

  it('entra por /entrar e vê só a própria agenda (não a de outro profissional nem a de outro salão)', async () => {
    const p = await convidada();
    await aceitarConvite({ token: p.token, senha: SENHA }, deps(T0));
    const proprioInicio = '2026-12-01T15:00:00Z';
    const proprio = await inserirReserva(c, {
      salaoId: a.salaoId, profissionalId: p.id, clienteId: a.clientes.ativaId, inicio: proprioInicio, fim: '2026-12-01T16:00:00Z',
    });
    await inserirReserva(c, {
      salaoId: a.salaoId, profissionalId: a.profissional.profissionalId, clienteId: a.clientes.ativaId, inicio: '2026-12-01T17:00:00Z', fim: '2026-12-01T18:00:00Z',
    });
    const { credencial } = await entrarDeVerdade(p.email!, { senha: SENHA });
    const ctx = await resolverTenant(credencial);
    expect(ctx).toMatchObject({ papel: 'profissional', salaoId: a.salaoId, profissionalId: p.id });

    const escopo = filtroDeProfissional(ctx, 'agenda.ver');
    expect(escopo).toEqual({ profissionalId: p.id });
    const periodo = { de: new Date('2026-11-01T00:00:00Z'), ate: new Date('2027-02-01T00:00:00Z') };
    const { blocos } = await repos().agenda.listarAgenda(ctx, { periodo, profissionalId: p.id, limite: 50, comPosicao: false });
    expect(blocos.map((x) => x.reservaId)).toEqual([proprio]);
    // O repositório escopado pelo salão A nunca devolve reservas do salão B.
    const todas = await repos().agenda.listarAgenda(ctx, { periodo, profissionalId: null, limite: 50, comPosicao: false });
    expect(todas.blocos.length).toBeGreaterThan(1);
    expect(todas.blocos.every((x) => x.reservaId !== b.reserva.id)).toBe(true);
  });

  it('o aceite é permitido com o salão suspenso (pré-contexto, fora da política de estado)', async () => {
    const outro = (await criarDoisSaloes()).a;
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const p = await novoProfissionalSemAcesso(c, outro.salaoId);
    const { token } = await emitirConvite(ctxDoGestor(outro), p.id, T0);
    await aplicarSituacao(outro.salaoId, 'suspensa');
    expect(await aceitarConvite({ token, senha: SENHA }, deps(T0))).toMatchObject({ resultado: 'aceito' });
    expect(await linhasDeUsuario(c, p.email!)).toHaveLength(1);
  });
});

describe('CA-3: link recusado com a mesma mensagem', () => {
  it('já usado: o segundo aceite e o GET são recusados e nada novo é criado', async () => {
    const p = await convidada();
    await aceitarConvite({ token: p.token, senha: SENHA }, deps(T0));
    expect(await aceitarConvite({ token: p.token, senha: 'outra-senha-9' }, deps(em(5)))).toEqual(RECUSADO('ja_utilizado'));
    expect(await verificarConvite(p.token, deps(em(5)))).toEqual({ ok: false, motivo: 'ja_utilizado' });
    expect(await linhasDeUsuario(c, p.email!)).toHaveLength(1);
  });

  it('expirado: agora = expira_em e depois; um milissegundo antes ainda vale', async () => {
    const p = await convidada();
    const limite = 7 * DIA_MS;
    expect(await verificarConvite(p.token, deps(em(limite - 1)))).toEqual({ ok: true });
    expect(await verificarConvite(p.token, deps(em(limite)))).toEqual({ ok: false, motivo: 'expirado' });
    expect(await aceitarConvite({ token: p.token, senha: SENHA }, deps(em(limite)))).toEqual(RECUSADO('expirado'));
    await nada(p);
    expect(await aceitarConvite({ token: p.token, senha: SENHA }, deps(em(limite - 1)))).toMatchObject({ resultado: 'aceito' });
  });

  it('substituído por reenvio: o link antigo é recusado e o novo funciona', async () => {
    const p = await convidada();
    const novo = await emitirConvite(ctxDoGestor(a), p.id, em(1000));
    expect(await aceitarConvite({ token: p.token, senha: SENHA }, deps(em(2000)))).toEqual(RECUSADO('invalidado'));
    await nada(p);
    expect(await aceitarConvite({ token: novo.token, senha: SENHA }, deps(em(2000)))).toMatchObject({ resultado: 'aceito' });
  });

  it('inexistente, malformado e não texto: recusa uniforme, sem usuário', async () => {
    linhasDeLog = [];
    for (const token of [gerarToken(), 'curto', `${'T'.repeat(42)}!`, '', undefined, 42, null]) {
      expect(await aceitarConvite({ token, senha: SENHA }, deps(T0)), String(token)).toEqual(RECUSADO('invalido'));
      expect(await verificarConvite(token, deps(T0)), String(token)).toEqual({ ok: false, motivo: 'invalido' });
    }
  });

  it('o GET (verificarConvite) não escreve no banco', async () => {
    const p = await convidada();
    const antes = await c.query(`SELECT count(*)::int AS n, max(atualizado_em) AS m FROM usuario`);
    const convAntes = await convitesDe(c, p.id);
    await verificarConvite(p.token, deps(T0));
    await verificarConvite(p.token, deps(T0));
    expect(await convitesDe(c, p.id)).toEqual(convAntes);
    expect((await c.query(`SELECT count(*)::int AS n, max(atualizado_em) AS m FROM usuario`)).rows).toEqual(antes.rows);
  });
});

describe('CA-8: e-mail registrado entre o envio e o aceite', () => {
  it('recusa sem criar usuário nem 500 (ON CONFLICT, sem 23505) e o convite continua pendente', async () => {
    const p = await convidada();
    await c.query(
      `INSERT INTO usuario (salao_id, papel, email, nome, senha_hash) VALUES ($1, 'profissional', $2, 'Intrusa', 'x')`,
      [b.salaoId, p.email],
    );
    expect(await aceitarConvite({ token: p.token, senha: SENHA }, deps(T0))).toEqual(RECUSADO('email_em_uso'));
    expect((await linhasDeUsuario(c, p.email!)).map((u) => u.nome)).toEqual(['Intrusa']);
    const { rows } = await c.query('SELECT usuario_id FROM profissional WHERE id = $1', [p.id]);
    expect(rows[0].usuario_id).toBeNull();
    expect(pendentes(await convitesDe(c, p.id))).toHaveLength(1);
  });
});

describe('CA-9: desativação depois do convite', () => {
  it('o link é recusado e a desativação já invalidou o convite; reativar não o restaura', async () => {
    const p = await convidada();
    const gestor = await credencialDoGestor(a);
    const d = await desativarProfissional.executar(gestor, { id: p.id }, { agora: em(1000) });
    expect(d).toMatchObject({ ok: true, dados: { resultado: 'desativado' } });
    expect(await aceitarConvite({ token: p.token, senha: SENHA }, deps(em(2000)))).toEqual(RECUSADO('invalidado'));
    await c.query('UPDATE profissional SET ativo = true WHERE id = $1', [p.id]);
    expect(await aceitarConvite({ token: p.token, senha: SENHA }, deps(em(3000)))).toEqual(RECUSADO('invalidado'));
    await nada(p);
  });

  it('inativo, e-mail trocado e perfil já vinculado sem invalidar o convite (UPDATE direto): recusa; restaurado, aceita', async () => {
    const p = await convidada();
    await c.query('UPDATE profissional SET ativo = false WHERE id = $1', [p.id]);
    expect(await aceitarConvite({ token: p.token, senha: SENHA }, deps(T0))).toEqual(RECUSADO('profissional_inativo'));
    await c.query('UPDATE profissional SET ativo = true WHERE id = $1', [p.id]);
    await c.query('UPDATE profissional SET email = $2 WHERE id = $1', [p.id, emailNovo()]);
    expect(await aceitarConvite({ token: p.token, senha: SENHA }, deps(T0))).toEqual(RECUSADO('email_divergente'));
    await c.query('UPDATE profissional SET email = $2 WHERE id = $1', [p.id, p.email]);
    const { rows: outro } = await c.query<{ id: string }>(
      `INSERT INTO usuario (salao_id, papel, email, nome, senha_hash) VALUES ($1, 'profissional', $2, 'Outra', 'x') RETURNING id::text AS id`,
      [a.salaoId, emailNovo()],
    );
    await c.query('UPDATE profissional SET usuario_id = $2 WHERE id = $1', [p.id, outro[0].id]);
    expect(await aceitarConvite({ token: p.token, senha: SENHA }, deps(T0))).toEqual(RECUSADO('ja_vinculado'));
    expect(await linhasDeUsuario(c, p.email!)).toHaveLength(0);
    await c.query('UPDATE profissional SET usuario_id = NULL WHERE id = $1', [p.id]);
    expect(await aceitarConvite({ token: p.token, senha: SENHA }, deps(T0))).toMatchObject({ resultado: 'aceito' });
  });
});

describe('CA-13: senha inválida', () => {
  it('menos de 8 e mais de 1024 caracteres: erro de campo e o convite continua pendente', async () => {
    const p = await convidada();
    for (const [senha, msg] of [
      ['1234567', MENSAGENS_CONVITE.senhaCurta],
      ['', MENSAGENS_CONVITE.senhaCurta],
      [undefined, MENSAGENS_CONVITE.senhaCurta],
      ['x'.repeat(1025), MENSAGENS_CONVITE.senhaLonga],
    ] as const) {
      expect(await aceitarConvite({ token: p.token, senha }, deps(T0)), String(senha?.length)).toEqual({ resultado: 'invalido', erros: { senha: msg } });
    }
    await nada(p);
    expect(pendentes(await convitesDe(c, p.id))).toHaveLength(1);
    expect(await aceitarConvite({ token: p.token, senha: 'x'.repeat(1024) }, deps(T0))).toMatchObject({ resultado: 'aceito' });
  });
});

describe('falha inesperada', () => {
  it('erro ao gerar o hash vira "falha" sem efeito e o convite continua pendente', async () => {
    const p = await convidada();
    const r = await aceitarConvite(
      { token: p.token, senha: SENHA },
      { ...deps(T0), hashSenha: async () => { throw new Error('argon2 caiu'); } },
    );
    expect(r).toEqual({ resultado: 'falha', mensagem: MENSAGENS_CONVITE.falha });
    await nada(p);
    expect(pendentes(await convitesDe(c, p.id))).toHaveLength(1);
  });
});
