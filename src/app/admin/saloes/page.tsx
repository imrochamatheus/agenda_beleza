import type { Metadata } from 'next';

import { ROTAS } from '@/config/navegacao';
import { listarSaloes } from '@/server/admin/saloes';
import { lerFiltros } from '@/server/admin/saloes-validacao';
import { exigirAcessoAoAdmin } from '@/server/auth/admin/pagina';

import { AcessoNegado } from '../_componentes/AcessoNegado';
import { CascaAdmin } from '../_componentes/CascaAdmin';
import { ListaDeSaloes } from './_componentes/ListaDeSaloes';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Salões', robots: { index: false, follow: false } };

type Props = { searchParams: Promise<{ [chave: string]: string | string[] | undefined }> };

/** /admin/saloes (D-044 CA-1): lista de salões; só super admin com TOTP (`exigirAcessoAoAdmin`). */
export default async function PaginaDeSaloes({ searchParams }: Props) {
  const acesso = await exigirAcessoAoAdmin();
  if (acesso.tipo === 'negado') return <AcessoNegado />;
  const filtros = lerFiltros(await searchParams);
  const lista = await listarSaloes(acesso.ctx, filtros);
  return (
    <CascaAdmin caminhoAtual={ROTAS.adminSaloes}>
      <h1>Salões</h1>
      <ListaDeSaloes lista={lista} filtros={filtros} base={ROTAS.adminSaloes} hrefDoSalao={ROTAS.adminSalao} />
    </CascaAdmin>
  );
}
