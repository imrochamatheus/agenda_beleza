import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { DetalheDaReserva } from '@/app/painel/agenda/_componentes/DetalheDaReserva';
import { TotalDaReserva } from '@/app/painel/agenda/_componentes/TotalDaReserva';
import { AcoesDaReserva } from '@/app/painel/agenda/reservas/[id]/AcoesDaReserva';
import { lerAbertura, lerResultadoPrg, mensagemDoResultado } from '@/app/painel/agenda/reservas/[id]/estado';
import { montarAcoes } from '@/app/painel/agenda/reservas/[id]/montagem';
import { PanelLayout } from '@/components/layout/PanelLayout';
import { ROTAS } from '@/config/navegacao';
import { vitrineHabilitada } from '@/server/env';

import { demonstrarCancelarAcao, demonstrarCancelarTodosAcao, demonstrarMarcarAcao, demonstrarRemarcarAcao } from './acoes';
import { baseDaVista, detalheDemo, lerVista, NOME_SALAO_DEMO, PROFISSIONAIS_DEMO, SERVICOS_DEMO } from './demonstracao';

// Demonstração das ações por item da reserva para o E2E sem banco (D-030; D-050 web-design §5.10): os MESMOS
// componentes e a MESMA montagem do detalhe real, com ações que só validam. 404 sem VITRINE_COMPONENTES=true
// (exceto em next dev), lido na requisição. `?vista=futura|iniciada|profissional|cancelada` escolhe o estado;
// `?remarcar=<itemId>`, `?cancelar=<itemId>` e `?cancelar=todos` abrem os formulários; `?resultado=` é o PRG.
export const dynamic = 'force-dynamic';

const METADADOS: Metadata = { title: 'Ações da reserva (demonstração) · Agenda Beleza', robots: { index: false, follow: false } };

export function generateMetadata(): Metadata {
  return vitrineHabilitada(process.env) ? METADADOS : {};
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function DemonstracaoReservaAcoes({ searchParams }: Props) {
  if (!vitrineHabilitada(process.env)) notFound();
  const params = await searchParams;
  const vista = lerVista(params.vista);
  const reserva = detalheDemo(vista, new Date());
  const abrir = lerAbertura(params, reserva);
  const dados = montarAcoes({ reserva, abrir, servicos: SERVICOS_DEMO, profissionais: PROFISSIONAIS_DEMO });
  return (
    <PanelLayout aviso={null} papel={reserva.papel} nomeSalao={NOME_SALAO_DEMO} caminhoAtual={ROTAS.agenda}>
      <DetalheDaReserva
        reserva={reserva}
        hrefVoltar={ROTAS.devAgenda}
        mensagens={[]}
        resultado={mensagemDoResultado(lerResultadoPrg(params), reserva)}
        roteiro={
          <AcoesDaReserva
            key={`${abrir.remarcar ?? ''}|${abrir.cancelar ?? ''}|${abrir.cancelarTodos}`}
            reservaId={reserva.id}
            hrefBase={baseDaVista(vista)}
            {...dados}
            rodape={<TotalDaReserva reserva={reserva} />}
            acaoRemarcar={demonstrarRemarcarAcao}
            acaoCancelar={demonstrarCancelarAcao}
            acaoMarcar={demonstrarMarcarAcao}
            acaoCancelarTodos={demonstrarCancelarTodosAcao}
          />
        }
      />
    </PanelLayout>
  );
}
