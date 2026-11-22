import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { FormularioEnvio } from '@/app/painel/configuracoes/fotos/FormularioEnvio';
import estilos from '@/app/painel/configuracoes/fotos/Fotos.module.css';
import { ListaFotos } from '@/app/painel/configuracoes/fotos/ListaFotos';
import { ResultadoFotos } from '@/app/painel/configuracoes/fotos/Resultado';
import { resultadoDaAcao, resultadoDoEnvio, TEXTOS_FOTOS } from '@/app/painel/configuracoes/fotos/estado';
import { PanelLayout } from '@/components/layout/PanelLayout';
import { ROTAS } from '@/config/navegacao';
import { vitrineHabilitada } from '@/server/env';
import { ehCodigoAcao, ehCodigoEnvio, LIMITES_FOTO } from '@/server/fotos/tipos';

import { demonstrarAltAcao, demonstrarMoverAcao, demonstrarRemoverAcao } from './acoes';
import { fotosDeExemplo, NOME_DEMONSTRACAO, URL_FOTO_EXEMPLO } from './demonstracao';

// Demonstração das fotos para o E2E sem banco (D-021 §3.6, D-10): os MESMOS componentes da página real,
// com um envio que valida e processa em memória (não grava) e ações que só validam. Responde 404 sem
// VITRINE_COMPONENTES=true (exceto em next dev), lido na requisição, antes de qualquer parâmetro.
// `?n=0..12` escolhe quantas fotos de exemplo (padrão 3).
export const dynamic = 'force-dynamic';

const METADADOS: Metadata = {
  title: 'Fotos do salão (demonstração) · Agenda Beleza',
  robots: { index: false, follow: false },
};

/** Metadados só com a vitrine habilitada. */
export function generateMetadata(): Metadata {
  return vitrineHabilitada(process.env) ? METADADOS : {};
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function DemonstracaoFotos({ searchParams }: Props) {
  // Antes de ler qualquer parâmetro.
  if (!vitrineHabilitada(process.env)) notFound();
  const params = await searchParams;
  const n = typeof params.n === 'string' && /^\d{1,2}$/.test(params.n) ? Math.min(Number(params.n), LIMITES_FOTO.maxFotos) : 3;
  const fotos = fotosDeExemplo(n);
  const envio = ehCodigoEnvio(params.envio) ? params.envio : null;
  const acao = ehCodigoAcao(params.acao) ? params.acao : null;
  const resultado = envio !== null ? resultadoDoEnvio(envio) : acao !== null ? resultadoDaAcao(acao) : null;
  return (
    <PanelLayout aviso={null} papel="gestor" nomeSalao={NOME_DEMONSTRACAO} caminhoAtual={ROTAS.configuracoesFotos}>
      <div className={estilos.pagina}>
        <p className={estilos.voltar}>
          <a href={ROTAS.configuracoes}>Voltar para Configurações</a>
        </p>
        <h1>Fotos do salão</h1>
        {resultado ? <ResultadoFotos variante={resultado.variante} texto={resultado.texto} /> : null}
        <section className={estilos.secao} aria-labelledby="fotos-enviar">
          <h2 id="fotos-enviar">Enviar foto</h2>
          <p className={estilos.contador}>{TEXTOS_FOTOS.contador(fotos.length)}</p>
          <FormularioEnvio action={ROTAS.devFotosEnvio} token={crypto.randomUUID()} total={fotos.length} codigo={envio} />
        </section>
        <section className={estilos.secao} aria-labelledby="fotos-lista">
          <h2 id="fotos-lista">Fotos enviadas</h2>
          <ListaFotos
            fotos={fotos}
            acoes={{ alt: demonstrarAltAcao, mover: demonstrarMoverAcao, remover: demonstrarRemoverAcao }}
            urlDe={() => URL_FOTO_EXEMPLO}
          />
        </section>
      </div>
    </PanelLayout>
  );
}
