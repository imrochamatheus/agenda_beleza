import { createHash } from 'node:crypto';

import type pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { LIMITE_ENVIOS, VALIDADE_CONVITE_MS, linkDeConvite } from '@/server/auth/convite';
import { MENSAGENS_CONVITE } from '@/server/convites/tipos';
import { convidarProfissional } from '@/server/convites/convites.acao';
import { convidar } from '@/server/convites/servico';
import { editarProfissional } from '@/server/profissionais/profissionais.acao';
import { ErroEnvioEmail } from '@/server/integrations/email/port';
import { NaoEncontrado } from '@/server/tenant/erros';

import { credencialDoGestor, credencialDoProfissional } from '../../support/auth';
import { criarDoisSaloes } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import {
  APP_URL,
  DIA_MS,
  MIN_MS,
  T0,
  contadorDaJanela,
  convitesDe,
  emailsDe,
  emitirConvite,
  novoProfissionalSemAcesso,
  pendentes,
  tokenDoUltimoEmail,
} from '../../support/convites';
import { conectar, emailNovo } from '../../support/sql';
import { ctxDoGestor } from '../profissionais/apoio';

// D-039 CA-1, CA-4, CA-5, CA-9 (envio), CA-10, CA-11, CA-12, CA-14: convidar contra PostgreSQL real, com
// relógio injetado e o adaptador de e-mail simulado (email_log).

let c: pg.Client;
let a: SalaoCompleto;
let b: SalaoCompleto;

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

const silencio = () => vi.spyOn(console, 'info').mockImplementation(() => {});
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

describe('CA-1: enviar', () => {
  it('cria 1 convite pendente (7 dias, só o hash), envia 1 e-mail com o link de APP_URL', async () => {
    silencio();
    const p = await novoProfissionalSemAcesso(c, a.salaoId, { email: emailNovo() });
    const { r, token } = await emitirConvite(ctxDoGestor(a), p.id);
    expect(r).toEqual({ resultado: 'criado', emailEnviado: true, expiraEm: new Date(T0.getTime() + VALIDADE_CONVITE_MS).toISOString() });

    const linhas = await convitesDe(c, p.id);
    expect(linhas).toHaveLength(1);
    expect(pendentes(linhas)).toHaveLength(1);
    expect(linhas[0].email).toBe(p.email);
    expect(linhas[0].expira_em.getTime()).toBe(T0.getTime() + 7 * DIA_MS);
    expect(linhas[0].token_hash).toBe(sha(token));
    expect(JSON.stringify(linhas)).not.toContain(token);

    const emails = await emailsDe(c, p.email!);
    expect(emails).toHaveLength(1);
    expect(emails[0].corpo).toContain(linkDeConvite(APP_URL, token));
    expect(emails[0].corpo).toContain(`${APP_URL}/convite/${token}`);
    expect(await tokenDoUltimoEmail(c, p.email!)).toBe(token);
    expect(emails[0].corpo).toMatch(/\/convite\/[A-Za-z0-9_-]{43}/);
    expect(emails[0].corpo).toContain('7 dias');
  });

  it('e-mail do perfil com caixa e espaços é gravado e enviado normalizado', async () => {
    silencio();
    const p = await novoProfissionalSemAcesso(c, a.salaoId, { email: `  ${emailNovo().toUpperCase()} ` });
    const { r } = await emitirConvite(ctxDoGestor(a), p.id);
    expect(r).toMatchObject({ resultado: 'criado' });
    const esperado = p.email!.trim().toLowerCase();
    expect((await convitesDe(c, p.id))[0].email).toBe(esperado);
    expect(await emailsDe(c, esperado)).toHaveLength(1);
  });
});

describe('CA-4: e-mail já usado', () => {
  it('e-mail de usuário de outro salão e do próprio salão: mesma mensagem, sem convite nem e-mail', async () => {
    silencio();
    for (const email of [b.gestor.email, a.gestor.email, b.profissional.email.toUpperCase()]) {
      const p = await novoProfissionalSemAcesso(c, a.salaoId, { email });
      const { r } = await emitirConvite(ctxDoGestor(a), p.id);
      expect(r).toEqual({ resultado: 'invalido', erros: { email: MENSAGENS_CONVITE.emailEmUso } });
      expect(await convitesDe(c, p.id)).toHaveLength(0);
      expect(await emailsDe(c, email.trim().toLowerCase())).toHaveLength(0);
      expect(await contadorDaJanela(c, p.id)).toBe(0);
    }
  });
});

describe('CA-5: reenviar', () => {
  it('invalida o anterior, deixa exatamente 1 pendente (o novo) e cada envio conta na janela', async () => {
    silencio();
    const p = await novoProfissionalSemAcesso(c, a.salaoId);
    const um = await emitirConvite(ctxDoGestor(a), p.id, T0);
    const dois = await emitirConvite(ctxDoGestor(a), p.id, new Date(T0.getTime() + MIN_MS));
    expect(dois.r).toMatchObject({ resultado: 'criado' });
    const linhas = await convitesDe(c, p.id);
    expect(linhas).toHaveLength(2);
    expect(linhas[0].invalidado_em).not.toBeNull();
    expect(pendentes(linhas)).toHaveLength(1);
    expect(pendentes(linhas)[0].token_hash).toBe(sha(dois.token));
    expect(linhas[0].token_hash).toBe(sha(um.token));
    expect(await contadorDaJanela(c, p.id)).toBe(2);
  });

  it('um convite vencido e não invalidado também é invalidado ao reenviar', async () => {
    silencio();
    const p = await novoProfissionalSemAcesso(c, a.salaoId);
    await emitirConvite(ctxDoGestor(a), p.id, T0);
    const { r } = await emitirConvite(ctxDoGestor(a), p.id, new Date(T0.getTime() + 8 * DIA_MS));
    expect(r).toMatchObject({ resultado: 'criado' });
    expect(pendentes(await convitesDe(c, p.id))).toHaveLength(1);
  });
});

describe('CA-9: recusas de envio', () => {
  it('inativo, com usuário vinculado (inclui o perfil do gestor) e sem e-mail: nada gravado, sem e-mail', async () => {
    silencio();
    const inativo = await novoProfissionalSemAcesso(c, a.salaoId, { ativo: false });
    const semEmail = await novoProfissionalSemAcesso(c, a.salaoId, { email: null });
    const casos: [string, unknown][] = [
      [inativo.id, { formulario: MENSAGENS_CONVITE.inativo }],
      [a.profissional.profissionalId, { formulario: MENSAGENS_CONVITE.jaTemAcesso }],
      [a.gestor.profissionalId!, { formulario: MENSAGENS_CONVITE.jaTemAcesso }],
      [semEmail.id, { email: MENSAGENS_CONVITE.semEmail }],
    ];
    for (const [id, erros] of casos) {
      const { r } = await emitirConvite(ctxDoGestor(a), id);
      expect(r, id).toEqual({ resultado: 'invalido', erros });
      expect(await convitesDe(c, id), id).toHaveLength(0);
    }
    const { rows } = await c.query(`SELECT 1 FROM email_log WHERE destinatario = $1`, [inativo.email]);
    expect(rows).toHaveLength(0);
  });
});

describe('CA-10: edição do e-mail do perfil', () => {
  it('trocar o e-mail invalida o convite pendente; salvar o mesmo e-mail ou só o nome não', async () => {
    silencio();
    const gestor = await credencialDoGestor(a);
    const p = await novoProfissionalSemAcesso(c, a.salaoId, { nome: 'Edith' });
    await emitirConvite(ctxDoGestor(a), p.id);

    const mesmo = await editarProfissional.executar(gestor, { id: p.id, nome: 'Edith Nova', email: p.email!.toUpperCase() });
    expect(mesmo).toMatchObject({ ok: true, dados: { resultado: 'salvo' } });
    expect(pendentes(await convitesDe(c, p.id))).toHaveLength(1);

    const novo = emailNovo();
    const troca = await editarProfissional.executar(gestor, { id: p.id, nome: 'Edith Nova', email: novo });
    expect(troca).toMatchObject({ ok: true, dados: { resultado: 'salvo' } });
    const linhas = await convitesDe(c, p.id);
    expect(pendentes(linhas)).toHaveLength(0);
    expect(linhas[0].invalidado_em).not.toBeNull();
  });

  it('erro de validação ao editar não invalida o convite', async () => {
    silencio();
    const gestor = await credencialDoGestor(a);
    const p = await novoProfissionalSemAcesso(c, a.salaoId);
    await emitirConvite(ctxDoGestor(a), p.id);
    const r = await editarProfissional.executar(gestor, { id: p.id, nome: 'X', email: 'nao-e-email' });
    expect(r).toMatchObject({ ok: true, dados: { resultado: 'invalido' } });
    expect(pendentes(await convitesDe(c, p.id))).toHaveLength(1);
  });
});

describe('CA-11: acesso e isolamento', () => {
  it('profissional logado → 403; gestor de outro salão com o id → 404; sem convite criado', async () => {
    silencio();
    const p = await novoProfissionalSemAcesso(c, a.salaoId);
    const prof = await credencialDoProfissional(a);
    expect(await convidarProfissional.executar(prof, { id: p.id })).toEqual({ ok: false, erro: 'acesso_negado', status: 403 });
    const gestorB = await credencialDoGestor(b);
    expect(await convidarProfissional.executar(gestorB, { id: p.id })).toEqual({ ok: false, erro: 'nao_encontrado', status: 404 });
    for (const id of ['nao-e-uuid', undefined, 42, '00000000-0000-4000-8000-000000000000']) {
      expect(await convidarProfissional.executar(gestorB, { id } as never), String(id)).toEqual({ ok: false, erro: 'nao_encontrado', status: 404 });
    }
    expect(await convitesDe(c, p.id)).toHaveLength(0);
    await expect(convidar(ctxDoGestor(b), { id: p.id }, T0)).rejects.toBeInstanceOf(NaoEncontrado);
    expect(await emailsDe(c, p.email!)).toHaveLength(0);
  });

  it('pela ação, o gestor do salão convida e o resultado é ok/criado', async () => {
    silencio();
    const p = await novoProfissionalSemAcesso(c, a.salaoId);
    const r = await convidarProfissional.executar(await credencialDoGestor(a), { id: p.id }, { agora: T0 });
    expect(r).toMatchObject({ ok: true, dados: { resultado: 'criado', emailEnviado: true } });
    expect(await emailsDe(c, p.email!)).toHaveLength(1);
    expect(pendentes(await convitesDe(c, p.id))).toHaveLength(1);
  });
});

describe('CA-12: limite de envios', () => {
  it('o 4º envio em 15 minutos é recusado, sem e-mail, e o 3º convite continua o único pendente', async () => {
    silencio();
    const p = await novoProfissionalSemAcesso(c, a.salaoId);
    const tokens: string[] = [];
    for (let i = 0; i < LIMITE_ENVIOS; i++) {
      const { r, token } = await emitirConvite(ctxDoGestor(a), p.id, new Date(T0.getTime() + i * MIN_MS));
      expect(r).toMatchObject({ resultado: 'criado' });
      tokens.push(token);
    }
    const { r } = await emitirConvite(ctxDoGestor(a), p.id, new Date(T0.getTime() + 3 * MIN_MS));
    expect(r).toEqual({ resultado: 'limite' });
    const linhas = await convitesDe(c, p.id);
    expect(linhas).toHaveLength(3);
    expect(pendentes(linhas).map((l) => l.token_hash)).toEqual([sha(tokens[2])]);
    expect(await emailsDe(c, p.email!)).toHaveLength(3);
    expect(await contadorDaJanela(c, p.id)).toBe(3);
  });

  it('numa janela nova de 15 minutos o envio volta a ser aceito', async () => {
    silencio();
    const p = await novoProfissionalSemAcesso(c, a.salaoId);
    for (let i = 0; i < 4; i++) await emitirConvite(ctxDoGestor(a), p.id, T0);
    const { r } = await emitirConvite(ctxDoGestor(a), p.id, new Date(T0.getTime() + 16 * MIN_MS));
    expect(r).toMatchObject({ resultado: 'criado' });
  });
});

describe('CA-14: falha da porta de e-mail', () => {
  it('o convite existe e a resposta traz emailEnviado: false', async () => {
    silencio();
    const p = await novoProfissionalSemAcesso(c, a.salaoId);
    const r = await convidar(ctxDoGestor(a), { id: p.id }, T0, {
      appUrl: APP_URL,
      email: {
        enviar: async () => {
          throw new ErroEnvioEmail('conexao', true);
        },
      },
    });
    expect(r).toMatchObject({ resultado: 'criado', emailEnviado: false });
    expect(pendentes(await convitesDe(c, p.id))).toHaveLength(1);
    expect(await emailsDe(c, p.email!)).toHaveLength(0);
  });

  it('APP_URL inválida: também vira emailEnviado: false, sem lançar', async () => {
    silencio();
    const p = await novoProfissionalSemAcesso(c, a.salaoId);
    const r = await convidar(ctxDoGestor(a), { id: p.id }, T0, { appUrl: 'isto nao e url' });
    expect(r).toMatchObject({ resultado: 'criado', emailEnviado: false });
    expect(pendentes(await convitesDe(c, p.id))).toHaveLength(1);
  });
});
