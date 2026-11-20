import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { criarServico, editarServico } from '@/server/servicos/servicos.acao';
import { obterParaEdicao } from '@/server/servicos/servico';
import { MENSAGENS_SERVICO } from '@/server/servicos/tipos';
import type { Credencial } from '@/server/tenant/sessao';

import { credencialDoGestor } from '../../support/auth';
import { criarDoisSaloes, criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

import {
  UUID_INEXISTENTE,
  contarServicos,
  ctxDoGestor,
  fotografiaReservas,
  fotografiaServico,
  inserirProfissional,
  inserirServico,
  vincular,
  vinculosDe,
  vinculosDoSalao,
} from './apoio';

// D-014 T-3: vínculos serviço × profissional pelas ações. CA-4 (RN-4), CA-6, CA-7 (RN-10, D-5) e
// CA-12 (RN-13: recusa de profissional não grava nada).

const M = MENSAGENS_SERVICO;
const RECUSA = { ok: true, dados: { resultado: 'invalido', erros: { profissionais: M.profissionais } } };

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

describe('CA-4: profissional de outro salão, inexistente ou malformado', () => {
  it('CA-4: criar com esses ids → mesma mensagem de campo; nada gravado em A nem em B', async () => {
    const antes = {
      servicosA: await contarServicos(c, a.salaoId),
      vA: await vinculosDoSalao(c, a.salaoId),
      vB: await vinculosDoSalao(c, b.salaoId),
    };
    for (const intruso of [b.profissional.profissionalId, UUID_INEXISTENTE]) {
      const r = await criarServico.executar(gestorA, {
        nome: 'Invasão',
        preco: '10',
        duracao: '30',
        profissionais: [a.profissional.profissionalId, intruso],
      });
      expect(r, intruso).toEqual(RECUSA);
    }
    // 'abc' é recusado já na validação pura, com a mesma mensagem.
    expect(
      await criarServico.executar(gestorA, { nome: 'Invasão', preco: '10', duracao: '30', profissionais: ['abc'] }),
    ).toEqual(RECUSA);
    expect({
      servicosA: await contarServicos(c, a.salaoId),
      vA: await vinculosDoSalao(c, a.salaoId),
      vB: await vinculosDoSalao(c, b.salaoId),
    }).toEqual(antes);
  });

  it('CA-4/CA-12: editar com esses ids → mesma mensagem; nome, preço, duração e vínculos do serviço não mudam', async () => {
    const id = a.servicos.ativos[0];
    const antes = await fotografiaServico(c, id);
    const vB = await vinculosDoSalao(c, b.salaoId);
    for (const intruso of [b.profissional.profissionalId, UUID_INEXISTENTE, 'abc']) {
      const r = await editarServico.executar(gestorA, { id, nome: 'Novo nome', preco: '1,00', duracao: '5', profissionais: [intruso] });
      expect(r, intruso).toEqual(RECUSA);
    }
    expect(await fotografiaServico(c, id)).toEqual(antes);
    expect(await vinculosDoSalao(c, b.salaoId)).toEqual(vB);
  });
});

describe('CA-6: vincular e desvincular', () => {
  it('CA-6: marcar persiste o vínculo e a edição o mostra; desmarcar remove e as reservas ficam iguais', async () => {
    const s = await criarSalaoCompleto();
    const g = await credencialDoGestor(s);
    const novo = await inserirProfissional(c, s.salaoId, 'Nova profissional');
    const id = s.servicos.ativos[0];
    const atuais = [s.profissional.profissionalId, s.gestor.profissionalId!];
    const reservas = await fotografiaReservas(c, s.salaoId);
    const base = { id, nome: 'Corte feminino', preco: '90,00', duracao: '60' };

    expect(await editarServico.executar(g, { ...base, profissionais: [...atuais, novo] })).toMatchObject({
      ok: true,
      dados: { resultado: 'salvo', servico: { profissionaisAtivos: 3 } },
    });
    const { rows } = await c.query('SELECT salao_id::text AS s FROM servico_profissional WHERE servico_id = $1 AND profissional_id = $2', [
      id,
      novo,
    ]);
    expect(rows).toEqual([{ s: s.salaoId }]);
    const edicao = await obterParaEdicao(ctxDoGestor(s), id);
    expect(edicao.profissionais.find((p) => p.id === novo)).toEqual({ id: novo, nome: 'Nova profissional', ativo: true, vinculado: true });

    // Desmarca o profissional que tem a reserva da fábrica com este serviço.
    expect(await editarServico.executar(g, { ...base, profissionais: [s.gestor.profissionalId!, novo] })).toMatchObject({
      ok: true,
      dados: { resultado: 'salvo', servico: { profissionaisAtivos: 2 } },
    });
    expect(await vinculosDe(c, id)).not.toContain(s.profissional.profissionalId);
    expect(await fotografiaReservas(c, s.salaoId)).toEqual(reservas);
    const depois = await obterParaEdicao(ctxDoGestor(s), id);
    expect(depois.profissionais.find((p) => p.id === s.profissional.profissionalId)!.vinculado).toBe(false);
  });

  it('ids repetidos ou em maiúsculas são normalizados, sem erro', async () => {
    const s = await criarSalaoCompleto();
    const g = await credencialDoGestor(s);
    const p = s.profissional.profissionalId;
    const r = await criarServico.executar(g, { nome: 'Dup', preco: '1', duracao: '5', profissionais: [p, p.toUpperCase(), p] });
    if (!r.ok || r.dados.resultado !== 'salvo') throw new Error('esperava salvo');
    expect(await vinculosDe(c, r.dados.servico.id)).toEqual([p]);
  });
});

describe('CA-7: vínculos com profissional inativo', () => {
  it('CA-7: salvar com conjunto vazio remove P1 (ativo) e preserva P2 (inativo); vincular P2 é recusado', async () => {
    const s = await criarSalaoCompleto();
    const g = await credencialDoGestor(s);
    const p1 = s.profissional.profissionalId;
    const p2 = s.profissionalInativoId;
    const id = await inserirServico(c, s.salaoId, { nome: 'Hidratação' });
    await vincular(c, s.salaoId, id, p1);
    await vincular(c, s.salaoId, id, p2);
    const base = { id, nome: 'Hidratação', preco: '50,00', duracao: '30' };

    expect(await editarServico.executar(g, { ...base, profissionais: [] })).toMatchObject({
      ok: true,
      dados: { resultado: 'salvo', servico: { profissionaisAtivos: 0, ofertavel: false } },
    });
    expect(await vinculosDe(c, id)).toEqual([p2]);

    const edicao = await obterParaEdicao(ctxDoGestor(s), id);
    expect(edicao.profissionais.find((p) => p.id === p2)).toMatchObject({ ativo: false, vinculado: true });

    const antes = await fotografiaServico(c, id);
    expect(await editarServico.executar(g, { ...base, nome: 'Outro', profissionais: [p2] })).toEqual(RECUSA);
    expect(await criarServico.executar(g, { nome: 'Novo', preco: '1', duracao: '5', profissionais: [p2] })).toEqual(RECUSA);
    expect(await fotografiaServico(c, id)).toEqual(antes);
  });
});
