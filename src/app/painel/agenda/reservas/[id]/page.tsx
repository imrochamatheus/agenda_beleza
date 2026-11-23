import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { PanelLayout } from '@/components/layout/PanelLayout';
import { ROTAS } from '@/config/navegacao';
import { lerReservaDaAgenda } from '@/server/agenda/consultar';
import type { DetalheDaReserva as Detalhe } from '@/server/agenda/tipos';
import { isoDaData } from '@/server/agenda/validacao';
import { exigirAcessoAoPainel } from '@/server/auth/pagina';
import { consultarMensagensDaReserva } from '@/server/mensagens/consultar-por-reserva';
import type { MensagemSituacao } from '@/server/mensagens/situacao-tipos';
import { repos } from '@/server/repos';
import { buscarIdentidadeDoPainel } from '@/server/repos/usuario';
import { NaoEncontrado } from '@/server/tenant/erros';

import { AcessoNegado } from '../../../_componentes/AcessoNegado';
import { AreaUsuario } from '../../../_componentes/AreaUsuario';
import { DetalheDaReserva } from '../../_componentes/DetalheDaReserva';
import { hrefAgenda } from '../../_componentes/links';
import { TotalDaReserva } from '../../_componentes/TotalDaReserva';

import { cancelarAcao, cancelarTodosDaReservaAcao, marcarAcao, remarcarAcao } from './acoes';
import { AcoesDaReserva } from './AcoesDaReserva';
import { lerAbertura, lerResultadoPrg, mensagemDoResultado } from './estado';
import { montarAcoes } from './montagem';
import type { ProfissionalDaLista, ServicoDaLista } from './montagem';

export const metadata: Metadata = { title: 'Reserva', robots: { index: false } };
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> };

/**
 * Detalhe da reserva (D-028 RN-10, RN-11) com as ações POR ITEM (D-030; D-050 web-design §5.10): situação,
 * remarcar e cancelar cada serviço e "Cancelar todos" (gestor). Só aparece o que a máquina de status permite
 * agora (o servidor repete todas as regras). 403 só sem `agenda.ver`; reserva sem item do profissional, de
 * outro salão, inexistente ou id malformado → 404. Abrir um formulário é GET (`?remarcar=`, `?cancelar=`).
 */
export default async function PaginaReserva({ params, searchParams }: Props) {
  const { id } = await params;
  const busca = (await searchParams) ?? {};
  const acesso = await exigirAcessoAoPainel(ROTAS.agendaReserva(id), ['gestor', 'profissional'], 'agenda.ver');
  if (acesso.tipo === 'negado') {
    return <AcessoNegado />;
  }
  const agora = new Date();
  let reserva: Detalhe | null = null;
  let mensagens: MensagemSituacao[] = [];
  try {
    [reserva, mensagens] = await Promise.all([lerReservaDaAgenda(acesso.ctx, id, agora), consultarMensagensDaReserva(acesso.ctx, id)]);
  } catch (e) {
    if (!(e instanceof NaoEncontrado)) throw e;
  }
  if (reserva === null) {
    notFound();
  }
  const { nomeUsuario, nomeSalao } = await buscarIdentidadeDoPainel(acesso.ctx);
  const abrir = lerAbertura(busca, reserva);
  // Listas do formulário de remarcar só quando ele está aberto.
  let servicos: ServicoDaLista[] = [];
  let profissionais: ProfissionalDaLista[] = [];
  if (abrir.remarcar !== null) {
    const r = repos();
    [servicos, profissionais] = await Promise.all([
      r.servicos.listar(acesso.ctx),
      reserva.papel === 'gestor' ? r.profissionais.listarAtivos(acesso.ctx) : Promise.resolve([]),
    ]);
  }
  const hrefBase = ROTAS.agendaReserva(reserva.id);
  const voltar = hrefAgenda(ROTAS.agenda, { data: isoDaData(reserva.data) });
  const dados = montarAcoes({ reserva, abrir, servicos, profissionais });
  return (
    <PanelLayout
      papel={acesso.ctx.papel}
      nomeSalao={nomeSalao}
      caminhoAtual={ROTAS.agenda}
      areaUsuario={<AreaUsuario nome={nomeUsuario} />}
    >
      <DetalheDaReserva
        reserva={reserva}
        hrefVoltar={voltar}
        mensagens={mensagens}
        resultado={mensagemDoResultado(lerResultadoPrg(busca), reserva)}
        roteiro={
          <AcoesDaReserva
            key={`${abrir.remarcar ?? ''}|${abrir.cancelar ?? ''}|${abrir.cancelarTodos}`}
            reservaId={reserva.id}
            hrefBase={hrefBase}
            {...dados}
            rodape={<TotalDaReserva reserva={reserva} />}
            acaoRemarcar={remarcarAcao}
            acaoCancelar={cancelarAcao}
            acaoMarcar={marcarAcao}
            acaoCancelarTodos={cancelarTodosDaReservaAcao}
          />
        }
      />
    </PanelLayout>
  );
}
