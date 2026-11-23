import { describe, expect, it } from 'vitest';

import type { FaixaDaSemana } from '@/server/reserva-publica/tipos';

import { estadoSemDia, ID_TITULO_FAIXA, propsDaFaixa, rotuloDoDia } from './faixa';

// D-051 §3.6: textos e links da régua, puros (CA-1, CA-2, CA-7, CA-12, CA-16). Rodam em dois TZ (CA-15).
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

/** Semana 3 de uma janela de 60 dias com hoje = 29/11/2026 (domingo): 20/12 a 26/12. */
const FAIXA: FaixaDaSemana = {
  hoje: '2026-11-29',
  inicio: '2026-12-20',
  fim: '2026-12-26',
  dias: ['2026-12-20', '2026-12-21', '2026-12-22', '2026-12-23', '2026-12-24', '2026-12-25', '2026-12-26'].map((data) => ({
    data,
    temHorarios: data !== '2026-12-25',
  })),
  anterior: '2026-12-13',
  proxima: '2026-12-27',
  selecionado: '2026-12-22',
};

describe('rotuloDoDia', () => {
  it('dia da semana pelo domínio e data pelo format.ts; chave inválida volta como veio', () => {
    expect(rotuloDoDia('2026-12-01')).toBe('Terça-feira, 01/12/2026');
    expect(rotuloDoDia('2026-11-29')).toBe('Domingo, 29/11/2026');
    expect(rotuloDoDia('2027-01-02')).toBe('Sábado, 02/01/2027');
    expect(rotuloDoDia('x')).toBe('x');
  });
});

describe('propsDaFaixa (D-051 RN-2, RN-4, RN-10)', () => {
  it('título, período, nav e apoio', () => {
    const p = propsDaFaixa('/bela', [A, B], FAIXA);
    expect(p.idTitulo).toBe(ID_TITULO_FAIXA);
    expect(p.titulo).toBe('Escolha o dia');
    expect(p.periodo).toBe('20/12/2026 a 26/12/2026');
    expect(p.rotuloNavegacao).toBe('Semanas');
    expect(p.apoio).toBe('Um dia aparece disponível quando cada serviço tem ao menos um horário livre nele.');
    expect(p.anterior).toEqual({ href: `/bela?s=${A}&s=${B}&de=2026-12-13#reservar`, rotulo: 'Semana anterior' });
    expect(p.proxima).toEqual({ href: `/bela?s=${A}&s=${B}&de=2026-12-27#reservar`, rotulo: 'Próxima semana' });
  });

  it('cada dia: semana curta, número sem zero, mês curto, rótulo completo, link só com horário e o marcado', () => {
    const dias = propsDaFaixa('/bela', [A, B], FAIXA).dias;
    expect(dias.map((d) => d.semana)).toEqual(['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']);
    expect(dias.map((d) => `${d.dia} ${d.mes}`)).toEqual(['20 dez', '21 dez', '22 dez', '23 dez', '24 dez', '25 dez', '26 dez']);
    expect(dias[2]).toEqual({
      chave: '2026-12-22',
      semana: 'Ter',
      dia: '22',
      mes: 'dez',
      rotulo: 'Terça-feira, 22/12/2026',
      href: `/bela?s=${A}&s=${B}&data=2026-12-22#reservar`,
      atual: true,
    });
    expect(dias[5]).toMatchObject({ rotulo: 'Sexta-feira, 25/12/2026, sem horários', href: null, atual: false });
    expect(dias.filter((d) => d.atual)).toHaveLength(1);
  });

  it('hoje: "Hoje" no lugar do dia da semana e sufixos na ordem fixa (C4)', () => {
    const semana0: FaixaDaSemana = {
      ...FAIXA,
      inicio: '2026-11-29',
      fim: '2026-12-05',
      dias: [
        { data: '2026-11-29', temHorarios: false },
        { data: '2026-11-30', temHorarios: true },
      ],
      anterior: null,
      selecionado: null,
    };
    const [hoje, amanha] = propsDaFaixa('/bela', [A], semana0).dias;
    expect(hoje).toMatchObject({ semana: 'Hoje', dia: '29', mes: 'nov', rotulo: 'Domingo, 29/11/2026, hoje, sem horários', href: null });
    expect(amanha).toMatchObject({ semana: 'Seg', rotulo: 'Segunda-feira, 30/11/2026', href: `/bela?s=${A}&data=2026-11-30#reservar` });
    const comHorario = propsDaFaixa('/bela', [A], { ...semana0, dias: [{ data: '2026-11-29', temHorarios: true }] }).dias[0];
    expect(comHorario.rotulo).toBe('Domingo, 29/11/2026, hoje');
    expect(propsDaFaixa('/bela', [A], semana0).anterior).toBeNull();
  });

  it('nenhum href com chave fora de s|data|de nem dado pessoal (CA-7, CA-16)', () => {
    const p = propsDaFaixa('/bela', [A, B], FAIXA);
    const hrefs = [...p.dias.map((d) => d.href), p.anterior?.href, p.proxima?.href].filter((h): h is string => typeof h === 'string');
    expect(hrefs).toHaveLength(8);
    for (const h of hrefs) {
      expect(h.endsWith('#reservar'), h).toBe(true);
      for (const k of new URL(h, 'http://l').searchParams.keys()) expect(['s', 'data', 'de']).toContain(k);
    }
  });
});

describe('estadoSemDia (D-051 RN-7, RN-9; web-design §6)', () => {
  it('com algum dia disponível: "escolha um dia"', () => {
    expect(estadoSemDia(FAIXA, 'Escova')).toEqual({
      titulo: 'Escolha um dia para ver os horários',
      texto: 'Os horários de Escova aparecem aqui, separados por profissional.',
    });
  });

  it('semana vazia: com próxima, última e única', () => {
    const vazia = { ...FAIXA, dias: FAIXA.dias.map((d) => ({ ...d, temHorarios: false })) };
    const titulo = 'Nenhum dia desta semana tem horário';
    expect(estadoSemDia(vazia, 'Escova')).toEqual({ titulo, texto: 'Veja a próxima semana ou altere os serviços.' });
    expect(estadoSemDia({ ...vazia, proxima: null }, 'Escova')).toEqual({
      titulo,
      texto: 'Esta é a última semana aberta para reservas. Volte à semana anterior ou altere os serviços.',
    });
    expect(estadoSemDia({ ...vazia, proxima: null, anterior: null }, 'Escova')).toEqual({
      titulo,
      texto: 'Não há dias abertos para reservas agora. Altere os serviços ou tente mais tarde.',
    });
  });
});
