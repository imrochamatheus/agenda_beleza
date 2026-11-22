import type { Metadata } from 'next';

import { PublicLayout } from '@/components/layout/PublicLayout';
import { MENSAGENS_CONVITE, verificarConvite } from '@/server/auth/convite';

import { aceitarConviteAcao } from './acoes';
import { FormularioConvite } from './FormularioConvite';

// D-039: o token está no CAMINHO. Os cabeçalhos HTTP desta rota (next.config.ts: `Referrer-Policy:
// strict-origin`, `Cache-Control: no-store`, `X-Robots-Tag: noindex`) impedem o vazamento e a indexação.
// Sem meta `referrer` e nunca `no-referrer` (o POST sem JS sairia com `Origin: null`). Sem recursos de
// terceiros. O GET só lê o banco (nunca grava).
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Ativar acesso', robots: { index: false, follow: false } };

/**
 * /convite/[token]. Renderiza SEMPRE o mesmo componente cliente, que decide entre formulário, recusa e
 * sucesso; o estado da ação prevalece sobre o veredito desta página. O token só vai para o campo oculto,
 * e só quando o link é válido.
 */
export default async function PaginaConvite({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const verificacao = await verificarConvite(token);
  return (
    <PublicLayout>
      <FormularioConvite
        acao={aceitarConviteAcao}
        token={verificacao.ok ? token : ''}
        verificacao={verificacao.ok ? 'valido' : 'recusado'}
        mensagemRecusa={MENSAGENS_CONVITE.recusado}
      />
    </PublicLayout>
  );
}
