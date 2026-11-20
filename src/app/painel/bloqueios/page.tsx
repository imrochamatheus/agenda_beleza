import type { Metadata } from 'next';

import { PanelLayout } from '@/components/layout/PanelLayout';
import { ROTAS } from '@/config/navegacao';
import { exigirAcessoAoPainel } from '@/server/auth/pagina';
import { listar, opcoesDeAlvo } from '@/server/bloqueios/servico';
import { buscarIdentidadeDoPainel } from '@/server/repos/usuario';

import { AcessoNegado } from '../_componentes/AcessoNegado';
import { AreaUsuario } from '../_componentes/AreaUsuario';

import { criarBloqueioAcao, removerBloqueioAcao } from './acoes';
import estilos from './Bloqueios.module.css';
import { FormularioBloqueio } from './FormularioBloqueio';
import { AlertaDeRemocao, ListaBloqueios } from './ListaBloqueios';

export const metadata: Metadata = { title: 'Bloqueios', robots: { index: false } };

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

/**
 * Bloqueios do salão e dos profissionais (D-016 §3.7; RN-12, RN-18). Gestor: cria para o salão ou para
 * qualquer profissional e vê todos; profissional: cria na própria agenda e vê os próprios e os do salão
 * (somente leitura). A permissão é conferida no servidor antes de qualquer leitura.
 */
export default async function PaginaBloqueios({ searchParams }: Props) {
  const acesso = await exigirAcessoAoPainel(ROTAS.bloqueios, ['gestor', 'profissional'], 'bloqueio_profissional.gerir');
  if (acesso.tipo === 'negado') {
    return <AcessoNegado />;
  }
  const agora = new Date();
  const [{ itens }, opcoes, { nomeUsuario, nomeSalao }] = await Promise.all([
    listar(acesso.ctx, agora),
    opcoesDeAlvo(acesso.ctx),
    buscarIdentidadeDoPainel(acesso.ctx),
  ]);
  const remocao = (await searchParams)?.remocao;
  return (
    <PanelLayout
      papel={acesso.ctx.papel}
      nomeSalao={nomeSalao}
      caminhoAtual={ROTAS.bloqueios}
      areaUsuario={<AreaUsuario nome={nomeUsuario} />}
    >
      <div className={estilos.pagina}>
        <h1>Bloqueios</h1>
        <AlertaDeRemocao remocao={remocao} />
        <section className={estilos.secao} aria-labelledby="novo-bloqueio">
          <h2 id="novo-bloqueio">Novo bloqueio</h2>
          <FormularioBloqueio acao={criarBloqueioAcao} opcoesAlvo={opcoes} rotuloEnviar="Salvar bloqueio" />
        </section>
        <section className={estilos.secao} aria-labelledby="bloqueios-vigentes">
          <h2 id="bloqueios-vigentes">Bloqueios vigentes e futuros</h2>
          <ListaBloqueios itens={itens} acaoRemover={removerBloqueioAcao} />
        </section>
      </div>
    </PanelLayout>
  );
}
