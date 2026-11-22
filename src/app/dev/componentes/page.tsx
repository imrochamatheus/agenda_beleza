import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AdminLayout } from '@/components/layout/AdminLayout';
import { PanelLayout } from '@/components/layout/PanelLayout';
import { PublicLayout } from '@/components/layout/PublicLayout';
import { vitrineHabilitada } from '@/server/env';

import { lerOpcoesVitrine } from './opcoes';
import { Vitrine } from './Vitrine';

// Vitrine de componentes e layouts (D-009 RN-17), para o E2E e o desenvolvimento local. Responde
// 404 sem VITRINE_COMPONENTES=true (exceto em next dev). O ambiente é lido na requisição: o mesmo
// build serve o E2E (variável ligada) e a produção (404). Sem banco, sessão, adaptadores nem rede.
export const dynamic = 'force-dynamic';

const METADADOS: Metadata = {
  title: 'Vitrine de componentes · Agenda Beleza',
  robots: { index: false, follow: false },
};

/**
 * Metadados só com a vitrine habilitada (D-009 DEF-2): uma `metadata` estática seria resolvida
 * mesmo com notFound() e exporia o título no payload do 404. Desligada, fica só a do layout raiz.
 */
export function generateMetadata(): Metadata {
  return vitrineHabilitada(process.env) ? METADADOS : {};
}

const NOME_SALAO = 'Salão Exemplo';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function VitrineDeComponentes({ searchParams }: Props) {
  // Antes de ler qualquer parâmetro.
  if (!vitrineHabilitada(process.env)) notFound();
  const opcoes = lerOpcoesVitrine(await searchParams);
  const conteudo = <Vitrine />;

  switch (opcoes.layout) {
    case 'publico-salao':
      return (
        <PublicLayout variante="salao" nomeSalao={NOME_SALAO}>
          {conteudo}
        </PublicLayout>
      );
    case 'painel':
      return (
        <PanelLayout aviso={null} papel={opcoes.papel} nomeSalao={NOME_SALAO} caminhoAtual={opcoes.caminho}>
          {conteudo}
        </PanelLayout>
      );
    case 'admin':
      return <AdminLayout caminhoAtual={opcoes.caminho}>{conteudo}</AdminLayout>;
    default:
      return <PublicLayout>{conteudo}</PublicLayout>;
  }
}
