import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { PanelLayout } from '@/components/layout/PanelLayout';
import { Alert } from '@/components/ui/Alert';
import { ROTAS } from '@/config/navegacao';
import { exigirAcessoAoPainel } from '@/server/auth/pagina';
import { buscarIdentidadeDoPainel } from '@/server/repos/usuario';
import { obterParaEdicao } from '@/server/servicos/servico';
import { MENSAGENS_SERVICO } from '@/server/servicos/tipos';
import type { ServicoEdicao } from '@/server/servicos/tipos';
import { NaoEncontrado } from '@/server/tenant/erros';

import { AcessoNegado } from '../../_componentes/AcessoNegado';
import { AreaUsuario } from '../../_componentes/AreaUsuario';
import { desativarServicoAcao, editarServicoAcao, reativarServicoAcao } from '../acoes';
import { ControleSituacao } from '../ControleSituacao';
import { FormularioServico } from '../FormularioServico';
import estilos from '../Servicos.module.css';

export const metadata: Metadata = { title: 'Serviço', robots: { index: false } };

/**
 * Edição do serviço e dos vínculos, desativação e reativação (D-014 §3.6). A permissão é conferida
 * ANTES da busca (o profissional vê "Acesso negado", não 404). Id de outro salão, inexistente ou
 * malformado → notFound(), chamado fora do try. Ativo e não ofertável → aviso (D-19).
 */
export default async function PaginaServico({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const acesso = await exigirAcessoAoPainel(ROTAS.servico(id), ['gestor'], 'servico.gerir');
  if (acesso.tipo === 'negado') {
    return <AcessoNegado />;
  }
  let servico: ServicoEdicao | null;
  try {
    servico = await obterParaEdicao(acesso.ctx, id);
  } catch (e) {
    if (!(e instanceof NaoEncontrado)) throw e;
    servico = null;
  }
  if (servico === null) {
    notFound();
  }
  const { nomeUsuario, nomeSalao } = await buscarIdentidadeDoPainel(acesso.ctx);
  return (
    <PanelLayout
      papel={acesso.ctx.papel}
      nomeSalao={nomeSalao}
      caminhoAtual={ROTAS.servico(id)}
      areaUsuario={<AreaUsuario nome={nomeUsuario} />}
    >
      <div className={estilos.pagina}>
        <h1>{servico.nome}</h1>
        {servico.ativo && !servico.ofertavel ? <Alert variante="aviso">{MENSAGENS_SERVICO.semProfissional}</Alert> : null}
        <FormularioServico
          modo="editar"
          acao={editarServicoAcao}
          profissionais={servico.profissionais}
          servico={servico}
        />
        <ControleSituacao
          id={servico.id}
          ativo={servico.ativo}
          desativar={desativarServicoAcao}
          reativar={reativarServicoAcao}
        />
      </div>
    </PanelLayout>
  );
}
