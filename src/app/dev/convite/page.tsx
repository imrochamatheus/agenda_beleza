import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { FormularioConvite } from '@/app/(publico)/convite/[token]/FormularioConvite';
import { PublicLayout } from '@/components/layout/PublicLayout';
import { MENSAGENS_CONVITE } from '@/server/auth/convite';
import { vitrineHabilitada } from '@/server/env';

import { demonstrarConviteAcao } from './acoes';

// Demonstração do aceite do convite para o E2E sem banco (D-039): o MESMO componente de /convite/[token],
// com ação que só valida a senha. `?vista=recusado` mostra a recusa. 404 sem VITRINE_COMPONENTES=true
// (exceto em next dev), lido na requisição.
export const dynamic = 'force-dynamic';

const METADADOS: Metadata = {
  title: 'Convite (demonstração) · Agenda Beleza',
  robots: { index: false, follow: false },
};

/** Metadados só com a vitrine habilitada (D-009 DEF-2). */
export function generateMetadata(): Metadata {
  return vitrineHabilitada(process.env) ? METADADOS : {};
}

export default async function DemonstracaoConvite({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!vitrineHabilitada(process.env)) notFound();
  const { vista } = await searchParams;
  return (
    <PublicLayout>
      <FormularioConvite
        acao={demonstrarConviteAcao}
        token="demonstracao"
        verificacao={vista === 'recusado' ? 'recusado' : 'valido'}
        mensagemRecusa={MENSAGENS_CONVITE.recusado}
      />
    </PublicLayout>
  );
}
