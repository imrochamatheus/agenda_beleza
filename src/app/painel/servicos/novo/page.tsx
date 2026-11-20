import type { Metadata } from 'next';

import { PanelLayout } from '@/components/layout/PanelLayout';
import { ROTAS } from '@/config/navegacao';
import { exigirAcessoAoPainel } from '@/server/auth/pagina';
import { buscarIdentidadeDoPainel } from '@/server/repos/usuario';
import { listarProfissionaisParaNovo } from '@/server/servicos/servico';

import { AcessoNegado } from '../../_componentes/AcessoNegado';
import { AreaUsuario } from '../../_componentes/AreaUsuario';
import { criarServicoAcao } from '../acoes';
import { FormularioServico } from '../FormularioServico';
import estilos from '../Servicos.module.css';

export const metadata: Metadata = { title: 'Cadastrar serviço', robots: { index: false } };

/** Cadastro de serviço, já com os profissionais ativos para vincular (D-014 §3.6, D-13). Só o gestor. */
export default async function PaginaNovoServico() {
  const acesso = await exigirAcessoAoPainel(ROTAS.novoServico, ['gestor'], 'servico.gerir');
  if (acesso.tipo === 'negado') {
    return <AcessoNegado />;
  }
  const [profissionais, { nomeUsuario, nomeSalao }] = await Promise.all([
    listarProfissionaisParaNovo(acesso.ctx),
    buscarIdentidadeDoPainel(acesso.ctx),
  ]);
  return (
    <PanelLayout
      papel={acesso.ctx.papel}
      nomeSalao={nomeSalao}
      caminhoAtual={ROTAS.novoServico}
      areaUsuario={<AreaUsuario nome={nomeUsuario} />}
    >
      <div className={estilos.pagina}>
        <h1>Cadastrar serviço</h1>
        <FormularioServico modo="criar" acao={criarServicoAcao} profissionais={profissionais} />
      </div>
    </PanelLayout>
  );
}
