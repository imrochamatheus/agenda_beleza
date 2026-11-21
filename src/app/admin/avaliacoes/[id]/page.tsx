import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { PARAMETRO_RESULTADO } from '@/config/moderacao';
import { ROTAS } from '@/config/navegacao';
import { exigirAcessoAoAdmin } from '@/server/auth/admin/pagina';
import { lerDetalheDaAvaliacao } from '@/server/denuncias/leitura';

import { AcessoNegado } from '../../_componentes/AcessoNegado';
import { CascaAdmin } from '../../_componentes/CascaAdmin';
import { arquivarAcao, restaurarAcao, retirarAcao } from '../acoes';
import { DetalheDaModeracao } from '../_componentes/DetalheDaModeracao';
import { lerResultado } from '../resultado';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Moderar avaliação', robots: { index: false, follow: false } };

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [chave: string]: string | string[] | undefined }>;
};

/** /admin/avaliacoes/[id] (D-035): detalhe e ações; id desconhecido ou malformado = 404. */
export default async function PaginaDeModeracao({ params, searchParams }: Props) {
  const acesso = await exigirAcessoAoAdmin();
  if (acesso.tipo === 'negado') return <AcessoNegado />;
  const { id } = await params;
  const detalhe = await lerDetalheDaAvaliacao(acesso.ctx, id);
  if (detalhe === null) notFound();
  const consulta = await searchParams;
  return (
    <CascaAdmin caminhoAtual={ROTAS.adminAvaliacao(id)}>
      <DetalheDaModeracao
        detalhe={detalhe}
        acoes={{ retirar: retirarAcao, restaurar: restaurarAcao, arquivar: arquivarAcao }}
        resultado={lerResultado(consulta[PARAMETRO_RESULTADO])}
        hrefDaFila={ROTAS.adminAvaliacoes}
      />
    </CascaAdmin>
  );
}
