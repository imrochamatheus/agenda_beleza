import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { FormularioAssinar } from '@/app/painel/assinatura/FormularioAssinar';
import { ResumoDaAssinatura } from '@/app/painel/assinatura/Resumo';
import { resumoDoPlano } from '@/app/painel/assinatura/plano';
import { PanelLayout } from '@/components/layout/PanelLayout';
import { ROTAS } from '@/config/navegacao';
import { rotuloDeSituacao } from '@/server/assinatura/rotulos';
import { vitrineHabilitada } from '@/server/env';

import { demonstrarAssinarAcao } from './acoes';

// Demonstração da assinatura para o E2E sem banco (D-040): os MESMOS componentes da página real, com a
// situação escolhida por `?situacao=` e uma ação que não chama provedor. 404 sem VITRINE_COMPONENTES=true
// (exceto em next dev), lido na requisição, antes de qualquer parâmetro.
export const dynamic = 'force-dynamic';

const METADADOS: Metadata = {
  title: 'Assinatura (demonstração) · Agenda Beleza',
  robots: { index: false, follow: false },
};

export function generateMetadata(): Metadata {
  return vitrineHabilitada(process.env) ? METADADOS : {};
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function DemonstracaoAssinatura({ searchParams }: Props) {
  if (!vitrineHabilitada(process.env)) notFound();
  const { situacao } = await searchParams;
  const estado = situacao === 'pendente' ? 'pendente' : situacao === 'em_teste' ? 'em_teste' : 'sem_assinatura';
  const podeAssinar = estado !== 'em_teste';
  return (
    <PanelLayout aviso={null} papel="gestor" nomeSalao="Salão de demonstração" caminhoAtual={ROTAS.assinatura}>
      <ResumoDaAssinatura
        situacao={rotuloDeSituacao(estado)}
        formulario={podeAssinar ? <FormularioAssinar acao={demonstrarAssinarAcao} resumo={resumoDoPlano()} /> : null}
      />
    </PanelLayout>
  );
}
