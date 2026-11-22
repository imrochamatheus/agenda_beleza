import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { DetalheDaReserva } from '@/app/painel/agenda/_componentes/DetalheDaReserva';
import { hrefAgenda } from '@/app/painel/agenda/_componentes/links';
import { VistaDaAgenda } from '@/app/painel/agenda/_componentes/VistaDaAgenda';
import { PanelLayout } from '@/components/layout/PanelLayout';
import { ROTAS } from '@/config/navegacao';
import { vitrineHabilitada } from '@/server/env';

import { exemplos, NOME_SALAO_DEMONSTRACAO, vistaDemonstracao } from './demonstracao';

// Demonstração da agenda para o E2E sem banco (D-028): os MESMOS componentes da página real, com dados
// em memória relativos a hoje. 404 sem VITRINE_COMPONENTES=true (exceto em next dev), lido na
// requisição, antes de qualquer parâmetro. `?reserva=<id>` mostra o detalhe; sem ele, a agenda.
export const dynamic = 'force-dynamic';

const METADADOS: Metadata = {
  title: 'Agenda (demonstração) · Agenda Beleza',
  robots: { index: false, follow: false },
};

/** Metadados só com a vitrine habilitada (D-009 DEF-2). */
export function generateMetadata(): Metadata {
  return vitrineHabilitada(process.env) ? METADADOS : {};
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const hrefReserva = (id: string) => `${ROTAS.devAgenda}?reserva=${encodeURIComponent(id)}`;

export default async function DemonstracaoAgenda({ searchParams }: Props) {
  // Antes de ler qualquer parâmetro.
  if (!vitrineHabilitada(process.env)) notFound();
  const params = await searchParams;
  const agora = new Date();
  const reserva = typeof params.reserva === 'string' ? exemplos(agora).detalhes.get(params.reserva) : undefined;
  if (params.reserva !== undefined && !reserva) notFound();
  const vista = reserva ? null : vistaDemonstracao({ data: params.data, visao: params.visao, profissional: params.profissional }, agora);
  if (!reserva && vista === null) notFound();
  return (
    <PanelLayout aviso={null} papel="gestor" nomeSalao={NOME_SALAO_DEMONSTRACAO} caminhoAtual={ROTAS.agenda}>
      {reserva ? (
        <DetalheDaReserva reserva={reserva} hrefVoltar={hrefAgenda(ROTAS.devAgenda, {})} />
      ) : (
        <VistaDaAgenda vista={vista!} base={ROTAS.devAgenda} hrefReserva={hrefReserva} baseNovaReserva={ROTAS.devReservaNova} />
      )}
    </PanelLayout>
  );
}
