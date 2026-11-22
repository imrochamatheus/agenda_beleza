import { Suspense } from 'react';
import type { ReactNode } from 'react';

import { itensDoPainel } from '@/config/navegacao';
import { siteConfig } from '@/lib/site';
import type { PapelDeSalao } from '@/server/tenant/context';

import { AvisoDoPlano } from '@/app/painel/_aviso/AvisoDoPlano';
import { Estrutura } from './Estrutura';
import estilos from './Layout.module.css';
import { MenuNavegacao } from './MenuNavegacao';

export type PanelLayoutProps = {
  /** Vem da sessão no servidor (E1.2). Fora do tipo → nenhum item (falha fechada). */
  papel: PapelDeSalao;
  nomeSalao: string;
  /** Caminho atual para o aria-current; padrão: usePathname(). */
  caminhoAtual?: string;
  /** Nome do usuário e "Sair" (E1.2); vazio por padrão. */
  areaUsuario?: ReactNode;
  /**
   * Faixa do plano (D-038). Omitida: componente servidor `AvisoDoPlano` (estado do salão da sessão).
   * Informada (inclusive `null`): substitui a leitura (vitrines e testes sem banco).
   */
  aviso?: ReactNode;
  children: ReactNode;
};

/**
 * Layout do painel do salão (D-009 RN-12, RN-16). A navegação por papel é só interface: a
 * autorização continua no servidor.
 */
export function PanelLayout({ papel, nomeSalao, caminhoAtual, areaUsuario, aviso, children }: PanelLayoutProps) {
  return (
    <Estrutura
      variante="painel"
      marca={
        <>
          <span className={estilos.nomeMarca}>{siteConfig.name}</span>
          <span className={estilos.nomeSalao}>{nomeSalao}</span>
        </>
      }
      complementoCabecalho={areaUsuario}
      navegacao={
        <MenuNavegacao itens={itensDoPainel(papel)} rotulo="Navegação do painel" caminhoAtual={caminhoAtual} />
      }
    >
      {aviso === undefined ? (
        <Suspense fallback={null}>
          <AvisoDoPlano papel={papel} />
        </Suspense>
      ) : (
        aviso
      )}
      {children}
    </Estrutura>
  );
}
