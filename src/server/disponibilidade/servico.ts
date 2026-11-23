// Consulta de disponibilidade POR SERVIÇO (D-050 §3.4, E3.6; base D-018 §3.4): valida a entrada, lê o
// necessário em NO MÁXIMO seis instruções SQL (constante, independente de serviços, datas e
// profissionais, CA-3), monta a entrada do domínio puro uma vez por serviço calculado e devolve um
// resultado discriminado. Só leitura: a criação revalida na transação e a exclusion constraint
// `reserva_item_sem_sobreposicao` é a garantia final. Quem chama aplica permissão e política.
//
// Não há segunda implementação de regra aqui (RN-12): os itens já escolhidos entram no domínio como
// ocupações extras do profissional ([inicio, fim + intervalo), RN-9) e como `ocupacoesDaCliente`
// ([inicio, fim), RN-8). O vazio por conflito (C3) reexecuta o MESMO domínio sem os escolhidos, com os
// dados já lidos (nenhuma instrução SQL a mais).
import { calcularDisponibilidade, datasDoPeriodo, limitesDaJanela, periodoDeLeitura } from '@/domain/disponibilidade';
import type {
  AgendaDoProfissional,
  DisponibilidadeCalculada,
  FuncionamentoDeAgenda,
  Intervalo,
} from '@/domain/disponibilidade';
import { repos } from '@/server/repos';
import type { CandidatoProfissional, RepoDisponibilidade } from '@/server/repos/disponibilidade';
import { ehUuid } from '@/server/repos/ids';
import { montarSemana } from '@/server/semana/montagem';
import type { ContextoDeLeituraDeAgenda } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';
import { compararDatas, diferencaEmDias } from '@/server/tempo/fuso';

import type {
  DisponibilidadeDoServico,
  EntradaDisponibilidadePorServico,
  ResultadoDisponibilidadePorServico,
} from './tipos';
import { validarCalculo, validarEntradaEstrutural, validarEscolhidos } from './validacao';

const MS_MIN = 60_000;

function agoraValido(agora: Date): void {
  if (!(agora instanceof Date) || Number.isNaN(agora.getTime())) {
    throw new RangeError('`agora` inválido');
  }
}

/** A-12 da D-018: `semana.map(d => d.intervalos)`; o discriminador é só `definido`. */
function funcionamentoDeAgenda(f: { definido: boolean; linhas: { diaSemana: number; inicioMin: number; fimMin: number }[] }): FuncionamentoDeAgenda {
  return f.definido
    ? { definido: true, dias: montarSemana(f.linhas).map((d) => d.intervalos) }
    : { definido: false };
}

/** Restrição de profissional por serviço (ids em minúsculas), ou null quando ausente/vazia. */
function lerRestricao(p: Readonly<Record<string, string>> | undefined): Map<string, string> | null {
  if (p === undefined || Object.keys(p).length === 0) return null;
  const m = new Map<string, string>();
  for (const [servicoId, profissionalId] of Object.entries(p)) {
    if (!ehUuid(profissionalId)) throw new NaoEncontrado();
    m.set(servicoId, profissionalId.toLowerCase());
  }
  return m;
}

const temHorario = (c: DisponibilidadeCalculada): boolean => c.some((p) => p.dias.some((d) => d.horarios.length > 0));

/**
 * Horários por serviço, cada um com os profissionais ATIVOS vinculados àquele serviço (RN-7), no fuso do
 * salão. Lança `NaoEncontrado` para um profissional de `profissionalPorServico` malformado, inexistente
 * ou de outro salão, e `RangeError` para `agora` inválido.
 */
export async function consultarDisponibilidadePorServico(
  ctx: ContextoDeLeituraDeAgenda,
  entrada: EntradaDisponibilidadePorServico,
  leitor: RepoDisponibilidade = repos().disponibilidade,
): Promise<ResultadoDisponibilidadePorServico> {
  agoraValido(entrada.agora);
  const invalida =
    validarEntradaEstrutural(entrada) ??
    validarEscolhidos(entrada.servicoIds, entrada.escolhidos) ??
    validarCalculo(entrada.servicoIds, entrada.calcular, entrada.profissionalPorServico);
  if (invalida !== null) {
    return { resultado: 'entrada_invalida', motivo: invalida };
  }
  const restricao = lerRestricao(entrada.profissionalPorServico);

  // 1: regras e funcionamento.
  const { regras, funcionamento } = await leitor.lerRegras(ctx);
  if (diferencaEmDias(entrada.de, entrada.ate) + 1 > regras.janelaDias + 1) {
    return { resultado: 'entrada_invalida', motivo: 'periodo_longo' };
  }

  // 2: serviços ofertáveis (todos os pedidos, inclusive os dos escolhidos).
  const servicos = await leitor.servicosOfertaveis(ctx, entrada.servicoIds);
  const servicoPorId = new Map(servicos.map((s) => [s.id, s]));
  if (!entrada.servicoIds.every((id) => servicoPorId.has(id))) {
    return { resultado: 'servico_indisponivel' };
  }
  const alvo = new Set(entrada.calcular ?? entrada.servicoIds);
  const calculados = entrada.servicoIds.filter((id) => alvo.has(id));

  // 3: candidatos (ativos do salão, ou só os da restrição) com os serviços que cada um executa.
  const restritos = restricao === null ? null : [...new Set(restricao.values())];
  const candidatos = await leitor.candidatos(ctx, entrada.servicoIds, restritos);
  if (restritos !== null && !restritos.every((id) => candidatos.some((p) => p.id === id))) {
    throw new NaoEncontrado();
  }
  const elegiveisPorServico = new Map<string, CandidatoProfissional[]>(
    calculados.map((k) => [
      k,
      candidatos.filter((p) => p.ativo && p.servicos.includes(k) && (restricao === null || restricao.get(k) === p.id)),
    ]),
  );
  const uniao = [...new Set([...elegiveisPorServico.values()].flatMap((ps) => ps.map((p) => p.id)))];

  // Recorta o período pedido à janela [hoje, hoje + janela_dias]: só o recorte é lido.
  const { hoje, ultima } = limitesDaJanela(entrada.agora, regras);
  const de = compararDatas(entrada.de, hoje) < 0 ? hoje : entrada.de;
  const ate = compararDatas(entrada.ate, ultima) > 0 ? ultima : entrada.ate;
  const recorteVazio = compararDatas(de, ate) > 0;

  const agendas = new Map<string, AgendaDoProfissional>();
  let bloqueiosDoSalao: Intervalo[] = [];
  if (uniao.length > 0 && !recorteVazio) {
    // 4–6: jornadas, bloqueios e ocupações da UNIÃO dos elegíveis, uma instrução cada.
    const periodo = periodoDeLeitura(de, ate, regras);
    const [jornadas, bloqueios, ocupacoes] = await Promise.all([
      leitor.jornadas(ctx, uniao),
      leitor.bloqueios(ctx, uniao, periodo),
      leitor.ocupacoes(ctx, uniao, periodo),
    ]);
    bloqueiosDoSalao = bloqueios.filter((b) => b.profissionalId === null).map((b) => ({ inicio: b.inicio, fim: b.fim }));
    for (const id of uniao) {
      agendas.set(id, {
        profissionalId: id,
        jornada: jornadas
          .filter((j) => j.profissionalId === id)
          .map((j) => ({ diaSemana: j.diaSemana, inicioMin: j.inicioMin, fimMin: j.fimMin })),
        bloqueios: bloqueios.filter((b) => b.profissionalId === id).map((b) => ({ inicio: b.inicio, fim: b.fim })),
        ocupacoes: ocupacoes.filter((o) => o.profissionalId === id).map((o) => ({ inicio: o.inicio, fim: o.ocupadoAte })),
      });
    }
  }
  // Curto-circuito (sem elegíveis ou recorte vazio): nenhuma leitura de jornada, bloqueio ou item.
  const agendaDe = (id: string): AgendaDoProfissional =>
    agendas.get(id) ?? { profissionalId: id, jornada: [], bloqueios: [], ocupacoes: [] };

  const intervaloMs = regras.intervaloMin * MS_MIN;
  const escolhidos = (entrada.escolhidos ?? []).map((e) => {
    const inicio = e.inicio.getTime();
    const fim = inicio + servicoPorId.get(e.servicoId)!.duracaoMin * MS_MIN;
    return { servicoId: e.servicoId, profissionalId: e.profissionalId.toLowerCase(), inicio, fim };
  });
  const datas = datasDoPeriodo(entrada.de, entrada.ate);
  const funcionamentoDoDominio = funcionamentoDeAgenda(funcionamento);

  const resultado: DisponibilidadeDoServico[] = calculados.map((k) => {
    const s = servicoPorId.get(k)!;
    const elegiveis = elegiveisPorServico.get(k)!;
    const outros = escolhidos.filter((e) => e.servicoId !== k);
    const calcular = (comEscolhidos: boolean): DisponibilidadeCalculada =>
      calcularDisponibilidade({
        agora: entrada.agora,
        regras,
        funcionamento: funcionamentoDoDominio,
        duracaoMin: s.duracaoMin,
        datas,
        bloqueiosDoSalao,
        profissionais: elegiveis.map((p) => {
          const base = agendaDe(p.id);
          if (!comEscolhidos) return base;
          const extras = outros
            .filter((e) => e.profissionalId === p.id)
            .map((e) => ({ inicio: new Date(e.inicio), fim: new Date(e.fim + intervaloMs) }));
          return extras.length === 0 ? base : { ...base, ocupacoes: [...base.ocupacoes, ...extras] };
        }),
        ocupacoesDaCliente: comEscolhidos ? outros.map((e) => ({ inicio: new Date(e.inicio), fim: new Date(e.fim) })) : [],
      });
    const comDesconto = calcular(true);
    const vazioPorConflito =
      outros.length > 0 && elegiveis.length > 0 && !temHorario(comDesconto) && temHorario(calcular(false));
    return {
      servicoId: s.id,
      nome: s.nome,
      duracaoMin: s.duracaoMin,
      precoCentavos: s.precoCentavos,
      profissionais: comDesconto.map((p, i) => ({ profissionalId: p.profissionalId, nome: elegiveis[i].nome, dias: [...p.dias] })),
      vazioPorConflito,
    };
  });

  return { resultado: 'ok', fuso: regras.fuso, intervaloMin: regras.intervaloMin, servicos: resultado };
}

/**
 * true se `inicio` é um horário oferecido a `profissionalId` em `servico` (comparação exata do instante).
 * Pura: apoio da revalidação (T-5/T-12) e do fluxo público (T-10), sem segunda regra.
 */
export function horarioOferecido(servico: DisponibilidadeDoServico, profissionalId: string, inicio: Date): boolean {
  const id = profissionalId.toLowerCase();
  const t = inicio.getTime();
  const p = servico.profissionais.find((x) => x.profissionalId === id);
  return p !== undefined && p.dias.some((d) => d.horarios.some((h) => h.inicio.getTime() === t));
}
