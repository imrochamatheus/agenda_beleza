import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ROTAS } from '@/config/navegacao';
import { lerSalao } from '@/server/admin/saloes';
import type { DetalheSalao } from '@/server/admin/saloes-tipos';
import { recusaDaExtensao } from '@/server/admin/saloes-validacao';
import { exigirAcessoAoAdmin } from '@/server/auth/admin/pagina';
import { opcoesDeFuso } from '@/server/salao/fusos';
import { NaoEncontrado } from '@/server/tenant/erros';

import { AcessoNegado } from '../../_componentes/AcessoNegado';
import { CascaAdmin } from '../../_componentes/CascaAdmin';
import { editarSalaoAcao, estenderTesteAcao, reativarSalaoAcao, suspenderSalaoAcao } from '../acoes';
import { CabecalhoDoSalao } from '../_componentes/CabecalhoDoSalao';
import { PainelDoSalao } from '../_componentes/PainelDoSalao';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Salão', robots: { index: false, follow: false } };

type Props = { params: Promise<{ id: string }> };

/**
 * /admin/saloes/[id] (D-044): detalhe, edição, suspensão e extensão do teste. Ordem: 403 (sessão que não é de
 * admin) → 404 (id malformado ou desconhecido, sem vazar nada). `notFound()` fica fora do try.
 */
export default async function PaginaDoSalao({ params }: Props) {
  const acesso = await exigirAcessoAoAdmin();
  if (acesso.tipo === 'negado') return <AcessoNegado />;
  const { id } = await params;
  let salao: DetalheSalao | null = null;
  try {
    salao = await lerSalao(acesso.ctx, id);
  } catch (e) {
    if (!(e instanceof NaoEncontrado)) throw e;
  }
  if (salao === null) notFound();
  const a = salao.assinatura;
  const recusa = recusaDaExtensao(
    { estado: a?.estado ?? null, temProvedor: a?.vinculada ?? false, testeFimEm: a?.testeFimEm === null || a === null ? null : new Date(a.testeFimEm) },
    new Date(),
  );
  return (
    <CascaAdmin caminhoAtual={ROTAS.adminSalao(salao.id)}>
      <CabecalhoDoSalao salao={salao} hrefLista={ROTAS.adminSaloes} />
      <PainelDoSalao
        salao={salao}
        fusos={opcoesDeFuso(salao.fuso)}
        acoes={{ editar: editarSalaoAcao, suspender: suspenderSalaoAcao, reativar: reativarSalaoAcao, estender: estenderTesteAcao }}
        recusaDaExtensao={recusa}
        hrefVoltar={ROTAS.adminSalao(salao.id)}
        hrefAssinatura={ROTAS.adminSalaoAssinatura(salao.id)}
        hrefAuditoria={`${ROTAS.adminAuditoria}?salao=${encodeURIComponent(salao.id)}`}
      />
    </CascaAdmin>
  );
}
