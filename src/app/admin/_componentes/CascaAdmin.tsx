import type { ReactNode } from 'react';

import { AdminLayout } from '@/components/layout/AdminLayout';
import { Button } from '@/components/ui/Button';

import { sairAdminAcao } from '../acoes';

/** Layout das telas do admin com "Sair" (POST). Sem menu enquanto o resto do menu não existe. */
export function CascaAdmin({ caminhoAtual, children }: { caminhoAtual: string; children: ReactNode }) {
  return (
    <AdminLayout
      caminhoAtual={caminhoAtual}
      semNavegacao
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
