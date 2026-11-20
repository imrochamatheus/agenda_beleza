import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { revogarSessoesDoUsuario } from '@/server/repos/sessao';
import { repos } from '@/server/repos';
import { emTransacao } from '@/server/repos/transacao';
import { NaoEncontrado } from '@/server/tenant/erros';

import { criarSessao } from '../../support/auth';
import { criarDoisSaloes, criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

import {
  MIN_MS,
  ctxDoGestor,
  ctxDoProfissional,
  inserirConvite,
  inserirReservaComItens,
  linhaProfissional,
  sessoesDe,
} from './apoio';

// D-013 T-2: repositórios de profissionais e a consulta de reservas bloqueantes, contra PostgreSQL
// real, com dois salões (G-4). CA-1, CA-2, CA-7, CA-9, CA-10, CA-14 e CA-15 na camada de dados.

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

describe('criar, listar e buscar', () => {
  it('CA-1: criar grava no salão do contexto, ativo, sem usuário; e-mail opcional', async () => {
    const ana = await repos().profissionais.criar(ctxDoGestor(a), { nome: 'Ana', email: null });
    const bia = await repos().profissionais.criar(ctxDoGestor(a), { nome: 'Bia', email: 'bia@exemplo.com' });
    expect(ana).toMatchObject({ nome: 'Ana', email: null, usuarioId: null, ativo: true });
    expect(await linhaProfissional(c, ana.id)).toMatchObject({ salao_id: a.salaoId, usuario_id: null, email: null, ativo: true });
    expect(await linhaProfissional(c, bia.id)).toMatchObject({ salao_id: a.salaoId, email: 'bia@exemplo.com' });
  });

  it('CA-10/D-9: listarParaPainel só traz o salão do contexto, ativos primeiro e por nome, com o vínculo', async () => {
    const s = await criarSalaoCompleto({ gestor: { nome: 'Marta' }, profissional: { nome: 'Carla' } });
    const zu = await repos().profissionais.criar(ctxDoGestor(s), { nome: 'Zuleica', email: null });
    const abel = await repos().profissionais.criar(ctxDoGestor(s), { nome: 'Abel', email: null });
    await c.query('UPDATE profissional SET ativo = false WHERE id = $1', [abel.id]);

    const lista = await repos().profissionais.listarParaPainel(ctxDoGestor(s));
    const linhaInativa = await linhaProfissional(c, s.profissionalInativoId);
    expect(lista.map((p) => [p.nome, p.ativo])).toEqual([
      ['Carla', true],
      ['Marta', true],
      ['Zuleica', true],
      ['Abel', false],
      [linhaInativa!.nome, false],
    ]);
    const porId = new Map(lista.map((p) => [p.id, p]));
    expect(porId.get(s.gestor.profissionalId!)!.vinculo).toEqual({ papel: 'gestor', emailLogin: s.gestor.email });
    expect(porId.get(s.profissional.profissionalId)!.vinculo).toEqual({ papel: 'profissional', emailLogin: s.profissional.email });
    expect(porId.get(zu.id)!.vinculo).toBeNull();
    expect(lista.some((p) => p.id === b.profissional.profissionalId)).toBe(false);
    expect(JSON.stringify(lista)).not.toContain('senha');
  });

  it('CA-4: listarAtivos exclui os inativos', async () => {
    const ativos = await repos().profissionais.listarAtivos(ctxDoGestor(a));
    expect(ativos.every((p) => p.ativo)).toBe(true);
    expect(ativos.map((p) => p.id)).toContain(a.profissional.profissionalId);
    expect(ativos.map((p) => p.id)).not.toContain(a.profissionalInativoId);
    expect(ativos.map((p) => p.id)).not.toContain(b.profissional.profissionalId);
  });

  it('CA-9: buscarParaPainel, atualizarDados e reativar com id de B ou inexistente → NaoEncontrado; B intacto', async () => {
    const antes = await linhaProfissional(c, b.profissional.profissionalId);
    const r = repos().profissionais;
    for (const id of [b.profissional.profissionalId, '00000000-0000-4000-8000-000000000000']) {
      await expect(r.buscarParaPainel(ctxDoGestor(a), id)).rejects.toBeInstanceOf(NaoEncontrado);
      await expect(r.atualizarDados(ctxDoGestor(a), id, { nome: 'X', email: null })).rejects.toBeInstanceOf(NaoEncontrado);
      await expect(r.reativar(ctxDoGestor(a), id)).rejects.toBeInstanceOf(NaoEncontrado);
      await expect(emTransacao((t) => t.profissionais.travarParaAlteracao(ctxDoGestor(a), id))).rejects.toBeInstanceOf(
        NaoEncontrado,
      );
    }
    expect(await linhaProfissional(c, b.profissional.profissionalId)).toEqual(antes);
    const proprio = await r.buscarParaPainel(ctxDoGestor(a), a.profissional.profissionalId);
    expect(proprio.vinculo).toEqual({ papel: 'profissional', emailLogin: a.profissional.email });
  });

  it('atualizarDados grava nome e e-mail e devolve o DTO', async () => {
    const p = await repos().profissionais.criar(ctxDoGestor(a), { nome: 'Dora', email: null });
    const novo = await repos().profissionais.atualizarDados(ctxDoGestor(a), p.id, { nome: 'Dora Lima', email: 'dora@exemplo.com' });
    expect(novo).toMatchObject({ id: p.id, nome: 'Dora Lima', email: 'dora@exemplo.com' });
  });
});

describe('travarParaAlteracao e aplicarDesativacao', () => {
  it('a trava devolve o estado, o papel do usuário vinculado e o fuso do salão', async () => {
    const s = await criarSalaoCompleto({ salao: { fuso: 'America/Manaus' } });
    const [prof, gestor, semUsuario] = await emTransacao(async (t) => [
      await t.profissionais.travarParaAlteracao(ctxDoGestor(s), s.profissional.profissionalId),
      await t.profissionais.travarParaAlteracao(ctxDoGestor(s), s.gestor.profissionalId!),
      await t.profissionais.travarParaAlteracao(ctxDoGestor(s), s.profissionalInativoId),
    ]);
    expect(prof).toEqual({
      id: s.profissional.profissionalId,
      usuarioId: s.profissional.usuarioId,
      ativo: true,
      email: s.profissional.email,
      papelUsuario: 'profissional',
      fusoSalao: 'America/Manaus',
    });
    expect([gestor.papelUsuario, gestor.usuarioId]).toEqual(['gestor', s.gestor.usuarioId]);
    expect([semUsuario.papelUsuario, semUsuario.usuarioId, semUsuario.ativo]).toEqual([null, null, false]);
  });

  it('CA-7: revoga só as sessões do usuário indicado e invalida só o convite pendente', async () => {
    const s = await criarSalaoCompleto();
    const id = s.profissional.profissionalId;
    await criarSessao(s.profissional.usuarioId);
    await criarSessao(s.profissional.usuarioId);
    const jaRevogada = await criarSessao(s.profissional.usuarioId, { revogadaEm: new Date('2026-01-01T00:00:00Z') });
    await criarSessao(s.gestor.usuarioId);
    const pendente = await inserirConvite(c, { salaoId: s.salaoId, profissionalId: id, estado: 'pendente' });
    const aceito = await inserirConvite(c, { salaoId: s.salaoId, profissionalId: id, estado: 'aceito' });
    const invalidado = await inserirConvite(c, { salaoId: s.salaoId, profissionalId: id, estado: 'invalidado' });
    const outro = await inserirConvite(c, { salaoId: s.salaoId, profissionalId: s.profissionalInativoId, estado: 'pendente' });
    const conviteAntes = await c.query('SELECT id, aceito_em, invalidado_em FROM convite WHERE id = ANY($1) ORDER BY id', [
      [aceito, invalidado, outro],
    ]);
    const agora = new Date('2031-03-04T05:06:07.000Z');

    const r = await emTransacao((t) =>
      t.profissionais.aplicarDesativacao(ctxDoGestor(s), id, { agora, revogarSessoesDe: s.profissional.usuarioId }),
    );

    expect(r).toEqual({ sessoesRevogadas: 2, convitesInvalidados: 1 });
    expect((await linhaProfissional(c, id))!.ativo).toBe(false);
    const sessoes = await sessoesDe(c, s.profissional.usuarioId);
    expect(sessoes.filter((x) => x.id !== jaRevogada.sessaoId).map((x) => x.revogada_em)).toEqual([agora, agora]);
    expect(sessoes.find((x) => x.id === jaRevogada.sessaoId)!.revogada_em).toEqual(new Date('2026-01-01T00:00:00Z'));
    expect((await sessoesDe(c, s.gestor.usuarioId)).every((x) => x.revogada_em === null)).toBe(true);
    const { rows } = await c.query('SELECT invalidado_em FROM convite WHERE id = $1', [pendente]);
    expect(rows[0].invalidado_em).toEqual(agora);
    expect(
      (await c.query('SELECT id, aceito_em, invalidado_em FROM convite WHERE id = ANY($1) ORDER BY id', [[aceito, invalidado, outro]]))
        .rows,
    ).toEqual(conviteAntes.rows);
  });

  it('sem usuário a revogar: nenhuma sessão muda', async () => {
    const s = await criarSalaoCompleto();
    await criarSessao(s.gestor.usuarioId);
    const r = await emTransacao((t) =>
      t.profissionais.aplicarDesativacao(ctxDoGestor(s), s.gestor.profissionalId!, { agora: new Date(), revogarSessoesDe: null }),
    );
    expect(r).toEqual({ sessoesRevogadas: 0, convitesInvalidados: 0 });
    expect((await sessoesDe(c, s.gestor.usuarioId)).every((x) => x.revogada_em === null)).toBe(true);
  });

  it('revogarSessoesDoUsuario com o executor da transação é desfeita pelo rollback', async () => {
    const s = await criarSalaoCompleto();
    await criarSessao(s.profissional.usuarioId);
    const erro = await emTransacao(async (t) => {
      await t.profissionais.aplicarDesativacao(ctxDoGestor(s), s.profissional.profissionalId, {
        agora: new Date(),
        revogarSessoesDe: s.profissional.usuarioId,
      });
      throw new Error('desfazer');
    }).catch((e: unknown) => e);
    expect((erro as Error).message).toBe('desfazer');
    expect((await linhaProfissional(c, s.profissional.profissionalId))!.ativo).toBe(true);
    expect((await sessoesDe(c, s.profissional.usuarioId)).every((x) => x.revogada_em === null)).toBe(true);
    // Sem executor, a forma de dois argumentos continua usando o cliente global.
    expect(await revogarSessoesDoUsuario(s.profissional.usuarioId, new Date())).toBe(1);
  });
});

describe('garantirPerfilDoGestor (CA-2, CA-14)', () => {
  it('cria, depois informa "já atende" e reativa o mesmo perfil desativado', async () => {
    const s = await criarSalaoCompleto({ gestor: { comPerfil: false, nome: 'Rita' } });
    const ctx = ctxDoGestor(s, null);
    const criado = await emTransacao((t) => t.profissionais.garantirPerfilDoGestor(ctx));
    expect(criado.resultado).toBe('criado');
    expect(await linhaProfissional(c, criado.id)).toMatchObject({
      salao_id: s.salaoId,
      usuario_id: s.gestor.usuarioId,
      nome: 'Rita',
      email: null,
      ativo: true,
    });
    expect(await emTransacao((t) => t.profissionais.garantirPerfilDoGestor(ctx))).toEqual({ id: criado.id, resultado: 'ja_atende' });
    await c.query('UPDATE profissional SET ativo = false WHERE id = $1', [criado.id]);
    expect(await emTransacao((t) => t.profissionais.garantirPerfilDoGestor(ctx))).toEqual({ id: criado.id, resultado: 'reativado' });
    expect((await linhaProfissional(c, criado.id))!.ativo).toBe(true);
    const { rows } = await c.query('SELECT count(*)::int AS n FROM profissional WHERE usuario_id = $1', [s.gestor.usuarioId]);
    expect(rows[0].n).toBe(1);
  });

  it('usuário que não é gestor → NaoEncontrado, sem criar perfil; nunca toca outro salão', async () => {
    const antesB = await c.query('SELECT count(*)::int AS n FROM profissional WHERE salao_id = $1', [b.salaoId]);
    await expect(emTransacao((t) => t.profissionais.garantirPerfilDoGestor(ctxDoProfissional(a)))).rejects.toBeInstanceOf(
      NaoEncontrado,
    );
    // Contexto forjado com o usuário gestor de B e o salão de A: o filtro por salão impede.
    const forjado = ctxDoGestor({ ...b, salaoId: a.salaoId });
    await expect(emTransacao((t) => t.profissionais.garantirPerfilDoGestor(forjado))).rejects.toBeInstanceOf(NaoEncontrado);
    const depoisB = await c.query('SELECT count(*)::int AS n FROM profissional WHERE salao_id = $1', [b.salaoId]);
    expect(depoisB.rows).toEqual(antesB.rows);
  });
});

describe('listarBloqueantesDeDesativacao (CA-3, CA-15)', () => {
  it('só confirmadas com fim > agora, por início; cliente anonimizada nula; serviços na ordem; isolada por salão', async () => {
    const s = await criarSalaoCompleto();
    const p = await repos().profissionais.criar(ctxDoGestor(s), { nome: 'Eva', email: null });
    const agora = new Date('2031-05-10T12:00:00.000Z');
    const em = (min: number) => new Date(agora.getTime() + min * MIN_MS);
    const [serv1, serv2] = s.servicos.ativos;
    const base = { salaoId: s.salaoId, profissionalId: p.id, clienteId: s.clientes.ativaId, servicoIds: [serv1] };
    const passada = await inserirReservaComItens(c, { ...base, inicio: em(-61), fim: em(-1) });
    const terminaAgora = await inserirReservaComItens(c, { ...base, inicio: em(-1), fim: em(0) });
    const emAndamento = await inserirReservaComItens(c, { ...base, inicio: em(0), fim: em(1), servicoIds: [serv2, serv1] });
    const futuraAnon = await inserirReservaComItens(c, {
      ...base,
      clienteId: s.clientes.anonimizadaId,
      inicio: em(120),
      fim: em(150),
    });
    const futura = await inserirReservaComItens(c, { ...base, inicio: em(60), fim: em(90) });
    await inserirReservaComItens(c, { ...base, inicio: em(200), fim: em(230), status: 'cancelado' });
    await inserirReservaComItens(c, { ...base, inicio: em(300), fim: em(330), status: 'concluido' });
    await inserirReservaComItens(c, { ...base, inicio: em(400), fim: em(430), status: 'nao_compareceu' });

    const r = await repos().reservas.listarBloqueantesDeDesativacao(ctxDoGestor(s), p.id, agora);
    expect(r.map((x) => x.id)).toEqual([emAndamento, futura, futuraAnon]);
    expect(r.map((x) => x.id)).not.toContain(passada);
    expect(r.map((x) => x.id)).not.toContain(terminaAgora);
    expect(r[0]).toEqual({
      id: emAndamento,
      inicio: em(0),
      fim: em(1),
      clienteNome: s.clientes.nomeAtiva,
      servicos: [s.servicos.nomes[1], s.servicos.nomes[0]],
    });
    expect(r[2].clienteNome).toBeNull();
    expect(JSON.stringify(r)).not.toContain(s.clientes.telefoneAtiva);
    // Outro salão com o id deste profissional: nada (o filtro é pelo salão do contexto).
    expect(await repos().reservas.listarBloqueantesDeDesativacao(ctxDoGestor(b), p.id, agora)).toEqual([]);
  });
});
