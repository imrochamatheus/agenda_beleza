import type { Metadata } from 'next';

import { ErrorState } from '@/components/ui/ErrorState';
import { ROTAS } from '@/config/navegacao';
import { listarAuditoria } from '@/server/admin/auditoria';
import type { ListaAuditoria } from '@/server/admin/auditoria-tipos';
import { exigirAcessoAoAdmin } from '@/server/auth/admin/pagina';
import { ehErroDeDominio } from '@/server/tenant/erros';

import { AcessoNegado } from '../_componentes/AcessoNegado';
import { CascaAdmin } from '../_componentes/CascaAdmin';
import { TelaDeAuditoria } from './_componentes/TelaDeAuditoria';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Auditoria', robots: { index: false, follow: false } };

type Props = { searchParams: Promise<{ [chave: string]: string | string[] | undefined }> };

/** /admin/auditoria (D-045 CA-4/CA-12): consulta somente leitura; só super admin com TOTP. Ler NÃO audita. */
export default async function PaginaDeAuditoria({ searchParams }: Props) {
  const acesso = await exigirAcessoAoAdmin();
  if (acesso.tipo === 'negado') return <AcessoNegado />;
  const sp = await searchParams;
  let lista: ListaAuditoria | null = null;
  try {
    lista = await listarAuditoria(acesso.ctx, sp);
  } catch (e) {
    if (ehErroDeDominio(e)) throw e;
    console.error(JSON.stringify({ evento: 'admin.auditoria.leitura_falhou' }));
  }
  return (
    <CascaAdmin caminhoAtual={ROTAS.adminAuditoria}>
      <h1>Auditoria</h1>
      {lista === null ? (
        <ErrorState titulo="Não foi possível carregar os registros." saida={<a href={ROTAS.adminAuditoria}>Tentar novamente</a>} />
      ) : (
        <TelaDeAuditoria lista={lista} base={ROTAS.adminAuditoria} hrefDoSalao={ROTAS.adminSalao} />
      )}
    </CascaAdmin>
  );
}
