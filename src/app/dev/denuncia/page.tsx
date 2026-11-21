import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { PublicLayout } from '@/components/layout/PublicLayout';
import { PARAMETRO_DENUNCIA, VALOR_DENUNCIA_RECEBIDA } from '@/config/denuncia';
import { vitrineHabilitada } from '@/server/env';
import { widgetHumano } from '@/server/protecao/widget';
import { SecaoAvaliacoes } from '@/app/(publico)/[slug]/_componentes/SecaoAvaliacoes';
import type { AvaliacoesPublicas } from '@/server/avaliacoes/tipos';

import { demonstrarDenunciaAcao } from './acoes';

// Demonstração da denúncia pública de avaliação para o E2E sem banco (D-035): a MESMA seção de avaliações
// da página do salão, com ação que só valida. 404 sem VITRINE_COMPONENTES=true (exceto em next dev), lido
// na requisição.
export const dynamic = 'force-dynamic';

const METADADOS: Metadata = { title: 'Denúncia (demonstração) · Agenda Beleza', robots: { index: false, follow: false } };

export function generateMetadata(): Metadata {
  return vitrineHabilitada(process.env) ? METADADOS : {};
}

const AVALIACOES: AvaliacoesPublicas = {
  total: 12,
  media: 4.6,
  itens: [
    { id: '11111111-1111-4111-8111-111111111111', nome: 'Maria S.', nota: 5, comentario: 'Atendimento ótimo, voltarei.', mesAno: 'novembro de 2026' },
    { id: '22222222-2222-4222-8222-222222222222', nome: 'Ana L.', nota: 4, comentario: null, mesAno: 'outubro de 2026' },
  ],
};

type Props = { searchParams: Promise<{ [chave: string]: string | string[] | undefined }> };

export default async function DemonstracaoDenuncia({ searchParams }: Props) {
  if (!vitrineHabilitada(process.env)) notFound();
  const consulta = await searchParams;
  return (
    <PublicLayout>
      <h1>Denúncia de avaliação (demonstração)</h1>
      <SecaoAvaliacoes
        avaliacoes={AVALIACOES}
        denuncia={{
          acao: demonstrarDenunciaAcao,
          slug: 'salao-demo',
          humano: widgetHumano(),
          recebida: consulta[PARAMETRO_DENUNCIA] === VALOR_DENUNCIA_RECEBIDA,
        }}
      />
    </PublicLayout>
  );
}
