import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ErrorState } from '@/components/ui/ErrorState';
import { ROTAS } from '@/config/navegacao';
import { lerAssinaturaDoSalao } from '@/server/admin/assinatura';
import type { AssinaturaDoSalaoDTO } from '@/server/admin/assinatura-tipos';
import { exigirAcessoAoAdmin } from '@/server/auth/admin/pagina';
import { ehErroDeDominio, NaoEncontrado } from '@/server/tenant/erros';

import { AcessoNegado } from '../../../_componentes/AcessoNegado';
import { CascaAdmin } from '../../../_componentes/CascaAdmin';
import { TelaDeAssinatura } from './_componentes/TelaDeAssinatura';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Assinatura do salão', robots: { index: false, follow: false } };

type Props = { params: Promise<{ id: string }> };

/**
 * /admin/saloes/[id]/assinatura (D-045 CA-1/CA-13): resumo, transições e eventos de webhook do salão. Ordem:
 * 403 (sessão que não é de admin) → 404 (id malformado ou desconhecido). Somente leitura; não audita.
 */
export default async function PaginaDeAssinatura({ params }: Props) {
  const acesso = await exigirAcessoAoAdmin();
  if (acesso.tipo === 'negado') return <AcessoNegado />;
  const { id } = await params;
  let dados: AssinaturaDoSalaoDTO | null = null;
  let naoEncontrado = false;
  try {
    dados = await lerAssinaturaDoSalao(acesso.ctx, id);
  } catch (e) {
    if (e instanceof NaoEncontrado) naoEncontrado = true;
    else if (ehErroDeDominio(e)) throw e;
    else console.error(JSON.stringify({ evento: 'admin.assinatura.leitura_falhou' }));
  }
  if (naoEncontrado) notFound();
  const href = ROTAS.adminSalaoAssinatura(id);
  return (
    <CascaAdmin caminhoAtual={ROTAS.adminSalao(id)}>
      {dados === null ? (
        <>
          <h1>Assinatura</h1>
          <ErrorState titulo="Não foi possível carregar a assinatura." saida={<a href={href}>Tentar novamente</a>} />
        </>
      ) : (
        <TelaDeAssinatura dados={dados} hrefSalao={ROTAS.adminSalao(dados.salao.id)} hrefAuditoria={`${ROTAS.adminAuditoria}?salao=${encodeURIComponent(dados.salao.id)}`} />
      )}
    </CascaAdmin>
  );
}
