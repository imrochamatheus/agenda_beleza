import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';

import { ROTAS } from '@/config/navegacao';
import { carregarPasso, carregarSalao, lerRegrasDaPagina } from '@/server/reserva-publica/pagina';
import { lerPasso, slugPlausivel } from '@/server/reserva-publica/passos';
import type { ParametrosBrutos } from '@/server/reserva-publica/passos';
import type { VisaoDoPasso } from '@/server/reserva-publica/tipos';
import { lerPerfilPublico, resolverSalaoPorSlug } from '@/server/repos/publico';
import { NaoEncontrado } from '@/server/tenant/erros';

import { reservarAcao } from './acoes';
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
  const [salao, regras] = await Promise.all([carregarSalao(ctx, agora), lerRegrasDaPagina(ctx, agora)]);
  const base = ROTAS.salaoPublico(resolucao.slugAtual);
  const passo = lerPasso(consulta, regras);
  const visao: VisaoDoPasso = salao.decisao.disponivel
    ? await carregarPasso(ctx, passo, { servicos: salao.servicos, regras, agora })
    : { passo: 'servicos', aviso: null };

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
      acao={reservarAcao}
    />
  );
}
