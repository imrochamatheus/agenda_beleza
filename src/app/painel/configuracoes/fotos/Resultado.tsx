'use client';

import { useEffect, useRef } from 'react';

import { Alert } from '@/components/ui/Alert';
import type { VarianteAlerta } from '@/components/ui/Alert';

import estilos from './Fotos.module.css';

export const ID_RESULTADO_FOTOS = 'resultado-fotos';

/**
 * Resultado do envio ou da ação (D-021 RN-21): anunciado (role do Alert) e focado ao aparecer. Sem
 * JavaScript, o resultado já vem na página do 303/PRG.
 */
export function ResultadoFotos({ variante, texto }: { variante: VarianteAlerta; texto: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, [variante, texto]);
  return (
    <div ref={ref} id={ID_RESULTADO_FOTOS} tabIndex={-1} className={estilos.resultado}>
      <Alert variante={variante}>{texto}</Alert>
    </div>
  );
}
