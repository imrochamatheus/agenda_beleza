import type { ReactNode } from 'react';

import { AdminLayout } from '@/components/layout/AdminLayout';
import { Button } from '@/components/ui/Button';
import { NAVEGACAO_ADMIN_DISPONIVEL } from '@/config/navegacao';

import { sairAdminAcao } from '../acoes';

/** Layout das telas do admin com "Sair" (POST) e o menu só com as telas que existem (D-044). */
export function CascaAdmin({ caminhoAtual, children }: { caminhoAtual: string; children: ReactNode }) {
  return (
    <AdminLayout
      caminhoAtual={caminhoAtual}
      itensNavegacao={NAVEGACAO_ADMIN_DISPONIVEL}
      areaUsuario={
        <form action={sairAdminAcao}>
          <Button type="submit" variante="discreta">
            Sair
          </Button>
        </form>
      }
    >
      {children}
    </AdminLayout>
  );
}
