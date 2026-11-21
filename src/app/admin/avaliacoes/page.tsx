import type { Metadata } from 'next';

import { ROTAS } from '@/config/navegacao';
import { exigirAcessoAoAdmin } from '@/server/auth/admin/pagina';
import { listarFilaModeracao } from '@/server/denuncias/leitura';
import { lerFiltrosDaFila } from '@/server/denuncias/validacao';

import { AcessoNegado } from '../_componentes/AcessoNegado';
import { CascaAdmin } from '../_componentes/CascaAdmin';
import { FilaDeAvaliacoes } from './_componentes/FilaDeAvaliacoes';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Moderação de avaliações', robots: { index: false, follow: false } };

type Props = { searchParams: Promise<{ [chave: string]: string | string[] | undefined }> };

/** /admin/avaliacoes (D-035 RN-7): fila de moderação; só super admin com TOTP (`exigirAcessoAoAdmin`). */
export default async function PaginaFilaDeAvaliacoes({ searchParams }: Props) {
  const acesso = await exigirAcessoAoAdmin();
  if (acesso.tipo === 'negado') return <AcessoNegado />;
  const filtros = lerFiltrosDaFila(await searchParams);
  const fila = await listarFilaModeracao(acesso.ctx, filtros);
  return (
    <CascaAdmin caminhoAtual={ROTAS.adminAvaliacoes}>
      <h1>Moderação de avaliações</h1>
      <p>
        <a href={ROTAS.admin}>Início da administração</a>
      </p>
      <FilaDeAvaliacoes fila={fila} filtros={filtros} base={ROTAS.adminAvaliacoes} hrefDoDetalhe={ROTAS.adminAvaliacao} />
    </CascaAdmin>
  );
}
