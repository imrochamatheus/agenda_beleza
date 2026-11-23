import { describe, expect, it } from 'vitest';

import { lerPasso, valorDoItem } from '@/server/reserva-publica/passos';
import type { ParametrosBrutos } from '@/server/reserva-publica/passos';
import { partesLocais } from '@/server/tempo/fuso';

import {
  diaDoExemplo,
  EQUIPE_DEMO,
  estadoDaVista,
  FUSO_DEMO,
  JANELA_DEMO,
  passoDoExemplo,
  SERVICOS_DEMO,
  visaoDemonstracao,
  visaoDoConflito,
} from './dados';

// 2026-12-01 é terça-feira; 12:00 UTC = 09:00 em São Paulo.
const AGORA = new Date('2026-12-01T12:00:00Z');
const HOJE = partesLocais(AGORA, FUSO_DEMO).data;
const [ESCOVA, HIDRATACAO, MANICURE] = SERVICOS_DEMO.map((s) => s.id);
const [ANA, BIA, CARLA] = EQUIPE_DEMO.map((p) => p.id);
const ver = (params: ParametrosBrutos) => visaoDemonstracao(lerPasso(params, { hoje: HOJE, janelaDias: JANELA_DEMO }), HOJE, AGORA);
const DIA = '2026-12-02';
const Z = (hhmm: string) => `${DIA}T${String(Number(hhmm.slice(0, 2)) + 3).padStart(2, '0')}:${hhmm.slice(3)}:00.000Z`;

describe('visaoDemonstracao (D-050)', () => {
  it('serviços: sem parâmetros; serviço desconhecido volta com aviso; "Alterar serviços" marca os escolhidos', () => {
    expect(ver({})).toEqual({ passo: 'servicos', marcados: [], aviso: null });
    expect(ver({ s: '99999999-9999-4999-8999-999999999999', data: DIA })).toEqual({ passo: 'servicos', marcados: [], aviso: 'servico_indisponivel' });
    expect(ver({ s: [ESCOVA, MANICURE], alterar: 'servicos' })).toMatchObject({ passo: 'servicos', marcados: [ESCOVA, MANICURE] });
  });

  it('dias: 14 por página, domingos sem horário, navegação até o fim da janela; dia exige horário em cada serviço', () => {
    const v = ver({ s: [ESCOVA, MANICURE] });
    if (v.passo !== 'data') throw new Error('passo inesperado');
    expect(v.dias).toHaveLength(14);
    expect(v.dias.find((d) => d.data === '2026-12-06')?.temHorarios).toBe(false);
    expect(v.dias.find((d) => d.data === DIA)?.temHorarios).toBe(true);
    expect(v.selecao).toEqual({ servicos: [SERVICOS_DEMO[0], SERVICOS_DEMO[2]], precoTotalCentavos: 13000 });
    expect([v.anterior, v.proxima]).toEqual([null, '2026-12-15']);
    const fim = ver({ s: ESCOVA, de: '2027-01-20' });
    expect(fim.passo === 'data' && [fim.dias.at(-1)?.data, fim.proxima, fim.anterior]).toEqual(['2027-01-30', null, '2027-01-06']);
  });

  it('serviço 1 de 2: profissionais que fazem o serviço, cada um com a sua jornada; o outro fica pendente', () => {
    const v = ver({ s: [ESCOVA, HIDRATACAO], data: DIA });
    if (v.passo !== 'servico') throw new Error('passo inesperado');
    expect([v.indice, v.total, v.pendentes, v.proximoEhDados, v.vazio]).toEqual([0, 2, [1], false, null]);
    expect(v.opcoesDeFiltro.map((p) => p.nome)).toEqual(['Ana', 'Bia']);
    expect(v.profissionais.map((p) => p.horarios[0])).toEqual([Z('09:00'), Z('10:00')]);
    expect(v.profissionais[0].horarios.at(-1)).toBe(Z('17:00'));
  });

  it('hoje respeita a antecedência de 2 h', () => {
    const v = ver({ s: ESCOVA, data: '2026-12-01' });
    expect(v.passo === 'servico' && v.profissionais[0].horarios[0]).toBe('2026-12-01T14:00:00.000Z');
  });

  it('serviço 2 de 2: desconta o item já escolhido (a cliente não está em dois lugares) e aplica o filtro', () => {
    const h0 = valorDoItem(ANA, Z('09:00'));
    const v = ver({ s: [ESCOVA, HIDRATACAO], data: DIA, h0 });
    if (v.passo !== 'servico') throw new Error('passo inesperado');
    expect(v.indice).toBe(1);
    expect(v.escolhidos.map((i) => [i.servicoNome, i.profissionalNome, i.fimIso])).toEqual([['Escova', 'Ana', Z('10:00')]]);
    const carla = v.profissionais.find((p) => p.id === CARLA)!;
    expect(carla.horarios).toContain(Z('08:00'));
    expect(carla.horarios).not.toContain(Z('08:30'));
    expect(carla.horarios).not.toContain(Z('09:30'));
    expect(carla.horarios).toContain(Z('10:00'));
    expect(v.consulta).toEqual({ s: [ESCOVA, HIDRATACAO], data: DIA, h: [h0, null] });
    const filtrada = ver({ s: [ESCOVA, HIDRATACAO], data: DIA, h0, f: CARLA });
    expect(filtrada.passo === 'servico' && [filtrada.filtro, filtrada.profissionais.map((p) => p.nome)]).toEqual([CARLA, ['Carla']]);
  });

  it('domingo: vazio por calendário', () => {
    expect(ver({ s: ESCOVA, data: '2026-12-06' })).toMatchObject({ passo: 'servico', vazio: 'calendario' });
  });

  it('dados: itens por início e total; item que coincide com outro volta ao passo dele com o horário perdido', () => {
    const h0 = valorDoItem(ANA, Z('10:00'));
    const h1 = valorDoItem(CARLA, Z('09:00'));
    const v = ver({ s: [ESCOVA, HIDRATACAO], data: DIA, h0, h1 });
    expect(v).toMatchObject({ passo: 'dados', totalCentavos: 16500, itens: [{ servicoNome: 'Hidratação' }, { servicoNome: 'Escova' }] });
    const cruzado = ver({ s: [ESCOVA, HIDRATACAO], data: DIA, h0, h1: valorDoItem(CARLA, Z('09:30')) });
    expect(cruzado).toMatchObject({ passo: 'servico', indice: 0, aviso: 'horario_indisponivel', horarioPerdidoIso: Z('10:00') });
  });

  it('"Alterar": pré-seleciona o horário atual; horário que não é mais oferecido vira aviso com a hora perdida', () => {
    const h0 = valorDoItem(BIA, Z('10:00'));
    const v = ver({ s: [ESCOVA], data: DIA, h0, alterar: '0' });
    expect(v).toMatchObject({ passo: 'servico', alterando: true, preSelecionado: h0, aviso: null });
    const fora = ver({ s: [ESCOVA], data: DIA, h0: valorDoItem(BIA, Z('09:00')), alterar: '0' });
    expect(fora).toMatchObject({ passo: 'servico', preSelecionado: null, aviso: 'horario_indisponivel', horarioPerdidoIso: Z('09:00') });
  });

  it('item de profissional que não faz o serviço conta como pendente', () => {
    const v = ver({ s: [MANICURE, ESCOVA], data: DIA, h0: valorDoItem(ANA, Z('09:00')) });
    expect(v).toMatchObject({ passo: 'servico', indice: 1, pendentes: [0], escolhidos: [] });
  });
});

describe('vistas do exemplo (Escova 09:00 Ana, Hidratação 10:00 Bia, Manicure 15:00 Carla)', () => {
  it('dia do exemplo: o próximo dia que não é domingo', () => {
    expect(diaDoExemplo(HOJE)).toEqual({ ano: 2026, mes: 12, dia: 2 });
    expect(diaDoExemplo({ ano: 2026, mes: 12, dia: 5 })).toEqual({ ano: 2026, mes: 12, dia: 7 });
  });

  it('o passo do exemplo é o de dados com os três itens', () => {
    expect(visaoDemonstracao(passoDoExemplo(HOJE), HOJE, AGORA)).toMatchObject({ passo: 'dados', totalCentavos: 20500 });
  });

  it('confirmada: resumo por início com os três itens', () => {
    const e = estadoDaVista('confirmada', HOJE, AGORA, 'k');
    expect(e).toMatchObject({ status: 'confirmada', chave: 'k', resumo: { data: DIA, totalCentavos: 20500 } });
    expect(e.resumo?.itens.map((i) => `${i.servicoNome}/${i.profissionalNome}`)).toEqual(['Escova/Ana', 'Hidratação/Bia', 'Manicure/Carla']);
  });

  it('reescolha: Hidratação das 10:00 com a Bia tomada; dados preservados; a Bia perde só 10:00–10:40', () => {
    const e = estadoDaVista('reescolha', HOJE, AGORA, 'k');
    expect(e.status).toBe('horario_indisponivel');
    expect(e.mensagem).toBe(
      'O horário das 10:00 de Hidratação com Bia acabou de ser reservado. Escolha outro horário para este serviço. Os outros serviços e os seus dados continuam aqui.',
    );
    expect(e.valores.nome).toBe('Maria Souza');
    const r = e.reescolha!;
    expect(r.mantidos.map((i) => i.servicoNome)).toEqual(['Escova', 'Manicure']);
    const bia = r.itens[0].profissionais.find((p) => p.id === BIA)!;
    expect(bia.horarios).not.toContain(Z('10:00'));
    expect(bia.horarios).not.toContain(Z('09:30'));
    expect(bia.horarios).toContain(Z('10:45'));
    expect(r.itens[0].profissionais.find((p) => p.id === ANA)!.horarios).toContain(Z('10:00'));
  });

  it('conflito: passo de Hidratação vazio por conflito, com a Escova e a Manicure escolhidas', () => {
    expect(visaoDoConflito(HOJE, AGORA)).toMatchObject({
      passo: 'servico',
      indice: 1,
      vazio: 'conflito',
      escolhidos: [{ servicoNome: 'Escova' }, { servicoNome: 'Manicure' }],
    });
  });
});
