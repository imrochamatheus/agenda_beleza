import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { PublicLayout } from '@/components/layout/PublicLayout';
import { vitrineHabilitada } from '@/server/env';
import { widgetHumano } from '@/server/protecao/widget';
import { FormularioAvaliacao } from '@/app/(publico)/[slug]/avaliar/[token]/FormularioAvaliacao';

import { demonstrarAvaliacaoAcao } from './acoes';

// Demonstração do formulário de avaliação para o E2E sem banco (D-032): o MESMO componente da rota com
// token, com ação que só valida. `?vista=invalido` mostra a resposta uniforme. 404 sem
// VITRINE_COMPONENTES=true (exceto em next dev), lido na requisição.
export const dynamic = 'force-dynamic';

const METADADOS: Metadata = { title: 'Avaliação (demonstração) · Agenda Beleza', robots: { index: false, follow: false } };

export function generateMetadata(): Metadata {
  return vitrineHabilitada(process.env) ? METADADOS : {};
}

type Props = { searchParams: Promise<{ vista?: string | string[] }> };

export default async function DemonstracaoAvaliacao({ searchParams }: Props) {
  if (!vitrineHabilitada(process.env)) notFound();
  const { vista } = await searchParams;
  const invalido = vista === 'invalido';
  return (
    <PublicLayout>
      <FormularioAvaliacao
        acao={demonstrarAvaliacaoAcao}
        slug="salao-demo"
        token={invalido ? '' : 'demonstracao'}
        nomeSalao="Salão Demonstração"
        verificacao={invalido ? 'invalido' : 'valido'}
        humano={widgetHumano()}
      />
    </PublicLayout>
  );
}
