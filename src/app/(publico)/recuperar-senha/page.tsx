import type { Metadata } from 'next';

import { PublicLayout } from '@/components/layout/PublicLayout';

import { solicitarRecuperacaoAcao } from './acoes';
import { FormularioRecuperar } from './FormularioRecuperar';

export const metadata: Metadata = { title: 'Recuperar senha' };

/** /recuperar-senha (D-012 RN-7, RN-18): pedido do link por e-mail. Não consulta banco nem sessão. */
export default function PaginaRecuperarSenha() {
  return (
    <PublicLayout>
      <h1>Recuperar senha</h1>
      <p>Informe o e-mail da sua conta. Se ele estiver cadastrado, enviaremos um link para você definir uma nova senha.</p>
      <FormularioRecuperar acao={solicitarRecuperacaoAcao} />
    </PublicLayout>
  );
}
