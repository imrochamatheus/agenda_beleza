import { headers } from 'next/headers';
import type { Metadata } from 'next';

import { PublicLayout } from '@/components/layout/PublicLayout';
import { verificarLink } from '@/server/avaliacoes/servico';
import { configDaProtecao } from '@/server/protecao/config';
import { extrairIp } from '@/server/protecao/ip';
import { widgetHumano } from '@/server/protecao/widget';

import { avaliarAcao } from './acoes';
import { FormularioAvaliacao } from './FormularioAvaliacao';

// D-032: o token está no caminho. Cabeçalhos HTTP desta rota (next.config.ts): `Referrer-Policy:
// strict-origin` (nunca `no-referrer`, que quebra o POST sem JS), `Cache-Control: no-store` e
// `X-Robots-Tag: noindex`. A página nunca dá 404: slug, token e estado inválidos respondem o MESMO
// corpo (RN-4) e nada da reserva (serviço, profissional, data) aparece.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Avaliar atendimento', robots: { index: false, follow: false } };

type Props = { params: Promise<{ slug: string; token: string }> };

export default async function PaginaAvaliar({ params }: Props) {
  const { slug, token } = await params;
  const ip = extrairIp(await headers(), configDaProtecao().proxyHops);
  const v = await verificarLink(slug, token, ip, new Date());
  const valido = v.ok;
  return (
    <PublicLayout>
      <FormularioAvaliacao
        acao={avaliarAcao}
        slug={slug}
        token={valido ? token : ''}
        nomeSalao={valido ? v.nomeSalao : ''}
        verificacao={valido ? 'valido' : v.motivo === 'limite' ? 'limitado' : 'invalido'}
        humano={widgetHumano()}
      />
    </PublicLayout>
  );
}
