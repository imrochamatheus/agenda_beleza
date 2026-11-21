import { exigirPermissao, filtroDeProfissional } from '@/server/auth/permissoes';
import { lerBloqueios } from '@/server/bloqueios/leitura';
import { lerContatoDaCliente } from '@/server/clientes/leitura';
import { repos } from '@/server/repos';
import type { LinhaAgenda } from '@/server/repos/agenda';
import { lerFuncionamento } from '@/server/salao/funcionamento-leitura';
import { montarSemana } from '@/server/semana/montagem';
import type { SemanaHoraria } from '@/server/semana/tipos';
import { partesLocais } from '@/server/tempo/fuso';
import type { TenantContext } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';

import { montarPeriodo } from './periodo';
import { montarVista } from './montagem';
import { LIMITES_AGENDA } from './tipos';
import type { AgendaVista, DetalheDaReserva, ReservaDaAgenda } from './tipos';
import { lerParametros } from './validacao';
import type { ParametrosBrutos } from './validacao';

// Leitura da agenda da equipe (D-028 §3). SOMENTE LEITURA e sem checagem de suspensão (RN-4, CA-10):
// a futura E6.x mantém `agenda.ver` liberada. Seis instruções SQL por consulta, qualquer que seja o
// número de reservas, datas e profissionais (CA-16): fuso, profissionais, reservas, bloqueios,
// jornadas e funcionamento. Não importado pela página pública (CA-17).

function paraReserva(l: LinhaAgenda): ReservaDaAgenda {
  return {
    id: l.id,
    profissionalId: l.profissionalId,
    inicio: l.inicio,
    fim: l.fim,
    status: l.status,
    origem: l.origem,
    encaixe: l.encaixe,
    clienteNome: l.clienteNome,
    itens: l.itens,
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
  const [{ reservas, truncada }, bloqueios, jornadas, funcionamento] = await Promise.all([
    r.agenda.listarAgenda(ctx, {
      periodo: { de: periodo.de, ate: periodo.ate },
      profissionalId: filtro,
      limite: LIMITES_AGENDA.reservas,
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
    reservas: reservas.map(paraReserva),
    bloqueios,
    jornadas: semanas,
    funcionamento,
    truncada,
  });
}

/**
 * Detalhe somente leitura de uma reserva (RN-10, RN-11). Reserva inexistente, malformada, de outro
 * salão ou de outro profissional → NaoEncontrado, sempre o mesmo. O telefone vem de lerContatoDaCliente
 * (operação `cliente.contato`); se essa leitura falhar, o detalhe abre sem o telefone. Sem mensagens.
 */
export async function lerReservaDaAgenda(ctx: TenantContext, id: unknown): Promise<DetalheDaReserva> {
  exigirPermissao(ctx, 'agenda.ver');
  const escopo = filtroDeProfissional(ctx, 'agenda.ver');
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
  return {
    id: linha.id,
    fuso,
    profissional: { id: linha.profissionalId, nome: linha.profissionalNome, ativo: linha.profissionalAtivo },
    clienteNome: linha.clienteNome,
    anonimizada: linha.clienteAnonimizada,
    contato,
    inicio: linha.inicio,
    fim: linha.fim,
    status: linha.status,
    origem: linha.origem,
    encaixe: linha.encaixe,
    itens: linha.itens,
    totalCentavos: linha.itens.reduce((t, i) => t + i.precoCentavos, 0),
    duracaoTotalMin: linha.itens.reduce((t, i) => t + i.duracaoMin, 0),
  };
}
