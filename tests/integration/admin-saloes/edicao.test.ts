import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { editarSalao, lerSalao } from '@/server/admin/saloes';
import { MENSAGENS_ADMIN_SALOES } from '@/server/admin/saloes-tipos';
import { hashDoToken } from '@/server/tenant/sessao';
import { MENSAGENS_CONFIGURACOES } from '@/server/salao/tipos';
import { encerrarPrisma, obterPrisma } from '@/server/repos/db';
import { NaoEncontrado } from '@/server/tenant/erros';

import {
  DEPS, adminDeTeste, criarTokenPendente, emailsEnviados, entradaIgual, salaoComAssinatura, salaoNoBanco, sessoesAtivas, slugsNoBanco,
  tokensPendentes, usuarioNoBanco,
} from '../../support/admin-saloes';
import type { AdminDeTeste } from '../../support/admin-saloes';
import { linhasDeAuditoria } from '../../support/auditoria';
import { criarSessao } from '../../support/auth';
import { conectar, emailNovo, slugNovo } from '../../support/sql';

// D-044 CA-8, CA-9, CA-13: edição de nome, slug, fuso, regras e gestor (sem senha), com auditoria antes/depois.
let c: pg.Client;
let adm: AdminDeTeste;
const AGORA = new Date('2027-05-10T12:00:00Z');

beforeAll(async () => {
  c = await conectar();
  adm = await adminDeTeste();
});
afterAll(async () => {
  await c.end();
  await encerrarPrisma();
});

const auditoriaDo = (salaoId: string, like = 'salao.%') => linhasDeAuditoria(c, 'salao_id = $1 AND acao LIKE $2', [salaoId, like]);
const detalhe = (id: string) => lerSalao(adm.ctx, id);

describe('CA-8: edição válida', () => {
  it('persiste nome, slug (o anterior vira histórico), fuso, regras e nome do gestor; audita só o que mudou', async () => {
    const s = await salaoComAssinatura('ativa');
    const d = await detalhe(s.salaoId);
    const novoSlug = slugNovo();
    const r = await editarSalao(
      adm.ctx,
      entradaIgual(d, { nome: '  Studio   Novo ', slug: ` ${novoSlug.toUpperCase()} `, fuso: 'America/Manaus', grade: '30', antecedencia: '4', janela: '90', intervalo: '10', gestorNome: 'Nova Gestora' }),
      AGORA,
      DEPS,
    );
    expect(r).toEqual({ resultado: 'editado' });
    expect(await salaoNoBanco(c, s.salaoId)).toMatchObject({ nome: 'Studio Novo', fuso: 'America/Manaus', grade_min: 30, antecedencia_min: 240, janela_dias: 90, intervalo_min: 10 });
    expect(await slugsNoBanco(c, s.salaoId)).toEqual(
      [{ slug: novoSlug, atual: true }, { slug: s.slugAtual, atual: false }, { slug: s.slugHistorico, atual: false }].sort((a, b) => (a.slug < b.slug ? -1 : 1)),
    );
    expect((await usuarioNoBanco(c, s.gestor.usuarioId)).nome).toBe('Nova Gestora');
    const aud = await auditoriaDo(s.salaoId);
    expect(aud).toHaveLength(1);
    expect(aud[0]).toMatchObject({ acao: 'salao.atualizar', entidade: 'salao', entidade_id: s.salaoId, ator_id: adm.usuarioId, resultado: 'sucesso' });
    expect(aud[0].antes).toEqual({
      nome: s.nome, fuso: 'America/Sao_Paulo', grade_min: 15, antecedencia_min: 120, janela_dias: 60, intervalo_min: 0, slug: s.slugAtual, gestor_nome: s.gestor.nome,
    });
    expect(aud[0].depois).toEqual({
      nome: 'Studio Novo', fuso: 'America/Manaus', grade_min: 30, antecedencia_min: 240, janela_dias: 90, intervalo_min: 10, slug: novoSlug, gestor_nome: 'Nova Gestora',
    });
    expect(await auditoriaDo(s.salaoId, 'usuario.%')).toHaveLength(0);
  });

  it('só um campo alterado: a auditoria carrega só ele', async () => {
    const s = await salaoComAssinatura(null);
    await editarSalao(adm.ctx, entradaIgual(await detalhe(s.salaoId), { janela: '45' }), AGORA, DEPS);
    const [a] = await auditoriaDo(s.salaoId);
    expect(a.antes).toEqual({ janela_dias: 60 });
    expect(a.depois).toEqual({ janela_dias: 45 });
  });

  it('valores idênticos não gravam nem auditam (nem atualizado_em)', async () => {
    const s = await salaoComAssinatura(null);
    const antes = await salaoNoBanco(c, s.salaoId);
    const d = await detalhe(s.salaoId);
    const r = await editarSalao(adm.ctx, entradaIgual(d, { nome: `  ${d.nome} `, gestorEmail: d.gestor!.email.toUpperCase() }), AGORA, DEPS);
    expect(r).toEqual({ resultado: 'sem_mudanca' });
    expect(await salaoNoBanco(c, s.salaoId)).toEqual(antes);
    expect(await auditoriaDo(s.salaoId, '%')).toHaveLength(0);
  });

  it('voltar a um slug próprio antigo é permitido', async () => {
    const s = await salaoComAssinatura(null);
    const r = await editarSalao(adm.ctx, entradaIgual(await detalhe(s.salaoId), { slug: s.slugHistorico }), AGORA, DEPS);
    expect(r).toEqual({ resultado: 'editado' });
    expect((await slugsNoBanco(c, s.salaoId)).find((x) => x.atual)?.slug).toBe(s.slugHistorico);
  });
});

describe('CA-8: as mesmas recusas da E2.5, sem gravar nada', () => {
  it('grade, antecedência × janela, fuso, slug reservado e formato: erros de campo com as mesmas mensagens', async () => {
    const s = await salaoComAssinatura(null);
    const d = await detalhe(s.salaoId);
    const antes = await salaoNoBanco(c, s.salaoId);
    const r = await editarSalao(
      adm.ctx,
      entradaIgual(d, { nome: 'Outro nome', grade: '7', antecedencia: '1440', janela: '30', fuso: 'Brasil/Leste', slug: 'painel' }),
      AGORA,
      DEPS,
    );
    expect(r).toEqual({
      resultado: 'invalido',
      erros: { grade: MENSAGENS_CONFIGURACOES.grade, antecedencia: MENSAGENS_CONFIGURACOES.antecedencia, fuso: MENSAGENS_CONFIGURACOES.fuso, slug: MENSAGENS_CONFIGURACOES.slugReservado },
    });
    expect(await salaoNoBanco(c, s.salaoId)).toEqual(antes);
    expect(await auditoriaDo(s.salaoId, '%')).toHaveLength(0);
  });

  it('antecedência igual ou maior que a janela', async () => {
    const s = await salaoComAssinatura(null);
    const r = await editarSalao(adm.ctx, entradaIgual(await detalhe(s.salaoId), { antecedencia: '48', janela: '2' }), AGORA, DEPS);
    expect(r).toEqual({ resultado: 'invalido', erros: { antecedencia: MENSAGENS_CONFIGURACOES.antecedenciaJanela } });
  });

  it('slug atual ou histórico de OUTRO salão: conflito_slug, e o resto da edição também não grava', async () => {
    const a = await salaoComAssinatura(null);
    const b = await salaoComAssinatura(null);
    const antes = await salaoNoBanco(c, a.salaoId);
    for (const slug of [b.slugAtual, b.slugHistorico]) {
      const r = await editarSalao(adm.ctx, entradaIgual(await detalhe(a.salaoId), { slug, nome: 'Nome que não deve gravar', grade: '30' }), AGORA, DEPS);
      expect(r).toEqual({ resultado: 'conflito_slug', erros: { slug: MENSAGENS_CONFIGURACOES.slugEmUso } });
    }
    expect(await salaoNoBanco(c, a.salaoId)).toEqual(antes);
    expect(await slugsNoBanco(c, a.salaoId)).toHaveLength(2);
    expect(await auditoriaDo(a.salaoId, '%')).toHaveLength(0);
    expect((await slugsNoBanco(c, b.salaoId)).find((x) => x.atual)?.slug).toBe(b.slugAtual);
  });
});

describe('CA-9: e-mail do gestor', () => {
  it('e-mail já usado por outra conta: erro de campo e nenhuma escrita (nem o nome)', async () => {
    const a = await salaoComAssinatura(null);
    const b = await salaoComAssinatura(null);
    const antes = await usuarioNoBanco(c, a.gestor.usuarioId);
    const r = await editarSalao(adm.ctx, entradaIgual(await detalhe(a.salaoId), { gestorEmail: b.gestor.email.toUpperCase(), gestorNome: 'Nome novo', nome: 'Salão novo' }), AGORA, DEPS);
    expect(r).toEqual({ resultado: 'email_em_uso', erros: { gestorEmail: MENSAGENS_ADMIN_SALOES.emailEmUso } });
    expect(await usuarioNoBanco(c, a.gestor.usuarioId)).toEqual(antes);
    expect((await salaoNoBanco(c, a.salaoId)).nome).toBe(a.nome);
    expect(await auditoriaDo(a.salaoId, '%')).toHaveLength(0);
  });

  it('e-mail livre: desconfirma, revoga sessões, invalida tokens, envia a confirmação ao novo endereço e mantém a senha', async () => {
    const s = await salaoComAssinatura(null);
    const gestor = s.gestor.usuarioId;
    await criarSessao(gestor);
    await criarSessao(gestor);
    const outro = await salaoComAssinatura(null);
    const sessaoDeOutro = await sessoesAtivas(c, outro.gestor.usuarioId);
    await criarSessao(outro.gestor.usuarioId);
    await criarTokenPendente(c, gestor, 'confirmacao_email');
    await criarTokenPendente(c, gestor, 'recuperacao_senha');
    const antes = await usuarioNoBanco(c, gestor);
    expect(antes.email_confirmado_em).not.toBeNull();
    const novo = emailNovo().toUpperCase();

    const r = await editarSalao(adm.ctx, entradaIgual(await detalhe(s.salaoId), { gestorEmail: ` ${novo} ` }), AGORA, DEPS);
    expect(r).toEqual({ resultado: 'editado', confirmacao: 'enviado' });

    const depois = await usuarioNoBanco(c, gestor);
    expect(depois.email).toBe(novo.toLowerCase());
    expect(depois.email_confirmado_em).toBeNull();
    expect(depois.senha_hash).toBe(antes.senha_hash);
    expect(depois.nome).toBe(antes.nome);
    expect(await sessoesAtivas(c, gestor)).toBe(0);
    expect(await sessoesAtivas(c, outro.gestor.usuarioId)).toBe(sessaoDeOutro + 1);
    expect(await tokensPendentes(c, gestor, 'recuperacao_senha')).toBe(0);
    expect(await tokensPendentes(c, gestor, 'confirmacao_email')).toBe(1);

    const enviados = await emailsEnviados(c, novo.toLowerCase());
    expect(enviados).toHaveLength(1);
    const token = /token=([A-Za-z0-9_-]{43})/.exec(enviados[0].corpo)?.[1];
    expect(token).toBeDefined();
    const linha = await obterPrisma().token.findUniqueOrThrow({ where: { tokenHash: hashDoToken(token!) } });
    expect(linha).toMatchObject({ usuarioId: gestor, tipo: 'confirmacao_email', usadoEm: null, invalidadoEm: null });
    expect(await emailsEnviados(c, antes.email)).toHaveLength(0);

    const aud = await auditoriaDo(s.salaoId, 'usuario.%');
    expect(aud).toHaveLength(1);
    expect(aud[0]).toMatchObject({
      acao: 'usuario.atualizar_email', entidade: 'usuario', entidade_id: gestor, ator_id: adm.usuarioId,
      antes: { email: antes.email, email_confirmado: true }, depois: { email: novo.toLowerCase(), email_confirmado: false },
    });
    expect(await auditoriaDo(s.salaoId)).toHaveLength(0);
  });

  it('falha ao enviar o e-mail não desfaz a troca; o resultado informa', async () => {
    const s = await salaoComAssinatura(null);
    const quebrada = { async enviar(): Promise<never> { throw new Error('smtp fora do ar'); } };
    const novo = emailNovo();
    const r = await editarSalao(adm.ctx, entradaIgual(await detalhe(s.salaoId), { gestorEmail: novo }), AGORA, { ...DEPS, email: quebrada });
    expect(r).toEqual({ resultado: 'editado', confirmacao: 'falhou' });
    expect((await usuarioNoBanco(c, s.gestor.usuarioId)).email).toBe(novo);
    expect(await tokensPendentes(c, s.gestor.usuarioId, 'confirmacao_email')).toBe(1);
  });

  it('corrida: outro cadastro ocupa o e-mail depois da pré-checagem; o 23505 vira email_em_uso e desfaz tudo', async () => {
    const s = await salaoComAssinatura(null);
    const d = await detalhe(s.salaoId);
    const novo = emailNovo();
    const intruso = await conectar();
    try {
      await intruso.query('BEGIN');
      await intruso.query(
        `INSERT INTO usuario (papel, email, nome, senha_hash) VALUES ('super_admin', $1, 'Intruso', 'hash-de-teste')`,
        [novo],
      );
      const edicao = editarSalao(adm.ctx, entradaIgual(d, { gestorEmail: novo, nome: 'Não deve gravar' }), AGORA, DEPS);
      // Espera o UPDATE do gestor ficar preso no índice único (esperando o intruso decidir).
      for (let i = 0; i < 100; i++) {
        const { rows } = await c.query<{ n: string }>(
          `SELECT count(*) AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query ILIKE '%UPDATE usuario%'`,
        );
        if (Number(rows[0].n) > 0) break;
        await new Promise((ok) => setTimeout(ok, 50));
      }
      await intruso.query('COMMIT');
      expect(await edicao).toEqual({ resultado: 'email_em_uso', erros: { gestorEmail: MENSAGENS_ADMIN_SALOES.emailEmUso } });
    } finally {
      await intruso.end();
    }
    expect((await usuarioNoBanco(c, s.gestor.usuarioId)).email).toBe(s.gestor.email);
    expect((await salaoNoBanco(c, s.salaoId)).nome).toBe(s.nome);
    expect(await auditoriaDo(s.salaoId, '%')).toHaveLength(0);
    expect(await emailsEnviados(c, novo)).toHaveLength(0);
  });

  it('só o nome do gestor: não desconfirma, não revoga sessões nem envia e-mail', async () => {
    const s = await salaoComAssinatura(null);
    await criarSessao(s.gestor.usuarioId);
    const sessoes = await sessoesAtivas(c, s.gestor.usuarioId);
    const r = await editarSalao(adm.ctx, entradaIgual(await detalhe(s.salaoId), { gestorNome: 'Só o nome' }), AGORA, DEPS);
    expect(r).toEqual({ resultado: 'editado' });
    const u = await usuarioNoBanco(c, s.gestor.usuarioId);
    expect(u.email_confirmado_em).not.toBeNull();
    expect(await sessoesAtivas(c, s.gestor.usuarioId)).toBe(sessoes);
    expect(await emailsEnviados(c, s.gestor.email)).toHaveLength(0);
    expect(await auditoriaDo(s.salaoId, 'usuario.%')).toHaveLength(0);
  });

  it('gestor ainda não confirmado que troca o e-mail continua não confirmado e recebe o link', async () => {
    const s = await salaoComAssinatura(null, {}, { gestor: { emailConfirmado: false } });
    const novo = emailNovo();
    expect(await editarSalao(adm.ctx, entradaIgual(await detalhe(s.salaoId), { gestorEmail: novo }), AGORA, DEPS)).toEqual({ resultado: 'editado', confirmacao: 'enviado' });
    expect((await usuarioNoBanco(c, s.gestor.usuarioId)).email_confirmado_em).toBeNull();
  });

  it('campos do gestor inválidos: erros juntos com os do salão', async () => {
    const s = await salaoComAssinatura(null);
    const r = await editarSalao(adm.ctx, entradaIgual(await detalhe(s.salaoId), { gestorEmail: 'sem-arroba', gestorNome: 'A', grade: '7' }), AGORA, DEPS);
    expect(r).toMatchObject({ resultado: 'invalido', erros: { gestorEmail: expect.any(String), gestorNome: expect.any(String), grade: expect.any(String) } });
  });
});

describe('CA-13: escopo e entrada', () => {
  it('salão sem gestor: edita o salão e ignora os campos do gestor', async () => {
    const db = obterPrisma();
    const criado = await db.salao.create({ data: { nome: 'Salão órfão' }, select: { id: true } });
    await db.salaoSlug.create({ data: { slug: slugNovo(), salaoId: criado.id, atual: true } });
    const s = { salaoId: criado.id };
    const d = await detalhe(s.salaoId);
    expect(d.gestor).toBeNull();
    const r = await editarSalao(adm.ctx, entradaIgual(d, { nome: 'Sem gestor', gestorNome: '', gestorEmail: 'lixo' }), AGORA, DEPS);
    expect(r).toEqual({ resultado: 'editado' });
    expect((await salaoNoBanco(c, s.salaoId)).nome).toBe('Sem gestor');
  });

  it('id malformado ou desconhecido: NaoEncontrado; editar um salão não toca o outro', async () => {
    for (const salaoId of ['x', '', undefined, '00000000-0000-4000-8000-000000000000']) {
      await expect(editarSalao(adm.ctx, { salaoId, nome: 'x' }, AGORA, DEPS)).rejects.toBeInstanceOf(NaoEncontrado);
    }
    const a = await salaoComAssinatura(null);
    const b = await salaoComAssinatura(null);
    await editarSalao(adm.ctx, entradaIgual(await detalhe(a.salaoId), { nome: 'Só o A', gestorNome: 'Só A' }), AGORA, DEPS);
    expect((await salaoNoBanco(c, b.salaoId)).nome).toBe(b.nome);
    expect((await usuarioNoBanco(c, b.gestor.usuarioId)).nome).toBe(b.gestor.nome);
  });

  it('entrada sem os campos do formulário é erro de campo, nunca exceção', async () => {
    const s = await salaoComAssinatura(null);
    const r = await editarSalao(adm.ctx, { salaoId: s.salaoId, salaoIdExtra: 'x', senha: 'nunca', senhaHash: 'nunca' } as never, AGORA, DEPS);
    expect(r.resultado).toBe('invalido');
    expect((await usuarioNoBanco(c, s.gestor.usuarioId)).senha_hash).not.toBe('nunca');
  });
});
