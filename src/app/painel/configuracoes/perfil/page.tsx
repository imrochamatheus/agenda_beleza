import type { Metadata } from 'next';

import { PanelLayout } from '@/components/layout/PanelLayout';
import { ROTAS } from '@/config/navegacao';
import { exigirAcessoAoPainel } from '@/server/auth/pagina';
import { buscarIdentidadeDoPainel } from '@/server/repos/usuario';
import { obterPerfil } from '@/server/salao/perfil';

import { AcessoNegado } from '../../_componentes/AcessoNegado';
import { AreaUsuario } from '../../_componentes/AreaUsuario';

import { salvarPerfilAcao } from './acoes';
import { FormularioPerfil } from './FormularioPerfil';
import estilos from './Perfil.module.css';

export const metadata: Metadata = { title: 'Perfil público', robots: { index: false } };

/**
 * Perfil público do salão (D-020 §3.8; RN-1, RN-19): só o gestor. A permissão é conferida no servidor
 * antes de qualquer leitura de dados; profissional vê "Acesso negado" e sem sessão vai para /entrar.
 */
export default async function PaginaPerfil() {
  const acesso = await exigirAcessoAoPainel(ROTAS.configuracoesPerfil, ['gestor'], 'salao.configurar');
  if (acesso.tipo === 'negado') {
    return <AcessoNegado />;
  }
  const [{ valores }, { nomeUsuario, nomeSalao }] = await Promise.all([obterPerfil(acesso.ctx), buscarIdentidadeDoPainel(acesso.ctx)]);
  return (
    <PanelLayout
      papel={acesso.ctx.papel}
      nomeSalao={nomeSalao}
      caminhoAtual={ROTAS.configuracoesPerfil}
      areaUsuario={<AreaUsuario nome={nomeUsuario} />}
    >
      <div className={estilos.pagina}>
        <p className={estilos.voltar}>
          <a href={ROTAS.configuracoes}>Voltar para Configurações</a>
        </p>
        <h1>Perfil público</h1>
        <FormularioPerfil acao={salvarPerfilAcao} valoresIniciais={valores} />
      </div>
    </PanelLayout>
  );
}
