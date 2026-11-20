import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { formatarMoeda, formatarMoedaSemSimbolo } from '@/lib/format';
import { listarServicosPublicos } from '@/server/repos/publico';
import { criarServico, desativarServico, editarServico, reativarServico } from '@/server/servicos/servicos.acao';
import { MENSAGENS_SERVICO } from '@/server/servicos/tipos';
import { converterPrecoParaCentavos } from '@/server/servicos/validacao';
import type { Credencial } from '@/server/tenant/sessao';

import { credencialDoGestor, credencialDoProfissional } from '../../support/auth';
import { criarDoisSaloes } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

import {
  contarServicos,
  ctxPublico,
  fotografiaServico,
  inserirProfissional,
  inserirServico,
  linhaServico,
  vincular,
  vinculosDe,
  vinculosDoSalao,
} from './apoio';

// D-014 T-8 (tester): regressão independente. Preço por texto (CA-5), duração, vínculos com ids
// repetidos/maiúsculos, isolamento com serviço E profissional de B, 403 antes de 404 e leitura pública.

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

describe('tester: preço pela ação (CA-5)', () => {
  const aceitos: [string, number][] = [
    ['80', 8000],
    ['80,5', 8050],
    ['1.234,56', 123456],
    ['R$ 0,00', 0],
    ['R$ 80,00', 8000],
    ['R$80', 8000],
    ['  0,10  ', 10],
    ['99.999,99', 9999999],
    ['1234', 123400],
  ];
  for (const [preco, centavos] of aceitos) {
    it(`aceita ${JSON.stringify(preco)} → ${centavos}`, async () => {
      const r = await criarServico.executar(gestorA, { nome: 'Preço ok', preco, duracao: '30', profissionais: [] });
      if (!r.ok || r.dados.resultado !== 'salvo') throw new Error(`esperava salvo: ${JSON.stringify(r)}`);
      expect((await linhaServico(c, r.dados.servico.id))?.preco_centavos).toBe(centavos);
    });
  }

  const recusados: unknown[] = [
    '80.00', '80,001', '-1,00', '100.000,00', 'abc', '', '   ', '12.34', '1.23,00', '1.2345', 'R$ -1', '80,', ',50',
    '1e3', '0x10', '８０', 80, null, undefined, ['80'],
  ];
  it('recusa os formatos inválidos com o erro de preço e não grava nada', async () => {
    const antes = await contarServicos(c, a.salaoId);
    for (const preco of recusados) {
      const r = await criarServico.executar(gestorA, { nome: 'Preço ruim', preco, duracao: '30', profissionais: [] });
      expect(r, JSON.stringify(preco)).toEqual({ ok: true, dados: { resultado: 'invalido', erros: { preco: M.preco } } });
    }
    expect(await contarServicos(c, a.salaoId)).toBe(antes);
  });

  it('ida e volta com formatarMoeda/formatarMoedaSemSimbolo para valores-limite', () => {
    for (const v of [0, 1, 10, 99, 100, 999, 1000, 8050, 99999, 100000, 123456, 1000000, 9999999]) {
      expect(converterPrecoParaCentavos(formatarMoeda(v))).toBe(v);
      expect(converterPrecoParaCentavos(formatarMoedaSemSimbolo(v))).toBe(v);
    }
    expect(converterPrecoParaCentavos(formatarMoeda(10000000))).toBeNull();
  });
});

describe('tester: duração pela ação', () => {
  it('aceita 5 e 720; recusa 0, -5, 7, 725, "45.5", vazio, "1e2", 45.5 e "abc"', async () => {
    for (const duracao of ['5', 720]) {
      const r = await criarServico.executar(gestorA, { nome: 'Dur ok', preco: '10', duracao, profissionais: [] });
      expect(r.ok && r.dados.resultado).toBe('salvo');
    }
    for (const duracao of ['0', -5, '7', '725', '45.5', '', '1e2', 45.5, 'abc', '-5', null]) {
      const r = await criarServico.executar(gestorA, { nome: 'Dur ruim', preco: '10', duracao, profissionais: [] });
      expect(r, JSON.stringify(duracao)).toEqual({ ok: true, dados: { resultado: 'invalido', erros: { duracao: M.duracao } } });
    }
  });
});

describe('tester: vínculos', () => {
  it('ids repetidos e em maiúsculas são deduplicados, sem erro e sem violação de PK', async () => {
    const p = a.profissional.profissionalId;
    const r = await criarServico.executar(gestorA, {
      nome: 'Dedup',
      preco: '10',
      duracao: '30',
      profissionais: [p, p.toUpperCase(), p],
    });
    if (!r.ok || r.dados.resultado !== 'salvo') throw new Error(`esperava salvo: ${JSON.stringify(r)}`);
    expect(await vinculosDe(c, r.dados.servico.id)).toEqual([p]);
  });

  it('o perfil profissional do gestor pode ser vinculado e o serviço fica ofertável', async () => {
    const r = await criarServico.executar(gestorA, {
      nome: 'Gestor atende',
      preco: '10',
      duracao: '30',
      profissionais: [a.gestor.profissionalId!],
    });
    if (!r.ok || r.dados.resultado !== 'salvo') throw new Error('esperava salvo');
    expect(r.dados.servico.ofertavel).toBe(true);
    const publicos = await listarServicosPublicos(ctxPublico(a));
    expect(publicos.map((s) => s.id)).toContain(r.dados.servico.id);
  });

  it('serviço inativo pode ser editado e ter vínculos alterados, sem voltar à leitura pública', async () => {
    const s = await inserirServico(c, a.salaoId, { nome: 'Inativo editável', ativo: false });
    const r = await editarServico.executar(gestorA, {
      id: s,
      nome: 'Inativo editado',
      preco: '15,00',
      duracao: '40',
      profissionais: [a.profissional.profissionalId],
    });
    expect(r.ok && r.dados.resultado).toBe('salvo');
    expect(await linhaServico(c, s)).toMatchObject({ nome: 'Inativo editado', preco_centavos: 1500, duracao_min: 40, ativo: false });
    expect((await listarServicosPublicos(ctxPublico(a))).some((x) => x.id === s)).toBe(false);
  });

  it('caixas desmarcadas: [] remove só os ativos e preserva o vínculo com inativo (CA-7)', async () => {
    const s = await inserirServico(c, a.salaoId, { nome: 'Misto' });
    const inativo = await inserirProfissional(c, a.salaoId, 'Inativa X', false);
    await vincular(c, a.salaoId, s, a.profissional.profissionalId);
    await vincular(c, a.salaoId, s, inativo);
    const r = await editarServico.executar(gestorA, { id: s, nome: 'Misto', preco: '50', duracao: '30', profissionais: [] });
    expect(r.ok && r.dados.resultado).toBe('salvo');
    expect(await vinculosDe(c, s)).toEqual([inativo]);
  });
});

describe('tester: isolamento e permissões', () => {
  it('editar serviço de B com profissional de B: nada muda em B, resposta não distingue', async () => {
    const sB = b.servicos.ativos[0];
    const antes = { s: await fotografiaServico(c, sB), v: await vinculosDoSalao(c, b.salaoId) };
    const r1 = await editarServico.executar(gestorA, {
      id: sB,
      nome: 'Invasão',
      preco: '1',
      duracao: '5',
      profissionais: [b.profissional.profissionalId],
    });
    expect(r1.ok && r1.dados).toEqual({ resultado: 'invalido', erros: { profissionais: M.profissionais } });
    const r2 = await editarServico.executar(gestorA, { id: sB, nome: 'Invasão', preco: '1', duracao: '5', profissionais: [] });
    expect(r2).toEqual({ ok: false, erro: 'nao_encontrado', status: 404 });
    for (const acao of [desativarServico, reativarServico]) {
      expect(await acao.executar(gestorA, { id: sB })).toEqual({ ok: false, erro: 'nao_encontrado', status: 404 });
    }
    expect({ s: await fotografiaServico(c, sB), v: await vinculosDoSalao(c, b.salaoId) }).toEqual(antes);
  });

  it('profissional recebe 403 (não 404) com id de B, inexistente e de A', async () => {
    const prof = await credencialDoProfissional(a);
    const sA = await inserirServico(c, a.salaoId, { nome: 'Alvo' });
    const sB = await inserirServico(c, b.salaoId, { nome: 'Alvo B' });
    for (const id of [sA, sB, '00000000-0000-4000-8000-000000000000', 'abc']) {
      expect(await desativarServico.executar(prof, { id })).toEqual({ ok: false, erro: 'acesso_negado', status: 403 });
      expect(
        await editarServico.executar(prof, { id, nome: 'X x', preco: '1', duracao: '5', profissionais: [] }),
      ).toEqual({ ok: false, erro: 'acesso_negado', status: 403 });
    }
    expect((await linhaServico(c, sA))?.ativo).toBe(true);
  });
});
