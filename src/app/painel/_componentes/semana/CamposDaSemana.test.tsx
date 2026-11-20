/** @vitest-environment jsdom */
import { createRef } from 'react';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { montarSemana } from '@/server/semana/montagem';

import { CamposDaSemana } from './CamposDaSemana';
import { valoresDaSemana } from './formulario';
import { ResumoDeErros } from './ResumoDeErros';

// D-020 T-7: CamposDaSemana e ResumoDeErros (prefixo, texto do dia vazio, erros associados).

const SEMANA = montarSemana([{ diaSemana: 1, inicioMin: 540, fimMin: 720 }]);

describe('CamposDaSemana', () => {
  it('7 dias de segunda a domingo, "Fechado" no dia vazio, 6 linhas com ids prefixados', () => {
    render(
      <CamposDaSemana prefixoId="funcionamento" idAjuda="ajuda" semana={SEMANA} valores={valoresDaSemana(SEMANA)} erros={{}} textoDiaVazio="Fechado" />,
    );
    const detalhes = [...document.querySelectorAll('details')];
    expect(detalhes).toHaveLength(7);
    expect(detalhes[0].querySelector('summary')!.textContent).toBe('Segunda-feira09:00–12:00');
    expect(detalhes[6].querySelector('summary')!.textContent).toBe('DomingoFechado');
    expect(detalhes.every((d) => !d.open)).toBe(true);
    const inicio = document.getElementById('funcionamento-1-0-inicio') as HTMLInputElement;
    expect(inicio.name).toBe('inicio-1-0');
    expect(inicio.value).toBe('09:00');
    expect(inicio.getAttribute('aria-describedby')).toBe('ajuda');
    expect(document.querySelectorAll('input')).toHaveLength(7 * 6 * 2);
    expect(screen.getAllByRole('group', { name: 'Intervalos de Segunda-feira' })).toHaveLength(1);
  });

  it('erros do dia e da linha associados; dia com erro aberto', () => {
    render(
      <CamposDaSemana
        prefixoId="funcionamento"
        idAjuda="ajuda"
        semana={SEMANA}
        valores={valoresDaSemana(SEMANA)}
        erros={{ dias: { 3: { dia: 'Limite', intervalos: { 1: { intervalo: 'Sobrepõe' }, 2: { inicio: 'Formato' } } } } }}
        textoDiaVazio="Fechado"
      />,
    );
    const quarta = [...document.querySelectorAll('details')][2];
    expect(quarta.open).toBe(true);
    expect(quarta.querySelector('fieldset')!.getAttribute('aria-describedby')).toBe('funcionamento-3-erro');
    expect(document.getElementById('funcionamento-3-erro')!.textContent).toContain('Limite');
    const linha = document.getElementById('funcionamento-3-1-inicio')!;
    expect(linha.getAttribute('aria-describedby')).toBe('ajuda funcionamento-3-1-erro');
    expect(linha.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById('funcionamento-3-1-erro')!.textContent).toContain('Sobrepõe');
    expect(document.getElementById('funcionamento-3-2-inicio')!.getAttribute('aria-invalid')).toBe('true');
  });
});

describe('ResumoDeErros', () => {
  it('alerta focável com título e links; ref para o contêiner', () => {
    const ref = createRef<HTMLDivElement>();
    render(<ResumoDeErros ref={ref} id="r" titulo="Corrija" itens={[{ href: '#a', texto: 'Erro A' }]} />);
    const alerta = screen.getByRole('alert', { name: 'Corrija' });
    expect(ref.current).toBe(alerta);
    expect(alerta.tabIndex).toBe(-1);
    expect(screen.getByRole('link', { name: 'Erro A' }).getAttribute('href')).toBe('#a');
  });
});
