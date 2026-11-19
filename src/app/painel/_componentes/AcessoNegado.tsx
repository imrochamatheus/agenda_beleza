import { PublicLayout } from '@/components/layout/PublicLayout';
import { ROTAS } from '@/config/navegacao';

/** Tela de acesso negado (D-010 RN-17, D-9 opção b): texto fixo, nenhum dado de salão ou usuário. */
export function AcessoNegado() {
  return (
    <PublicLayout>
      <h1>Acesso negado</h1>
      <p>Esta conta não tem acesso ao painel do salão.</p>
      <p>
        <a href={ROTAS.entrar}>Entrar com outra conta</a>
      </p>
    </PublicLayout>
  );
}
