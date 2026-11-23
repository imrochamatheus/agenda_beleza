import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { carregarPasso, carregarSalao, lerRegrasDaPagina } from '@/server/reserva-publica/pagina';
import {
  camposOcultos,
  chaveDeData,
  hrefAlterarItem,
  hrefDaSemana,
  hrefDoDia,
  hrefSeguirSem,
  lerPasso,
  lerSelecao,
} from '@/server/reserva-publica/passos';
import type { ParametrosBrutos } from '@/server/reserva-publica/passos';
import { reescolhaDosItens } from '@/server/reserva-publica/reescolha';
import { reservarPelaPagina } from '@/server/reserva-publica/servico';
import type { EntradaReservaPublica, VisaoDoPasso } from '@/server/reserva-publica/tipos';
import { obterPrisma } from '@/server/repos/db';
import { criarPublicoContext } from '@/server/tenant/context';

import { AGORA, DIA, contarLinhas, sp } from '../../support/reservas';
import { enfileirar, entradaPublica, ipNovo, itemPublico } from '../../support/reserva-publica';
import { ocupar } from '../reservas/apoio-itens';
import { criarCenarioTres, h } from './apoio';
import type { CenarioTres } from './apoio';

// D-050 T-10: o fluxo público de ponta a ponta no servidor (CA-6), percorrido como a página faz: cada passo
// é um GET cuja query vem dos campos ocultos + rádio do passo anterior; e a reescolha do CA-10 (horário de
// um item tomado entre a escolha e o envio).

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterAll(() => {
  vi.restoreAllMocks();
});

const db = () => obterPrisma();
const DIA_CHAVE = chaveDeData(DIA);
const iso = (hhmm: string) => sp(DIA, hhmm).toISOString();

async function abrir(c: CenarioTres, params: ParametrosBrutos): Promise<VisaoDoPasso> {
  const ctx = criarPublicoContext(c.s.salaoId, c.s.slugAtual);
  const salao = await carregarSalao(ctx, AGORA);
  const regras = await lerRegrasDaPagina(ctx, AGORA);
  return carregarPasso(ctx, lerPasso(params, regras), { servicos: salao.servicos, equipe: salao.equipe, regras, agora: AGORA });
}

/** Simula o envio GET do formulário de um passo: campos ocultos + o rádio `h<k>` marcado. */
function enviar(campos: { name: string; value: string }[], extra: Record<string, string> = {}): ParametrosBrutos {
  const p: Record<string, string | string[]> = {};
  for (const { name, value } of [...campos, ...Object.entries(extra).map(([name, value]) => ({ name, value }))]) {
    const atual = p[name];
    p[name] = atual === undefined ? value : Array.isArray(atual) ? [...atual, value] : [atual, value];
  }
  return p;
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

describe('CA-6/CA-9: percorrer serviços → dia (régua) → serviço a serviço → dados → confirmação', () => {
  it('A com Ana 09:00, B com Bia 10:00 e C com Carla 15:00: uma reserva com 3 itens e o resumo por início', async () => {
    const c = await criarCenarioTres();
    const s = [c.A, c.B, c.C];
    // D-051: depois dos serviços vem a régua (semana 0); o dia D fica na semana seguinte.
    const semana0 = await abrir(c, { s });
    if (semana0.passo !== 'dia') throw new Error(`passo inesperado: ${semana0.passo}`);
    const semana1 = await abrir(c, paramsDoHref(hrefDaSemana('/x', s, semana0.faixa.proxima!)));
    if (semana1.passo !== 'dia') throw new Error(`passo inesperado: ${semana1.passo}`);
    expect(semana1.faixa.dias.find((d) => d.data === DIA_CHAVE)?.temHorarios).toBe(true);
    let v = await abrir(c, paramsDoHref(hrefDoDia('/x', s, DIA_CHAVE)));
    const escolhas = [h(c.ana, sp(DIA, '09:00')), h(c.bia, sp(DIA, '10:00')), h(c.carla, sp(DIA, '15:00'))];
    for (const [k, valor] of escolhas.entries()) {
      if (v.passo !== 'servico') throw new Error(`passo inesperado: ${v.passo}`);
      expect(v.indice).toBe(k);
      expect(v.proximoEhDados).toBe(k === 2);
      // O horário escolhido é oferecido ao profissional, na data D (CA-7).
      const [prof, inicio] = valor.split('_');
      expect(v.profissionais.find((p) => p.id === prof)?.horarios).toContain(inicio);
      v = await abrir(c, enviar(camposOcultos(v.consulta, k), { [`h${k}`]: valor }));
    }
    if (v.passo !== 'dados') throw new Error(`passo inesperado: ${v.passo}`);
    expect(v.itens.map((x) => [x.servicoNome, x.profissionalNome, x.inicioIso])).toEqual([
      ['A', 'Ana', iso('09:00')],
      ['B', 'Bia', iso('10:00')],
      ['C', 'Carla', iso('15:00')],
    ]);

    // CA-9: "Alterar" B volta ao passo dele com A e C preservados; continuar com outro horário volta aos dados.
    const alterar = await abrir(c, paramsDoHref(hrefAlterarItem('/x', v.consulta, 1)));
    if (alterar.passo !== 'servico') throw new Error('passo inesperado');
    expect(alterar).toMatchObject({ indice: 1, alterando: true, preSelecionado: escolhas[1] });
    const novo = h(c.bia, sp(DIA, '11:00'));
    v = await abrir(c, enviar(camposOcultos(alterar.consulta, 1), { h1: novo }));
    if (v.passo !== 'dados') throw new Error(`passo inesperado: ${v.passo}`);
    expect(v.itens.map((x) => x.inicioIso)).toEqual([iso('09:00'), iso('11:00'), iso('15:00')]);

    // POST de dados: a casca lê s, data e h<k> dos campos ocultos (lerSelecao) e monta a entrada.
    const selecao = lerSelecao(enviar(camposOcultos(v.consulta)))!;
    const itens = selecao.itens.map((x, k) => itemPublico(selecao.s[k], x.profissionalId, x.inicio));
    const r = await reservarPelaPagina(entradaPublica(c, { servicoIds: selecao.s, itens }), AGORA, { enfileirar });
    expect(r.resultado).toBe('confirmada');
    if (r.resultado !== 'confirmada') return;
    expect(r.resumo.itens.map((x) => [x.servicoNome, x.profissionalNome, x.inicioIso, x.precoCentavos])).toEqual([
      ['A', 'Ana', iso('09:00'), 5000],
      ['B', 'Bia', iso('11:00'), 7000],
      ['C', 'Carla', iso('15:00'), 4000],
    ]);
    expect(r.resumo.totalCentavos).toBe(16000);
    const reservas = await db().reserva.findMany({ where: { salaoId: c.s.salaoId }, include: { itens: true } });
    expect(reservas).toHaveLength(1);
    expect(reservas[0].itens).toHaveLength(3);
  });
});

describe('CA-10: horário de um item tomado entre a escolha e o envio', () => {
  async function preparar() {
    const c = await criarCenarioTres();
    const itens = [itemPublico(c.A, c.ana, sp(DIA, '09:00')), itemPublico(c.B, c.bia, sp(DIA, '10:00')), itemPublico(c.C, c.carla, sp(DIA, '15:00'))];
    const minha = entradaPublica(c, { itens, nome: 'Maria Atrasada' });
    // Outra cliente reserva B com a Bia às 10:00 antes do envio.
    const outra = await reservarPelaPagina(entradaPublica(c, { itens: [itens[1]] }), AGORA, { enfileirar });
    expect(outra.resultado).toBe('confirmada');
    return { c, itens, minha };
  }
  const selecaoDe = (e: EntradaReservaPublica) => ({
    s: e.servicoIds,
    data: DIA_CHAVE,
    itens: e.itens.map((x) => ({ profissionalId: x.profissionalId, inicio: x.inicio })),
  });

  it('nada é gravado; a reescolha aponta o item B, mostra horários atualizados dele e mantém A e C', async () => {
    const { c, minha } = await preparar();
    const antes = await contarLinhas(c.s.salaoId);
    const r = await reservarPelaPagina(minha, AGORA, { enfileirar });
    expect(r.resultado).toBe('reescolher');
    expect(await contarLinhas(c.s.salaoId)).toEqual(antes);

    const re = await reescolhaDosItens(c.s.slugAtual, selecaoDe(minha), AGORA, ipNovo());
    if (re?.resultado !== 'reescolher') throw new Error(`reescolha inesperada: ${JSON.stringify(re)}`);
    expect(re.fuso).toBe('America/Sao_Paulo');
    expect(re.data).toBe(DIA_CHAVE);
    expect(re.mantidos.map((x) => [x.indice, x.servicoNome, x.profissionalNome, x.inicioIso])).toEqual([
      [0, 'A', 'Ana', iso('09:00')],
      [2, 'C', 'Carla', iso('15:00')],
    ]);
    expect(re.itens).toHaveLength(1);
    const b = re.itens[0];
    expect(b).toMatchObject({ indice: 1, servicoId: c.B, servicoNome: 'B', horarioAnteriorIso: iso('10:00'), profissionalAnteriorNome: 'Bia', caiu: true, preSelecionado: null });
    const bia = b.profissionais.find((p) => p.nome === 'Bia')!.horarios;
    expect(bia).not.toContain(iso('10:00'));
    expect(bia).toContain(iso('11:00'));
    // Os novos horários de B ainda descontam A e C (RN-10).
    for (const p of b.profissionais) {
      expect(p.horarios).not.toContain(iso('09:00'));
      expect(p.horarios).not.toContain(iso('15:00'));
    }
    // "Seguir sem B" mantém A e C (sem PII na URL).
    expect(hrefSeguirSem('/x', re.consulta, 1)).toBe(`/x?s=${c.A}&s=${c.C}&data=${DIA_CHAVE}&h0=${encodeURIComponent(h(c.ana, sp(DIA, '09:00')))}&h1=${encodeURIComponent(h(c.carla, sp(DIA, '15:00')))}`);

    // Reenviar com o novo horário de B confirma, e só então algo é gravado.
    const novo = { ...minha, itens: minha.itens.map((x, k) => (k === 1 ? itemPublico(c.B, c.bia, sp(DIA, '11:00')) : x)) };
    const ok = await reservarPelaPagina(novo, AGORA, { enfileirar });
    expect(ok.resultado).toBe('confirmada');
  });

  it('o 23P01 (corrida depois da revalidação) também vira reescolha, e o item é recalculado', async () => {
    const c = await criarCenarioTres();
    const itens = [itemPublico(c.A, c.ana, sp(DIA, '09:00')), itemPublico(c.B, c.bia, sp(DIA, '10:00'))];
    const minha = entradaPublica(c, { itens });
    // Outra conexão grava B da Bia às 10:00 depois da revalidação da minha e antes do INSERT (INSERT direto:
    // não disputa a trava do profissional): 23P01 sem índice.
    const r = await reservarPelaPagina(minha, AGORA, {
      enfileirar,
      aposRevalidar: async () => {
        await ocupar(c, { inicio: sp(DIA, '10:00'), fim: sp(DIA, '10:45'), profissionalId: c.bia, servicoId: c.B });
      },
    });
    expect(r).toEqual({ resultado: 'reescolher', itens: [] });
    const re = await reescolhaDosItens(c.s.slugAtual, selecaoDe(minha), AGORA, ipNovo());
    expect(re).toMatchObject({ resultado: 'reescolher', itens: [{ indice: 1, caiu: true }] });
  });

  it('dois itens caem: um bloco por item; as alternativas descontam só os itens mantidos', async () => {
    const c = await criarCenarioTres({ gradeMin: 30 });
    const itens = [itemPublico(c.A, c.ana, sp(DIA, '09:00')), itemPublico(c.B, c.bia, sp(DIA, '10:00')), itemPublico(c.C, c.carla, sp(DIA, '15:00'))];
    for (const x of [itens[1], itens[2]]) {
      expect((await reservarPelaPagina(entradaPublica(c, { itens: [x] }), AGORA, { enfileirar })).resultado).toBe('confirmada');
    }
    const minha = entradaPublica(c, { itens });
    const re = await reescolhaDosItens(c.s.slugAtual, selecaoDe(minha), AGORA, ipNovo());
    if (re?.resultado !== 'reescolher') throw new Error('reescolha inesperada');
    expect(re.mantidos.map((x) => x.indice)).toEqual([0]);
    expect(re.itens.map((x) => [x.indice, x.caiu])).toEqual([[1, true], [2, true]]);
    // As alternativas de B NÃO descontam o horário antigo de C (15:00, que caiu): Bia ainda pode às 15:00.
    expect(re.itens[0].profissionais.find((p) => p.nome === 'Bia')!.horarios).toContain(iso('15:00'));
    expect(re.itens[0].profissionais.find((p) => p.nome === 'Bia')!.horarios).not.toContain(iso('09:00'));
  });

  it('reabrir (reenvio da reescolha com erro de campo): o item continua aberto com a escolha nova pré-selecionada', async () => {
    const c = await criarCenarioTres();
    const itens = [itemPublico(c.A, c.ana, sp(DIA, '09:00')), itemPublico(c.B, c.bia, sp(DIA, '11:00'))];
    const re = await reescolhaDosItens(c.s.slugAtual, selecaoDe(entradaPublica(c, { itens })), AGORA, ipNovo(), { reabrir: [1, 7, -1] });
    expect(re).toMatchObject({ resultado: 'reescolher', itens: [{ indice: 1, caiu: false, preSelecionado: h(c.bia, sp(DIA, '11:00')) }] });
  });

  it('nenhum item caiu: sem_queda; seleção ou slug inválidos: null; limite de IP: limitado', async () => {
    const c = await criarCenarioTres();
    const minha = entradaPublica(c, { itens: [itemPublico(c.A, c.ana, sp(DIA, '09:00'))] });
    expect(await reescolhaDosItens(c.s.slugAtual, selecaoDe(minha), AGORA, ipNovo())).toEqual({ resultado: 'sem_queda' });
    for (const slug of ['nao-existe-xyz', 'api', c.s.slugHistorico]) {
      expect(await reescolhaDosItens(slug, selecaoDe(minha), AGORA, ipNovo()), slug).toBeNull();
    }
    const ruins = [
      { ...selecaoDe(minha), data: 'x' },
      { ...selecaoDe(minha), s: [c.A, c.B] },
      { ...selecaoDe(minha), itens: [{ profissionalId: 'x', inicio: iso('09:00') }] },
      { ...selecaoDe(minha), itens: [{ profissionalId: c.ana, inicio: 'x' }] },
    ];
    for (const sel of ruins) expect(await reescolhaDosItens(c.s.slugAtual, sel, AGORA, ipNovo())).toBeNull();
    // Serviço desativado: null (a casca volta aos serviços).
    await db().servico.update({ where: { id: c.A }, data: { ativo: false } });
    expect(await reescolhaDosItens(c.s.slugAtual, selecaoDe(minha), AGORA, ipNovo())).toBeNull();
    const negado = async () => ({ permitido: false as const, reiniciaEm: AGORA });
    expect(await reescolhaDosItens(c.s.slugAtual, selecaoDe(minha), AGORA, ipNovo(), { limitar: negado })).toEqual({ resultado: 'limitado' });
  });
});
