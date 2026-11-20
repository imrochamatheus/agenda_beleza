import type { Metadata } from 'next';

import { PanelLayout } from '@/components/layout/PanelLayout';
import { ROTAS } from '@/config/navegacao';
import { exigirAcessoAoPainel } from '@/server/auth/pagina';
import { buscarIdentidadeDoPainel } from '@/server/repos/usuario';

import { AcessoNegado } from './_componentes/AcessoNegado';
import { AreaUsuario } from './_componentes/AreaUsuario';

export const metadata: Metadata = { title: 'Painel', robots: { index: false } };

/**
 * /painel mínimo (D-010 RN-21): papel e salão vêm da sessão no servidor. Sem redirecionar para a
 * agenda enquanto a E3.3 não existir. Quem tem perfil de profissional (inclusive o gestor que atende)
 * vê o link "Minha jornada" (D-015 D-9).
 */
export default async function PaginaPainel() {
  const acesso = await exigirAcessoAoPainel(ROTAS.painel);
  if (acesso.tipo === 'negado') {
    return <AcessoNegado />;
  }
  const { nomeUsuario, nomeSalao } = await buscarIdentidadeDoPainel(acesso.ctx);
  return (
    <PanelLayout
      papel={acesso.ctx.papel}
      nomeSalao={nomeSalao}
      caminhoAtual={ROTAS.painel}
      areaUsuario={<AreaUsuario nome={nomeUsuario} />}
    >
      <h1>Olá, {nomeUsuario}</h1>
      {acesso.ctx.profissionalId !== null ? (
        <p>
          <a href={ROTAS.jornada(acesso.ctx.profissionalId)}>Minha jornada</a>
        </p>
      ) : null}
    </PanelLayout>
  );
}
