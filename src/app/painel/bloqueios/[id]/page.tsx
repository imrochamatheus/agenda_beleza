import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PanelLayout } from '@/components/layout/PanelLayout';
import { ROTAS } from '@/config/navegacao';
import { exigirAcessoAoPainel } from '@/server/auth/pagina';
import { obterParaEdicao } from '@/server/bloqueios/servico';
import type { BloqueioItem, ValoresBloqueio } from '@/server/bloqueios/tipos';
import { buscarIdentidadeDoPainel } from '@/server/repos/usuario';
import { AcessoNegado as ErroAcessoNegado, NaoEncontrado } from '@/server/tenant/erros';

import { AcessoNegado } from '../../_componentes/AcessoNegado';
import { AreaUsuario } from '../../_componentes/AreaUsuario';
import { editarBloqueioAcao } from '../acoes';
import estilos from '../Bloqueios.module.css';
import { rotuloDoAlvo } from '../estado';
import { FormularioBloqueio } from '../FormularioBloqueio';

export const metadata: Metadata = { title: 'Editar bloqueio', robots: { index: false } };

type Props = { params: Promise<{ id: string }> };

/**
 * Edição de um bloqueio (D-016 §3.7; RN-11): início, fim e motivo; o alvo não muda. Ordem: 404 (outro
 * salão, inexistente ou malformado) → 403 (profissional diante de bloqueio do salão ou de colega,
 * "Acesso negado"). notFound() e o retorno de AcessoNegado ficam fora do try.
 */
export default async function PaginaEditarBloqueio({ params }: Props) {
  const { id } = await params;
  const acesso = await exigirAcessoAoPainel(ROTAS.bloqueio(id), ['gestor', 'profissional'], 'bloqueio_profissional.gerir');
  if (acesso.tipo === 'negado') {
    return <AcessoNegado />;
  }
  let dados: { item: BloqueioItem; valores: ValoresBloqueio } | null = null;
  let negado = false;
  try {
    dados = await obterParaEdicao(acesso.ctx, id);
  } catch (e) {
    if (e instanceof ErroAcessoNegado) negado = true;
    else if (!(e instanceof NaoEncontrado)) throw e;
  }
  if (negado) {
    return <AcessoNegado />;
  }
  if (dados === null) {
    notFound();
  }
  const { nomeUsuario, nomeSalao } = await buscarIdentidadeDoPainel(acesso.ctx);
  const { item, valores } = dados;
  return (
    <PanelLayout
      papel={acesso.ctx.papel}
      nomeSalao={nomeSalao}
      caminhoAtual={ROTAS.bloqueio(id)}
      areaUsuario={<AreaUsuario nome={nomeUsuario} />}
    >
      <div className={estilos.pagina}>
        <h1>Editar bloqueio</h1>
        <p>
          <Link href={ROTAS.bloqueios} className={estilos.link}>
            Voltar para bloqueios
          </Link>
        </p>
        <p>
          Período atual: <strong>{item.periodo}</strong>
        </p>
        <FormularioBloqueio
          acao={editarBloqueioAcao}
          opcoesAlvo={null}
          id={item.id}
          alvoTexto={rotuloDoAlvo(item.alvo)}
          valoresIniciais={valores}
          rotuloEnviar="Salvar alterações"
        />
      </div>
    </PanelLayout>
  );
}
