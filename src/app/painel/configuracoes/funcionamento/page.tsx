import type { Metadata } from 'next';

import { PanelLayout } from '@/components/layout/PanelLayout';
import { ROTAS } from '@/config/navegacao';
import { exigirAcessoAoPainel } from '@/server/auth/pagina';
import { buscarIdentidadeDoPainel } from '@/server/repos/usuario';
import { obterFuncionamento } from '@/server/salao/funcionamento';

import { AcessoNegado } from '../../_componentes/AcessoNegado';
import { AreaUsuario } from '../../_componentes/AreaUsuario';

import { salvarFuncionamentoAcao } from './acoes';
import { AvisoDoFuncionamento } from './AvisoDoFuncionamento';
import estilos from './Funcionamento.module.css';
import { FormularioFuncionamento } from './FormularioFuncionamento';

export const metadata: Metadata = { title: 'Horário de funcionamento', robots: { index: false } };

/**
 * Horário de funcionamento do salão (D-020 §3.8; RN-1, RN-11..RN-19): só o gestor. A permissão é
 * conferida no servidor antes de qualquer leitura de dados.
 */
export default async function PaginaFuncionamento() {
  const acesso = await exigirAcessoAoPainel(ROTAS.configuracoesFuncionamento, ['gestor'], 'salao.configurar');
  if (acesso.tipo === 'negado') {
    return <AcessoNegado />;
  }
  const [funcionamento, { nomeUsuario, nomeSalao }] = await Promise.all([obterFuncionamento(acesso.ctx), buscarIdentidadeDoPainel(acesso.ctx)]);
  return (
    <PanelLayout
      papel={acesso.ctx.papel}
      nomeSalao={nomeSalao}
      caminhoAtual={ROTAS.configuracoesFuncionamento}
      areaUsuario={<AreaUsuario nome={nomeUsuario} />}
    >
      <div className={estilos.pagina}>
        <p className={estilos.voltar}>
          <a href={ROTAS.configuracoes}>Voltar para Configurações</a>
        </p>
        <h1>Horário de funcionamento</h1>
        <AvisoDoFuncionamento funcionamento={funcionamento} />
        <FormularioFuncionamento acao={salvarFuncionamentoAcao} funcionamento={funcionamento} />
      </div>
    </PanelLayout>
  );
}
