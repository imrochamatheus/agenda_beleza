import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { repos } from '@/server/repos';
import { criarProfissional, editarProfissional } from '@/server/profissionais/profissionais.acao';
import { MENSAGENS_PROFISSIONAL } from '@/server/profissionais/tipos';
import type { Credencial } from '@/server/tenant/sessao';

import { credencialDoGestor } from '../../support/auth';
import { criarDoisSaloes } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

import { ctxDoGestor, linhaProfissional } from './apoio';

// D-013 T-3: criar e editar pelas ações (defineAcao + serviço), com sessões reais e dois salões.
// CA-1, CA-12 e CA-13.

const M = MENSAGENS_PROFISSIONAL;

let c: pg.Client;
let a: SalaoCompleto;
let b: SalaoCompleto;
let gestorA: Credencial;

beforeAll(async () => {
  c = await conectar();
  ({ a, b } = await criarDoisSaloes());
  gestorA = await credencialDoGestor(a);
});
afterAll(async () => {
  await c.end();
});

async function contagem(salaoId: string): Promise<number> {
  const { rows } = await c.query<{ n: number }>('SELECT count(*)::int AS n FROM profissional WHERE salao_id = $1', [salaoId]);
  return rows[0].n;
}

describe('CA-1: criar', () => {
  it('CA-1: "Ana" sem e-mail → sucesso, ativa na lista de A, linha com salão A e sem usuário; fora da lista de B', async () => {
    const r = await criarProfissional.executar(gestorA, { nome: 'Ana' });
    expect(r.ok).toBe(true);
    if (!r.ok || r.dados.resultado !== 'salvo') throw new Error('esperava salvo');
    const { profissional } = r.dados;
    expect(profissional).toEqual({
      id: expect.any(String),
      nome: 'Ana',
      email: null,
      ativo: true,
      acesso: 'sem_acesso',
      emailLogin: null,
      emailBloqueado: false,
    });
    expect(await linhaProfissional(c, profissional.id)).toMatchObject({
      salao_id: a.salaoId,
      ativo: true,
      usuario_id: null,
      email: null,
    });
    const listaA = await repos().profissionais.listar(ctxDoGestor(a));
    expect(listaA.find((p) => p.id === profissional.id)).toMatchObject({ nome: 'Ana', ativo: true });
    const listaB = await repos().profissionais.listar(ctxDoGestor(b));
    expect(listaB.some((p) => p.id === profissional.id)).toBe(false);
  });

  it('CA-12: e-mail "  ANA@Exemplo.COM " é gravado normalizado; e-mail vazio vira NULL', async () => {
    const r1 = await criarProfissional.executar(gestorA, { nome: 'Ana Souza', email: '  ANA@Exemplo.COM ' });
    const r2 = await criarProfissional.executar(gestorA, { nome: 'Bia', email: '   ' });
    if (!r1.ok || r1.dados.resultado !== 'salvo' || !r2.ok || r2.dados.resultado !== 'salvo') throw new Error('esperava salvo');
    expect((await linhaProfissional(c, r1.dados.profissional.id))!.email).toBe('ana@exemplo.com');
    expect((await linhaProfissional(c, r2.dados.profissional.id))!.email).toBeNull();
  });

  it('CA-12: entradas inválidas → erros por campo em pt-BR e nada gravado', async () => {
    const antes = await contagem(a.salaoId);
    const casos: [unknown, Record<string, string>][] = [
      [{ nome: '' }, { nome: M.nome }],
      [{ nome: '    ' }, { nome: M.nome }],
      [{ nome: 'A' }, { nome: M.nome }],
      [{ nome: 'a'.repeat(101) }, { nome: M.nome }],
      [{ nome: 'Ana', email: 'ana@' }, { email: M.email }],
      [{ nome: 'Ana', email: `${'a'.repeat(243)}@exemplo.com` }, { email: M.email }],
      [{ nome: 'Ana', usuarioId: a.gestor.usuarioId }, { formulario: M.formulario }],
      [{ nome: 'Ana', salaoId: b.salaoId }, { formulario: M.formulario }],
    ];
    for (const [entrada, erros] of casos) {
      expect(await criarProfissional.executar(gestorA, entrada as never), JSON.stringify(entrada)).toEqual({
        ok: true,
        dados: { resultado: 'invalido', erros },
      });
    }
    expect(await contagem(a.salaoId)).toBe(antes);
  });
});

describe('CA-12/CA-13: editar', () => {
  it('edita nome e e-mail de um profissional sem usuário; e-mail vazio limpa', async () => {
    const r = await criarProfissional.executar(gestorA, { nome: 'Cora', email: 'cora@exemplo.com' });
    if (!r.ok || r.dados.resultado !== 'salvo') throw new Error('esperava salvo');
    const id = r.dados.profissional.id;
    const e1 = await editarProfissional.executar(gestorA, { id, nome: ' Cora   Lima ', email: 'CORA.LIMA@Exemplo.com' });
    expect(e1).toMatchObject({ ok: true, dados: { resultado: 'salvo', profissional: { id, nome: 'Cora Lima', email: 'cora.lima@exemplo.com' } } });
    expect(await linhaProfissional(c, id)).toMatchObject({ nome: 'Cora Lima', email: 'cora.lima@exemplo.com' });
    await editarProfissional.executar(gestorA, { id, nome: 'Cora Lima', email: '' });
    expect((await linhaProfissional(c, id))!.email).toBeNull();
  });

  it('CA-12: editar com entrada inválida não grava nada', async () => {
    const antes = await linhaProfissional(c, a.profissionalInativoId);
    for (const [entrada, erros] of [
      [{ id: a.profissionalInativoId, nome: 'X' }, { nome: M.nome }],
      [{ id: a.profissionalInativoId, nome: 'Xavier', email: 'x@' }, { email: M.email }],
      [{ id: a.profissionalInativoId, nome: 'Xavier', ativo: true }, { formulario: M.formulario }],
      ['texto', { formulario: M.formulario }],
    ] as const) {
      expect(await editarProfissional.executar(gestorA, entrada as never)).toEqual({ ok: true, dados: { resultado: 'invalido', erros } });
    }
    expect(await linhaProfissional(c, a.profissionalInativoId)).toEqual(antes);
  });

  it('CA-13: com usuário vinculado, trocar o e-mail é recusado (perfil e usuário intactos); só o nome é aceito', async () => {
    const id = a.profissional.profissionalId;
    const antes = await linhaProfissional(c, id);
    const usuarioAntes = await c.query('SELECT email, atualizado_em FROM usuario WHERE id = $1', [a.profissional.usuarioId]);
    for (const email of ['outra@exemplo.com', '']) {
      expect(await editarProfissional.executar(gestorA, { id, nome: 'Nome Novo', email })).toEqual({
        ok: true,
        dados: { resultado: 'invalido', erros: { email: M.emailBloqueado } },
      });
    }
    expect(await linhaProfissional(c, id)).toEqual(antes);

    // Mesmo e-mail (com outra caixa e espaços) ou campo ausente: aceito, e o e-mail não muda.
    const r1 = await editarProfissional.executar(gestorA, { id, nome: 'Nome Novo', email: ` ${a.profissional.email.toUpperCase()} ` });
    expect(r1).toMatchObject({
      ok: true,
      dados: {
        resultado: 'salvo',
        profissional: { nome: 'Nome Novo', email: a.profissional.email, acesso: 'com_acesso', emailLogin: a.profissional.email, emailBloqueado: true },
      },
    });
    await editarProfissional.executar(gestorA, { id, nome: 'Nome Mais Novo' });
    expect(await linhaProfissional(c, id)).toMatchObject({ nome: 'Nome Mais Novo', email: a.profissional.email });
    const usuarioDepois = await c.query('SELECT email, atualizado_em FROM usuario WHERE id = $1', [a.profissional.usuarioId]);
    expect(usuarioDepois.rows).toEqual(usuarioAntes.rows);
  });

  it('CA-13: perfil do gestor (acesso "Você"): e-mail bloqueado; renomear não muda usuario.nome', async () => {
    const id = a.gestor.profissionalId!;
    const r = await editarProfissional.executar(gestorA, { id, nome: 'Gestora que atende', email: a.gestor.email });
    expect(r).toMatchObject({ ok: true, dados: { resultado: 'salvo', profissional: { acesso: 'voce', emailBloqueado: true } } });
    const { rows } = await c.query('SELECT nome FROM usuario WHERE id = $1', [a.gestor.usuarioId]);
    expect(rows[0].nome).toBe(a.gestor.nome);
  });
});
