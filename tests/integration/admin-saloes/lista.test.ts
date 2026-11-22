import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listarSaloes as listarNoServico } from '@/server/admin/saloes';
import { lerFiltros } from '@/server/admin/saloes-validacao';
import { listarSaloes as listarNoRepo } from '@/server/repos/admin-saloes';
import { encerrarPrisma, obterPrisma } from '@/server/repos/db';

import { criarClienteComLog } from '../disponibilidade/apoio';
import { adminDeTeste, prefixoUnico, salaoComAssinatura, salaoLeve } from '../../support/admin-saloes';
import type { AdminDeTeste } from '../../support/admin-saloes';
import { conectar } from '../../support/sql';

// D-044 CA-1 e CA-13: a lista de salões do admin (estados, suspensão, busca, filtros, paginação, SQL constante).
let c: pg.Client;
let adm: AdminDeTeste;

beforeAll(async () => {
  c = await conectar();
  adm = await adminDeTeste();
});
afterAll(async () => {
  await c.end();
  await encerrarPrisma();
});

const listar = (sp: Record<string, string>) => listarNoServico(adm.ctx, lerFiltros(sp));
const nomes = (l: { itens: { nome: string }[] }) => l.itens.map((i) => i.nome);

describe('CA-1: estados, indicador de suspensão, slug atual e gestor', () => {
  it('mostra os seis estados, o salão sem assinatura, o só-encerrada e o suspenso manualmente', async () => {
    const p = prefixoUnico();
    const estados = ['pendente', 'em_teste', 'ativa', 'em_carencia', 'suspensa', 'cancelada'] as const;
    const criados = new Map<string, { nome: string; slug: string; email: string }>();
    for (const e of estados) {
      const s = await salaoComAssinatura(e, {}, { salao: { nome: `${p} ${e}` } });
      criados.set(e, { nome: s.nome, slug: s.slugAtual, email: s.gestor.email });
    }
    const sem = await salaoComAssinatura(null, {}, { salao: { nome: `${p} sem` } });
    const enc = await salaoComAssinatura('encerrada', {}, { salao: { nome: `${p} so-encerrada` } });
    const susp = await salaoComAssinatura('ativa', {}, { salao: { nome: `${p} suspenso` } });
    await obterPrisma().salao.update({ where: { id: susp.salaoId }, data: { suspensoManualEm: new Date() } });
    // Uma encerrada antiga + uma vigente: vale a vigente.
    const dupla = await salaoComAssinatura('encerrada', {}, { salao: { nome: `${p} dupla` } });
    await obterPrisma().assinatura.create({ data: { salaoId: dupla.salaoId, estado: 'ativa' } });

    const l = await listar({ q: p });
    expect(l.total).toBe(10);
    const porNome = new Map(l.itens.map((i) => [i.nome, i]));
    for (const e of estados) {
      const esperado = criados.get(e)!;
      expect(porNome.get(esperado.nome)).toMatchObject({ estado: e, suspenso: false, slug: esperado.slug, gestorEmail: esperado.email });
    }
    expect(porNome.get(sem.nome)).toMatchObject({ estado: null, suspenso: false });
    expect(porNome.get(enc.nome)).toMatchObject({ estado: null });
    expect(porNome.get(susp.nome)).toMatchObject({ estado: 'ativa', suspenso: true });
    expect(porNome.get(dupla.nome)).toMatchObject({ estado: 'ativa' });
  });

  it('o slug exibido é o atual, nunca o histórico', async () => {
    const p = prefixoUnico();
    const s = await salaoComAssinatura('ativa', {}, { salao: { nome: `${p} slug` } });
    const l = await listar({ q: p });
    expect(l.itens[0].slug).toBe(s.slugAtual);
    expect(l.itens[0].slug).not.toBe(s.slugHistorico);
  });
});

describe('CA-1: paginação, ordem e contagem', () => {
  it('25 salões: 20 + 5, ordem estável por nome (C) e id, página além do fim vazia', async () => {
    const p = prefixoUnico();
    for (let i = 1; i <= 25; i++) await salaoLeve(`${p} ${String(i).padStart(2, '0')}`);
    const p1 = await listar({ q: p });
    const p2 = await listar({ q: p, pagina: '2' });
    const p3 = await listar({ q: p, pagina: '3' });
    expect(p1).toMatchObject({ total: 25, pagina: 1, porPagina: 20 });
    expect(p1.itens).toHaveLength(20);
    expect(p2.itens).toHaveLength(5);
    expect(p2.total).toBe(25);
    expect(p3).toMatchObject({ itens: [], total: 0 });
    const todos = [...nomes(p1), ...nomes(p2)];
    expect(todos).toEqual([...todos].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    expect(new Set(todos).size).toBe(25);
    expect(await listar({ q: p, pagina: '2' })).toEqual(p2);
  });

  it('emite UMA instrução SQL por chamada, com 0, 1 ou 25 resultados e qualquer filtro', async () => {
    const p = prefixoUnico();
    for (let i = 0; i < 3; i++) await salaoLeve(`${p} ${i}`);
    const log = criarClienteComLog();
    try {
      const filtros = [{ q: '' }, { q: p }, { q: 'nada-parecido-xyz' }, { q: p, estado: 'em_teste', suspenso: 'nao', pagina: '2' }];
      for (const f of filtros) {
        const antes = log.consultas.length;
        const x = lerFiltros(f);
        await listarNoRepo({ chave: x.chave, estado: x.estado, suspenso: x.suspenso, pagina: x.pagina }, log.cliente);
        expect(log.consultas.slice(antes).filter((q) => !/^\s*(BEGIN|COMMIT|ROLLBACK|SET |DEALLOCATE)/i.test(q))).toHaveLength(1);
      }
    } finally {
      await log.encerrar();
    }
  });
});

describe('CA-1: busca', () => {
  it('ignora acento e caixa; %, _ e \\ são literais', async () => {
    const p = prefixoUnico();
    await salaoComAssinatura(null, {}, { salao: { nome: `Salão Ação ${p}` } });
    await salaoComAssinatura(null, {}, { salao: { nome: `${p} 100% Bela` } });
    await salaoComAssinatura(null, {}, { salao: { nome: `${p} 100x Bela` } });
    await salaoComAssinatura(null, {}, { salao: { nome: `${p} a_b` } });
    await salaoComAssinatura(null, {}, { salao: { nome: `${p} axb` } });
    await salaoComAssinatura(null, {}, { salao: { nome: `${p} barra\\ final` } });
    expect(nomes(await listar({ q: `salao acao ${p}` }))).toEqual([`Salão Ação ${p}`]);
    expect(nomes(await listar({ q: `SALAO AÇÃO ${p}` }))).toEqual([`Salão Ação ${p}`]);
    expect(nomes(await listar({ q: `${p} 100%` }))).toEqual([`${p} 100% Bela`]);
    expect(nomes(await listar({ q: `${p} a_b` }))).toEqual([`${p} a_b`]);
    expect(nomes(await listar({ q: `${p} barra\\` }))).toEqual([`${p} barra\\ final`]);
    // Um '%' sozinho não casa tudo.
    expect((await listar({ q: '%' })).itens.every((i) => i.nome.includes('%') || i.slug.includes('%') || (i.gestorEmail ?? '').includes('%'))).toBe(true);
  });

  it('encontra pelo slug ATUAL e pelo e-mail do gestor; o slug histórico não conta', async () => {
    const p = prefixoUnico();
    const s = await salaoComAssinatura(null, {}, { salao: { nome: `${p} busca` }, slugAtual: `atual-${p}`, slugHistorico: `historico-${p}`, gestor: { email: `gestor-${p}@exemplo.com.br` } });
    expect(nomes(await listar({ q: `atual-${p}` }))).toEqual([s.nome]);
    expect(nomes(await listar({ q: `GESTOR-${p}@EXEMPLO` }))).toEqual([s.nome]);
    expect((await listar({ q: `historico-${p}` })).total).toBe(0);
  });
});

describe('CA-1: filtros', () => {
  it('estado (inclui sem_assinatura) e suspensão, combinados', async () => {
    const p = prefixoUnico();
    const a = await salaoComAssinatura('em_teste', {}, { salao: { nome: `${p} a` } });
    const b = await salaoComAssinatura('em_teste', {}, { salao: { nome: `${p} b` } });
    const d = await salaoComAssinatura('ativa', {}, { salao: { nome: `${p} d` } });
    const e = await salaoComAssinatura(null, {}, { salao: { nome: `${p} e` } });
    const f = await salaoComAssinatura('encerrada', {}, { salao: { nome: `${p} f` } });
    await obterPrisma().salao.update({ where: { id: b.salaoId }, data: { suspensoManualEm: new Date() } });
    await obterPrisma().salao.update({ where: { id: e.salaoId }, data: { suspensoManualEm: new Date() } });
    expect(nomes(await listar({ q: p, estado: 'em_teste' }))).toEqual([a.nome, b.nome]);
    expect(nomes(await listar({ q: p, estado: 'em_teste', suspenso: 'sim' }))).toEqual([b.nome]);
    expect(nomes(await listar({ q: p, estado: 'em_teste', suspenso: 'nao' }))).toEqual([a.nome]);
    expect(nomes(await listar({ q: p, estado: 'ativa' }))).toEqual([d.nome]);
    expect(nomes(await listar({ q: p, estado: 'sem_assinatura' }))).toEqual([e.nome, f.nome]);
    expect(nomes(await listar({ q: p, suspenso: 'sim' }))).toEqual([b.nome, e.nome]);
    expect((await listar({ q: p, suspenso: 'nao' })).total).toBe(3);
    expect((await listar({ q: p })).total).toBe(5);
  });
});

describe('CA-13: o que a lista nunca carrega', () => {
  it('só as seis chaves esperadas; nada de provedor, hash, token nem TOTP', async () => {
    const p = prefixoUnico();
    const s = await salaoComAssinatura('em_teste', {}, { salao: { nome: `${p} seg` } });
    await obterPrisma().assinatura.update({ where: { id: s.assinaturaId! }, data: { provedorAssinaturaId: `PROVEDOR-SECRETO-${p}` } });
    const l = await listar({ q: p });
    expect(Object.keys(l.itens[0]).sort()).toEqual(['estado', 'gestorEmail', 'id', 'nome', 'slug', 'suspenso']);
    const json = JSON.stringify(l);
    expect(json).not.toContain('PROVEDOR-SECRETO');
    expect(json).not.toMatch(/argon2|senha|totp|token/i);
  });
});
