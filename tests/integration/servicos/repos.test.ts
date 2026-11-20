import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { repos } from '@/server/repos';
import { emTransacao } from '@/server/repos/transacao';
import { NaoEncontrado } from '@/server/tenant/erros';

import { criarDoisSaloes, criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

import {
  UUID_INEXISTENTE,
  ctxDoGestor,
  fotografiaServico,
  inserirProfissional,
  inserirServico,
  linhaServico,
  vincular,
  vinculosDe,
  vinculosDoSalao,
} from './apoio';

// D-014 T-2: repositório de serviços e vínculos contra PostgreSQL real, com dois salões (G-4).
// CA-1, CA-4, CA-6, CA-7, CA-9 e CA-10 na camada de dados.

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

const DADOS = { nome: 'Corte', precoCentavos: 8000, duracaoMin: 45 };

describe('criar, listar e buscar', () => {
  it('CA-1: criar grava no salão do contexto, ativo, com preço e duração', async () => {
    const s = await repos().servicos.criar(ctxDoGestor(a), DADOS);
    expect(s).toMatchObject({ ...DADOS, ativo: true });
    expect(await linhaServico(c, s.id)).toMatchObject({
      salao_id: a.salaoId,
      nome: 'Corte',
      preco_centavos: 8000,
      duracao_min: 45,
      ativo: true,
    });
    expect(await vinculosDe(c, s.id)).toEqual([]);
  });

  it('CA-10/D-10: listarParaPainel só traz o salão, ativos primeiro, por nome, e conta só profissionais ativos', async () => {
    const s = await criarSalaoCompleto();
    const ctx = ctxDoGestor(s);
    const zeta = await inserirServico(c, s.salaoId, { nome: 'Zeta' });
    const alfaInativo = await inserirServico(c, s.salaoId, { nome: 'Alfa', ativo: false });
    const soInativo = await inserirServico(c, s.salaoId, { nome: 'Beta' });
    await vincular(c, s.salaoId, soInativo, s.profissionalInativoId);
    await vincular(c, s.salaoId, zeta, s.profissional.profissionalId);

    const lista = await repos().servicos.listarParaPainel(ctx);
    expect(lista.map((x) => [x.nome, x.ativo, x.profissionaisAtivos])).toEqual([
      ['Beta', true, 0],
      ['Corte feminino', true, 2],
      ['Escova', true, 2],
      ['Zeta', true, 1],
      ['Alfa', false, 0],
      ['Coloração (descontinuada)', false, 0],
    ]);
    expect(lista.some((x) => x.id === alfaInativo)).toBe(true);
    const idsDeB = [...b.servicos.ativos, b.servicos.inativoId];
    expect(lista.some((x) => idsDeB.includes(x.id))).toBe(false);
    // Profissional de B vinculado não é possível (FK composta), então a contagem é sempre do salão.
    const unico = await repos().servicos.buscarParaPainel(ctx, zeta);
    expect(unico).toMatchObject({ id: zeta, nome: 'Zeta', profissionaisAtivos: 1, ativo: true });
  });

  it('CA-9: buscarParaPainel, travarParaAlteracao, atualizarDados e definirAtivo com id de B ou inexistente → NaoEncontrado; B intacto', async () => {
    const r = repos().servicos;
    const ctx = ctxDoGestor(a);
    const alvo = b.servicos.ativos[0];
    const antes = await fotografiaServico(c, alvo);
    for (const id of [alvo, UUID_INEXISTENTE]) {
      await expect(r.buscarParaPainel(ctx, id)).rejects.toBeInstanceOf(NaoEncontrado);
      await expect(r.atualizarDados(ctx, id, DADOS)).rejects.toBeInstanceOf(NaoEncontrado);
      await expect(r.definirAtivo(ctx, id, false)).rejects.toBeInstanceOf(NaoEncontrado);
      await expect(emTransacao((t) => t.servicos.travarParaAlteracao(ctx, id))).rejects.toBeInstanceOf(NaoEncontrado);
    }
    expect(await fotografiaServico(c, alvo)).toEqual(antes);
  });

  it('atualizarDados e definirAtivo gravam e devolvem o DTO; a trava devolve o estado', async () => {
    const id = await inserirServico(c, a.salaoId, { nome: 'Manicure' });
    const r = repos().servicos;
    const ctx = ctxDoGestor(a);
    expect(await r.atualizarDados(ctx, id, { nome: 'Manicure completa', precoCentavos: 4500, duracaoMin: 50 })).toMatchObject({
      id,
      nome: 'Manicure completa',
      precoCentavos: 4500,
      duracaoMin: 50,
      ativo: true,
    });
    expect((await r.definirAtivo(ctx, id, false)).ativo).toBe(false);
    expect(await emTransacao((t) => t.servicos.travarParaAlteracao(ctx, id))).toEqual({ id, ativo: false });
    expect((await r.definirAtivo(ctx, id, true)).ativo).toBe(true);
    expect((await linhaServico(c, id))!.ativo).toBe(true);
  });
});

describe('vínculos', () => {
  it('CA-6/CA-7/D-5: listarProfissionaisParaVinculo traz ativos (marcados ou não) e inativos VINCULADOS; nada de B', async () => {
    const s = await criarSalaoCompleto({ gestor: { nome: 'Marta' }, profissional: { nome: 'Carla' } });
    const outroInativo = await inserirProfissional(c, s.salaoId, 'Zilda', false);
    const novo = await inserirProfissional(c, s.salaoId, 'Abel');
    const servico = await inserirServico(c, s.salaoId, { nome: 'Pé' });
    await vincular(c, s.salaoId, servico, s.profissional.profissionalId);
    await vincular(c, s.salaoId, servico, s.profissionalInativoId);

    const lista = await repos().servicos.listarProfissionaisParaVinculo(ctxDoGestor(s), servico);
    expect(lista).toEqual([
      { id: novo, nome: 'Abel', ativo: true, vinculado: false },
      { id: s.profissional.profissionalId, nome: 'Carla', ativo: true, vinculado: true },
      { id: s.gestor.profissionalId, nome: 'Marta', ativo: true, vinculado: false },
      { id: s.profissionalInativoId, nome: expect.any(String), ativo: false, vinculado: true },
    ]);
    expect(lista.some((p) => p.id === outroInativo)).toBe(false);
    expect(lista.some((p) => p.id === b.profissional.profissionalId)).toBe(false);
  });

  it('CA-4: travarProfissionaisParaVinculo devolve só ativos do salão; B, inexistente, inativo e malformado ficam de fora', async () => {
    const ids = [
      a.profissional.profissionalId,
      a.gestor.profissionalId!,
      a.profissionalInativoId,
      b.profissional.profissionalId,
      UUID_INEXISTENTE,
      'abc',
    ];
    const achados = await emTransacao((t) => t.servicos.travarProfissionaisParaVinculo(ctxDoGestor(a), ids));
    expect(achados.sort()).toEqual([a.profissional.profissionalId, a.gestor.profissionalId!].sort());
  });

  it('substituirVinculosAtivos: adiciona, remove só ativos, preserva o inativo; [] remove todos os ativos', async () => {
    const s = await criarSalaoCompleto();
    const ctx = ctxDoGestor(s);
    const servico = await inserirServico(c, s.salaoId, { nome: 'Sobrancelha' });
    const p1 = s.profissional.profissionalId;
    const p2 = s.gestor.profissionalId!;
    const inativo = s.profissionalInativoId;
    await vincular(c, s.salaoId, servico, p1);
    await vincular(c, s.salaoId, servico, inativo);

    const r1 = await emTransacao((t) => t.servicos.substituirVinculosAtivos(ctx, servico, [p2]));
    expect(r1).toEqual({ adicionados: 1, removidos: 1 });
    expect(await vinculosDe(c, servico)).toEqual([p2, inativo].sort());

    const r2 = await emTransacao((t) => t.servicos.substituirVinculosAtivos(ctx, servico, [p1, p2]));
    expect(r2).toEqual({ adicionados: 1, removidos: 0 });
    expect(await vinculosDe(c, servico)).toEqual([p1, p2, inativo].sort());

    const r3 = await emTransacao((t) => t.servicos.substituirVinculosAtivos(ctx, servico, []));
    expect(r3).toEqual({ adicionados: 0, removidos: 2 });
    expect(await vinculosDe(c, servico)).toEqual([inativo]);
  });

  it('CA-9: substituirVinculosAtivos com serviço de B não toca B (nenhuma linha casa o salão do contexto)', async () => {
    const antes = await vinculosDoSalao(c, b.salaoId);
    const r = await emTransacao((t) => t.servicos.substituirVinculosAtivos(ctxDoGestor(a), b.servicos.ativos[0], []));
    expect(r).toEqual({ adicionados: 0, removidos: 0 });
    expect(await vinculosDoSalao(c, b.salaoId)).toEqual(antes);
  });
});
