'use client';

import type { ReactNode } from 'react';

import { Button } from './Button';
import estilos from './ErrorState.module.css';

export type ErrorStateProps = {
  titulo: string;
  descricao?: ReactNode;
  onTentarNovamente?: () => void;
  rotuloTentarNovamente?: string;
  /** Link de saída (ex.: voltar ao início). */
  saida?: ReactNode;
  /** Padrão h2. */
  nivelTitulo?: 2 | 3;
};

/**
 * Estado de erro (D-009 RN-19), anunciado com role="alert". Só recebe texto, nunca o Error: não
 * há como vazar stack ou código interno.
 */
export function ErrorState({
  titulo,
  descricao,
  onTentarNovamente,
  rotuloTentarNovamente = 'Tentar novamente',
  saida,
  nivelTitulo = 2,
}: ErrorStateProps) {
  const Titulo = nivelTitulo === 3 ? 'h3' : 'h2';
  return (
    <div role="alert" className={estilos.estado}>
      <Titulo className={estilos.titulo}>{titulo}</Titulo>
      {descricao ? <div className={estilos.descricao}>{descricao}</div> : null}
      {onTentarNovamente || saida ? (
        <div className={estilos.acoes}>
          {onTentarNovamente ? (
            <Button variante="secundaria" onClick={() => onTentarNovamente()}>
              {rotuloTentarNovamente}
            </Button>
          ) : null}
          {saida}
        </div>
      ) : null}
    </div>
  );
}
