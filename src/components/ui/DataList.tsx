import { Fragment } from 'react';
import type { ReactNode } from 'react';

import estilos from './DataList.module.css';
import { EmptyState } from './EmptyState';

export type Coluna<T> = {
  chave: string;
  rotulo: string;
  renderizar: (linha: T) => ReactNode;
  /** Classe extra da célula (ex.: `min-width: max-content` da coluna de selos). */
  classeCelula?: string;
};

export type DataListProps<T> = {
  /** Nome acessível (<caption>), sempre presente; visualmente oculto se legendaVisivel=false. */
  legenda: string;
  legendaVisivel?: boolean;
  colunas: readonly Coluna<T>[];
  linhas: readonly T[];
  chaveDaLinha: (linha: T) => string;
  /** Sem linhas, mostra isto (padrão: EmptyState "Nada por aqui ainda."). */
  vazio?: ReactNode;
  /**
   * Linha de detalhe em largura total logo abaixo da linha (D-045): `<tr><td colSpan>` em 48rem ou mais;
   * abaixo disso, um bloco do mesmo cartão. `null` = sem detalhe para a linha. Sem a prop, o DOM é idêntico.
   */
  detalhe?: (linha: T) => ReactNode | null;
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
  detalhe,
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
        {linhas.map((linha) => {
          const extra = detalhe?.(linha) ?? null;
          return (
            <Fragment key={chaveDaLinha(linha)}>
              <tr className={extra === null ? estilos.linha : `${estilos.linha} ${estilos.comDetalhe}`}>
                {colunas.map((coluna) => (
                  <td key={coluna.chave} className={coluna.classeCelula ? `${estilos.celula} ${coluna.classeCelula}` : estilos.celula}>
                    <span className={estilos.rotuloCelula} aria-hidden="true">
                      {coluna.rotulo}
                    </span>
                    <span className={estilos.valor}>{coluna.renderizar(linha)}</span>
                  </td>
                ))}
              </tr>
              {extra === null ? null : (
                <tr className={estilos.linhaDetalhe}>
                  <td colSpan={colunas.length} className={estilos.celulaDetalhe}>
                    {extra}
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
