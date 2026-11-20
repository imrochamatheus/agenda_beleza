import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { formatarDuracao, formatarMoeda } from '@/lib/format';
import { criarServico, editarServico } from '@/server/servicos/servicos.acao';
import { listarParaPainel } from '@/server/servicos/servico';
import { MENSAGENS_SERVICO } from '@/server/servicos/tipos';
import type { Credencial } from '@/server/tenant/sessao';

import { credencialDoGestor } from '../../support/auth';
import { criarDoisSaloes, criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

import {
  contarServicos,
  ctxDoGestor,
  fotografiaReservas,
  fotografiaServico,
  linhaServico,
  servicosPorNome,
  vinculosDe,
  vinculosDoSalao,
} from './apoio';

// D-014 T-3: criar e editar pelas ações (defineAcao), com sessão real no PostgreSQL. CA-1, CA-2,
// CA-5, CA-12 e CA-13.

const M = MENSAGENS_SERVICO;

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
beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('criar', () => {
  it('CA-1: "Corte" a "80,00" com 45 min → salvo, ativo, no salão A; a lista de A mostra, a de B não', async () => {
    const r = await criarServico.executar(gestorA, { nome: 'Corte', preco: '80,00', duracao: '45', profissionais: [] });
    expect(r.ok).toBe(true);
    if (!r.ok || r.dados.resultado !== 'salvo') throw new Error('esperava salvo');
    const { servico } = r.dados;
    expect(servico).toMatchObject({ nome: 'Corte', precoCentavos: 8000, duracaoMin: 45, ativo: true, profissionaisAtivos: 0, ofertavel: false });
    expect(await linhaServico(c, servico.id)).toMatchObject({ salao_id: a.salaoId, preco_centavos: 8000, duracao_min: 45, ativo: true });

    const listaA = await listarParaPainel(ctxDoGestor(a));
    const linha = listaA.find((x) => x.id === servico.id)!;
    expect(linha.ativo).toBe(true);
    expect(formatarMoeda(linha.precoCentavos)).toBe('R$ 80,00');
    expect(formatarDuracao(linha.duracaoMin)).toBe('45 min');
    const listaB = await listarParaPainel(ctxDoGestor(b));
    expect(listaB.some((x) => x.id === servico.id)).toBe(false);
  });

  it('CA-12: criar com dois profissionais ativos cria o serviço e os dois vínculos juntos (ofertável)', async () => {
    const ps = [a.profissional.profissionalId, a.gestor.profissionalId!];
    const r = await criarServico.executar(gestorA, { nome: 'Escova longa', preco: '120', duracao: 60, profissionais: ps });
    if (!r.ok || r.dados.resultado !== 'salvo') throw new Error('esperava salvo');
    expect(r.dados.servico).toMatchObject({ profissionaisAtivos: 2, ofertavel: true, precoCentavos: 12000 });
    expect(await vinculosDe(c, r.dados.servico.id)).toEqual([...ps].sort());
  });

  it('CA-13: nome duplicado no salão é aceito, sem aviso, e a lista mostra os dois', async () => {
    const s = await criarSalaoCompleto();
    const g = await credencialDoGestor(s);
    for (let i = 0; i < 2; i++) {
      const r = await criarServico.executar(g, { nome: 'Corte', preco: '50', duracao: '30', profissionais: [] });
      expect(r).toMatchObject({ ok: true, dados: { resultado: 'salvo' } });
    }
    expect(await servicosPorNome(c, s.salaoId, 'Corte')).toHaveLength(2);
    expect((await listarParaPainel(ctxDoGestor(s))).filter((x) => x.nome === 'Corte')).toHaveLength(2);
  });

  it('CA-5: entradas inválidas → erro por campo em pt-BR, nada gravado', async () => {
    const base = { nome: 'Válido', preco: '80,00', duracao: '45', profissionais: [] as string[] };
    const casos: [Record<string, unknown>, Record<string, string>][] = [
      ...[0, -5, 7, 725, '45.5', ''].map((duracao): [Record<string, unknown>, Record<string, string>] => [{ duracao }, { duracao: M.duracao }]),
      ...['-1,00', 'abc', '80,001', '80.00', '100.000,00', ''].map((preco): [Record<string, unknown>, Record<string, string>] => [{ preco }, { preco: M.preco }]),
      ...['', '   ', 'A', 'a'.repeat(101)].map((nome): [Record<string, unknown>, Record<string, string>] => [{ nome }, { nome: M.nome }]),
    ];
    const antes = await contarServicos(c, a.salaoId);
    const vinculosAntes = await vinculosDoSalao(c, a.salaoId);
    for (const [mudanca, erros] of casos) {
      const r = await criarServico.executar(gestorA, { ...base, ...mudanca } as never);
      expect(r, JSON.stringify(mudanca)).toEqual({ ok: true, dados: { resultado: 'invalido', erros } });
    }
    expect(await contarServicos(c, a.salaoId)).toBe(antes);
    expect(await vinculosDoSalao(c, a.salaoId)).toEqual(vinculosAntes);
  });

  it('D-16: sem o campo profissionais, com campo extra ou entrada não objeto → erro de formulário', async () => {
    const antes = await contarServicos(c, a.salaoId);
    for (const e of [
      { nome: 'X1', preco: '1', duracao: '5' },
      { nome: 'X1', preco: '1', duracao: '5', profissionais: [], ativo: false },
      null,
      'texto',
    ]) {
      expect(await criarServico.executar(gestorA, e as never)).toEqual({
        ok: true,
        dados: { resultado: 'invalido', erros: { formulario: M.formulario } },
      });
    }
    expect(await contarServicos(c, a.salaoId)).toBe(antes);
  });
});

describe('editar', () => {
  it('CA-2: alterar preço e duração não muda os itens de reserva nem a reserva (snapshot)', async () => {
    const s = await criarSalaoCompleto({ servicos: { ativos: [{ precoCentavos: 8000 }] } });
    const g = await credencialDoGestor(s);
    const id = s.servicos.ativos[0];
    const antes = await fotografiaReservas(c, s.salaoId);
    const { rows: itensAntes } = await c.query('SELECT preco_centavos, duracao_min FROM reserva_item WHERE servico_id = $1', [id]);
    expect(itensAntes).toEqual([{ preco_centavos: 8000, duracao_min: 60 }]);

    const r = await editarServico.executar(g, {
      id,
      nome: 'Corte feminino',
      preco: '90,00',
      duracao: '30',
      profissionais: [s.profissional.profissionalId, s.gestor.profissionalId!],
    });
    expect(r).toMatchObject({ ok: true, dados: { resultado: 'salvo', servico: { precoCentavos: 9000, duracaoMin: 30 } } });
    expect(await linhaServico(c, id)).toMatchObject({ preco_centavos: 9000, duracao_min: 30 });
    const { rows: itensDepois } = await c.query('SELECT preco_centavos, duracao_min FROM reserva_item WHERE servico_id = $1', [id]);
    expect(itensDepois).toEqual([{ preco_centavos: 8000, duracao_min: 60 }]);
    expect(await fotografiaReservas(c, s.salaoId)).toEqual(antes);
  });

  it('edita nome, preço e duração de serviço inativo (spec §6) sem reativá-lo', async () => {
    const id = a.servicos.inativoId;
    const r = await editarServico.executar(gestorA, { id, nome: 'Coloração nova', preco: '200', duracao: '90', profissionais: [] });
    expect(r).toMatchObject({ ok: true, dados: { resultado: 'salvo', servico: { ativo: false, ofertavel: false } } });
    expect(await linhaServico(c, id)).toMatchObject({ nome: 'Coloração nova', preco_centavos: 20000, duracao_min: 90, ativo: false });
  });

  it('CA-5 (editar) e CA-12: preço inválido com vínculos válidos → nem o serviço nem os vínculos mudam', async () => {
    const id = a.servicos.ativos[1];
    const antes = await fotografiaServico(c, id);
    const r = await editarServico.executar(gestorA, { id, nome: 'Outro nome', preco: '-1,00', duracao: '30', profissionais: [] });
    expect(r).toEqual({ ok: true, dados: { resultado: 'invalido', erros: { preco: M.preco } } });
    const r2 = await editarServico.executar(gestorA, { id, nome: 'Outro nome', preco: '1', duracao: 7, profissionais: [] });
    expect(r2).toEqual({ ok: true, dados: { resultado: 'invalido', erros: { duracao: M.duracao } } });
    expect(await fotografiaServico(c, id)).toEqual(antes);
  });

  it('editar com entrada que não é objeto → erro de formulário', async () => {
    for (const e of [null, 'x', [a.servicos.ativos[0]]]) {
      expect(await editarServico.executar(gestorA, e as never)).toEqual({
        ok: true,
        dados: { resultado: 'invalido', erros: { formulario: M.formulario } },
      });
    }
  });
});
