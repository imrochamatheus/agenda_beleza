import type { ReactNode } from 'react';

import estilos from './DataList.module.css';
import { EmptyState } from './EmptyState';

export type Coluna<T> = { chave: string; rotulo: string; renderizar: (linha: T) => ReactNode };

export type DataListProps<T> = {
  /** Nome acessível (<caption>), sempre presente; visualmente oculto se legendaVisivel=false. */
  legenda: string;
  legendaVisivel?: boolean;
  colunas: readonly Coluna<T>[];
  linhas: readonly T[];
  chaveDaLinha: (linha: T) => string;
  /** Sem linhas, mostra isto (padrão: EmptyState "Nada por aqui ainda."). */
  vazio?: ReactNode;
};

/**
 * Tabela semântica (D-009 RN-20, D-20). Abaixo de 48rem, as linhas empilham como cartões e cada
 * célula mostra o rótulo da coluna num span aria-hidden (o cabeçalho continua na árvore de
 * acessibilidade). Limitação conhecida: o Safari remove a semântica de tabela com display alterado.
 */
export function DataList<T>({
  legenda,
  legendaVisivel = true,
  colunas,
  linhas,
  chaveDaLinha,
  vazio,
}: DataListProps<T>) {
  if (linhas.length === 0) {
    return <>{vazio ?? <EmptyState titulo="Nada por aqui ainda." nivelTitulo={3} />}</>;
  }
  return (
    <table className={estilos.tabela}>
      <caption className={legendaVisivel ? estilos.legenda : 'visualmente-oculto'}>{legenda}</caption>
      <thead className={estilos.cabecalho}>
        <tr>
          {colunas.map((coluna) => (
            <th key={coluna.chave} scope="col">
              {coluna.rotulo}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {linhas.map((linha) => (
          <tr key={chaveDaLinha(linha)} className={estilos.linha}>
            {colunas.map((coluna) => (
              <td key={coluna.chave} className={estilos.celula}>
                <span className={estilos.rotuloCelula} aria-hidden="true">
                  {coluna.rotulo}
                </span>
                <span className={estilos.valor}>{coluna.renderizar(linha)}</span>
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
