import type { Metadata } from 'next';

import { PanelLayout } from '@/components/layout/PanelLayout';
import { ROTAS } from '@/config/navegacao';
import { exigirAcessoAoPainel } from '@/server/auth/pagina';
import { buscarIdentidadeDoPainel } from '@/server/repos/usuario';
import { listarParaPainel } from '@/server/servicos/servico';

import { AcessoNegado } from '../_componentes/AcessoNegado';
import { AreaUsuario } from '../_componentes/AreaUsuario';
import { ListaServicos } from './ListaServicos';
import estilos from './Servicos.module.css';

export const metadata: Metadata = { title: 'Serviços', robots: { index: false } };

/**
 * Lista de serviços do salão (D-014 §3.6). Só o gestor (RN-5): a permissão é conferida no servidor
 * antes de qualquer leitura.
 */
export default async function PaginaServicos() {
  const acesso = await exigirAcessoAoPainel(ROTAS.servicos, ['gestor'], 'servico.gerir');
  if (acesso.tipo === 'negado') {
    return <AcessoNegado />;
  }
  const [servicos, { nomeUsuario, nomeSalao }] = await Promise.all([
    listarParaPainel(acesso.ctx),
    buscarIdentidadeDoPainel(acesso.ctx),
  ]);
  return (
    <PanelLayout
      papel={acesso.ctx.papel}
      nomeSalao={nomeSalao}
      caminhoAtual={ROTAS.servicos}
      areaUsuario={<AreaUsuario nome={nomeUsuario} />}
    >
      <div className={estilos.pagina}>
        <div className={estilos.cabecalho}>
          <h1>Serviços</h1>
          <a href={ROTAS.novoServico}>Cadastrar serviço</a>
        </div>
        <ListaServicos servicos={servicos} />
      </div>
    </PanelLayout>
  );
}
