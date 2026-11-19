import type { ReactNode } from 'react';

import { NAVEGACAO_ADMIN } from '@/config/navegacao';
import { siteConfig } from '@/lib/site';

import { Estrutura } from './Estrutura';
import estilos from './Layout.module.css';
import { MenuNavegacao } from './MenuNavegacao';

export type AdminLayoutProps = {
  caminhoAtual?: string;
  /** Nome do super admin e "Sair" (E1.5); vazio por padrão. */
  areaUsuario?: ReactNode;
  children: ReactNode;
  /** Rótulo visível que distingue a área da plataforma. */
  rotuloArea?: string;
};

/** Layout do super admin (D-009 RN-12, RN-16). */
export function AdminLayout({
  caminhoAtual,
  areaUsuario,
  children,
  rotuloArea = 'Administração da plataforma',
}: AdminLayoutProps) {
  return (
    <Estrutura
      variante="painel"
      marca={
        <>
          <span className={estilos.nomeMarca}>{siteConfig.name}</span>
          <span className={estilos.nomeSalao}>{rotuloArea}</span>
        </>
      }
      complementoCabecalho={areaUsuario}
      navegacao={
        <MenuNavegacao itens={NAVEGACAO_ADMIN} rotulo="Navegação da administração" caminhoAtual={caminhoAtual} />
      }
    >
      {children}
    </Estrutura>
  );
}
