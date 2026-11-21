// Dados da página pública do salão e do passo atual do fluxo (D-026 §2, §3). Sem next/*. Todo acesso parte
// do `PublicoContext` do slug; horários só de `consultarDisponibilidade` (RN-7), nunca recalculados aqui.
import { datasDoPeriodo, limitesDaJanela } from '@/domain/disponibilidade';
import { consultarDisponibilidade, listarProfissionaisElegiveis } from '@/server/disponibilidade/servico';
import { lerFotosPublicas } from '@/server/fotos/leitura';
import type { FotoPublica } from '@/server/fotos/tipos';
import { repos } from '@/server/repos';
import {
  lerPerfilPublico,
  listarProfissionaisPublicos,
  listarServicosPublicos,
} from '@/server/repos/publico';
import type { PerfilPublico, ProfissionalPublico, ServicoPublico } from '@/server/repos/publico';
import type { PublicoContext } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';
import { compararDatas, somarDias } from '@/server/tempo/fuso';
import type { DataCivil } from '@/server/tempo/fuso';

import type { DecisaoAgendamento } from './agendamento';
import { decidirAgendamento } from './estado';
import { chaveDeData, DIAS_POR_PAGINA, QUALQUER } from './passos';
import type { PassoLido } from './passos';
import type { Selecao, VisaoDoPasso } from './tipos';

export type DadosDoSalao = {
  perfil: PerfilPublico;
  fotos: FotoPublica[];
  servicos: ServicoPublico[];
  equipe: ProfissionalPublico[];
  decisao: DecisaoDoSalao;
};
export type DecisaoDoSalao = DecisaoAgendamento;

/** Perfil, fotos, serviços, equipe e decisão: leituras independentes, em paralelo. */
export async function carregarSalao(ctx: PublicoContext, agora: Date): Promise<DadosDoSalao> {
  const [perfil, fotos, servicos, equipe, decisao] = await Promise.all([
    lerPerfilPublico(ctx),
    lerFotosPublicas(ctx),
    listarServicosPublicos(ctx),
    listarProfissionaisPublicos(ctx),
    decidirAgendamento(ctx, agora),
  ]);
  return { perfil, fotos, servicos, equipe, decisao };
}

export type RegrasDaPagina = { fuso: string; janelaDias: number; hoje: DataCivil };

/** Fuso, janela e "hoje" no fuso do salão (para `lerPasso`). */
export async function lerRegrasDaPagina(ctx: PublicoContext, agora: Date): Promise<RegrasDaPagina> {
  const { regras } = await repos().disponibilidade.lerRegras(ctx);
  return { fuso: regras.fuso, janelaDias: regras.janelaDias, hoje: limitesDaJanela(agora, regras).hoje };
}

/** Serviços escolhidos, na ordem da URL, com preço e duração; null se algum não é ofertável. */
export function montarSelecao(servicos: readonly ServicoPublico[], ids: readonly string[]): Selecao | null {
  const porId = new Map(servicos.map((s) => [s.id.toLowerCase(), s]));
  const escolhidos: ServicoPublico[] = [];
  for (const id of ids) {
    const s = porId.get(id);
    if (s === undefined) return null;
    escolhidos.push(s);
  }
  return {
    servicos: escolhidos,
    duracaoTotalMin: escolhidos.reduce((t, s) => t + s.duracaoMin, 0),
    precoTotalCentavos: escolhidos.reduce((t, s) => t + s.precoCentavos, 0),
  };
}


/** Horários do período, unidos por instante (ordem estável nome, id: o primeiro elegível leva). */
async function horariosDoPeriodo(
  ctx: PublicoContext,
  s: string[],
  p: string,
  de: DataCivil,
  ate: DataCivil,
  agora: Date,
): Promise<{ ok: true; fuso: string; profissionais: number; porData: Map<string, Map<number, { id: string; nome: string }>> } | { ok: false }> {
  let r;
  try {
    r = await consultarDisponibilidade(ctx, { servicoIds: s, profissionalId: p === QUALQUER ? null : p, de, ate, agora });
  } catch (e) {
    if (e instanceof NaoEncontrado) return { ok: false };
    throw e;
  }
  if (r.resultado !== 'ok') return { ok: false };
  const porData = new Map<string, Map<number, { id: string; nome: string }>>();
  for (const prof of r.profissionais) {
    for (const dia of prof.dias) {
      const chave = chaveDeData(dia.data);
      const mapa = porData.get(chave) ?? new Map<number, { id: string; nome: string }>();
      for (const h of dia.horarios) {
        const t = h.inicio.getTime();
        if (!mapa.has(t)) mapa.set(t, { id: prof.profissionalId, nome: prof.nome });
      }
      porData.set(chave, mapa);
    }
  }
  return { ok: true, fuso: r.fuso, profissionais: r.profissionais.length, porData };
}

/**
 * View-model do passo pedido. Se algo mudou desde o passo anterior (serviço desativado, nenhum
 * profissional, horário tomado), devolve o passo anterior com um aviso de código fechado.
 */
export async function carregarPasso(
  ctx: PublicoContext,
  passo: PassoLido,
  contexto: { servicos: readonly ServicoPublico[]; regras: RegrasDaPagina; agora: Date },
): Promise<VisaoDoPasso> {
  if (passo.passo === 'servicos') return { passo: 'servicos', aviso: passo.aviso };
  const { servicos, regras, agora } = contexto;
  const selecao = montarSelecao(servicos, passo.s);
  if (selecao === null) return { passo: 'servicos', aviso: 'servico_indisponivel' };

  const elegiveis = await listarProfissionaisElegiveis(ctx, passo.s);
  if (elegiveis.resultado !== 'ok') return { passo: 'servicos', aviso: 'servico_indisponivel' };
  if (elegiveis.profissionais.length === 0) return { passo: 'servicos', aviso: 'sem_profissional' };

  const voltarAoProfissional = (): VisaoDoPasso => ({
    passo: 'profissional',
    s: passo.s,
    selecao,
    profissionais: elegiveis.profissionais,
    aviso: 'profissional_indisponivel',
  });
  if (passo.passo === 'profissional') {
    return { passo: 'profissional', s: passo.s, selecao, profissionais: elegiveis.profissionais, aviso: passo.aviso };
  }
  if (passo.p !== QUALQUER && !elegiveis.profissionais.some((x) => x.id.toLowerCase() === passo.p)) {
    return voltarAoProfissional();
  }

  const ultima = somarDias(regras.hoje, regras.janelaDias);
  if (passo.passo === 'data') {
    const fim = somarDias(passo.de, DIAS_POR_PAGINA - 1);
    const ate = compararDatas(fim, ultima) > 0 ? ultima : fim;
    const r = await horariosDoPeriodo(ctx, passo.s, passo.p, passo.de, ate, agora);
    if (!r.ok || r.profissionais === 0) return voltarAoProfissional();
    const anterior = somarDias(passo.de, -DIAS_POR_PAGINA);
    const proxima = somarDias(passo.de, DIAS_POR_PAGINA);
    return {
      passo: 'data',
      s: passo.s,
      p: passo.p,
      selecao,
      de: chaveDeData(passo.de),
      dias: datasDoPeriodo(passo.de, ate).map((d) => ({
        data: chaveDeData(d),
        temHorarios: (r.porData.get(chaveDeData(d))?.size ?? 0) > 0,
      })),
      anterior: compararDatas(passo.de, regras.hoje) > 0
        ? chaveDeData(compararDatas(anterior, regras.hoje) < 0 ? regras.hoje : anterior)
        : null,
      proxima: compararDatas(proxima, ultima) <= 0 ? chaveDeData(proxima) : null,
      aviso: passo.aviso,
    };
  }

  const r = await horariosDoPeriodo(ctx, passo.s, passo.p, passo.data, passo.data, agora);
  if (!r.ok || r.profissionais === 0) return voltarAoProfissional();
  const doDia = r.porData.get(chaveDeData(passo.data)) ?? new Map<number, { id: string; nome: string }>();
  const horarios = [...doDia.keys()].sort((a, b) => a - b).map((t) => new Date(t).toISOString());
  const base = { s: passo.s, p: passo.p, data: chaveDeData(passo.data), selecao, fuso: r.fuso };
  if (passo.passo === 'horario') return { passo: 'horario', ...base, horarios, aviso: passo.aviso };

  const escolhido = doDia.get(passo.h.getTime());
  if (escolhido === undefined) return { passo: 'horario', ...base, horarios, aviso: 'horario_indisponivel' };
  return { passo: 'dados', ...base, inicioIso: passo.h.toISOString(), profissional: escolhido };
}
