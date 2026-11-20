import type { Metadata } from 'next';

import { PublicLayout } from '@/components/layout/PublicLayout';
import { MENSAGENS_RECUPERACAO, verificarLinkDeRedefinicao } from '@/server/auth/recuperacao-senha';

import { redefinirSenhaAcao } from './acoes';
import { FormularioRedefinir } from './FormularioRedefinir';

// D-012 RN-14: o token está na URL. O cabeçalho HTTP `Referrer-Policy: strict-origin` desta rota
// (next.config.ts) impede que ele vaze no Referer. Sem meta `referrer` e nunca `no-referrer` (que
// faria o POST sem JS sair com `Origin: null`; D-011 DEF-2). Sem recursos de terceiros.
export const metadata: Metadata = { title: 'Definir nova senha' };

type PaginaRedefinirSenhaProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * /redefinir-senha (D-012 RN-10, D-1, D-18). O GET só verifica o link (nunca consome nem grava).
 * Renderiza SEMPRE o mesmo componente cliente, que decide entre formulário, recusa e sucesso; o
 * estado da ação prevalece sobre o veredito desta página (re-render do POST sem JS). O token só vai
 * para o campo oculto, e só quando o link é válido.
 */
export default async function PaginaRedefinirSenha({ searchParams }: PaginaRedefinirSenhaProps) {
  const { token } = await searchParams;
  const verificacao = await verificarLinkDeRedefinicao(token);
  return (
    <PublicLayout>
      <FormularioRedefinir
        acao={redefinirSenhaAcao}
        token={verificacao.ok && typeof token === 'string' ? token : ''}
        verificacao={verificacao.ok ? 'valido' : 'recusado'}
        mensagemRecusa={MENSAGENS_RECUPERACAO.recusado}
      />
    </PublicLayout>
  );
}
