import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { PanelLayout } from '@/components/layout/PanelLayout';
import { ROTAS } from '@/config/navegacao';
import { consultarAgenda } from '@/server/agenda/consultar';
import type { AgendaVista } from '@/server/agenda/tipos';
import { exigirAcessoAoPainel } from '@/server/auth/pagina';
import { buscarIdentidadeDoPainel } from '@/server/repos/usuario';
import { NaoEncontrado } from '@/server/tenant/erros';

import { AcessoNegado } from '../_componentes/AcessoNegado';
import { AreaUsuario } from '../_componentes/AreaUsuario';

import { VistaDaAgenda } from './_componentes/VistaDaAgenda';

export const metadata: Metadata = { title: 'Agenda', robots: { index: false } };
export const dynamic = 'force-dynamic';

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

/**
 * Agenda da equipe (D-028 §2; RN-1, RN-12, RN-13): dia e semana, somente leitura, navegação por GET.
 * Ordem: 401 (redirect) → 403 ("Acesso negado") → 404 (`profissional` inválido ou de outro salão).
 * Parâmetros repetidos (array) valem como ausentes. notFound() fica fora do try.
 */
export default async function PaginaAgenda({ searchParams }: Props) {
  const acesso = await exigirAcessoAoPainel(ROTAS.agenda, ['gestor', 'profissional'], 'agenda.ver');
  if (acesso.tipo === 'negado') {
    return <AcessoNegado />;
  }
  const params = (await searchParams) ?? {};
  let vista: AgendaVista | null = null;
  try {
    vista = await consultarAgenda(acesso.ctx, { data: params.data, visao: params.visao, profissional: params.profissional }, new Date());
  } catch (e) {
    if (!(e instanceof NaoEncontrado)) throw e;
  }
  if (vista === null) {
    notFound();
  }
  const { nomeUsuario, nomeSalao } = await buscarIdentidadeDoPainel(acesso.ctx);
  return (
    <PanelLayout
      papel={acesso.ctx.papel}
      nomeSalao={nomeSalao}
      caminhoAtual={ROTAS.agenda}
      areaUsuario={<AreaUsuario nome={nomeUsuario} />}
    >
      <VistaDaAgenda vista={vista} base={ROTAS.agenda} hrefReserva={ROTAS.agendaReserva} />
    </PanelLayout>
  );
}
