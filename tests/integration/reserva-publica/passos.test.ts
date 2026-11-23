import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { consultarDisponibilidadePorServico } from '@/server/disponibilidade/servico';
import { carregarPasso, carregarSalao, lerRegrasDaPagina } from '@/server/reserva-publica/pagina';
import { chaveDeData, lerPasso } from '@/server/reserva-publica/passos';
import type { ParametrosBrutos } from '@/server/reserva-publica/passos';
import type { VisaoDoPasso } from '@/server/reserva-publica/tipos';
import { obterPrisma } from '@/server/repos/db';
import { criarPublicoContext } from '@/server/tenant/context';

import { AGORA, DIA, definirFuncionamento, definirJornada, instalarContadorDeComandos, sp } from '../../support/reservas';
import { enfileirar, entradaPublica, itemPublico } from '../../support/reserva-publica';
import { reservarPelaPagina } from '@/server/reserva-publica/servico';
import { criarCenarioTres, h } from './apoio';
import type { CenarioTres } from './apoio';

// D-050 T-10: o passo do fluxo público derivado da query (CA-8), a lista de dias (DA-2), o passo por serviço
// com os horários descontando os itens escolhidos (RN-10, CA-4, C3), "Alterar" (CA-9) e o passo de dados com
// a conferência de todos os itens, contra o PostgreSQL real.

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterAll(() => {
  vi.restoreAllMocks();
});

const db = () => obterPrisma();
const DIA_CHAVE = chaveDeData(DIA);
const iso = (hhmm: string) => sp(DIA, hhmm).toISOString();

async function passo(c: CenarioTres, params: ParametrosBrutos): Promise<VisaoDoPasso> {
  const ctx = criarPublicoContext(c.s.salaoId, c.s.slugAtual);
  const salao = await carregarSalao(ctx, AGORA);
  const regras = await lerRegrasDaPagina(ctx, AGORA);
  return carregarPasso(ctx, lerPasso(params, regras), { servicos: salao.servicos, equipe: salao.equipe, regras, agora: AGORA });
}
function servico(v: VisaoDoPasso): Extract<VisaoDoPasso, { passo: 'servico' }> {
  if (v.passo !== 'servico') throw new Error(`passo inesperado: ${v.passo}`);
  return v;
}

describe('passo de serviços', () => {
  it('sem parâmetros: nenhum marcado; "Alterar serviços" deixa marcados só os ofertáveis', async () => {
    const c = await criarCenarioTres();
    expect(await passo(c, {})).toEqual({ passo: 'servicos', marcados: [], aviso: null });
    const outro = await criarCenarioTres();
    expect(await passo(c, { s: [c.A, c.C], alterar: 'servicos' })).toEqual({ passo: 'servicos', marcados: [c.A, c.C], aviso: null });
    expect(await passo(c, { s: [c.A, outro.C], alterar: 'servicos' })).toEqual({ passo: 'servicos', marcados: [c.A], aviso: null });
  });

  it('CA-2: nenhum profissional faz A e C, mas a escolha segue (não há mais "sem profissional comum")', async () => {
    const c = await criarCenarioTres();
    const v = await passo(c, { s: [c.A, c.C], data: DIA_CHAVE });
    expect(servico(v).indice).toBe(0);
  });
});

describe('CA-8: query inválida, de outro salão ou fora de ordem', () => {
  it('serviço de outro salão, inexistente ou inativo: volta aos serviços com aviso', async () => {
    const c = await criarCenarioTres();
    const outro = await criarCenarioTres();
    const inativo = c.s.servicos.inativoId;
    for (const s of [outro.A, '00000000-0000-4000-8000-000000000000', inativo, [c.A, outro.B]]) {
      expect(await passo(c, { s, data: DIA_CHAVE }), String(s)).toEqual({ passo: 'servicos', marcados: [], aviso: 'servico_indisponivel' });
    }
  });

  it('item com profissional de outro salão: o passo do item, sem horário dele; nada do outro salão aparece', async () => {
    const c = await criarCenarioTres();
    const outro = await criarCenarioTres();
    await db().profissional.update({ where: { id: outro.ana }, data: { nome: 'Exclusiva do Outro' } });
    const v = servico(await passo(c, { s: [c.A, c.C], data: DIA_CHAVE, h0: h(outro.ana, sp(DIA, '09:00')) }));
    // O item 0 não é escolhido (o profissional não é da equipe ativa do salão): passo 1, item 0 pendente.
    expect(v.indice).toBe(1);
    expect(v.pendentes).toEqual([0]);
    expect(JSON.stringify(v)).not.toContain('Exclusiva do Outro');
    // No passo de dados, o item volta ao passo dele com aviso.
    const d = servico(await passo(c, { s: [c.A], data: DIA_CHAVE, h0: h(outro.ana, sp(DIA, '09:00')) }));
    expect(d).toMatchObject({ indice: 0, aviso: 'profissional_indisponivel', horarioPerdidoIso: null });
    expect(JSON.stringify(d)).not.toContain(outro.ana);
  });

  it('item em outra data, fora da grade ou fora da jornada: volta ao passo do item com o horário perdido', async () => {
    const c = await criarCenarioTres();
    for (const inicio of [sp({ ano: 2026, mes: 12, dia: 2 }, '09:00'), sp(DIA, '09:07'), sp(DIA, '22:00')]) {
      const v = servico(await passo(c, { s: [c.A, c.C], data: DIA_CHAVE, h0: h(c.ana, inicio), h1: h(c.carla, sp(DIA, '15:00')) }));
      expect(v, inicio.toISOString()).toMatchObject({ indice: 0, aviso: 'horario_indisponivel', horarioPerdidoIso: inicio.toISOString(), preSelecionado: null });
      expect(v.escolhidos.map((x) => x.indice)).toEqual([1]);
    }
  });
});

describe('passo "dia" (DA-2; D-051 RN-3, RN-4)', () => {
  it('7 dias alinhados a hoje; um dia é oferecido só se CADA serviço tem horário nele; navegação respeita a janela', async () => {
    const c = await criarCenarioTres({ funcionamento: { 2: [['09:00', '18:00']], 3: [['09:00', '18:00']] } });
    // Carla só trabalha às quartas: C só tem horário na quarta; A tem na terça e na quarta.
    await db().jornada.deleteMany({ where: { salaoId: c.s.salaoId, profissionalId: c.carla } });
    await db().jornada.create({ data: { salaoId: c.s.salaoId, profissionalId: c.carla, diaSemana: 3, inicioMin: 540, fimMin: 1080 } });
    const dia = (v: VisaoDoPasso) => {
      if (v.passo !== 'dia') throw new Error(`passo inesperado: ${v.passo}`);
      return v;
    };
    const so = dia(await passo(c, { s: c.A }));
    expect(so.faixa.dias).toHaveLength(7);
    expect([so.faixa.hoje, so.faixa.inicio, so.faixa.fim, so.faixa.anterior, so.faixa.proxima, so.faixa.selecionado]).toEqual([
      '2026-11-20',
      '2026-11-20',
      '2026-11-26',
      null,
      '2026-11-27',
      null,
    ]);
    expect(so.faixa.dias.filter((d) => d.temHorarios).map((d) => d.data)).toEqual(['2026-11-24', '2026-11-25']);
    expect([so.servico.nome, so.total]).toEqual(['A', 1]);
    // Semana 1 (navegada): terça e quarta de novo.
    const semana1 = dia(await passo(c, { s: c.A, de: '2026-11-27' }));
    expect(semana1.faixa.dias.filter((d) => d.temHorarios).map((d) => d.data)).toEqual(['2026-12-01', '2026-12-02']);
    const ambos = dia(await passo(c, { s: [c.A, c.C], de: '2026-11-29' }));
    expect(ambos.faixa.inicio).toBe('2026-11-27');
    expect(ambos.faixa.dias.filter((d) => d.temHorarios).map((d) => d.data)).toEqual(['2026-12-02']);
    expect(ambos.selecao).toMatchObject({ precoTotalCentavos: 9000, servicos: [{ id: c.A, nome: 'A' }, { id: c.C, nome: 'C' }] });

    // Janela de 60 dias: a 9ª semana tem 5 dias e termina na última data.
    const ultima = dia(await passo(c, { s: c.A, de: '2027-01-10' }));
    expect([ultima.faixa.inicio, ultima.faixa.fim, ultima.faixa.dias.length, ultima.faixa.proxima, ultima.faixa.anterior]).toEqual([
      '2027-01-08',
      '2027-01-14',
      7,
      '2027-01-15',
      '2027-01-01',
    ]);
    const nona = dia(await passo(c, { s: c.A, de: '2030-01-01' }));
    expect([nona.faixa.inicio, nona.faixa.fim, nona.faixa.dias.length, nona.faixa.proxima, nona.faixa.anterior]).toEqual([
      '2027-01-15',
      '2027-01-19',
      5,
      null,
      '2027-01-08',
    ]);
  });
});

describe('passo por serviço (RF-3, RN-7, RN-10)', () => {
  it('CA-1/CA-6: cada serviço lista só os profissionais ativos vinculados a ele, com os horários da consulta', async () => {
    const c = await criarCenarioTres({ gradeMin: 30, jornada: [['09:00', '11:00']] });
    await db().profissional.update({ where: { id: c.carla }, data: { ativo: false } });
    await db().servicoProfissional.create({ data: { salaoId: c.s.salaoId, servicoId: c.C, profissionalId: c.bia } });
    const v = servico(await passo(c, { s: [c.A, c.C], data: DIA_CHAVE }));
    expect(v).toMatchObject({ indice: 0, total: 2, servico: { id: c.A, nome: 'A' }, fuso: 'America/Sao_Paulo', data: DIA_CHAVE, vazio: null, proximoEhDados: false });
    expect(v.profissionais.map((p) => p.nome)).toEqual(['Ana', 'Bia']);
    const ctx = criarPublicoContext(c.s.salaoId, c.s.slugAtual);
    const real = await consultarDisponibilidadePorServico(ctx, { servicoIds: [c.A, c.C], de: DIA, ate: DIA, agora: AGORA, calcular: [c.A] });
    if (real.resultado !== 'ok') throw new Error('consulta inesperada');
    expect(v.profissionais.map((p) => p.horarios)).toEqual(real.servicos[0].profissionais.map((p) => p.dias[0].horarios.map((x) => x.inicio.toISOString())));
    expect(v.profissionais[0].horarios).toEqual(['09:00', '09:30', '10:00', '10:30'].map(iso));
    expect(v.pendentes).toEqual([1]);
    // C: Carla inativa sai; Bia (vinculada a C) fica.
    const vc = servico(await passo(c, { s: [c.A, c.C], data: DIA_CHAVE, h0: h(c.ana, sp(DIA, '09:00')) }));
    expect(vc.profissionais.map((p) => p.nome)).toEqual(['Bia']);
    expect(vc.proximoEhDados).toBe(true);
  });

  it('CA-4: os horários do serviço B descontam o item A já escolhido (cliente e mesmo profissional + intervalo)', async () => {
    const c = await criarCenarioTres({ gradeMin: 5, intervaloMin: 10, servicoA: { precoCentavos: 5000, duracaoMin: 60 }, servicoB: { precoCentavos: 7000, duracaoMin: 40 } });
    const v = servico(await passo(c, { s: [c.A, c.B], data: DIA_CHAVE, h0: h(c.ana, sp(DIA, '09:00')) }));
    expect(v.indice).toBe(1);
    const de = (nome: string) => v.profissionais.find((p) => p.nome === nome)!.horarios;
    // Ninguém em (08:20, 10:00) (a cliente está em A); Ana também não em (08:10, 10:10).
    const dentro = (x: string, a: string, b: string) => x > iso(a) && x < iso(b);
    expect(de('Bia').filter((x) => dentro(x, '08:20', '10:00'))).toEqual([]);
    expect(de('Ana').filter((x) => dentro(x, '08:10', '10:10'))).toEqual([]);
    expect(de('Bia')).toContain(iso('10:00'));
    expect(de('Ana')).not.toContain(iso('10:00'));
    expect(de('Ana')).toContain(iso('10:10'));
    // Roteiro: o item A escolhido com o nome da profissional e o fim pela duração atual.
    expect(v.escolhidos).toEqual([
      { indice: 0, servicoId: c.A, servicoNome: 'A', profissionalId: c.ana, profissionalNome: 'Ana', inicioIso: iso('09:00'), fimIso: iso('10:00'), precoCentavos: 5000, duracaoMin: 60 },
    ]);
    expect(v.consulta).toEqual({ s: [c.A, c.B], data: DIA_CHAVE, h: [h(c.ana, sp(DIA, '09:00')), null] });
  });

  it('C3: vazio por conflito (só os itens escolhidos ocupam o dia) × vazio por calendário', async () => {
    const c = await criarCenarioTres({ gradeMin: 30, jornada: [['09:00', '10:00']] });
    // B só com a Ana (09:00–10:00): com A da Ana às 09:00 não cabe nada; sem o item caberia 09:00.
    await db().servicoProfissional.deleteMany({ where: { salaoId: c.s.salaoId, servicoId: c.B, profissionalId: c.bia } });
    const conflito = servico(await passo(c, { s: [c.A, c.B], data: DIA_CHAVE, h0: h(c.ana, sp(DIA, '09:00')) }));
    expect(conflito).toMatchObject({ indice: 1, vazio: 'conflito' });
    // Domingo seguinte sem funcionamento → calendário.
    await definirFuncionamento(c.s.salaoId, { 2: [['09:00', '18:00']] });
    const calendario = servico(await passo(c, { s: [c.B], data: '2026-12-02' }));
    expect(calendario.vazio).toBe('calendario');
    expect(calendario.profissionais.map((p) => [p.nome, p.horarios])).toEqual([['Ana', []]]);
  });

  it('filtro por profissional: só o filtrado; opções com todos os elegíveis; filtro inválido é ignorado', async () => {
    const c = await criarCenarioTres();
    const v = servico(await passo(c, { s: c.A, data: DIA_CHAVE, f: c.bia }));
    expect(v.filtro).toBe(c.bia);
    expect(v.profissionais.map((p) => p.id)).toEqual([c.bia]);
    expect(v.opcoesDeFiltro.map((p) => p.nome)).toEqual(['Ana', 'Bia']);
    for (const f of [c.carla, 'x', '00000000-0000-4000-8000-000000000000']) {
      const x = servico(await passo(c, { s: c.A, data: DIA_CHAVE, f }));
      expect(x.filtro, f).toBeNull();
      expect(x.profissionais).toHaveLength(2);
    }
  });

  it('continuar sem escolher (enviado=k): aviso sem_selecao no mesmo passo', async () => {
    const c = await criarCenarioTres();
    const v = servico(await passo(c, { s: [c.A, c.C], data: DIA_CHAVE, h0: h(c.ana, sp(DIA, '09:00')), enviado: '1' }));
    expect(v).toMatchObject({ indice: 1, aviso: 'sem_selecao' });
  });

  it('CA-9: "Alterar" volta ao passo do item com os outros preservados, pré-seleção e desconto dos outros', async () => {
    const c = await criarCenarioTres();
    const params = { s: [c.A, c.B, c.C], data: DIA_CHAVE, h0: h(c.ana, sp(DIA, '09:00')), h1: h(c.bia, sp(DIA, '10:00')), h2: h(c.carla, sp(DIA, '15:00')) };
    const v = servico(await passo(c, { ...params, alterar: '1' }));
    expect(v).toMatchObject({ indice: 1, alterando: true, preSelecionado: h(c.bia, sp(DIA, '10:00')), proximoEhDados: true, aviso: null, pendentes: [] });
    expect(v.escolhidos.map((x) => x.indice)).toEqual([0, 2]);
    // Os horários de B descontam A (09:00–09:30) e C (15:00–15:45) para qualquer profissional.
    const bia = v.profissionais.find((p) => p.nome === 'Bia')!.horarios;
    expect(bia).not.toContain(iso('09:00'));
    expect(bia).not.toContain(iso('15:00'));
    expect(bia).toContain(iso('10:00'));
    expect(v.consulta.h).toEqual([params.h0, params.h1, params.h2]);
  });

  it('"Alterar" de um item que deixou de estar livre: aviso com o horário perdido, sem pré-seleção', async () => {
    const c = await criarCenarioTres();
    const outra = await reservarPelaPagina(entradaPublica(c, { itens: [itemPublico(c.B, c.bia, sp(DIA, '10:00'))] }), AGORA, { enfileirar });
    expect(outra.resultado).toBe('confirmada');
    const v = servico(await passo(c, { s: [c.A, c.B], data: DIA_CHAVE, h0: h(c.ana, sp(DIA, '09:00')), h1: h(c.bia, sp(DIA, '10:00')), alterar: '1' }));
    expect(v).toMatchObject({ indice: 1, alterando: true, preSelecionado: null, aviso: 'horario_indisponivel', horarioPerdidoIso: iso('10:00') });
  });
});

describe('passo de dados', () => {
  it('todos os itens válidos: roteiro por início, total, uma consulta (6 instruções)', async () => {
    const c = await criarCenarioTres();
    const params = { s: [c.C, c.A, c.B], data: DIA_CHAVE, h0: h(c.carla, sp(DIA, '15:00')), h1: h(c.ana, sp(DIA, '09:00')), h2: h(c.bia, sp(DIA, '10:00')) };
    const ctx = criarPublicoContext(c.s.salaoId, c.s.slugAtual);
    const salao = await carregarSalao(ctx, AGORA);
    const regras = await lerRegrasDaPagina(ctx, AGORA);
    const contador = instalarContadorDeComandos();
    let v: VisaoDoPasso;
    try {
      v = await carregarPasso(ctx, lerPasso(params, regras), { servicos: salao.servicos, equipe: salao.equipe, regras, agora: AGORA });
      expect(contador.contar()).toBe(6);
    } finally {
      await contador.encerrar();
    }
    if (v.passo !== 'dados') throw new Error(`passo inesperado: ${v.passo}`);
    expect(v.itens.map((x) => [x.indice, x.servicoNome, x.profissionalNome, x.inicioIso, x.fimIso])).toEqual([
      [1, 'A', 'Ana', iso('09:00'), iso('09:30')],
      [2, 'B', 'Bia', iso('10:00'), iso('10:45')],
      [0, 'C', 'Carla', iso('15:00'), iso('15:45')],
    ]);
    expect(v.totalCentavos).toBe(16000);
    expect(v.consulta).toEqual({ s: params.s, data: DIA_CHAVE, h: [params.h0, params.h1, params.h2] });
  });

  it('itens que se cruzam (forjados na URL): o primeiro volta ao passo dele', async () => {
    const c = await criarCenarioTres();
    const v = servico(await passo(c, { s: [c.A, c.B], data: DIA_CHAVE, h0: h(c.ana, sp(DIA, '09:00')), h1: h(c.bia, sp(DIA, '09:15')) }));
    expect(v).toMatchObject({ indice: 0, aviso: 'horario_indisponivel', horarioPerdidoIso: iso('09:00') });
    expect(v.consulta.h).toEqual([null, h(c.bia, sp(DIA, '09:15'))]);
  });

  it('profissional desativado depois da escolha: volta ao passo do item com profissional_indisponivel', async () => {
    const c = await criarCenarioTres();
    await db().profissional.update({ where: { id: c.carla }, data: { ativo: false } });
    await db().servicoProfissional.create({ data: { salaoId: c.s.salaoId, servicoId: c.C, profissionalId: c.bia } });
    await definirJornada(c.s.salaoId, c.bia, [['09:00', '19:00']]);
    const v = servico(await passo(c, { s: [c.A, c.C], data: DIA_CHAVE, h0: h(c.ana, sp(DIA, '09:00')), h1: h(c.carla, sp(DIA, '15:00')) }));
    expect(v).toMatchObject({ indice: 1, aviso: 'profissional_indisponivel', horarioPerdidoIso: null });
    expect(v.profissionais.map((p) => p.nome)).toEqual(['Bia']);
  });
});
