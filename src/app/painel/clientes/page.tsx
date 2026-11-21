import type { Metadata } from 'next';

import { PanelLayout } from '@/components/layout/PanelLayout';
import { ROTAS } from '@/config/navegacao';
import { exigirAcessoAoPainel } from '@/server/auth/pagina';
import { listar } from '@/server/clientes/servico';
import { buscarIdentidadeDoPainel } from '@/server/repos/usuario';

import { AcessoNegado } from '../_componentes/AcessoNegado';
import { AreaUsuario } from '../_componentes/AreaUsuario';

import { BuscaClientes } from './BuscaClientes';
import estilos from './Clientes.module.css';
import { ListaClientes } from './ListaClientes';

export const metadata: Metadata = { title: 'Clientes', robots: { index: false } };

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

/**
 * Clientes do salão (D-022 §3.6; RN-8..RN-10, RN-19): só o gestor. Busca por GET (funciona sem JS),
 * lista paginada de 20 e link para o detalhe. A permissão é conferida no servidor antes de qualquer leitura.
 */
export default async function PaginaClientes({ searchParams }: Props) {
  const acesso = await exigirAcessoAoPainel(ROTAS.clientes, ['gestor'], 'cliente.gerir');
  if (acesso.tipo === 'negado') {
    return <AcessoNegado />;
  }
  const params = (await searchParams) ?? {};
  const [lista, { nomeUsuario, nomeSalao }] = await Promise.all([
    listar(acesso.ctx, { q: params.q, pagina: params.pagina }),
    buscarIdentidadeDoPainel(acesso.ctx),
  ]);
  return (
    <PanelLayout
      papel={acesso.ctx.papel}
      nomeSalao={nomeSalao}
      caminhoAtual={ROTAS.clientes}
      areaUsuario={<AreaUsuario nome={nomeUsuario} />}
    >
      <div className={estilos.pagina}>
        <h1>Clientes</h1>
        <BuscaClientes base={ROTAS.clientes} q={lista.q} />
        <ListaClientes lista={lista} base={ROTAS.clientes} hrefDetalhe={ROTAS.cliente} />
      </div>
    </PanelLayout>
  );
}
