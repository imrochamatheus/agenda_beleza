import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { FormularioJornada } from '@/app/painel/profissionais/[id]/jornada/FormularioJornada';
import estilos from '@/app/painel/profissionais/[id]/jornada/Jornada.module.css';
import { VisaoJornada } from '@/app/painel/profissionais/[id]/jornada/VisaoJornada';
import { PanelLayout } from '@/components/layout/PanelLayout';
import { Alert } from '@/components/ui/Alert';
import { ROTAS } from '@/config/navegacao';
import { vitrineHabilitada } from '@/server/env';
import { montarSemana } from '@/server/jornadas/semana';
import { MENSAGENS_JORNADA } from '@/server/jornadas/tipos';

import { demonstrarJornadaAcao } from './acoes';

// Demonstração da jornada para o E2E sem banco (D-015 §3.7, D-11): os MESMOS componentes da página
// real, com uma ação que só valida. Responde 404 sem VITRINE_COMPONENTES=true (exceto em next dev),
// lido na requisição, antes de qualquer parâmetro. Sem banco, sessão, adaptadores nem rede.
export const dynamic = 'force-dynamic';

const METADADOS: Metadata = {
  title: 'Jornada (demonstração) · Agenda Beleza',
  robots: { index: false, follow: false },
};

/** Metadados só com a vitrine habilitada (D-009 DEF-2). */
export function generateMetadata(): Metadata {
  return vitrineHabilitada(process.env) ? METADADOS : {};
}

/** UUID fixo do profissional de demonstração (campo oculto). */
const PROFISSIONAL_DEMONSTRACAO = '00000000-0000-4000-8000-00000000d015';
const NOME = 'Ana Demonstração';
const NOME_SALAO = 'Salão Exemplo';

/** A semana da fábrica de testes: segunda a sábado, 09:00–12:00 e 13:00–18:00. */
const SEMANA_PADRAO = montarSemana(
  [1, 2, 3, 4, 5, 6].flatMap((diaSemana) => [
    { diaSemana, inicioMin: 540, fimMin: 720 },
    { diaSemana, inicioMin: 780, fimMin: 1080 },
  ]),
);

type ModoDemonstracao = 'edicao' | 'leitura' | 'vazia';

/** `?modo=`; ausente, repetido ou desconhecido → 'edicao'. */
function lerModo(params: Record<string, string | string[] | undefined>): ModoDemonstracao {
  const modo = params.modo;
  return modo === 'leitura' || modo === 'vazia' ? modo : 'edicao';
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function DemonstracaoJornada({ searchParams }: Props) {
  // Antes de ler qualquer parâmetro.
  if (!vitrineHabilitada(process.env)) notFound();
  const modo = lerModo(await searchParams);
  const caminho = ROTAS.jornada(PROFISSIONAL_DEMONSTRACAO);
  if (modo === 'edicao') {
    return (
      <PanelLayout papel="gestor" nomeSalao={NOME_SALAO} caminhoAtual={caminho}>
        <div className={estilos.pagina}>
          <h1>Jornada de {NOME}</h1>
          <FormularioJornada acao={demonstrarJornadaAcao} profissionalId={PROFISSIONAL_DEMONSTRACAO} semana={SEMANA_PADRAO} />
        </div>
      </PanelLayout>
    );
  }
  const vazia = modo === 'vazia';
  return (
    <PanelLayout papel="profissional" nomeSalao={NOME_SALAO} caminhoAtual={caminho}>
      <div className={estilos.pagina}>
        <h1>Jornada de {NOME}</h1>
        {vazia ? <Alert variante="aviso">{MENSAGENS_JORNADA.semIntervalos}</Alert> : null}
        <p>{MENSAGENS_JORNADA.somenteLeitura}</p>
        <VisaoJornada semana={vazia ? montarSemana([]) : SEMANA_PADRAO} />
      </div>
    </PanelLayout>
  );
}
