import { exigirPermissao, filtroDeProfissional } from '@/server/auth/permissoes';
import { lerBloqueios } from '@/server/bloqueios/leitura';
import { lerContatoDaCliente } from '@/server/clientes/leitura';
import { repos } from '@/server/repos';
import type { LinhaAgenda } from '@/server/repos/agenda';
import { acoesPermitidas } from '@/server/reservas/status';
import { lerFuncionamento } from '@/server/salao/funcionamento-leitura';
import { montarSemana } from '@/server/semana/montagem';
import type { SemanaHoraria } from '@/server/semana/tipos';
import { partesLocais } from '@/server/tempo/fuso';
import type { TenantContext } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';

import { montarPeriodo } from './periodo';
import { montarVista } from './montagem';
import { LIMITES_AGENDA } from './tipos';
import type { AgendaVista, BlocoDaAgenda, DetalheDaReserva, ItemDoDetalhe, TotalDoDetalhe } from './tipos';
import { lerParametros } from './validacao';
import type { ParametrosBrutos } from './validacao';

// Leitura da agenda da equipe (D-028 §3; D-050 §3.9). SOMENTE LEITURA e sem checagem de suspensão (RN-4,
// CA-10): a política mantém `agenda.ver` liberada. Seis instruções SQL por consulta, qualquer que seja o
// número de itens, reservas, datas e profissionais (CA-16; D-050 CA-34): fuso, profissionais, itens,
// bloqueios, jornadas e funcionamento. Não importado pela página pública (CA-17).
// D-050: um bloco por ITEM na coluna do profissional do item (RN-36); o profissional só recebe os
// próprios itens, sem o marcador "n de N" (CA-33/C4).

function paraBloco(l: LinhaAgenda): BlocoDaAgenda {
  return {
    itemId: l.itemId,
    reservaId: l.reservaId,
    profissionalId: l.profissionalId,
    inicio: l.inicio,
    fim: l.fim,
    status: l.status,
    origem: l.origem,
    encaixe: l.encaixe,
    clienteNome: l.clienteNome,
    servicoNome: l.servicoNome,
    precoCentavos: l.precoCentavos,
    duracaoMin: l.duracaoMin,
    temFalhaDeMensagem: l.temFalhaDeMensagem,
    posicao: l.posicao,
  };
}

/**
 * Vista da agenda do salão do contexto. Gestor: todos os profissionais (ativos e inativos), com filtro
 * opcional (`profissional` inválido ou de outro salão → NaoEncontrado). Profissional: só o próprio; o
 * parâmetro `profissional` é ignorado (RN-12). `data`/`visao` inválidos → padrão, sem erro.
 */
export async function consultarAgenda(
  ctx: TenantContext,
  entrada: ParametrosBrutos,
  agora: Date,
): Promise<AgendaVista> {
  exigirPermissao(ctx, 'agenda.ver');
  const escopo = filtroDeProfissional(ctx, 'agenda.ver');
  const r = repos();
  const fuso = await r.bloqueios.fusoDoSalao(ctx);
  const hoje = partesLocais(agora, fuso).data;
  const parametros = lerParametros(entrada, hoje);

  const todos = await r.bloqueios.listarProfissionais(ctx);
  let visiveis = todos;
  let filtro: string | null = null;
  if ('profissionalId' in escopo) {
    visiveis = todos.filter((p) => p.id === escopo.profissionalId);
    filtro = escopo.profissionalId;
  } else if (parametros.profissional !== null) {
    if (!todos.some((p) => p.id === parametros.profissional)) {
      throw new NaoEncontrado();
    }
    filtro = parametros.profissional;
  }

  const periodo = montarPeriodo(parametros.data, parametros.visao, fuso);
  const [{ blocos, truncada }, bloqueios, jornadas, funcionamento] = await Promise.all([
    r.agenda.listarAgenda(ctx, {
      periodo: { de: periodo.de, ate: periodo.ate },
      profissionalId: filtro,
      limite: LIMITES_AGENDA.itens,
      // C4/CA-33: o "n de N" é só do gestor (o do profissional sugeriria serviços de outras pessoas).
      comPosicao: !('profissionalId' in escopo),
    }),
    lerBloqueios(ctx, { de: periodo.de, ate: periodo.ate }, filtro === null ? {} : { profissionalId: filtro }),
    r.agenda.listarJornadas(ctx, filtro),
    lerFuncionamento(ctx),
  ]);

  const porProfissional = new Map<string, { id: string; diaSemana: number; inicioMin: number; fimMin: number }[]>();
  for (const l of jornadas) {
    const lista = porProfissional.get(l.profissionalId) ?? [];
    lista.push(l);
    porProfissional.set(l.profissionalId, lista);
  }
  const semanas = new Map<string, SemanaHoraria>([...porProfissional].map(([id, linhas]) => [id, montarSemana(linhas)]));

  return montarVista({
    data: parametros.data,
    visao: parametros.visao,
    fuso,
    hoje,
    profissionais: visiveis,
    filtro,
    colunaSempre: filtro !== null,
    comOpcoes: !('profissionalId' in escopo),
    blocos: blocos.map(paraBloco),
    bloqueios,
    jornadas: semanas,
    funcionamento,
    truncada,
  });
}

/**
 * RN-35: gestor e profissional somam os itens VISÍVEIS não cancelados (`reserva` / `seus_servicos`); com o
 * status derivado `cancelado` (todos os itens cancelados), a soma de todos os visíveis, rótulo `cancelada`.
 */
export function totalDoDetalhe(
  itens: readonly Pick<ItemDoDetalhe, 'status' | 'precoCentavos'>[],
  statusDaReserva: DetalheDaReserva['status'],
  papel: DetalheDaReserva['papel'],
): TotalDoDetalhe {
  const cancelada = statusDaReserva === 'cancelado';
  const somados = cancelada ? itens : itens.filter((i) => i.status !== 'cancelado');
  return {
    centavos: somados.reduce((t, i) => t + i.precoCentavos, 0),
    servicos: somados.length,
    rotulo: cancelada ? 'cancelada' : papel === 'gestor' ? 'reserva' : 'seus_servicos',
  };
}

/**
 * Detalhe somente leitura de uma reserva (D-028 RN-10/RN-11; D-050 §3.9). Reserva inexistente, malformada,
 * de outro salão ou SEM ITEM do profissional logado → NaoEncontrado, sempre o mesmo. O profissional recebe
 * só os próprios itens (CA-33): os dos outros nem chegam ao DTO, e o total soma só os dele. `acoes` de cada
 * item vem da máquina de status (`acoesPermitidas`, por item) no instante `agora`. O telefone vem de
 * lerContatoDaCliente (operação `cliente.contato`); se essa leitura falhar, o detalhe abre sem o telefone.
 * As mensagens vêm de consultarMensagensDaReserva (D-043); aqui só o indicador de falha vigente.
 */
export async function lerReservaDaAgenda(ctx: TenantContext, id: unknown, agora: Date): Promise<DetalheDaReserva> {
  exigirPermissao(ctx, 'agenda.ver');
  const escopo = filtroDeProfissional(ctx, 'agenda.ver');
  const papel: DetalheDaReserva['papel'] = 'profissionalId' in escopo ? 'profissional' : 'gestor';
  const r = repos();
  const linha = await r.agenda.detalhe(ctx, id, 'profissionalId' in escopo ? escopo.profissionalId : null);
  const fuso = await r.bloqueios.fusoDoSalao(ctx);
  let contato: DetalheDaReserva['contato'] = null;
  if (!linha.clienteAnonimizada) {
    try {
      const c = await lerContatoDaCliente(ctx, linha.clienteId);
      contato = c.telefoneE164 === null ? null : { telefoneE164: c.telefoneE164 };
    } catch {
      contato = null;
    }
  }
  const itens: ItemDoDetalhe[] = linha.itens.map((i) => ({
    ...i,
    acoes: acoesPermitidas({ status: i.status, inicio: i.inicio, fim: i.fim, agora }),
  }));
  const cancelaveis = itens.filter((i) => i.acoes.cancelar).length;
  return {
    id: linha.id,
    clienteId: linha.clienteId,
    fuso,
    clienteNome: linha.clienteNome,
    anonimizada: linha.clienteAnonimizada,
    contato,
    data: partesLocais(linha.inicio, fuso).data,
    status: linha.status,
    origem: linha.origem,
    temFalhaDeMensagem: linha.temFalhaDeMensagem,
    itens,
    total: totalDoDetalhe(itens, linha.status, papel),
    temItemCancelado: itens.some((i) => i.status === 'cancelado'),
    // A-14/ND-3: "Cancelar todos" é só do gestor (linha `reserva.cancelar_todos` = salao/negado) e só com 2+
    // itens canceláveis; a ação da T-6 continua sendo a guarda real.
    podeCancelarTodos: papel === 'gestor' && cancelaveis >= 2,
    papel,
  };
}
