import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { PublicLayout } from '@/components/layout/PublicLayout';
import { vitrineHabilitada } from '@/server/env';

import { demonstrarConsentimentoAcao } from './acoes';
import { FormularioConsentimento } from './FormularioConsentimento';

// Demonstração das caixas de consentimento para o E2E sem banco (D-023 §3.7): o MESMO componente da
// reserva pública, com ação que só valida. 404 sem VITRINE_COMPONENTES=true (exceto em next dev), lido
// na requisição.
export const dynamic = 'force-dynamic';

const METADADOS: Metadata = {
  title: 'Consentimento (demonstração) · Agenda Beleza',
  robots: { index: false, follow: false },
};

/** Metadados só com a vitrine habilitada (D-009 DEF-2). */
export function generateMetadata(): Metadata {
  return vitrineHabilitada(process.env) ? METADADOS : {};
}

export default function DemonstracaoConsentimento() {
  if (!vitrineHabilitada(process.env)) notFound();
  return (
    <PublicLayout>
      <h1>Consentimento da reserva</h1>
      <p>Demonstração: nada é gravado.</p>
      <FormularioConsentimento acao={demonstrarConsentimentoAcao} />
    </PublicLayout>
  );
}
