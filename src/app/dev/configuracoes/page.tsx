import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import estilos from '@/app/painel/configuracoes/Configuracoes.module.css';
import { FormularioRegras } from '@/app/painel/configuracoes/FormularioRegras';
import { FormularioSlug } from '@/app/painel/configuracoes/FormularioSlug';
import { PanelLayout } from '@/components/layout/PanelLayout';
import { ROTAS } from '@/config/navegacao';
import { vitrineHabilitada } from '@/server/env';
import { opcoesDeFuso } from '@/server/salao/fusos';
import type { ValoresRegras } from '@/server/salao/tipos';

import { demonstrarRegrasAcao, demonstrarSlugAcao } from './acoes';
import {
  FUSO_ALIAS_DEMONSTRACAO,
  FUSO_DEMONSTRACAO,
  NOME_DEMONSTRACAO,
  SLUG_ANTERIOR_DEMONSTRACAO,
  SLUG_ATUAL_DEMONSTRACAO,
} from './demonstracao';

// Demonstração das configurações para o E2E sem banco (D-017 §3.7, D-26): os MESMOS componentes da
// página real, com ações que só validam. Responde 404 sem VITRINE_COMPONENTES=true (exceto em next dev),
// lido na requisição, antes de qualquer parâmetro. `?fuso=alias` grava Brazil/East como fuso atual
// (mostra a opção fora da lista).
export const dynamic = 'force-dynamic';

const METADADOS: Metadata = {
  title: 'Configurações (demonstração) · Agenda Beleza',
  robots: { index: false, follow: false },
};

/** Metadados só com a vitrine habilitada (D-009 DEF-2). */
export function generateMetadata(): Metadata {
  return vitrineHabilitada(process.env) ? METADADOS : {};
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function DemonstracaoConfiguracoes({ searchParams }: Props) {
  // Antes de ler qualquer parâmetro.
  if (!vitrineHabilitada(process.env)) notFound();
  const params = await searchParams;
  const fuso = params.fuso === 'alias' ? FUSO_ALIAS_DEMONSTRACAO : FUSO_DEMONSTRACAO;
  const valores: ValoresRegras = { nome: NOME_DEMONSTRACAO, fuso, grade: '15', antecedencia: '2', janela: '60', intervalo: '0' };
  return (
    <PanelLayout papel="gestor" nomeSalao={NOME_DEMONSTRACAO} caminhoAtual={ROTAS.configuracoes}>
      <div className={estilos.pagina}>
        <h1>Configurações</h1>
        <section className={estilos.secao} aria-labelledby="config-dados">
          <h2 id="config-dados">Dados e regras de horário</h2>
          <FormularioRegras acao={demonstrarRegrasAcao} valoresIniciais={valores} fusos={opcoesDeFuso(fuso)} />
        </section>
        <section className={estilos.secao} aria-labelledby="config-endereco">
          <h2 id="config-endereco">Endereço público</h2>
          <FormularioSlug acao={demonstrarSlugAcao} slugAtual={SLUG_ATUAL_DEMONSTRACAO} anteriores={[SLUG_ANTERIOR_DEMONSTRACAO]} />
        </section>
      </div>
    </PanelLayout>
  );
}
