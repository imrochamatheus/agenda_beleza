import type { Metadata } from 'next';

import { PanelLayout } from '@/components/layout/PanelLayout';
import { ROTAS } from '@/config/navegacao';
import { exigirAcessoAoPainel } from '@/server/auth/pagina';
import { listarParaPainel } from '@/server/profissionais/servico';
import { buscarIdentidadeDoPainel } from '@/server/repos/usuario';

import { AcessoNegado } from '../_componentes/AcessoNegado';
import { AreaUsuario } from '../_componentes/AreaUsuario';
import { euTambemAtendoAcao } from './acoes';
import { EuTambemAtendo } from './EuTambemAtendo';
import { ListaProfissionais } from './ListaProfissionais';
import estilos from './Profissionais.module.css';

export const metadata: Metadata = { title: 'Profissionais', robots: { index: false } };

/**
 * Lista de profissionais do salão (D-013 §3.6). Só o gestor (RN-6): a permissão é conferida no
 * servidor antes de qualquer leitura. "Eu também atendo" aparece enquanto o gestor não tem perfil ativo.
 */
export default async function PaginaProfissionais() {
  const acesso = await exigirAcessoAoPainel(ROTAS.profissionais, ['gestor'], 'profissional.gerir');
  if (acesso.tipo === 'negado') {
    return <AcessoNegado />;
  }
  const [profissionais, { nomeUsuario, nomeSalao }] = await Promise.all([
    listarParaPainel(acesso.ctx),
    buscarIdentidadeDoPainel(acesso.ctx),
  ]);
  const jaAtende = profissionais.some((p) => p.acesso === 'voce' && p.ativo);
  return (
    <PanelLayout
      papel={acesso.ctx.papel}
      nomeSalao={nomeSalao}
      caminhoAtual={ROTAS.profissionais}
      areaUsuario={<AreaUsuario nome={nomeUsuario} />}
    >
      <div className={estilos.pagina}>
        <div className={estilos.cabecalho}>
          <h1>Profissionais</h1>
          <a href={ROTAS.novoProfissional}>Cadastrar profissional</a>
        </div>
        <ListaProfissionais profissionais={profissionais} />
        {jaAtende ? null : <EuTambemAtendo acao={euTambemAtendoAcao} />}
      </div>
    </PanelLayout>
  );
}
