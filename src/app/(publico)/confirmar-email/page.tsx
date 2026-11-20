import type { Metadata } from 'next';

import { PublicLayout } from '@/components/layout/PublicLayout';
import { Alert } from '@/components/ui/Alert';
import { ROTAS } from '@/config/navegacao';
import { MENSAGENS_CONFIRMACAO, confirmarEmail } from '@/server/auth/confirmacao-email';

import { reenviarConfirmacaoAcao } from './acoes';
import { FormularioReenvio } from './FormularioReenvio';

// D-15 (revisada na rodada 2): o token está na URL. O cabeçalho HTTP `Referrer-Policy:
// strict-origin` desta rota (next.config.ts) impede que ele vaze no Referer. Sem a meta
// `no-referrer`: ela fazia o navegador enviar `Origin: null` nos POSTs sem JS (DEF-2).
// A página não carrega recursos de terceiros (fontes locais).
export const metadata: Metadata = { title: 'Confirmar e-mail' };

type PaginaConfirmarEmailProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * /confirmar-email (D-011 RN-13, D-6, D-14). Sem `token`: só o formulário de reenvio (sem banco).
 * Com `token` (inclusive vazio ou repetido): consome o link ao abrir e mostra o resultado. O token
 * nunca é ecoado em texto visível nem em URL nova; no reenvio pelo link expirado ele vai por POST.
 */
export default async function PaginaConfirmarEmail({ searchParams }: PaginaConfirmarEmailProps) {
  const { token } = await searchParams;

  if (token === undefined) {
    return (
      <PublicLayout>
        <h1>Reenviar link de confirmação</h1>
        <p>Informe o e-mail usado no cadastro. Se a conta ainda aguarda confirmação, enviaremos um novo link.</p>
        <FormularioReenvio acao={reenviarConfirmacaoAcao} modo="email" />
      </PublicLayout>
    );
  }

  const resultado = await confirmarEmail(token);

  switch (resultado) {
    case 'confirmado':
      return (
        <PublicLayout>
          <h1>E-mail confirmado</h1>
          <Alert variante="sucesso">{MENSAGENS_CONFIRMACAO.confirmado}</Alert>
          <p>
            <a href={ROTAS.entrar}>Entrar</a>
          </p>
        </PublicLayout>
      );
    case 'ja_utilizado':
      return (
        <PublicLayout>
          <h1>Link já utilizado</h1>
          <Alert variante="info">{MENSAGENS_CONFIRMACAO.jaUtilizado}</Alert>
          <p>
            <a href={ROTAS.entrar}>Entrar</a>
          </p>
        </PublicLayout>
      );
    case 'expirado_ou_substituido':
      return (
        <PublicLayout>
          <h1>Link expirado</h1>
          <Alert variante="aviso">{MENSAGENS_CONFIRMACAO.expirado}</Alert>
          <p>Peça um novo link. Ele vale por 24 horas.</p>
          <FormularioReenvio acao={reenviarConfirmacaoAcao} modo="token" token={typeof token === 'string' ? token : ''} />
        </PublicLayout>
      );
    default:
      return (
        <PublicLayout>
          <h1>Link inválido</h1>
          <Alert variante="erro">{MENSAGENS_CONFIRMACAO.invalido}</Alert>
          <p>Informe o e-mail usado no cadastro para receber um novo link.</p>
          <FormularioReenvio acao={reenviarConfirmacaoAcao} modo="email" />
        </PublicLayout>
      );
  }
}
