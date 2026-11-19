import type { ReactNode } from 'react';

import { ROTAS } from '@/config/navegacao';
import { siteConfig } from '@/lib/site';

import { Estrutura } from './Estrutura';
import estilos from './Layout.module.css';

export type PublicLayoutProps =
  | { variante?: 'plataforma'; children: ReactNode }
  | { variante: 'salao'; nomeSalao: string; children: ReactNode };

/**
 * Layout público (D-009 RN-12, D-6). Plataforma: marca com link para o início e acesso da equipe.
 * Salão: marca e nome do salão, sem links de equipe (a cliente não tem conta). Os links cabem em
 * 320 px quebrando linha, sem menu móvel (RN-13).
 */
export function PublicLayout(props: PublicLayoutProps) {
  const rodape = (
    <nav aria-label="Informações legais">
      <ul className={estilos.listaLinks}>
        <li>
          <a href={ROTAS.termos}>Termos de Uso</a>
        </li>
        <li>
          <a href={ROTAS.privacidade}>Política de Privacidade</a>
        </li>
      </ul>
    </nav>
  );

  if (props.variante === 'salao') {
    return (
      <Estrutura
        variante="publico"
        marca={
          <>
            <span className={estilos.nomeMarca}>{siteConfig.name}</span>
            <span className={estilos.nomeSalao}>{props.nomeSalao}</span>
          </>
        }
        rodape={rodape}
      >
        {props.children}
      </Estrutura>
    );
  }

  return (
    <Estrutura
      variante="publico"
      marca={
        <a className={estilos.linkMarca} href={ROTAS.inicio}>
          {siteConfig.name}
        </a>
      }
      complementoCabecalho={
        <nav aria-label="Acesso">
          <ul className={estilos.listaLinks}>
            <li>
              <a href={ROTAS.entrar}>Entrar</a>
            </li>
            <li>
              <a href={ROTAS.cadastro}>Criar conta</a>
            </li>
          </ul>
        </nav>
      }
      rodape={rodape}
    >
      {props.children}
    </Estrutura>
  );
}
