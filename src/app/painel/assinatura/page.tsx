import type { Metadata } from 'next';

import { PanelLayout } from '@/components/layout/PanelLayout';
import { ROTAS } from '@/config/navegacao';
import { exigirAcessoAoPainel } from '@/server/auth/pagina';
import { estadoEfetivoDoSalao } from '@/server/assinatura/estado-operacional';
import { rotuloDeSituacao } from '@/server/assinatura/rotulos';
import { buscarIdentidadeDoPainel } from '@/server/repos/usuario';

import { AcessoNegado } from '../_componentes/AcessoNegado';
import { AreaUsuario } from '../_componentes/AreaUsuario';

import { assinarAcao } from './acoes';
import { FormularioAssinar } from './FormularioAssinar';
import { resumoDoPlano } from './plano';
import { ResumoDaAssinatura } from './Resumo';

export const metadata: Metadata = { title: 'Assinatura', robots: { index: false } };
export const dynamic = 'force-dynamic';

/** Assinatura mínima (D-040): estado e botão "Assinar". A tela completa é da E6.5. */
export default async function PaginaAssinatura() {
  const acesso = await exigirAcessoAoPainel(ROTAS.assinatura, ['gestor'], 'assinatura.gerir');
  if (acesso.tipo === 'negado') {
    return <AcessoNegado />;
  }
  const [estado, { nomeUsuario, nomeSalao }] = await Promise.all([
    estadoEfetivoDoSalao(acesso.ctx, new Date()),
    buscarIdentidadeDoPainel(acesso.ctx),
  ]);
  const podeAssinar = estado.estado === 'sem_assinatura' || estado.estado === 'pendente';
  return (
    <PanelLayout
      papel={acesso.ctx.papel}
      nomeSalao={nomeSalao}
      caminhoAtual={ROTAS.assinatura}
      areaUsuario={<AreaUsuario nome={nomeUsuario} />}
    >
      <ResumoDaAssinatura
        situacao={rotuloDeSituacao(estado.estado)}
        formulario={podeAssinar ? <FormularioAssinar acao={assinarAcao} resumo={resumoDoPlano()} /> : null}
      />
    </PanelLayout>
  );
}
