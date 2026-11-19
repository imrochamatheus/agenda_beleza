/** @vitest-environment jsdom */
import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { montarHorarios, SlotGrid } from './SlotGrid';

const d = (iso: string) => new Date(iso);
const SP = 'America/Sao_Paulo';
const MENOS = '−';

const radios = () => screen.getAllByRole('radio') as HTMLInputElement[];
const nomes = () => radios().map((r) => r.closest('label')!.textContent);

describe('SlotGrid (CA-17, CA-8, RN-21)', () => {
  it('fieldset com legend, ordem crescente, HH:mm no fuso e deduplicação', () => {
    render(
      <SlotGrid
        rotuloGrupo="Horários de terça-feira, 10/03/2026"
        fuso={SP}
        instantes={[d('2026-03-10T14:00:00Z'), d('2026-03-10T13:00:00Z'), d('2026-03-10T13:30:00Z'), d('2026-03-10T13:00:00Z')]}
      />,
    );
    const grupo = screen.getByRole('group', { name: 'Horários de terça-feira, 10/03/2026' });
    expect(grupo.tagName).toBe('FIELDSET');
    expect(nomes()).toEqual(['10:00', '10:30', '11:00']);
    expect(radios().map((r) => r.value)).toEqual([
      '2026-03-10T13:00:00.000Z',
      '2026-03-10T13:30:00.000Z',
      '2026-03-10T14:00:00.000Z',
    ]);
    expect(screen.getByRole('radio', { name: '10:00' })).toBe(radios()[0]);
    expect(new Set(radios().map((r) => r.name)).size).toBe(1);
    expect(radios().every((r) => !r.checked)).toBe(true);
  });

  it('usa FUSO_PADRAO quando o fuso é omitido; outro fuso muda o rótulo', () => {
    const { unmount } = render(<SlotGrid rotuloGrupo="G" instantes={[d('2026-03-10T13:00:00Z')]} />);
    expect(nomes()).toEqual(['10:00']);
    unmount();
    render(<SlotGrid rotuloGrupo="G" fuso="America/Manaus" instantes={[d('2026-03-10T13:00:00Z')]} />);
    expect(nomes()).toEqual(['09:00']);
  });

  it('CA-8: rótulos repetidos ganham o deslocamento UTC nos dois instantes; os demais não', () => {
    render(
      <SlotGrid
        rotuloGrupo="Horários de sábado, 16/02/2019"
        fuso={SP}
        instantes={[d('2019-02-17T02:00:00Z'), d('2019-02-17T01:00:00Z'), d('2019-02-17T00:30:00Z')]}
      />,
    );
    expect(nomes()).toEqual([`22:30`, `23:00 (UTC${MENOS}02:00)`, `23:00 (UTC${MENOS}03:00)`]);
    expect(radios()[1].value).toBe('2019-02-17T01:00:00.000Z');
    expect(radios()[2].value).toBe('2019-02-17T02:00:00.000Z');
  });

  it('não controlado: marca ao escolher e chama o callback com o Date correto', () => {
    const onSelecionar = vi.fn();
    render(
      <SlotGrid
        rotuloGrupo="G"
        fuso={SP}
        name="horario"
        selecionadoInicial={d('2026-03-10T13:00:00Z')}
        onSelecionar={onSelecionar}
        instantes={[d('2026-03-10T13:00:00Z'), d('2026-03-10T13:30:00Z')]}
      />,
    );
    expect(radios()[0].checked).toBe(true);
    expect(radios()[0].name).toBe('horario');
    fireEvent.click(screen.getByText('10:30'));
    expect(radios()[1].checked).toBe(true);
    expect(radios()[0].checked).toBe(false);
    expect(onSelecionar).toHaveBeenCalledTimes(1);
    const recebido = onSelecionar.mock.calls[0][0] as Date;
    expect(recebido).toBeInstanceOf(Date);
    expect(recebido.toISOString()).toBe('2026-03-10T13:30:00.000Z');
  });

  it('não controlado sem callback também funciona', () => {
    render(<SlotGrid rotuloGrupo="G" instantes={[d('2026-03-10T13:00:00Z')]} />);
    fireEvent.click(radios()[0]);
    expect(radios()[0].checked).toBe(true);
  });

  it('controlado: segue a prop selecionado', () => {
    const instantes = [d('2026-03-10T13:00:00Z'), d('2026-03-10T13:30:00Z')];
    function Pai() {
      const [sel, setSel] = useState<Date | null>(null);
      return (
        <>
          <SlotGrid rotuloGrupo="G" instantes={instantes} selecionado={sel} onSelecionar={setSel} />
          <output>{sel ? sel.toISOString() : 'nenhum'}</output>
        </>
      );
    }
    render(<Pai />);
    expect(radios().every((r) => !r.checked)).toBe(true);
    fireEvent.click(radios()[1]);
    expect(radios()[1].checked).toBe(true);
    expect(screen.getByRole('status').textContent).toBe('2026-03-10T13:30:00.000Z');
  });

  it('controlado sem mudança no pai não marca sozinho', () => {
    const instantes = [d('2026-03-10T13:00:00Z')];
    render(<SlotGrid rotuloGrupo="G" instantes={instantes} selecionado={null} onSelecionar={() => {}} />);
    fireEvent.click(radios()[0]);
    expect(radios()[0].checked).toBe(false);
  });

  it('lista vazia: EmptyState padrão, sem fieldset', () => {
    render(<SlotGrid rotuloGrupo="G" instantes={[]} />);
    expect(screen.queryByRole('group')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Nenhum horário disponível nesta data.' })).toBeTruthy();
  });

  it('lista vazia: vazio sobrescrevível', () => {
    render(<SlotGrid rotuloGrupo="G" instantes={[]} vazio={<p>Escolha outra data.</p>} />);
    expect(screen.getByText('Escolha outra data.')).toBeTruthy();
  });

  it('disabled desabilita o grupo', () => {
    render(<SlotGrid rotuloGrupo="G" instantes={[d('2026-03-10T13:00:00Z')]} disabled />);
    const grupo = within(screen.getByRole('group')).getByRole('radio') as HTMLInputElement;
    expect(grupo.matches(':disabled')).toBe(true);
  });

  it('Date inválido é erro de programação (RangeError)', () => {
    expect(() => montarHorarios([new Date('x')], SP)).toThrow(RangeError);
  });

  it('montarHorarios não altera a entrada', () => {
    const entrada = [d('2026-03-10T14:00:00Z'), d('2026-03-10T13:00:00Z')];
    const copia = entrada.map((i) => i.getTime());
    montarHorarios(entrada, SP);
    expect(entrada.map((i) => i.getTime())).toEqual(copia);
  });
});
