import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolverSalaoPorSlug } from '@/server/repos/publico';
import * as acoes from '@/server/salao/configuracoes.acao';
import { obter, trocarSlug } from '@/server/salao/configuracoes';
import { MENSAGENS_CONFIGURACOES as M } from '@/server/salao/tipos';

import { criarDoisSaloes, criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

import { atuaisDe, credGestor, ctxDoGestor, definirSlugAtual, donoDoSlug, inserirSlug, linhaSalao, slugsDe } from './apoio';

// D-017 T-5: troca de slug com histórico pela ação, contra PostgreSQL real e dois salões.
// CA-1, CA-2, CA-8 (amostra), CA-9 (painel, admin), CA-10, CA-11 e CA-15 (slug). Os slugs fixos dos CAs
// aparecem uma única vez neste arquivo (a base é recriada por arquivo).

let c: pg.Client;
let a: SalaoCompleto;
let b: SalaoCompleto;

beforeAll(async () => {
  c = await conectar();
  ({ a, b } = await criarDoisSaloes());
});
beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterAll(async () => {
  await c.end();
});

const recusado = (slug: string) => ({ ok: true, dados: { resultado: 'invalido', erros: { slug } } });

describe('CA-1 e CA-10: troca e volta ao histórico', () => {
  it('studio-bela → bela-studio: anterior vira histórico; resolverSalaoPorSlug redireciona ao atual; e volta (CA-10)', async () => {
    const s = await criarSalaoCompleto();
    await definirSlugAtual(c, s.salaoId, 'studio-bela');
    const cred = await credGestor(s);
    const salaoAntes = await linhaSalao(c, s.salaoId);

    expect(await acoes.trocarSlugDoSalao.executar(cred, { slug: 'bela-studio' })).toEqual({
      ok: true,
      dados: { resultado: 'trocado', slug: 'bela-studio' },
    });
    expect(await donoDoSlug(c, 'studio-bela')).toEqual({ salao_id: s.salaoId, atual: false });
    expect(await donoDoSlug(c, 'bela-studio')).toEqual({ salao_id: s.salaoId, atual: true });
    expect(await atuaisDe(c, s.salaoId)).toEqual(['bela-studio']);
    const r = await resolverSalaoPorSlug('studio-bela');
    expect(r).toMatchObject({ historico: true, slugAtual: 'bela-studio' });
    expect(r.contexto.salaoId).toBe(s.salaoId);
    // A linha de salao não muda com a troca de slug.
    expect(await linhaSalao(c, s.salaoId)).toEqual(salaoAntes);

    // CA-10: volta para studio-bela sem linha nova.
    const linhasAntes = await slugsDe(c, s.salaoId);
    expect(await acoes.trocarSlugDoSalao.executar(cred, { slug: 'studio-bela' })).toEqual({
      ok: true,
      dados: { resultado: 'trocado', slug: 'studio-bela' },
    });
    const linhasDepois = await slugsDe(c, s.salaoId);
    expect(linhasDepois).toHaveLength(linhasAntes.length);
    expect(linhasDepois.map((l) => l.criado_em)).toEqual(linhasAntes.map((l) => l.criado_em));
    expect(await donoDoSlug(c, 'studio-bela')).toEqual({ salao_id: s.salaoId, atual: true });
    expect(await donoDoSlug(c, 'bela-studio')).toEqual({ salao_id: s.salaoId, atual: false });
    expect(await atuaisDe(c, s.salaoId)).toEqual(['studio-bela']);
    // A página mostra os anteriores.
    expect((await obter(ctxDoGestor(s))).slug.anteriores).toEqual(expect.arrayContaining(['bela-studio', s.slugAtual, s.slugHistorico]));
  });
});

describe('CA-2: slug de outro salão', () => {
  it('atual e histórico de B são recusados com "em uso", sem dados de B; nada muda em A nem em B', async () => {
    await definirSlugAtual(c, b.salaoId, 'b-atual');
    await inserirSlug(c, b.salaoId, 'b-antigo', false);
    const aAntes = await slugsDe(c, a.salaoId);
    const bAntes = await slugsDe(c, b.salaoId);
    const cred = await credGestor(a);
    for (const slug of ['b-atual', 'b-antigo', ' B-Atual ']) {
      const r = await acoes.trocarSlugDoSalao.executar(cred, { slug });
      expect(r).toEqual(recusado(M.slugEmUso));
      expect(JSON.stringify(r)).not.toContain(b.salaoId);
      expect(JSON.stringify(r)).not.toContain('Bromélia');
    }
    expect(await slugsDe(c, a.salaoId)).toEqual(aAntes);
    expect(await slugsDe(c, b.salaoId)).toEqual(bAntes);
  });
});

describe('CA-8 e CA-9: formato e reservados', () => {
  it('"  Bela-Studio-2 " grava bela-studio-2; recusados não gravam nada', async () => {
    const s = await criarSalaoCompleto();
    const cred = await credGestor(s);
    const antes = await slugsDe(c, s.salaoId);
    for (const slug of ['bela studio', 'bela_studio', '-bela', 'bela--studio', 'estúdio', 'ab', 'a'.repeat(61), '', null, 42, 'x'.repeat(10_000)]) {
      expect(await acoes.trocarSlugDoSalao.executar(cred, { slug } as never), String(slug).slice(0, 20)).toEqual(recusado(M.slugFormato));
    }
    expect(await acoes.trocarSlugDoSalao.executar(cred, {} as never)).toEqual(recusado(M.slugFormato));
    expect(await acoes.trocarSlugDoSalao.executar(cred, null as never)).toEqual(recusado(M.slugFormato));
    expect(await slugsDe(c, s.salaoId)).toEqual(antes);
    expect(await acoes.trocarSlugDoSalao.executar(cred, { slug: '  Bela-Studio-2 ' })).toEqual({
      ok: true,
      dados: { resultado: 'trocado', slug: 'bela-studio-2' },
    });
    expect(await atuaisDe(c, s.salaoId)).toEqual(['bela-studio-2']);
  });

  it('painel e admin → reservado, sem sufixo e sem gravar; painel-2 é aceito', async () => {
    const s = await criarSalaoCompleto();
    const cred = await credGestor(s);
    const antes = await slugsDe(c, s.salaoId);
    for (const slug of ['painel', 'admin', ' Painel ']) {
      expect(await acoes.trocarSlugDoSalao.executar(cred, { slug })).toEqual(recusado(M.slugReservado));
    }
    expect(await slugsDe(c, s.salaoId)).toEqual(antes);
    expect(await donoDoSlug(c, 'painel')).toBeUndefined();
    expect(await acoes.trocarSlugDoSalao.executar(cred, { slug: 'painel-2' })).toMatchObject({ ok: true, dados: { resultado: 'trocado' } });
  });
});

describe('CA-11: igual ao atual', () => {
  it('atual curto "x" (ou " X ") → sem_efeito, salao_slug idêntico (mesmos criado_em)', async () => {
    const s = await criarSalaoCompleto({ slugAtual: 'x', slugHistorico: 'x-anterior' });
    const cred = await credGestor(s);
    const antes = await slugsDe(c, s.salaoId);
    for (const slug of ['x', ' X ']) {
      expect(await acoes.trocarSlugDoSalao.executar(cred, { slug })).toEqual({ ok: true, dados: { resultado: 'sem_efeito', slug: 'x' } });
    }
    expect(await slugsDe(c, s.salaoId)).toEqual(antes);
  });
});

describe('CA-15: isolamento na troca de slug', () => {
  it('salaoId de B forjado na entrada é ignorado: só A troca; B intacto', async () => {
    const t = await criarDoisSaloes();
    const bAntes = await slugsDe(c, t.b.salaoId);
    const r = await acoes.trocarSlugDoSalao.executar(await credGestor(t.a), { slug: `${t.a.slugAtual}-novo`, salaoId: t.b.salaoId } as never);
    expect(r).toMatchObject({ ok: true, dados: { resultado: 'trocado' } });
    expect(await atuaisDe(c, t.a.salaoId)).toEqual([`${t.a.slugAtual}-novo`]);
    expect(await slugsDe(c, t.b.salaoId)).toEqual(bAntes);
  });

  it('log salao.slug_trocado só com salaoId e resultado', async () => {
    const s = await criarSalaoCompleto();
    const espiao = vi.spyOn(console, 'info').mockImplementation(() => {});
    await trocarSlug(ctxDoGestor(s), { slug: `${s.slugAtual}-log` });
    await trocarSlug(ctxDoGestor(s), { slug: b.slugAtual });
    const linhas = espiao.mock.calls.map((x) => String(x[0]));
    expect(linhas).toContain(JSON.stringify({ evento: 'salao.slug_trocado', salaoId: s.salaoId, resultado: 'trocado' }));
    expect(linhas).toContain(JSON.stringify({ evento: 'salao.slug_trocado', salaoId: s.salaoId, resultado: 'em_uso' }));
    expect(linhas.join('\n')).not.toContain(`${s.slugAtual}-log`);
  });
});
