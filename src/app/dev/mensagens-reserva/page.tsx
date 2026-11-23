import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { SituacaoMensagens } from '@/components/agenda/SituacaoMensagens';
import { PanelLayout } from '@/components/layout/PanelLayout';
import { ROTAS } from '@/config/navegacao';
import { rotuloDaMensagem } from '@/server/mensagens/rotulos';
import type { MensagemSituacao } from '@/server/mensagens/situacao-tipos';
import type { EstadoMensagem, TipoMensagem } from '@/server/mensagens/tipos';
import { vitrineHabilitada } from '@/server/env';

// Vitrine da situação das mensagens (D-043): todos os tipos × estados pelos MESMOS rótulos e componente do
// detalhe da reserva, sem banco. 404 sem VITRINE_COMPONENTES=true (exceto em next dev), lido na requisição.
// `?vista=vazia` mostra o estado sem mensagens. D-050: "substituída por alteração posterior" cobre remarcação,
// cancelamento de item e "cancelar todos" (a substituição é "pendente que deixou de ser vigente").
export const dynamic = 'force-dynamic';

const METADADOS: Metadata = {
  title: 'Mensagens da reserva (demonstração) · Agenda Beleza',
  robots: { index: false, follow: false },
};

export function generateMetadata(): Metadata {
  return vitrineHabilitada(process.env) ? METADADOS : {};
}

const TIPOS: TipoMensagem[] = ['confirmacao', 'remarcacao', 'cancelamento', 'convite_avaliacao'];
const ESTADOS: EstadoMensagem[] = ['enviada', 'pendente', 'enviando', 'falhou', 'nao_enviada', 'cancelada_anonimizacao', 'substituida'];
const CODIGO: Partial<Record<EstadoMensagem, string>> = { nao_enviada: 'sem_consentimento', falhou: 'resultado_incerto' };

function exemplos(): MensagemSituacao[] {
  return TIPOS.flatMap((tipo) =>
    ESTADOS.map((estado) => {
      const codigo = tipo === 'convite_avaliacao' && estado === 'falhou' ? 'link_indisponivel' : (CODIGO[estado] ?? null);
      const tentou = estado === 'enviada' || estado === 'falhou';
      return {
        id: `${tipo}-${estado}`,
        estado,
        ...rotuloDaMensagem({ tipo, revisao: tipo === 'remarcacao' ? 1 : 0, estado, erroCodigo: codigo }),
        tentativas: estado === 'falhou' ? 3 : tentou ? 1 : 0,
        ultimaTentativaEm: tentou ? new Date('2026-11-23T02:35:00Z') : null,
      };
    }),
  );
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function DemonstracaoMensagensReserva({ searchParams }: Props) {
  if (!vitrineHabilitada(process.env)) notFound();
  const { vista } = await searchParams;
  return (
    <PanelLayout aviso={null} papel="gestor" nomeSalao="Salão Exemplo" caminhoAtual={ROTAS.agenda}>
      <h1>Mensagens da reserva</h1>
      <SituacaoMensagens mensagens={vista === 'vazia' ? [] : exemplos()} fuso="America/Sao_Paulo" />
    </PanelLayout>
  );
}
