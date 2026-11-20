import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { PanelLayout } from '@/components/layout/PanelLayout';
import { ROTAS } from '@/config/navegacao';
import { exigirAcessoAoPainel } from '@/server/auth/pagina';
import { obterParaEdicao } from '@/server/profissionais/servico';
import type { ProfissionalVisao } from '@/server/profissionais/tipos';
import { buscarIdentidadeDoPainel } from '@/server/repos/usuario';
import { NaoEncontrado } from '@/server/tenant/erros';

import { AcessoNegado } from '../../_componentes/AcessoNegado';
import { AreaUsuario } from '../../_componentes/AreaUsuario';
import { desativarProfissionalAcao, editarProfissionalAcao, reativarProfissionalAcao } from '../acoes';
import { ControleAtivacao } from '../ControleAtivacao';
import { FormularioProfissional } from '../FormularioProfissional';
import estilos from '../Profissionais.module.css';

export const metadata: Metadata = { title: 'Profissional', robots: { index: false } };

/** Seção "Acesso" (RN-9, RN-12). Sem acesso: é aqui que a E1.4 coloca "Enviar convite". */
function Acesso({ p }: { p: ProfissionalVisao }) {
  return (
    <section className={estilos.secao} aria-labelledby="acesso-profissional">
      <h2 id="acesso-profissional">Acesso ao painel</h2>
      {p.acesso === 'voce' ? (
        <p>
          Este é o seu perfil de profissional. Você entra com <strong className={estilos.emailLogin}>{p.emailLogin}</strong>.
        </p>
      ) : p.acesso === 'com_acesso' ? (
        <p>
          Entra no painel com <strong className={estilos.emailLogin}>{p.emailLogin}</strong>.
        </p>
      ) : (
        <p>Sem acesso ao painel. O convite por e-mail ainda não está disponível.</p>
      )}
    </section>
  );
}

/**
 * Edição, desativação e reativação de um profissional (D-013 §3.6). A permissão é conferida ANTES da
 * busca (o profissional vê "Acesso negado", não 404, R-6). Id de outro salão, inexistente ou
 * malformado → notFound(), chamado fora do try.
 */
export default async function PaginaProfissional({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const acesso = await exigirAcessoAoPainel(ROTAS.profissional(id), ['gestor'], 'profissional.gerir');
  if (acesso.tipo === 'negado') {
    return <AcessoNegado />;
  }
  let profissional: ProfissionalVisao | null;
  try {
    profissional = await obterParaEdicao(acesso.ctx, id);
  } catch (e) {
    if (!(e instanceof NaoEncontrado)) throw e;
    profissional = null;
  }
  if (profissional === null) {
    notFound();
  }
  const { nomeUsuario, nomeSalao } = await buscarIdentidadeDoPainel(acesso.ctx);
  return (
    <PanelLayout
      papel={acesso.ctx.papel}
      nomeSalao={nomeSalao}
      caminhoAtual={ROTAS.profissional(id)}
      areaUsuario={<AreaUsuario nome={nomeUsuario} />}
    >
      <div className={estilos.pagina}>
        <h1>{profissional.nome}</h1>
        <FormularioProfissional modo="editar" acao={editarProfissionalAcao} profissional={profissional} />
        <Acesso p={profissional} />
        <section className={estilos.secao} aria-labelledby="jornada-profissional">
          <h2 id="jornada-profissional">Jornada</h2>
          <p>
            <a href={ROTAS.jornada(profissional.id)}>Ver e editar a jornada</a>
          </p>
        </section>
        <ControleAtivacao
          id={profissional.id}
          nome={profissional.nome}
          ativo={profissional.ativo}
          desativar={desativarProfissionalAcao}
          reativar={reativarProfissionalAcao}
        />
      </div>
    </PanelLayout>
  );
}
