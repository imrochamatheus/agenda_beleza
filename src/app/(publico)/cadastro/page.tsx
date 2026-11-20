import type { Metadata } from 'next';

import { PublicLayout } from '@/components/layout/PublicLayout';

import { cadastrarAcao } from './acoes';
import { FormularioCadastro } from './FormularioCadastro';

export const metadata: Metadata = { title: 'Criar conta do salão' };

/** /cadastro (D-011 RN-20): o gestor cria a própria conta e o salão. Não consulta banco nem sessão. */
export default function PaginaCadastro() {
  return (
    <PublicLayout>
      <h1>Criar conta do salão</h1>
      <p>Informe seus dados e o nome do salão. Enviaremos um link para confirmar o seu e-mail.</p>
      <FormularioCadastro acao={cadastrarAcao} />
    </PublicLayout>
  );
}
