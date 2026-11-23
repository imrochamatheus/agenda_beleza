import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { PaginaDoSalao } from '@/app/(publico)/[slug]/_componentes/PaginaDoSalao';
import { ROTAS } from '@/config/navegacao';
import { widgetHumano } from '@/server/protecao/widget';
import { vitrineHabilitada } from '@/server/env';
import { lerPasso } from '@/server/reserva-publica/passos';
import type { ParametrosBrutos } from '@/server/reserva-publica/passos';
import { partesLocais } from '@/server/tempo/fuso';

import { demonstrarReservaAcao } from './acoes';
import {
  EQUIPE_DEMO,
  estadoDaVista,
  FUSO_DEMO,
  JANELA_DEMO,
  passoDoExemplo,
  PERFIL_DEMO,
  PERFIL_VAZIO_DEMO,
  SERVICOS_DEMO,
  visaoDaSemanaVazia,
  visaoDemonstracao,
  visaoDoConflito,
} from './dados';

// Demonstração da página pública de reserva para o E2E sem banco (D-026 §8): o MESMO componente da página
// real, com dados em memória e uma ação que só valida. 404 sem VITRINE_COMPONENTES=true (exceto em next
// dev), lido na requisição, antes de qualquer parâmetro. `?vista=indisponivel`, `?vista=vazio`, `?vista=limitado` e,
// do exemplo da D-050 (Escova, Hidratação e Manicure com Ana, Bia e Carla), `?vista=reescolha` (Hidratação tomada),
// `?vista=confirmada` e `?vista=conflito` (passo de um serviço vazio por conflito). D-051 (régua da semana no
// serviço 0): `?s=…` mostra o passo 0 sem dia, `…&data=` com o dia marcado, `…&de=` outra semana (a última com
// `de` = hoje + 60) e `…&vista=semana-vazia` a mesma semana com todos os dias sem horário.
export const dynamic = 'force-dynamic';

const METADADOS: Metadata = {
  title: 'Reserva (demonstração) · Agenda Beleza',
  robots: { index: false, follow: false },
};

/** Metadados só com a vitrine habilitada (D-009 DEF-2). */
export function generateMetadata(): Metadata {
  return vitrineHabilitada(process.env) ? METADADOS : {};
}

type Props = { searchParams: Promise<ParametrosBrutos> };

export default async function DemonstracaoReserva({ searchParams }: Props) {
  if (!vitrineHabilitada(process.env)) notFound();
  const params = await searchParams;
  const vista = Array.isArray(params.vista) ? params.vista[0] : params.vista;
  const agora = new Date();
  const hoje = partesLocais(agora, FUSO_DEMO).data;
  const chave = crypto.randomUUID();
  const exemplo = vista === 'reescolha' || vista === 'confirmada' ? vista : null;
  const passo = exemplo !== null ? passoDoExemplo(hoje) : lerPasso(params, { hoje, janelaDias: JANELA_DEMO });
  const visao =
    vista === 'limitado'
      ? { passo: 'limitado' as const }
      : vista === 'conflito'
        ? visaoDoConflito(hoje, agora)
        : vista === 'semana-vazia'
          ? visaoDaSemanaVazia(visaoDemonstracao(passo, hoje, agora))
          : visaoDemonstracao(passo, hoje, agora);
  return (
    <PaginaDoSalao
      base={ROTAS.devReserva}
      slug="demonstracao"
      perfil={vista === 'vazio' ? PERFIL_VAZIO_DEMO : PERFIL_DEMO}
      fotos={[]}
      servicos={SERVICOS_DEMO}
      equipe={vista === 'vazio' ? [] : EQUIPE_DEMO}
      decisao={vista === 'indisponivel' ? { disponivel: false, motivo: 'assinatura' } : { disponivel: true }}
      visao={visao}
      humano={widgetHumano(process.env)}
      chave={chave}
      estadoInicial={exemplo !== null ? estadoDaVista(exemplo, hoje, agora, chave) : undefined}
      acao={demonstrarReservaAcao}
    />
  );
}
