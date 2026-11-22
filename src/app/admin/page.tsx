import type { Metadata } from 'next';

import { AdminLayout } from '@/components/layout/AdminLayout';
import { PublicLayout } from '@/components/layout/PublicLayout';
import { Button } from '@/components/ui/Button';
import { NAVEGACAO_ADMIN_DISPONIVEL, ROTAS } from '@/config/navegacao';
import { exigirAcessoAoAdmin } from '@/server/auth/admin/pagina';
import { lerIdentidadeDoAdmin } from '@/server/repos/admin';

import { sairAdminAcao } from './acoes';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Administração', robots: { index: false, follow: false } };

/** /admin mínima (D-034 CA-12): nome do admin e "Sair"; o menu e os atalhos só levam a telas que existem. */
export default async function PaginaAdmin() {
  const acesso = await exigirAcessoAoAdmin();
  if (acesso.tipo === 'negado') {
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
  const identidade = await lerIdentidadeDoAdmin(acesso.ctx.usuarioId);
  return (
    <AdminLayout
      caminhoAtual={ROTAS.admin}
      itensNavegacao={NAVEGACAO_ADMIN_DISPONIVEL}
      areaUsuario={
        <form action={sairAdminAcao}>
          <Button type="submit" variante="discreta">
            Sair
          </Button>
        </form>
      }
    >
      <h1>Olá, {identidade?.nome ?? 'administrador'}</h1>
      <p>{identidade?.email}</p>
      <nav aria-label="Atalhos da administração">
        <ul>
          <li>
            <a href={ROTAS.adminSaloes}>Salões</a>
          </li>
          <li>
            <a href={ROTAS.adminAvaliacoes}>Moderação de avaliações</a>
          </li>
        </ul>
      </nav>
    </AdminLayout>
  );
}
