import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { DetalheDaReserva } from '@/app/painel/agenda/_componentes/DetalheDaReserva';
import { AcoesDaReserva } from '@/app/painel/agenda/reservas/[id]/AcoesDaReserva';
import { lerResultadoPrg } from '@/app/painel/agenda/reservas/[id]/estado';
import { PanelLayout } from '@/components/layout/PanelLayout';
import { ROTAS } from '@/config/navegacao';
import { formatarDuracao, formatarMinutosDoDia, formatarMoeda } from '@/lib/format';
import { isoDaData } from '@/server/agenda/validacao';
import { vitrineHabilitada } from '@/server/env';
import { acoesPermitidas } from '@/server/reservas/status';
import { partesLocais } from '@/server/tempo/fuso';

import { demonstrarCancelarAcao, demonstrarMarcarAcao, demonstrarRemarcarAcao } from './acoes';
import { detalheDemo, lerVista, PROFISSIONAIS_DEMO } from './demonstracao';
import { NOME_SALAO_DEMO, SERVICOS_DEMO } from '@/app/dev/reserva-nova/demonstracao';

// Demonstração das ações da reserva para o E2E sem banco (D-030): os MESMOS componentes do detalhe real, com
// ações que só validam. 404 sem VITRINE_COMPONENTES=true (exceto em next dev), lido na requisição.
// `?vista=futura|iniciada|concluida|cancelada` escolhe o estado; `?resultado=` é o PRG de sucesso (sem ações).
export const dynamic = 'force-dynamic';

const METADADOS: Metadata = { title: 'Ações da reserva (demonstração) · Agenda Beleza', robots: { index: false, follow: false } };

export function generateMetadata(): Metadata {
  return vitrineHabilitada(process.env) ? METADADOS : {};
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function DemonstracaoReservaAcoes({ searchParams }: Props) {
  if (!vitrineHabilitada(process.env)) notFound();
  const params = await searchParams;
  const resultado = lerResultadoPrg(params.resultado);
  const agora = new Date();
  const reserva = detalheDemo(lerVista(params.vista), agora);
  const local = partesLocais(reserva.inicio, reserva.fuso);
  // Depois de um sucesso a reserva "mudou": nenhuma ação sobra (a vitrine não grava).
  const acoes = resultado
    ? { remarcar: false, cancelar: false, concluir: false, naoCompareceu: false }
    : acoesPermitidas({ status: reserva.status, inicio: reserva.inicio, fim: reserva.fim, agora });
  return (
    <PanelLayout papel="gestor" nomeSalao={NOME_SALAO_DEMO} caminhoAtual={ROTAS.agenda}>
      <DetalheDaReserva reserva={reserva} hrefVoltar={ROTAS.devAgenda} />
      <AcoesDaReserva
        reservaId={reserva.id}
        resultado={resultado}
        acoes={acoes}
        remarcar={{
          valores: {
            data: isoDaData(local.data),
            hora: formatarMinutosDoDia(local.minutosDoDia),
            profissionalId: reserva.profissional.id,
            servicoIds: [SERVICOS_DEMO[0].id],
            confirmarEncaixe: false,
          },
          servicos: SERVICOS_DEMO.map((s) => ({ id: s.id, rotulo: `${s.nome} · ${formatarDuracao(s.duracaoMin)} · ${formatarMoeda(s.precoCentavos)}` })),
          profissionais: PROFISSIONAIS_DEMO.map((p) => ({ valor: p.id, rotulo: p.nome })),
        }}
        acaoRemarcar={demonstrarRemarcarAcao}
        acaoCancelar={demonstrarCancelarAcao}
        acaoMarcar={demonstrarMarcarAcao}
      />
    </PanelLayout>
  );
}
