import { PublicLayout } from '@/components/layout/PublicLayout';
import { ROTAS } from '@/config/navegacao';

/** "Acesso negado" das telas do admin para quem tem sessão de salão (D-034 RN-10); sem dado algum. */
export function AcessoNegado() {
  return (
    <PublicLayout>
      <h1>Acesso negado</h1>
      <p>Esta área é exclusiva da administração da plataforma.</p>
      <p>
        <a href={ROTAS.painel}>Voltar ao painel</a>
      </p>
    </PublicLayout>
  );
}
