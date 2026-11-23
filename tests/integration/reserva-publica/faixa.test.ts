import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { carregarPasso, carregarPassoComLimite, carregarSalao, lerRegrasDaPagina } from '@/server/reserva-publica/pagina';
import { camposOcultos, chaveDeData, hrefAlterarItem, hrefDaSemana, hrefDoDia, hrefOutroDia, lerPasso } from '@/server/reserva-publica/passos';
import type { ParametrosBrutos } from '@/server/reserva-publica/passos';
import type { VisaoDoPasso } from '@/server/reserva-publica/tipos';
import { obterPrisma } from '@/server/repos/db';
import { criarPublicoContext } from '@/server/tenant/context';

import { AGORA, DIA, criarCenarioReserva, definirJornada, instalarContadorDeComandos, sp } from '../../support/reservas';
import type { CenarioReserva, OpcoesCenarioReserva } from '../../support/reservas';
import { ipNovo } from '../../support/reserva-publica';
import { ocupar } from '../reservas/apoio-itens';
import { contadorDoIp } from '../protecao/apoio';
import { criarCenarioTres, h } from './apoio';

// D-051 T-6: a régua da semana no passo do serviço 0 contra o PostgreSQL real. CA-14 (uma cota por
// carregamento e contagens de SQL determinísticas: 'dia' = 6, serviço 0 com dia = 12, serviço k ≥ 1 = 6,
// dados = 6 ou 12 quando o item 0 caiu), CA-8 (URLs antigas), CA-9 ("Alterar" do item 0), CA-11 (avisos),
// CA-12 (semana vazia), CA-15 (fuso do salão perto da meia-noite) e o isolamento entre salões.

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterAll(() => {
  vi.restoreAllMocks();
});

const db = () => obterPrisma();
const DIA_CHAVE = chaveDeData(DIA);

type Salao = { salaoId: string; slug: string };

async function abrir(c: Salao, params: ParametrosBrutos, agora: Date = AGORA): Promise<VisaoDoPasso> {
  const ctx = criarPublicoContext(c.salaoId, c.slug);
  const salao = await carregarSalao(ctx, agora);
  const regras = await lerRegrasDaPagina(ctx, agora);
  return carregarPasso(ctx, lerPasso(params, regras), { servicos: salao.servicos, equipe: salao.equipe, regras, agora });
}

/** Instruções SQL de UM carregamento do passo (as leituras do salão e das regras ficam fora da medição). */
async function contar(c: Salao, params: ParametrosBrutos): Promise<{ n: number; v: VisaoDoPasso }> {
  const ctx = criarPublicoContext(c.salaoId, c.slug);
  const salao = await carregarSalao(ctx, AGORA);
  const regras = await lerRegrasDaPagina(ctx, AGORA);
  const contador = instalarContadorDeComandos();
  try {
    const v = await carregarPasso(ctx, lerPasso(params, regras), { servicos: salao.servicos, equipe: salao.equipe, regras, agora: AGORA });
    return { n: contador.contar(), v };
  } finally {
    await contador.encerrar();
  }
}

const paramsDoHref = (href: string): ParametrosBrutos => {
  const u = new URL(href, 'http://l');
  const p: Record<string, string | string[]> = {};
  for (const k of new Set(u.searchParams.keys())) {
    const v = u.searchParams.getAll(k);
    p[k] = v.length === 1 ? v[0] : v;
  }
  return p;
};

function dia(v: VisaoDoPasso): Extract<VisaoDoPasso, { passo: 'dia' }> {
  if (v.passo !== 'dia') throw new Error(`passo inesperado: ${v.passo}`);
  return v;
}
function servico(v: VisaoDoPasso): Extract<VisaoDoPasso, { passo: 'servico' }> {
  if (v.passo !== 'servico') throw new Error(`passo inesperado: ${v.passo}`);
  return v;
}
const disponiveis = (v: { faixa: { dias: { data: string; temHorarios: boolean }[] } }) =>
  v.faixa.dias.filter((d) => d.temHorarios).map((d) => d.data);

/**
 * Salão com 10 serviços ativos, todos vinculados aos mesmos `nProf` profissionais (Ana + n−1), jornada 09:00–19:00
 * para todos e grade de 15 min. Os serviços em ordem: A, B e mais 8.
 */
async function criarSalaoMatriz(nProf: 1 | 8): Promise<CenarioReserva & Salao & { servicos: string[]; profs: string[] }> {
  const c = await criarCenarioReserva({ servicoA: { precoCentavos: 5000, duracaoMin: 30 }, servicoB: { precoCentavos: 7000, duracaoMin: 30 } });
  const salaoId = c.s.salaoId;
  await db().servicoProfissional.deleteMany({ where: { salaoId } });
  await db().profissional.update({ where: { id: c.bia }, data: { ativo: false } });
  const profs = [c.ana];
  for (let i = 1; i < nProf; i++) {
    profs.push((await db().profissional.create({ data: { salaoId, nome: `Prof ${i}` }, select: { id: true } })).id);
  }
  const servicos = [c.A, c.B];
  for (let i = 0; i < 8; i++) {
    servicos.push(
      (await db().servico.create({ data: { salaoId, nome: `S${i}`, precoCentavos: 1000, duracaoMin: 15 }, select: { id: true } })).id,
    );
  }
  await db().servicoProfissional.createMany({ data: servicos.flatMap((servicoId) => profs.map((profissionalId) => ({ salaoId, servicoId, profissionalId }))) });
  for (const p of profs) await definirJornada(salaoId, p, [['09:00', '19:00']]);
  return { ...c, salaoId, slug: c.s.slugAtual, servicos, profs };
}

/** Itens válidos, um por serviço, em sequência a partir das 09:00 de DIA (todos com a Ana, sem sobreposição). */
function itensEmSequencia(c: { ana: string }, n: number): string[] {
  // Serviços A/B 30 min, os demais 15 min: começa às 09:00 e avança 30 min por item (sobra folga).
  return Array.from({ length: n }, (_, k) => h(c.ana, new Date(sp(DIA, '09:00').getTime() + k * 30 * 60_000)));
}

describe('CA-14: instruções SQL por carregamento, constantes (1/3/10 serviços × 1/8 profissionais × com e sem itens)', () => {
  it.each([1, 8] as const)('%s profissional(is)', async (nProf) => {
    const c = await criarSalaoMatriz(nProf);
    for (const n of [1, 3, 10]) {
      const s = c.servicos.slice(0, n);
      const hs = itensEmSequencia(c, n);
      const ctx = `${nProf} prof × ${n} serv`;
      // Passo 'dia' (semana 0 e semana navegada): 6.
      const d0 = await contar(c, { s });
      expect(d0.v.passo, ctx).toBe('dia');
      expect(d0.n, ctx).toBe(6);
      const d1 = await contar(c, paramsDoHref(hrefDaSemana('/x', s, '2026-11-27')));
      expect([d1.v.passo, d1.n], ctx).toEqual(['dia', 6]);
      // Serviço 0 com dia, sem itens: 12 (a chamada da D-050 + a da régua).
      const s0 = await contar(c, { s, data: DIA_CHAVE });
      expect([s0.v.passo, s0.n], ctx).toEqual(['servico', 12]);
      expect(servico(s0.v).faixa?.selecionado, ctx).toBe(DIA_CHAVE);
      const todos = Object.fromEntries(hs.map((v, k) => [`h${k}`, v]));
      // Serviço 0 com dia e os outros itens escolhidos ("Alterar" do item 0): 12.
      const alt = await contar(c, { s, data: DIA_CHAVE, ...todos, alterar: '0' });
      expect([alt.v.passo, alt.n], ctx).toEqual(['servico', 12]);
      expect(servico(alt.v).preSelecionado, ctx).toBe(hs[0]);
      if (n > 1) {
        // Serviço k ≥ 1: 6, sem régua.
        const k1 = await contar(c, { s, data: DIA_CHAVE, h0: hs[0] });
        expect([k1.v.passo, k1.n, servico(k1.v).faixa], ctx).toEqual(['servico', 6, null]);
      }
      // Dados (nenhum item caiu): 6.
      const dados = await contar(c, { s, data: DIA_CHAVE, ...todos });
      expect([dados.v.passo, dados.n], ctx).toEqual(['dados', 6]);
    }
  });

  it('dados com o item 0 caído: 12 (a régua entra na visão do serviço 0); item k ≥ 1 caído: 6', async () => {
    const c = await criarSalaoMatriz(1);
    const s = c.servicos.slice(0, 3);
    const hs = itensEmSequencia(c, 3);
    // Item 0 às 07:00 (fora da jornada): cai.
    const caiu0 = await contar(c, { s, data: DIA_CHAVE, h0: h(c.ana, sp(DIA, '07:00')), h1: hs[1], h2: hs[2] });
    expect(caiu0.n).toBe(12);
    expect(servico(caiu0.v)).toMatchObject({ indice: 0, aviso: 'horario_indisponivel', faixa: { selecionado: DIA_CHAVE } });
    const caiu1 = await contar(c, { s, data: DIA_CHAVE, h0: hs[0], h1: h(c.ana, sp(DIA, '07:00')), h2: hs[2] });
    expect(caiu1.n).toBe(6);
    expect(servico(caiu1.v)).toMatchObject({ indice: 1, aviso: 'horario_indisponivel', faixa: null });
  });

  it('CA-12: semana sem nenhum dia oferecido custa o mesmo que uma com horário (6), sem salto de semana', async () => {
    const c = await criarSalaoMatriz(1);
    const s = c.servicos.slice(0, 3);
    // Bloqueio do salão inteiro na semana 1 (27/11 a 03/12).
    await db().bloqueio.create({
      data: { salaoId: c.salaoId, profissionalId: null, inicio: sp({ ano: 2026, mes: 11, dia: 27 }, '00:00'), fim: sp({ ano: 2026, mes: 12, dia: 4 }, '00:00') },
    });
    const vazia = await contar(c, { s, de: '2026-11-27' });
    expect(vazia.n).toBe(6);
    const v = dia(vazia.v);
    expect(v.faixa.inicio).toBe('2026-11-27');
    expect(v.faixa.dias).toHaveLength(7);
    expect(disponiveis(v)).toEqual([]);
    expect([v.faixa.anterior, v.faixa.proxima]).toEqual(['2026-11-20', '2026-12-04']);
    const cheia = await contar(c, { s });
    expect(cheia.n).toBe(6);
    expect(disponiveis(dia(cheia.v)).length).toBeGreaterThan(0);
  });

  it('uma cota por carregamento (sem dia, com dia, alterar=0 com itens, semana navegada); limitado = 1 comando', async () => {
    const c = await criarSalaoMatriz(1);
    const s = c.servicos.slice(0, 3);
    const hs = itensEmSequencia(c, 3);
    const ctx = criarPublicoContext(c.salaoId, c.slug);
    const salao = await carregarSalao(ctx, AGORA);
    const regras = await lerRegrasDaPagina(ctx, AGORA);
    const ip = ipNovo();
    const ler = (params: ParametrosBrutos) =>
      carregarPassoComLimite(ctx, lerPasso(params, regras), { servicos: salao.servicos, equipe: salao.equipe, regras, agora: AGORA, ip });
    vi.stubEnv('PROTECAO_LIMITE_IP_DISPONIBILIDADE', '4');
    try {
      const casos: [ParametrosBrutos, string][] = [
        [{ s }, 'dia'],
        [{ s, data: DIA_CHAVE }, 'servico'],
        [{ s, data: DIA_CHAVE, h0: hs[0], h1: hs[1], h2: hs[2], alterar: '0' }, 'servico'],
        [paramsDoHref(hrefDaSemana('/x', s, '2026-11-27')), 'dia'],
      ];
      for (const [k, [params, esperado]] of casos.entries()) {
        expect((await ler(params)).passo).toBe(esperado);
        expect(await contadorDoIp(ip, 'disponibilidade')).toBe(k + 1);
      }
      const contador = instalarContadorDeComandos();
      try {
        expect(await ler({ s, data: DIA_CHAVE })).toEqual({ passo: 'limitado' });
        expect(contador.contar()).toBe(1);
      } finally {
        await contador.encerrar();
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('CA-8: URLs antigas (tabela da RN-12) em carregarPasso', () => {
  it('cada linha cai no passo equivalente, sem erro', async () => {
    const t = await criarCenarioTres();
    const c = { salaoId: t.s.salaoId, slug: t.s.slugAtual };
    const s = [t.A, t.C];
    const h0 = h(t.ana, sp(DIA, '09:00'));
    const h1 = h(t.carla, sp(DIA, '15:00'));
    const X = '2026-12-02'; // meio da semana 1 (27/11 a 03/12)

    expect(dia(await abrir(c, { s })).faixa).toMatchObject({ inicio: '2026-11-20', selecionado: null });
    expect(dia(await abrir(c, { s, de: X })).faixa).toMatchObject({ inicio: '2026-11-27', fim: '2026-12-03', selecionado: null });
    expect(servico(await abrir(c, { s, data: DIA_CHAVE }))).toMatchObject({ indice: 0, faixa: { inicio: '2026-11-27', selecionado: DIA_CHAVE } });
    expect(servico(await abrir(c, { s, data: DIA_CHAVE, de: '2027-01-10' }))).toMatchObject({
      indice: 0,
      faixa: { inicio: '2026-11-27', selecionado: DIA_CHAVE },
    });
    expect(servico(await abrir(c, { s, data: DIA_CHAVE, h0 }))).toMatchObject({ indice: 1, faixa: null });
    expect((await abrir(c, { s, data: DIA_CHAVE, h0, h1 })).passo).toBe('dados');
    expect(servico(await abrir(c, { s, data: DIA_CHAVE, h0, h1, alterar: '0' }))).toMatchObject({
      indice: 0,
      alterando: true,
      preSelecionado: h0,
      faixa: { selecionado: DIA_CHAVE },
    });
    expect(servico(await abrir(c, { s, data: DIA_CHAVE, h0, h1, alterar: '1' }))).toMatchObject({ indice: 1, faixa: null });
    expect(dia(await abrir(c, { s, data: '2027-03-01', de: X })).faixa).toMatchObject({ inicio: '2026-11-27', selecionado: null });
    expect(dia(await abrir(c, { s, data: 'x' })).faixa).toMatchObject({ inicio: '2026-11-20' });
    expect(dia(await abrir(c, { s, data: DIA_CHAVE.replace('12-01', '11-19'), alterar: '0', h0 })).faixa.inicio).toBe('2026-11-20');
  });
});

describe('fluxo pela régua (CA-5, CA-7, CA-9, CA-10, CA-11)', () => {
  it('serviços → dia (pela régua) → horário do serviço 0 → serviço 1 → dados; "Alterar" do item 0 e troca de dia', async () => {
    const t = await criarCenarioTres();
    const c = { salaoId: t.s.salaoId, slug: t.s.slugAtual };
    const s = [t.A, t.B, t.C];
    // DIA (01/12) está na semana 1: "Próxima semana" e depois o link do dia.
    const s0 = dia(await abrir(c, { s }));
    expect(s0.faixa.proxima).toBe('2026-11-27');
    const s1 = dia(await abrir(c, paramsDoHref(hrefDaSemana('/x', s, s0.faixa.proxima!))));
    expect(s1.faixa.dias.find((d) => d.data === DIA_CHAVE)?.temHorarios).toBe(true);
    const p0 = servico(await abrir(c, paramsDoHref(hrefDoDia('/x', s, DIA_CHAVE))));
    expect(p0).toMatchObject({ indice: 0, data: DIA_CHAVE, preSelecionado: null, faixa: { inicio: '2026-11-27', selecionado: DIA_CHAVE } });
    // A grade do serviço 0 é a mesma de antes (a régua não muda a chamada da D-050).
    expect(p0.profissionais.map((p) => p.nome)).toEqual(['Ana', 'Bia']);

    // Continuar sem escolher (CA-11): volta ao serviço 0 com o dia marcado e sem_selecao.
    const semSelecao = servico(await abrir(c, Object.fromEntries(camposOcultos(p0.consulta, 0).map((x) => [x.name, x.name === 's' ? s : x.value]))));
    expect(semSelecao).toMatchObject({ indice: 0, aviso: 'sem_selecao', faixa: { selecionado: DIA_CHAVE } });

    const hs = [h(t.ana, sp(DIA, '09:00')), h(t.bia, sp(DIA, '10:00')), h(t.carla, sp(DIA, '15:00'))];
    // Escolher o horário do serviço 0 e seguir: serviço 1, sem régua (CA-6).
    const p1 = servico(await abrir(c, { s, data: DIA_CHAVE, h0: hs[0] }));
    expect(p1).toMatchObject({ indice: 1, faixa: null });
    // "Escolher outro dia" do passo 1 (CA-10): a semana de D, sem dia marcado nem itens.
    expect(dia(await abrir(c, paramsDoHref(hrefOutroDia('/x', p1.consulta)))).faixa).toMatchObject({ inicio: '2026-11-27', selecionado: null });

    // CA-9: "Alterar" do item 0 com os 3 itens: régua marcada, pré-seleção, os outros no roteiro.
    const dados = await abrir(c, { s, data: DIA_CHAVE, h0: hs[0], h1: hs[1], h2: hs[2] });
    if (dados.passo !== 'dados') throw new Error(`passo inesperado: ${dados.passo}`);
    const alt = servico(await abrir(c, paramsDoHref(hrefAlterarItem('/x', dados.consulta, 0))));
    expect(alt).toMatchObject({ indice: 0, alterando: true, preSelecionado: hs[0], faixa: { selecionado: DIA_CHAVE } });
    expect(alt.escolhidos.map((x) => x.indice)).toEqual([1, 2]);
    // Outro horário no mesmo dia mantém os demais.
    const outro = h(t.ana, sp(DIA, '11:00'));
    const volta = await abrir(c, { s, data: DIA_CHAVE, h0: outro, h1: hs[1], h2: hs[2] });
    expect(volta.passo).toBe('dados');
    // CA-7: o link de outro dia (02/12) descarta todos os itens.
    const trocado = servico(await abrir(c, paramsDoHref(hrefDoDia('/x', s, '2026-12-02'))));
    expect(trocado).toMatchObject({ indice: 0, data: '2026-12-02', preSelecionado: null, escolhidos: [], pendentes: [1, 2] });
  });
});

describe('CA-15: "hoje" e a semana 0 seguem o dia civil do salão perto da meia-noite', () => {
  it.each<[string, number]>([
    ['America/Manaus', 4],
    ['America/Noronha', 2],
  ])('%s', async (fuso, deslocamentoH) => {
    const opcoes: OpcoesCenarioReserva = { fuso };
    const t = await criarCenarioReserva(opcoes);
    const c = { salaoId: t.s.salaoId, slug: t.s.slugAtual };
    // Meia-noite local de 21/11/2026 = 21/11 às deslocamentoH:00 UTC.
    const meiaNoite = Date.UTC(2026, 10, 21, deslocamentoH, 0);
    const antes = dia(await abrir(c, { s: t.A }, new Date(meiaNoite - 5 * 60_000)));
    expect([antes.faixa.hoje, antes.faixa.inicio, antes.faixa.fim]).toEqual(['2026-11-20', '2026-11-20', '2026-11-26']);
    const depois = dia(await abrir(c, { s: t.A }, new Date(meiaNoite + 5 * 60_000)));
    expect([depois.faixa.hoje, depois.faixa.inicio, depois.faixa.fim]).toEqual(['2026-11-21', '2026-11-21', '2026-11-27']);
    // A data de ontem saiu da janela: volta ao passo 'dia' na semana 0.
    expect(dia(await abrir(c, { s: t.A, data: '2026-11-20' }, new Date(meiaNoite + 5 * 60_000))).faixa.inicio).toBe('2026-11-21');
  });
});

describe('isolamento: a régua de um salão não reflete a agenda de outro', () => {
  it('a única vaga do dia ocupada no salão A some só da régua de A', async () => {
    const criar = async () => {
      const t = await criarCenarioReserva({ gradeMin: 60, jornada: [['09:00', '10:00']], servicoA: { precoCentavos: 5000, duracaoMin: 60 } });
      // Só a Ana faz A, com uma vaga por dia (09:00).
      await db().servicoProfissional.deleteMany({ where: { salaoId: t.s.salaoId, servicoId: t.A, profissionalId: t.bia } });
      return t;
    };
    const a = await criar();
    const b = await criar();
    await ocupar(a, { inicio: sp(DIA, '09:00'), fim: sp(DIA, '10:00'), profissionalId: a.ana, servicoId: a.A });
    const de = '2026-11-27';
    const ra = dia(await abrir({ salaoId: a.s.salaoId, slug: a.s.slugAtual }, { s: a.A, de }));
    const rb = dia(await abrir({ salaoId: b.s.salaoId, slug: b.s.slugAtual }, { s: b.A, de }));
    expect(disponiveis(ra)).not.toContain(DIA_CHAVE);
    expect(disponiveis(rb)).toContain(DIA_CHAVE);
    expect(disponiveis(ra).length).toBe(disponiveis(rb).length - 1);
    // Serviço de outro salão: volta aos serviços, sem régua.
    expect(await abrir({ salaoId: a.s.salaoId, slug: a.s.slugAtual }, { s: b.A })).toEqual({
      passo: 'servicos',
      marcados: [],
      aviso: 'servico_indisponivel',
    });
  });
});
