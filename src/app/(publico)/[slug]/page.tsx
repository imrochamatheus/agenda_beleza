import { cache } from 'react';
import { headers } from 'next/headers';
import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';

import { ROTAS } from '@/config/navegacao';
import { carregarPassoComLimite, carregarSalao, lerRegrasDaPagina } from '@/server/reserva-publica/pagina';
import { configDaProtecao } from '@/server/protecao/config';
import { extrairIp } from '@/server/protecao/ip';
import { widgetHumano } from '@/server/protecao/widget';
import { lerPasso, slugPlausivel } from '@/server/reserva-publica/passos';
import type { ParametrosBrutos } from '@/server/reserva-publica/passos';
import type { VisaoDoPasso } from '@/server/reserva-publica/tipos';
import { lerPerfilPublico, resolverSalaoPorSlug } from '@/server/repos/publico';
import { NaoEncontrado } from '@/server/tenant/erros';

import { lerAvaliacoesPublicas } from '@/server/avaliacoes/leitura';

import { PARAMETRO_DENUNCIA, VALOR_DENUNCIA_RECEBIDA } from '@/config/denuncia';

import { denunciarAcao, reservarAcao } from './acoes';
import { PaginaDoSalao } from './_componentes/PaginaDoSalao';

// Página pública /<slug> (D-026): dinâmica (searchParams), sem loading.tsx nem Suspense acima do
// redirecionamento, para o 308 ser um status HTTP real e não um meta-refresh (R-1).
type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<ParametrosBrutos>;
};

/** Uma resolução por requisição, compartilhada entre `generateMetadata` e a página. */
const resolver = cache(async (slug: string) => {
  try {
    return await resolverSalaoPorSlug(slug);
  } catch (e) {
    if (e instanceof NaoEncontrado) return null;
    throw e;
  }
});

export async function generateMetadata({ params }: Pick<Props, 'params'>): Promise<Metadata> {
  const { slug } = await params;
  if (!slugPlausivel(slug)) return {};
  const r = await resolver(slug);
  if (!r || r.historico) return {};
  const { nome } = await lerPerfilPublico(r.contexto);
  return { title: `${nome} · Agende online`, description: `Agende seu horário no ${nome}.` };
}

function consultaOriginal(params: ParametrosBrutos): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    for (const x of Array.isArray(v) ? v : v === undefined ? [] : [v]) u.append(k, x);
  }
  const t = u.toString();
  return t === '' ? '' : `?${t}`;
}

export default async function PaginaPublicaDoSalao({ params, searchParams }: Props) {
  const { slug } = await params;
  if (!slugPlausivel(slug)) notFound();
  const resolucao = await resolver(slug);
  if (!resolucao) notFound();
  const consulta = await searchParams;
  if (resolucao.historico) {
    permanentRedirect(`${ROTAS.salaoPublico(resolucao.slugAtual)}${consultaOriginal(consulta)}`);
  }

  const ctx = resolucao.contexto;
  const agora = new Date();
  const [salao, regras, avaliacoes] = await Promise.all([
    carregarSalao(ctx, agora),
    lerRegrasDaPagina(ctx, agora),
    lerAvaliacoesPublicas(ctx),
  ]);
  const base = ROTAS.salaoPublico(resolucao.slugAtual);
  const passo = lerPasso(consulta, regras);
  const visao: VisaoDoPasso = salao.decisao.disponivel
    ? await carregarPassoComLimite(ctx, passo, {
        servicos: salao.servicos,
        equipe: salao.equipe,
        regras,
        agora,
        ip: extrairIp(await headers(), configDaProtecao().proxyHops),
      })
    : { passo: 'servicos', marcados: [], aviso: null };

  return (
    <PaginaDoSalao
      base={base}
      slug={resolucao.slugAtual}
      perfil={salao.perfil}
      fotos={salao.fotos}
      servicos={salao.servicos}
      equipe={salao.equipe}
      decisao={salao.decisao}
      visao={visao}
      chave={crypto.randomUUID()}
      humano={widgetHumano()}
      avaliacoes={avaliacoes}
      denuncia={{ acao: denunciarAcao, recebida: consulta[PARAMETRO_DENUNCIA] === VALOR_DENUNCIA_RECEBIDA }}
      acao={reservarAcao}
    />
  );
}
