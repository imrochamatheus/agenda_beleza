import type { Metadata } from 'next';

import { PanelLayout } from '@/components/layout/PanelLayout';
import { ROTAS } from '@/config/navegacao';
import { exigirAcessoAoPainel } from '@/server/auth/pagina';
import { buscarIdentidadeDoPainel } from '@/server/repos/usuario';

import { AcessoNegado } from '../../_componentes/AcessoNegado';
import { AreaUsuario } from '../../_componentes/AreaUsuario';
import { criarProfissionalAcao } from '../acoes';
import { FormularioProfissional } from '../FormularioProfissional';
import estilos from '../Profissionais.module.css';

export const metadata: Metadata = { title: 'Cadastrar profissional', robots: { index: false } };

/** Cadastro de profissional (D-013 §3.6; RN-9, RN-12). Só o gestor. */
export default async function PaginaNovoProfissional() {
  const acesso = await exigirAcessoAoPainel(ROTAS.novoProfissional, ['gestor'], 'profissional.gerir');
  if (acesso.tipo === 'negado') {
    return <AcessoNegado />;
  }
  const { nomeUsuario, nomeSalao } = await buscarIdentidadeDoPainel(acesso.ctx);
  return (
    <PanelLayout
      papel={acesso.ctx.papel}
      nomeSalao={nomeSalao}
      caminhoAtual={ROTAS.novoProfissional}
      areaUsuario={<AreaUsuario nome={nomeUsuario} />}
    >
      <div className={estilos.pagina}>
        <h1>Cadastrar profissional</h1>
        <FormularioProfissional modo="criar" acao={criarProfissionalAcao} />
      </div>
    </PanelLayout>
  );
}
