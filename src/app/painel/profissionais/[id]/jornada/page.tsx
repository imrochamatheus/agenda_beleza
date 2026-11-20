import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { PanelLayout } from '@/components/layout/PanelLayout';
import { Alert } from '@/components/ui/Alert';
import { ROTAS } from '@/config/navegacao';
import { exigirAcessoAoPainel } from '@/server/auth/pagina';
import { obter } from '@/server/jornadas/servico';
import { MENSAGENS_JORNADA } from '@/server/jornadas/tipos';
import type { JornadaVisao } from '@/server/jornadas/tipos';
import { buscarIdentidadeDoPainel } from '@/server/repos/usuario';
import { AcessoNegado as ErroAcessoNegado, NaoEncontrado } from '@/server/tenant/erros';

import { AcessoNegado } from '../../../_componentes/AcessoNegado';
import { AreaUsuario } from '../../../_componentes/AreaUsuario';

import { salvarJornadaAcao } from './acoes';
import { FormularioJornada } from './FormularioJornada';
import estilos from './Jornada.module.css';
import { VisaoJornada } from './VisaoJornada';

export const metadata: Metadata = { title: 'Jornada', robots: { index: false } };

type Props = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Jornada semanal de um profissional (D-015 §3.6). O gestor edita a de qualquer profissional do salão
 * (inclusive inativo, RN-13); o profissional vê só a própria, somente leitura (RN-1). Ordem: operação
 * `jornada.ver` (super admin → "Acesso negado") → 404 (outro salão, inexistente ou malformado) → alvo
 * (outro profissional do mesmo salão → "Acesso negado"). notFound() e o retorno de AcessoNegado ficam
 * fora do try. Sucesso de gravação por PRG (`?salva=1`, D-17).
 */
export default async function PaginaJornada({ params, searchParams }: Props) {
  const { id } = await params;
  const acesso = await exigirAcessoAoPainel(ROTAS.jornada(id), ['gestor', 'profissional'], 'jornada.ver');
  if (acesso.tipo === 'negado') {
    return <AcessoNegado />;
  }
  let visao: JornadaVisao | null = null;
  let negado = false;
  try {
    visao = await obter(acesso.ctx, id);
  } catch (e) {
    if (e instanceof ErroAcessoNegado) negado = true;
    else if (!(e instanceof NaoEncontrado)) throw e;
  }
  if (negado) {
    return <AcessoNegado />;
  }
  if (visao === null) {
    notFound();
  }
  const salva = (await searchParams)?.salva === '1';
  const { profissional, semana, semIntervalos, editavel } = visao;
  const { nomeUsuario, nomeSalao } = await buscarIdentidadeDoPainel(acesso.ctx);
  return (
    <PanelLayout
      papel={acesso.ctx.papel}
      nomeSalao={nomeSalao}
      caminhoAtual={ROTAS.jornada(id)}
      areaUsuario={<AreaUsuario nome={nomeUsuario} />}
    >
      <div className={estilos.pagina}>
        <h1>Jornada de {profissional.nome}</h1>
        {editavel ? (
          <p>
            <a href={ROTAS.profissional(profissional.id)}>Voltar para {profissional.nome}</a>
          </p>
        ) : null}
        {!profissional.ativo ? <Alert variante="aviso">{MENSAGENS_JORNADA.inativo}</Alert> : null}
        {semIntervalos ? <Alert variante="aviso">{MENSAGENS_JORNADA.semIntervalos}</Alert> : null}
        {editavel ? (
          <FormularioJornada
            acao={salvarJornadaAcao}
            profissionalId={profissional.id}
            semana={semana}
            aposSalvar={salva ? MENSAGENS_JORNADA.salva : undefined}
          />
        ) : (
          <>
            <p>{MENSAGENS_JORNADA.somenteLeitura}</p>
            <VisaoJornada semana={semana} />
          </>
        )}
      </div>
    </PanelLayout>
  );
}
