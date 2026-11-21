// Consulta de disponibilidade (D-018 §3.4, E3.1): valida a entrada, lê o necessário em NO MÁXIMO seis
// instruções SQL (constante, independente de datas e profissionais, RN-19/CA-26), monta a entrada do
// domínio puro e devolve um resultado discriminado. Só leitura: E3.2 revalida na criação da reserva
// e a exclusion constraint é a garantia final. Quem chama aplica permissão e política de assinatura.
import { calcularDisponibilidade, datasDoPeriodo, limitesDaJanela, periodoDeLeitura } from '@/domain/disponibilidade';
import type { AgendaDoProfissional, FuncionamentoDeAgenda, Intervalo } from '@/domain/disponibilidade';
import { repos } from '@/server/repos';
import type { RepoDisponibilidade } from '@/server/repos/disponibilidade';
import { ehUuid } from '@/server/repos/ids';
import { montarSemana } from '@/server/semana/montagem';
import type { ContextoDeLeituraDeAgenda } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';
import { compararDatas, diferencaEmDias } from '@/server/tempo/fuso';

import type {
  DisponibilidadeDeProfissional,
  EntradaDisponibilidade,
  ResultadoDisponibilidade,
  ResultadoElegiveis,
} from './tipos';
import { validarEntradaEstrutural, validarServicos } from './validacao';


function agoraValido(agora: Date): void {
  if (!(agora instanceof Date) || Number.isNaN(agora.getTime())) {
    throw new RangeError('`agora` inválido');
  }
}

/** A-12: `semana.map(d => d.intervalos)`; o discriminador é só `definido` (A-11). */
function funcionamentoDeAgenda(f: { definido: boolean; linhas: { diaSemana: number; inicioMin: number; fimMin: number }[] }): FuncionamentoDeAgenda {
  return f.definido
    ? { definido: true, dias: montarSemana(f.linhas).map((d) => d.intervalos) }
    : { definido: false };
}

/**
 * Horários disponíveis para a combinação de serviços, por profissional elegível (ativo e vinculado a
 * TODOS os serviços), no fuso do salão. Lança `NaoEncontrado` para profissional malformado, inexistente
 * ou de outro salão (RN-16) e `RangeError` para `agora` inválido.
 */
export async function consultarDisponibilidade(
  ctx: ContextoDeLeituraDeAgenda,
  entrada: EntradaDisponibilidade,
  leitor: RepoDisponibilidade = repos().disponibilidade,
): Promise<ResultadoDisponibilidade> {
  agoraValido(entrada.agora);
  const invalida = validarEntradaEstrutural(entrada);
  if (invalida !== null) {
    return { resultado: 'entrada_invalida', motivo: invalida };
  }
  const profissionalId = entrada.profissionalId ?? null;
  if (profissionalId !== null && !ehUuid(profissionalId)) {
    throw new NaoEncontrado();
  }

  const { regras, funcionamento } = await leitor.lerRegras(ctx);
  if (diferencaEmDias(entrada.de, entrada.ate) + 1 > regras.janelaDias + 1) {
    return { resultado: 'entrada_invalida', motivo: 'periodo_longo' };
  }

  const servicos = await leitor.servicosOfertaveis(ctx, entrada.servicoIds);
  const porId = new Map(servicos.map((s) => [s.id, s]));
  if (!entrada.servicoIds.every((id) => porId.has(id))) {
    return { resultado: 'servico_indisponivel' };
  }
  const escolhidos = entrada.servicoIds.map((id) => {
    const s = porId.get(id)!;
    return { id: s.id, nome: s.nome, duracaoMin: s.duracaoMin, precoCentavos: s.precoCentavos };
  });
  const duracaoTotalMin = escolhidos.reduce((t, s) => t + s.duracaoMin, 0);
  const precoTotalCentavos = escolhidos.reduce((t, s) => t + s.precoCentavos, 0);

  const candidatos = await leitor.candidatos(ctx, entrada.servicoIds, profissionalId);
  if (profissionalId !== null && candidatos.length === 0) {
    throw new NaoEncontrado();
  }
  const elegiveis = candidatos.filter((p) => p.ativo && p.vinculos === entrada.servicoIds.length);

  // Recorta o período pedido à janela [hoje, hoje + janela_dias] (A-7): só o recorte é lido.
  const { hoje, ultima } = limitesDaJanela(entrada.agora, regras);
  const de = compararDatas(entrada.de, hoje) < 0 ? hoje : entrada.de;
  const ate = compararDatas(entrada.ate, ultima) > 0 ? ultima : entrada.ate;
  const recorteVazio = compararDatas(de, ate) > 0;

  let agendas: AgendaDoProfissional[];
  let bloqueiosDoSalao: Intervalo[] = [];
  if (elegiveis.length === 0 || recorteVazio) {
    // Curto-circuito: nenhuma leitura de jornada, bloqueio ou reserva (A-4).
    agendas = elegiveis.map((p) => ({ profissionalId: p.id, jornada: [], bloqueios: [], ocupacoes: [] }));
  } else {
    const ids = elegiveis.map((p) => p.id);
    const periodo = periodoDeLeitura(de, ate, regras);
    const [jornadas, bloqueios, ocupacoes] = await Promise.all([
      leitor.jornadas(ctx, ids),
      leitor.bloqueios(ctx, ids, periodo),
      leitor.ocupacoes(ctx, ids, periodo),
    ]);
    bloqueiosDoSalao = bloqueios.filter((b) => b.profissionalId === null).map((b) => ({ inicio: b.inicio, fim: b.fim }));
    agendas = elegiveis.map((p) => ({
      profissionalId: p.id,
      jornada: jornadas
        .filter((j) => j.profissionalId === p.id)
        .map((j) => ({ diaSemana: j.diaSemana, inicioMin: j.inicioMin, fimMin: j.fimMin })),
      bloqueios: bloqueios.filter((b) => b.profissionalId === p.id).map((b) => ({ inicio: b.inicio, fim: b.fim })),
      ocupacoes: ocupacoes
        .filter((o) => o.profissionalId === p.id)
        .map((o) => ({ inicio: o.inicio, fim: o.ocupadoAte })),
    }));
  }

  const calculado = calcularDisponibilidade({
    agora: entrada.agora,
    regras,
    funcionamento: funcionamentoDeAgenda(funcionamento),
    duracaoMin: duracaoTotalMin,
    datas: datasDoPeriodo(entrada.de, entrada.ate),
    bloqueiosDoSalao,
    profissionais: agendas,
  });
  const nomes = new Map(elegiveis.map((p) => [p.id, p.nome]));
  const profissionais: DisponibilidadeDeProfissional[] = calculado.map((p) => ({
    profissionalId: p.profissionalId,
    nome: nomes.get(p.profissionalId)!,
    dias: [...p.dias],
  }));

  return { resultado: 'ok', fuso: regras.fuso, duracaoTotalMin, precoTotalCentavos, servicos: escolhidos, profissionais };
}

/** Profissionais ativos vinculados a TODOS os serviços (RN-1): duas instruções SQL. */
export async function listarProfissionaisElegiveis(
  ctx: ContextoDeLeituraDeAgenda,
  servicoIds: readonly string[],
  leitor: RepoDisponibilidade = repos().disponibilidade,
): Promise<ResultadoElegiveis> {
  const invalida = validarServicos(servicoIds);
  if (invalida !== null) {
    return { resultado: 'entrada_invalida', motivo: invalida };
  }
  const servicos = await leitor.servicosOfertaveis(ctx, servicoIds);
  const ofertaveis = new Set(servicos.map((s) => s.id));
  if (!servicoIds.every((id) => ofertaveis.has(id))) {
    return { resultado: 'servico_indisponivel' };
  }
  const candidatos = await leitor.candidatos(ctx, servicoIds, null);
  return {
    resultado: 'ok',
    profissionais: candidatos
      .filter((p) => p.ativo && p.vinculos === servicoIds.length)
      .map((p) => ({ id: p.id, nome: p.nome })),
  };
}

