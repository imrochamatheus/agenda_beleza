/** @vitest-environment jsdom */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { montarSemana } from '@/server/jornadas/semana';

import { VisaoJornada } from './VisaoJornada';

// D-015 T-5: CA-12 (somente leitura) e CA-15 (folga), com horários formatados.

describe('VisaoJornada', () => {
  it('CA-12: sem campos nem botão; de segunda a domingo, intervalos, pausas e "Folga"', () => {
    const semana = montarSemana([
      { diaSemana: 1, inicioMin: 540, fimMin: 720 },
      { diaSemana: 1, inicioMin: 780, fimMin: 1080 },
      { diaSemana: 5, inicioMin: 1320, fimMin: 1440 },
    ]);
    const { container } = render(<VisaoJornada semana={semana} />);
    expect(container.querySelector('input, button, textarea, select')).toBeNull();
    const dias = [...container.querySelectorAll('dl > div')];
    expect(dias.map((d) => d.querySelector('dt')!.textContent)).toEqual([
      'Segunda-feira',
      'Terça-feira',
      'Quarta-feira',
      'Quinta-feira',
      'Sexta-feira',
      'Sábado',
      'Domingo',
    ]);
    expect([...dias[0].querySelectorAll('dd')].map((d) => d.textContent)).toEqual([
      '09:00–12:00, 13:00–18:00',
      'Pausa 12:00–13:00',
    ]);
    expect([...dias[4].querySelectorAll('dd')].map((d) => d.textContent)).toEqual(['22:00–24:00']);
    expect([...dias[1].querySelectorAll('dd')].map((d) => d.textContent)).toEqual(['Folga']);
  });

  it('CA-15: semana vazia → todos os dias como folga', () => {
    const { container } = render(<VisaoJornada semana={montarSemana([])} />);
    expect([...container.querySelectorAll('dd')].map((d) => d.textContent)).toEqual(Array(7).fill('Folga'));
  });
});
