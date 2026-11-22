import type { Metadata } from 'next';

import { PanelLayout } from '@/components/layout/PanelLayout';
import { ROTAS } from '@/config/navegacao';
import { exigirAcessoAoPainel } from '@/server/auth/pagina';
import { lerTelaAssinatura } from '@/server/assinatura/tela';
import { buscarIdentidadeDoPainel } from '@/server/repos/usuario';

import { AcessoNegado } from '../_componentes/AcessoNegado';
import { AreaUsuario } from '../_componentes/AreaUsuario';

import { assinarAcao, cancelarAcao, regularizarAcao } from './acoes';
import { ConteudoDaAssinatura } from './ConteudoDaAssinatura';

export const metadata: Metadata = { title: 'Assinatura', robots: { index: false } };
export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Assinatura do salão (D-042): estado, datas, valor, ações e histórico. Só o gestor, em qualquer estado
 * da assinatura (capacidade `assinatura`). `?cancelar=1` abre a etapa 2 do cancelamento (GET, sem efeito).
 */
export default async function PaginaAssinatura({ searchParams }: Props) {
  const acesso = await exigirAcessoAoPainel(ROTAS.assinatura, ['gestor'], 'assinatura.gerir');
  if (acesso.tipo === 'negado') {
    return <AcessoNegado />;
  }
  const { cancelar } = await searchParams;
  const [tela, { nomeUsuario, nomeSalao }] = await Promise.all([
    lerTelaAssinatura(acesso.ctx, new Date()),
    buscarIdentidadeDoPainel(acesso.ctx),
  ]);
  return (
    <PanelLayout
      papel={acesso.ctx.papel}
      nomeSalao={nomeSalao}
      caminhoAtual={ROTAS.assinatura}
      areaUsuario={<AreaUsuario nome={nomeUsuario} />}
    >
      <ConteudoDaAssinatura
        tela={tela}
        acoes={{ assinar: assinarAcao, regularizar: regularizarAcao, cancelar: cancelarAcao }}
        confirmando={cancelar === '1'}
        hrefCancelar={`${ROTAS.assinatura}?cancelar=1`}
        hrefManter={ROTAS.assinatura}
      />
    </PanelLayout>
  );
}
