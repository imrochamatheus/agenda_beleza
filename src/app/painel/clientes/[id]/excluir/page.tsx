import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { PanelLayout } from '@/components/layout/PanelLayout';
import { ROTAS } from '@/config/navegacao';
import { exigirAcessoAoPainel } from '@/server/auth/pagina';
import { obter } from '@/server/clientes/servico';
import type { DetalheCliente } from '@/server/clientes/tipos';
import { buscarIdentidadeDoPainel } from '@/server/repos/usuario';
import { NaoEncontrado } from '@/server/tenant/erros';

import { AcessoNegado } from '../../../_componentes/AcessoNegado';
import { AreaUsuario } from '../../../_componentes/AreaUsuario';
import { excluirClienteAcao } from '../../acoes';
import estilos from '../../Clientes.module.css';
import { ConfirmarExclusaoCliente } from '../../ConfirmarExclusaoCliente';

export const metadata: Metadata = { title: 'Excluir cliente', robots: { index: false } };

type Props = { params: Promise<{ id: string }> };

/**
 * Confirmação da exclusão (D-031 RN-11, etapa 2 de 2). GET só mostra a página e não altera nada. Ordem:
 * 403 (profissional) → 404 (outro salão, inexistente, id malformado) → cliente já anonimizada volta ao
 * detalhe. notFound() e redirect() ficam fora do try.
 */
export default async function PaginaExcluirCliente({ params }: Props) {
  const { id } = await params;
  const acesso = await exigirAcessoAoPainel(ROTAS.excluirCliente(id), ['gestor'], 'cliente.gerir');
  if (acesso.tipo === 'negado') {
    return <AcessoNegado />;
  }
  let detalhe: DetalheCliente | null = null;
  try {
    detalhe = await obter(acesso.ctx, id);
  } catch (e) {
    if (!(e instanceof NaoEncontrado)) throw e;
  }
  if (detalhe === null) {
    notFound();
  }
  if (detalhe.cliente.anonimizada) {
    redirect(ROTAS.cliente(id));
  }
  const { nomeUsuario, nomeSalao } = await buscarIdentidadeDoPainel(acesso.ctx);
  return (
    <PanelLayout
      papel={acesso.ctx.papel}
      nomeSalao={nomeSalao}
      caminhoAtual={ROTAS.cliente(id)}
      areaUsuario={<AreaUsuario nome={nomeUsuario} />}
    >
      <div className={estilos.pagina}>
        <ConfirmarExclusaoCliente
          acao={excluirClienteAcao}
          clienteId={detalhe.cliente.id}
          nome={detalhe.cliente.nome ?? ''}
          hrefCancelar={ROTAS.cliente(id)}
        />
      </div>
    </PanelLayout>
  );
}
