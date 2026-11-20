import { describe, expect, it } from 'vitest';

import * as montagem from '@/server/semana/montagem';
import { LIMITES_SEMANA, MENSAGENS_INTERVALO } from '@/server/semana/tipos';
import * as nucleo from '@/server/semana/validacao';

import * as semana from './semana';
import { DIAS_SEMANA, LIMITES_JORNADA, MENSAGENS_JORNADA, ORDEM_EXIBICAO_DIAS } from './tipos';
import { converterHorario } from './validacao';

// D-020 T-1 (CA-19, R-1): as fachadas da jornada mantêm a mesma API e os mesmos textos de antes da
// extração do núcleo da semana. Cópias literais dos valores da D-015.

const MENSAGENS_D015 = {
  formato: 'Use o formato HH:MM, de 00:00 a 24:00 (ex.: 09:00).',
  granularidade: 'Use minutos múltiplos de 5 (ex.: 09:05).',
  inicio24: 'O início vai até 23:55. 24:00 só pode ser fim.',
  faltaInicio: 'Informe também o início.',
  faltaFim: 'Informe também o fim.',
  ordem:
    'O fim precisa ser depois do início. Para passar da meia-noite, termine às 24:00 e continue no dia seguinte a partir de 00:00.',
  sobreposicao: 'Este intervalo se sobrepõe a outro do mesmo dia.',
  limite: 'Use no máximo 6 intervalos por dia.',
  formulario: 'Não foi possível ler os dados enviados. Recarregue a página e tente de novo.',
  resumoErros: 'Corrija os campos indicados para salvar a jornada.',
  ajudaHorario:
    'Horário local do salão, no formato HH:MM, em múltiplos de 5 minutos. Use 24:00 para meia-noite no fim do dia. Linhas vazias são ignoradas.',
  salva: 'Jornada salva.',
  demonstracao: 'Jornada válida (demonstração: nada foi gravado).',
  semIntervalos: 'Sem nenhum intervalo na semana, este profissional não terá horários disponíveis para reserva.',
  inativo: 'Profissional inativo: esta jornada só passa a valer quando ele for reativado.',
  somenteLeitura: 'Só o gestor do salão altera a jornada.',
  folga: 'Folga',
  naoEncontrado: 'Profissional não encontrado.',
  acessoNegado: 'Acesso negado.',
};

describe('fachadas da jornada (CA-19)', () => {
  it('MENSAGENS_JORNADA: mesmo conjunto de chaves e mesmos textos da D-015; congelado', () => {
    expect({ ...MENSAGENS_JORNADA }).toEqual(MENSAGENS_D015);
    expect(Object.keys(MENSAGENS_JORNADA).sort()).toEqual(Object.keys(MENSAGENS_D015).sort());
    expect(Object.isFrozen(MENSAGENS_JORNADA)).toBe(true);
  });

  it('MENSAGENS_INTERVALO é o subconjunto genérico, com os mesmos textos', () => {
    for (const [k, v] of Object.entries(MENSAGENS_INTERVALO)) {
      expect(MENSAGENS_JORNADA[k as keyof typeof MENSAGENS_JORNADA], k).toBe(v);
    }
  });

  it('LIMITES_JORNADA: valores da D-015 e o mesmo objeto do núcleo', () => {
    expect({ ...LIMITES_JORNADA }).toEqual({
      intervalosPorDia: 6,
      linhasPorDia: 6,
      linhasRecebidasMax: 20,
      passoMin: 5,
      fimMax: 1440,
      horarioMaxCaracteres: 10,
    });
    expect(LIMITES_JORNADA).toBe(LIMITES_SEMANA);
  });

  it('dias e funções reexportados do núcleo', () => {
    expect(DIAS_SEMANA).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(ORDEM_EXIBICAO_DIAS).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(converterHorario).toBe(nucleo.converterHorario);
    expect(semana.montarSemana).toBe(montagem.montarSemana);
    expect(semana.pausasDe).toBe(montagem.pausasDe);
    expect(semana.diferenca).toBe(montagem.diferenca);
  });
});
