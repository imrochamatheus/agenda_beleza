import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { PanelLayout } from '@/components/layout/PanelLayout';
import { ROTAS } from '@/config/navegacao';
import { lerReservaDaAgenda } from '@/server/agenda/consultar';
import type { DetalheDaReserva as Detalhe } from '@/server/agenda/tipos';
import { isoDaData } from '@/server/agenda/validacao';
import { exigirAcessoAoPainel } from '@/server/auth/pagina';
import { buscarIdentidadeDoPainel } from '@/server/repos/usuario';
import { partesLocais } from '@/server/tempo/fuso';
import { NaoEncontrado } from '@/server/tenant/erros';

import { AcessoNegado } from '../../../_componentes/AcessoNegado';
import { AreaUsuario } from '../../../_componentes/AreaUsuario';
import { hrefAgenda } from '../../_componentes/links';
import { DetalheDaReserva } from '../../_componentes/DetalheDaReserva';

export const metadata: Metadata = { title: 'Reserva', robots: { index: false } };
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

/**
 * Detalhe da reserva (D-028 RN-10, RN-11), somente leitura. 403 só sem a permissão `agenda.ver`;
 * reserva de outro profissional, de outro salão, inexistente ou id malformado → 404 igual.
 */
export default async function PaginaReserva({ params }: Props) {
  const { id } = await params;
  const acesso = await exigirAcessoAoPainel(ROTAS.agendaReserva(id), ['gestor', 'profissional'], 'agenda.ver');
  if (acesso.tipo === 'negado') {
    return <AcessoNegado />;
  }
  let reserva: Detalhe | null = null;
  try {
    reserva = await lerReservaDaAgenda(acesso.ctx, id);
  } catch (e) {
    if (!(e instanceof NaoEncontrado)) throw e;
  }
  if (reserva === null) {
    notFound();
  }
  const { nomeUsuario, nomeSalao } = await buscarIdentidadeDoPainel(acesso.ctx);
  const voltar = hrefAgenda(ROTAS.agenda, { data: isoDaData(partesLocais(reserva.inicio, reserva.fuso).data) });
  return (
    <PanelLayout
      papel={acesso.ctx.papel}
      nomeSalao={nomeSalao}
      caminhoAtual={ROTAS.agenda}
      areaUsuario={<AreaUsuario nome={nomeUsuario} />}
    >
      <DetalheDaReserva reserva={reserva} hrefVoltar={voltar} />
    </PanelLayout>
  );
}
