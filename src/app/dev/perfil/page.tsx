import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { FormularioPerfil } from '@/app/painel/configuracoes/perfil/FormularioPerfil';
import estilos from '@/app/painel/configuracoes/perfil/Perfil.module.css';
import { PanelLayout } from '@/components/layout/PanelLayout';
import { ROTAS } from '@/config/navegacao';
import { vitrineHabilitada } from '@/server/env';
import { VALORES_PERFIL_VAZIOS } from '@/server/salao/perfil-tipos';
import { valoresDoPerfil } from '@/server/salao/perfil-validacao';

import { demonstrarPerfilAcao } from './acoes';
import { NOME_DEMONSTRACAO, PERFIL_DEMONSTRACAO } from './demonstracao';

// Demonstração do perfil público para o E2E sem banco (D-020 §3.9, D-14): o MESMO formulário da página
// real, com uma ação que só valida. Responde 404 sem VITRINE_COMPONENTES=true (exceto em next dev), lido
// na requisição, antes de qualquer parâmetro. `?vazio=1` mostra o perfil vazio.
export const dynamic = 'force-dynamic';

const METADADOS: Metadata = {
  title: 'Perfil público (demonstração) · Agenda Beleza',
  robots: { index: false, follow: false },
};

/** Metadados só com a vitrine habilitada. */
export function generateMetadata(): Metadata {
  return vitrineHabilitada(process.env) ? METADADOS : {};
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function DemonstracaoPerfil({ searchParams }: Props) {
  // Antes de ler qualquer parâmetro.
  if (!vitrineHabilitada(process.env)) notFound();
  const params = await searchParams;
  const valores = params.vazio === '1' ? VALORES_PERFIL_VAZIOS : valoresDoPerfil(PERFIL_DEMONSTRACAO);
  return (
    <PanelLayout papel="gestor" nomeSalao={NOME_DEMONSTRACAO} caminhoAtual={ROTAS.configuracoesPerfil}>
      <div className={estilos.pagina}>
        <p className={estilos.voltar}>
          <a href={ROTAS.configuracoes}>Voltar para Configurações</a>
        </p>
        <h1>Perfil público</h1>
        <FormularioPerfil acao={demonstrarPerfilAcao} valoresIniciais={valores} />
      </div>
    </PanelLayout>
  );
}
