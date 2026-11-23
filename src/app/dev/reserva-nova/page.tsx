import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { FormularioReservaManual } from '@/app/painel/agenda/nova/FormularioReservaManual';
import estilos from '@/app/painel/agenda/nova/NovaReserva.module.css';
import { valoresIniciais } from '@/app/painel/agenda/nova/pre-preenchimento';
import { PanelLayout } from '@/components/layout/PanelLayout';
import { ROTAS } from '@/config/navegacao';
import { formatarDuracao, formatarMoeda } from '@/lib/format';
import { vitrineHabilitada } from '@/server/env';
import { partesLocais } from '@/server/tempo/fuso';

import { demonstrarReservaManualAcao } from './acoes';
import { ANA_DEMO, FUSO_DEMO, NOME_SALAO_DEMO, PROFISSIONAIS_DEMO, SERVICOS_DEMO } from './demonstracao';
import { estadoDaVista } from './vistas';

// Demonstração da reserva manual para o E2E sem banco (D-029; D-050 §5.8): os MESMOS componentes da página
// real, com uma ação que só valida. 404 sem VITRINE_COMPONENTES=true (exceto em next dev), lido na
// requisição, antes de qualquer parâmetro. `?modo=profissional` mostra a agenda própria (sem seletor);
// `?vista=encaixe`, `?vista=erros` e `?vista=criada` abrem com 3 linhas (vistas.ts).
export const dynamic = 'force-dynamic';

const METADADOS: Metadata = {
  title: 'Nova reserva (demonstração) · Agenda Beleza',
  robots: { index: false, follow: false },
};

/** Metadados só com a vitrine habilitada (D-009 DEF-2). */
export function generateMetadata(): Metadata {
  return vitrineHabilitada(process.env) ? METADADOS : {};
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function DemonstracaoReservaNova({ searchParams }: Props) {
  if (!vitrineHabilitada(process.env)) notFound();
  const params = await searchParams;
  const proprio = params.modo === 'profissional';
  const valores = valoresIniciais(params, {
    profissionaisValidos: PROFISSIONAIS_DEMO.map((p) => p.id),
    fixo: proprio ? ANA_DEMO.id : null,
    hoje: partesLocais(new Date(), FUSO_DEMO).data,
  });
  return (
    <PanelLayout aviso={null} papel={proprio ? 'profissional' : 'gestor'} nomeSalao={NOME_SALAO_DEMO} caminhoAtual={ROTAS.agenda}>
      <div className={estilos.pagina}>
        <h1>Nova reserva</h1>
        <FormularioReservaManual
          acao={demonstrarReservaManualAcao}
          estadoInicial={estadoDaVista(params.vista, crypto.randomUUID(), valores, proprio)}
          servicos={SERVICOS_DEMO.map((s) => ({ id: s.id, nome: s.nome, rotulo: `${s.nome} · ${formatarDuracao(s.duracaoMin)} · ${formatarMoeda(s.precoCentavos)}` }))}
          profissionais={proprio ? null : PROFISSIONAIS_DEMO.map((p) => ({ valor: p.id, rotulo: p.nome }))}
          profissionalFixo={proprio ? ANA_DEMO : undefined}
          fuso={FUSO_DEMO}
        />
      </div>
    </PanelLayout>
  );
}
