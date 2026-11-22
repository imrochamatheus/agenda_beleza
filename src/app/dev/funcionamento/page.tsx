import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AvisoDoFuncionamento } from '@/app/painel/configuracoes/funcionamento/AvisoDoFuncionamento';
import { FormularioFuncionamento } from '@/app/painel/configuracoes/funcionamento/FormularioFuncionamento';
import estilos from '@/app/painel/configuracoes/funcionamento/Funcionamento.module.css';
import { PanelLayout } from '@/components/layout/PanelLayout';
import { ROTAS } from '@/config/navegacao';
import { vitrineHabilitada } from '@/server/env';
import type { Funcionamento } from '@/server/salao/funcionamento-tipos';

import { demonstrarFuncionamentoAcao } from './acoes';
import { FUNCIONAMENTO_DEMONSTRACAO, FUNCIONAMENTO_FECHADO, NOME_DEMONSTRACAO } from './demonstracao';

// Demonstração do horário de funcionamento para o E2E sem banco (D-020 §3.9, D-14): o MESMO formulário
// da página real, com uma ação que só valida. Responde 404 sem VITRINE_COMPONENTES=true (exceto em next
// dev), lido na requisição, antes de qualquer parâmetro. `?modo=nao-informado` e `?modo=fechado` mostram
// os dois avisos.
export const dynamic = 'force-dynamic';

const METADADOS: Metadata = {
  title: 'Horário de funcionamento (demonstração) · Agenda Beleza',
  robots: { index: false, follow: false },
};

/** Metadados só com a vitrine habilitada. */
export function generateMetadata(): Metadata {
  return vitrineHabilitada(process.env) ? METADADOS : {};
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function DemonstracaoFuncionamento({ searchParams }: Props) {
  // Antes de ler qualquer parâmetro.
  if (!vitrineHabilitada(process.env)) notFound();
  const params = await searchParams;
  const funcionamento: Funcionamento =
    params.modo === 'nao-informado' ? { definido: false } : params.modo === 'fechado' ? FUNCIONAMENTO_FECHADO : FUNCIONAMENTO_DEMONSTRACAO;
  return (
    <PanelLayout aviso={null} papel="gestor" nomeSalao={NOME_DEMONSTRACAO} caminhoAtual={ROTAS.configuracoesFuncionamento}>
      <div className={estilos.pagina}>
        <p className={estilos.voltar}>
          <a href={ROTAS.configuracoes}>Voltar para Configurações</a>
        </p>
        <h1>Horário de funcionamento</h1>
        <AvisoDoFuncionamento funcionamento={funcionamento} />
        <FormularioFuncionamento acao={demonstrarFuncionamentoAcao} funcionamento={funcionamento} />
      </div>
    </PanelLayout>
  );
}
