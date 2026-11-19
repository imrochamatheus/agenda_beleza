import type { ReactNode } from 'react';

import estilos from './Layout.module.css';

/** id do <main> dos layouts: destino do link "Pular para o conteúdo". */
export const ID_CONTEUDO = 'conteudo';

export type EstruturaProps = {
  marca: ReactNode;
  complementoCabecalho?: ReactNode;
  navegacao?: ReactNode;
  rodape?: ReactNode;
  children: ReactNode;
  variante: 'publico' | 'painel';
};

/**
 * Esqueleto comum dos layouts (D-009 RN-12): link de pular (1º focável), header, navegação, um
 * único main focável (tabIndex=-1) e footer opcional. Não lê sessão, cookie nem ambiente.
 */
export function Estrutura({ marca, complementoCabecalho, navegacao, rodape, children, variante }: EstruturaProps) {
  return (
    <div className={estilos.pagina} data-variante={variante}>
      <a className={estilos.pular} href={`#${ID_CONTEUDO}`}>
        Pular para o conteúdo
      </a>
      <header className={estilos.cabecalho}>
        <div className={estilos.marca}>{marca}</div>
        {complementoCabecalho ? <div className={estilos.complemento}>{complementoCabecalho}</div> : null}
      </header>
      <div className={variante === 'painel' ? estilos.corpoPainel : estilos.corpo}>
        {navegacao}
        <main id={ID_CONTEUDO} tabIndex={-1} className={estilos.conteudo}>
          {children}
        </main>
      </div>
      {rodape ? <footer className={estilos.rodape}>{rodape}</footer> : null}
    </div>
  );
}
