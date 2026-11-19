import type { ReactNode } from 'react';

import estilos from './EmptyState.module.css';

export type EmptyStateProps = {
  titulo: string;
  descricao?: ReactNode;
  /** Um Button ou link. */
  acao?: ReactNode;
  /** Padrão h2. */
  nivelTitulo?: 2 | 3;
};

/** Estado vazio (D-009 RN-19): título serifado, descrição e ação opcional. */
export function EmptyState({ titulo, descricao, acao, nivelTitulo = 2 }: EmptyStateProps) {
  const Titulo = nivelTitulo === 3 ? 'h3' : 'h2';
  return (
    <div className={estilos.estado}>
      <Titulo className={estilos.titulo}>{titulo}</Titulo>
      {descricao ? <div className={estilos.descricao}>{descricao}</div> : null}
      {acao ? <div className={estilos.acao}>{acao}</div> : null}
    </div>
  );
}
