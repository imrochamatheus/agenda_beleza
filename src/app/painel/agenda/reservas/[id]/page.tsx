import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { PanelLayout } from '@/components/layout/PanelLayout';
import { ROTAS } from '@/config/navegacao';
import { formatarDuracao, formatarMinutosDoDia, formatarMoeda } from '@/lib/format';
import { lerReservaDaAgenda } from '@/server/agenda/consultar';
import type { DetalheDaReserva as Detalhe } from '@/server/agenda/tipos';
import { consultarMensagensDaReserva } from '@/server/mensagens/consultar-por-reserva';
import type { MensagemSituacao } from '@/server/mensagens/situacao-tipos';
import { isoDaData } from '@/server/agenda/validacao';
import { exigirAcessoAoPainel } from '@/server/auth/pagina';
import { repos } from '@/server/repos';
import { buscarIdentidadeDoPainel } from '@/server/repos/usuario';
import { acoesPermitidas } from '@/server/reservas/status';
import { partesLocais } from '@/server/tempo/fuso';
import { NaoEncontrado } from '@/server/tenant/erros';

import { AcessoNegado } from '../../../_componentes/AcessoNegado';
import { AreaUsuario } from '../../../_componentes/AreaUsuario';
import { hrefAgenda } from '../../_componentes/links';
import { DetalheDaReserva } from '../../_componentes/DetalheDaReserva';

import { cancelarAcao, marcarAcao, remarcarAcao } from './acoes';
import { AcoesDaReserva } from './AcoesDaReserva';
import { lerResultadoPrg } from './estado';

export const metadata: Metadata = { title: 'Reserva', robots: { index: false } };
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> };

/**
 * Detalhe da reserva (D-028 RN-10, RN-11) e, desde a D-030, as ações de remarcar, cancelar e marcar o
 * resultado (só as que a máquina de status permite agora; o servidor repete todas as regras). 403 só sem a
 * permissão `agenda.ver`; reserva de outro profissional, de outro salão, inexistente ou id malformado → 404.
 */
export default async function PaginaReserva({ params, searchParams }: Props) {
  const { id } = await params;
  const resultado = lerResultadoPrg(((await searchParams) ?? {}).resultado);
  const acesso = await exigirAcessoAoPainel(ROTAS.agendaReserva(id), ['gestor', 'profissional'], 'agenda.ver');
  if (acesso.tipo === 'negado') {
    return <AcessoNegado />;
  }
  let reserva: Detalhe | null = null;
  let mensagens: MensagemSituacao[] = [];
  try {
    [reserva, mensagens] = await Promise.all([lerReservaDaAgenda(acesso.ctx, id), consultarMensagensDaReserva(acesso.ctx, id)]);
  } catch (e) {
    if (!(e instanceof NaoEncontrado)) throw e;
  }
  if (reserva === null) {
    notFound();
  }
  const { nomeUsuario, nomeSalao } = await buscarIdentidadeDoPainel(acesso.ctx);
  const r = repos();
  const agora = new Date();
  const [salaoReserva, ativos, servicos] = await Promise.all([
    r.reservas.buscarPorId(acesso.ctx, reserva.id),
    r.profissionais.listarAtivos(acesso.ctx),
    r.servicos.listar(acesso.ctx),
  ]);
  const idsDosItens = salaoReserva.itens.map((i) => i.servicoId);
  const ehGestor = acesso.ctx.papel === 'gestor';
  const local = partesLocais(reserva.inicio, reserva.fuso);
  const voltar = hrefAgenda(ROTAS.agenda, { data: isoDaData(partesLocais(reserva.inicio, reserva.fuso).data) });
  return (
    <PanelLayout
      papel={acesso.ctx.papel}
      nomeSalao={nomeSalao}
      caminhoAtual={ROTAS.agenda}
      areaUsuario={<AreaUsuario nome={nomeUsuario} />}
    >
      <DetalheDaReserva reserva={reserva} hrefVoltar={voltar} mensagens={mensagens} />
      <AcoesDaReserva
        reservaId={reserva.id}
        resultado={resultado}
        acoes={acoesPermitidas({ status: reserva.status, inicio: reserva.inicio, fim: reserva.fim, agora })}
        remarcar={{
          valores: {
            data: isoDaData(local.data),
            hora: formatarMinutosDoDia(local.minutosDoDia),
            profissionalId: reserva.profissional.id,
            servicoIds: idsDosItens,
            confirmarEncaixe: false,
          },
          servicos: servicos
            .filter((s) => s.ativo || idsDosItens.includes(s.id))
            .map((s) => ({ id: s.id, rotulo: `${s.nome} · ${formatarDuracao(s.duracaoMin)} · ${formatarMoeda(s.precoCentavos)}${s.ativo ? '' : ' (inativo)'}` })),
          profissionais: ehGestor ? ativos.map((p) => ({ valor: p.id, rotulo: p.nome })) : null,
          profissionalFixo: reserva.profissional.nome,
        }}
        acaoRemarcar={remarcarAcao}
        acaoCancelar={cancelarAcao}
        acaoMarcar={marcarAcao}
      />
    </PanelLayout>
  );
}
