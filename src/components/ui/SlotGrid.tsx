'use client';

import { useId, useMemo, useState, type ReactNode } from 'react';

import { formatarDeslocamentoUtc, formatarHora, FUSO_PADRAO } from '@/lib/format';

import { EmptyState } from './EmptyState';
import estilos from './SlotGrid.module.css';

export type SlotGridProps = {
  /** Inícios disponíveis (UTC), já calculados pela disponibilidade (E3.1). */
  instantes: readonly Date[];
  /** Fuso IANA do salão. Padrão FUSO_PADRAO. */
  fuso?: string;
  /** Legenda do grupo, ex.: 'Horários de terça-feira, 10/03/2026'. */
  rotuloGrupo: string;
  /** Modo controlado (com onSelecionar). */
  selecionado?: Date | null;
  /** Modo não controlado. */
  selecionadoInicial?: Date | null;
  onSelecionar?: (instante: Date) => void;
  /** Nome do grupo de rádios. Padrão: useId(). */
  name?: string;
  /** Padrão: EmptyState "Nenhum horário disponível nesta data." */
  vazio?: ReactNode;
  disabled?: boolean;
};

type Horario = { iso: string; texto: string };

/**
 * Deduplica por instante, ordena e rotula em HH:mm no fuso. Rótulos repetidos (fim de horário de
 * verão) ganham o deslocamento UTC em todos os instantes do grupo (D-21). Date inválido lança
 * RangeError (erro de programação do consumidor; não é filtrado em silêncio).
 */
export function montarHorarios(instantes: readonly Date[], fuso: string): Horario[] {
  const unicos = new Map<number, Date>();
  for (const instante of instantes) {
    if (!unicos.has(instante.getTime())) unicos.set(instante.getTime(), new Date(instante.getTime()));
  }
  const ordenados = [...unicos.values()]
    .sort((a, b) => a.getTime() - b.getTime())
    .map((instante) => ({ instante, rotulo: formatarHora(instante, fuso) }));
  const contagem = new Map<string, number>();
  for (const { rotulo } of ordenados) contagem.set(rotulo, (contagem.get(rotulo) ?? 0) + 1);
  return ordenados.map(({ instante, rotulo }) => ({
    iso: instante.toISOString(),
    texto:
      (contagem.get(rotulo) ?? 0) > 1 ? `${rotulo} (${formatarDeslocamentoUtc(instante, fuso)})` : rotulo,
  }));
}

/**
 * Grade de horários (D-009 RN-21): rádios nativos num fieldset (uma parada de Tab por grupo;
 * setas mudam a seleção). A identidade de cada horário é o instante ISO, nunca o rótulo.
 */
export function SlotGrid({
  instantes,
  fuso = FUSO_PADRAO,
  rotuloGrupo,
  selecionado,
  selecionadoInicial = null,
  onSelecionar,
  name,
  vazio,
  disabled,
}: SlotGridProps) {
  const gerado = useId();
  const nome = name ?? gerado;
  const controlado = selecionado !== undefined;
  const [interno, setInterno] = useState<string | null>(selecionadoInicial?.toISOString() ?? null);
  const atual = controlado ? (selecionado?.toISOString() ?? null) : interno;
  const horarios = useMemo(() => montarHorarios(instantes, fuso), [instantes, fuso]);

  if (horarios.length === 0) {
    return <>{vazio ?? <EmptyState titulo="Nenhum horário disponível nesta data." nivelTitulo={3} />}</>;
  }

  function escolher(iso: string) {
    if (!controlado) setInterno(iso);
    onSelecionar?.(new Date(iso));
  }

  return (
    <fieldset className={estilos.grupo} disabled={disabled}>
      <legend className={estilos.legenda}>{rotuloGrupo}</legend>
      <div className={estilos.grade}>
        {horarios.map((horario) => (
          <label key={horario.iso} className={estilos.horario}>
            <input
              type="radio"
              className={estilos.controle}
              name={nome}
              value={horario.iso}
              checked={atual === horario.iso}
              onChange={() => escolher(horario.iso)}
            />
            <span className={estilos.texto}>{horario.texto}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
