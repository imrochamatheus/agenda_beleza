// Dados da página pública do salão e do passo atual do fluxo (D-026 §2, §3; D-050 §3.10). Sem next/*. Todo
// acesso parte do `PublicoContext` do slug; horários só de `consultarDisponibilidadePorServico` (RN-7, RN-10),
// nunca recalculados aqui: os itens já escolhidos entram como `escolhidos` e a consulta os desconta.
import { datasDoPeriodo, limitesDaJanela } from '@/domain/disponibilidade';
import { consultarDisponibilidadePorServico, horarioOferecido } from '@/server/disponibilidade/servico';
import type { DisponibilidadeDoServico, ItemJaEscolhido } from '@/server/disponibilidade/tipos';
import { limitarPorIp } from '@/server/protecao/limite';
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
import { compararDatas, somarDias } from '@/server/tempo/fuso';
import type { DataCivil } from '@/server/tempo/fuso';

import type { DecisaoAgendamento } from './agendamento';
import { decidirAgendamento } from './estado';
import { chaveDeData, DIAS_POR_PAGINA, valorDoItem, valoresDosItens } from './passos';
import type { ItemDaUrl, PassoLido } from './passos';
import type { CodigoAviso, ConsultaDaUrl, ItemEscolhido, ProfissionalComHorarios, Selecao, VisaoDoPasso } from './tipos';

const MS_MIN = 60_000;

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
    servicos: escolhidos.map(({ id, nome, precoCentavos, duracaoMin }) => ({ id, nome, precoCentavos, duracaoMin })),
    precoTotalCentavos: escolhidos.reduce((t, s) => t + s.precoCentavos, 0),
  };
}

/** Item resolvido para o roteiro/resumo; o fim usa a duração ATUAL do serviço (a mesma da consulta). */
export function itemEscolhido(
  indice: number,
  servico: { id: string; nome: string; precoCentavos: number; duracaoMin: number },
  item: ItemDaUrl,
  profissionalNome: string,
): ItemEscolhido {
  return {
    indice,
    servicoId: servico.id,
    servicoNome: servico.nome,
    profissionalId: item.profissionalId,
    profissionalNome,
    inicioIso: item.inicio.toISOString(),
    fimIso: new Date(item.inicio.getTime() + servico.duracaoMin * MS_MIN).toISOString(),
    precoCentavos: servico.precoCentavos,
    duracaoMin: servico.duracaoMin,
  };
}

/** Por início; empate (não deve haver, RN-8) pelo índice. */
export const porInicio = (a: ItemEscolhido, b: ItemEscolhido): number =>
  a.inicioIso < b.inicioIso ? -1 : a.inicioIso > b.inicioIso ? 1 : a.indice - b.indice;

/** Profissionais do serviço com os horários (ISO) da data, na ordem da consulta (nome, id). */
export function profissionaisComHorarios(d: DisponibilidadeDoServico, data: DataCivil): ProfissionalComHorarios[] {
  return d.profissionais.map((p) => ({
    id: p.profissionalId,
    nome: p.nome,
    horarios: (p.dias.find((x) => compararDatas(x.data, data) === 0)?.horarios ?? []).map((h) => h.inicio.toISOString()),
  }));
}

/** Itens não nulos como `escolhidos` da consulta (um por serviço; `servicoId` = s[k]). */
export function comoEscolhidos(s: readonly string[], itens: readonly (ItemDaUrl | null)[]): ItemJaEscolhido[] {
  return itens.flatMap((x, k) => (x === null ? [] : [{ servicoId: s[k], profissionalId: x.profissionalId, inicio: x.inicio }]));
}

type Contexto = {
  servicos: readonly ServicoPublico[];
  /** Profissionais ativos do salão (nomes dos itens já escolhidos no passo de um serviço). */
  equipe: readonly ProfissionalPublico[];
  regras: RegrasDaPagina;
  agora: Date;
};

type EntradaDaVisaoDoServico = {
  s: string[];
  data: DataCivil;
  fuso: string;
  selecao: Selecao;
  indice: number;
  /** Itens válidos (os inválidos já como null); o do índice é ignorado no roteiro. */
  itens: (ItemDaUrl | null)[];
  disponibilidade: DisponibilidadeDoServico;
  nomes: ReadonlyMap<string, string>;
  filtro: string | null;
  /** Item a pré-selecionar se ainda oferecido ("Alterar"). */
  atual: ItemDaUrl | null;
  alterando: boolean;
  aviso: CodigoAviso | null;
  horarioPerdidoIso: string | null;
};

function visaoDoServico(e: EntradaDaVisaoDoServico): Extract<VisaoDoPasso, { passo: 'servico' }> {
  const servico = e.selecao.servicos[e.indice];
  const todos = profissionaisComHorarios(e.disponibilidade, e.data);
  const opcoesDeFiltro = todos.map(({ id, nome }) => ({ id, nome }));
  const filtro = e.filtro !== null && todos.some((p) => p.id === e.filtro) ? e.filtro : null;
  const escolhidos: ItemEscolhido[] = [];
  const pendentes: number[] = [];
  e.itens.forEach((x, k) => {
    if (k === e.indice) return;
    const nome = x === null ? undefined : e.nomes.get(x.profissionalId);
    if (x === null || nome === undefined) pendentes.push(k);
    else escolhidos.push(itemEscolhido(k, e.selecao.servicos[k], x, nome));
  });
  const atualOferecido = e.atual !== null && horarioOferecido(e.disponibilidade, e.atual.profissionalId, e.atual.inicio);
  const semHorario = todos.every((p) => p.horarios.length === 0);
  return {
    passo: 'servico',
    s: e.s,
    data: chaveDeData(e.data),
    fuso: e.fuso,
    selecao: e.selecao,
    indice: e.indice,
    total: e.s.length,
    servico,
    escolhidos: escolhidos.sort(porInicio),
    pendentes,
    profissionais: filtro === null ? todos : todos.filter((p) => p.id === filtro),
    opcoesDeFiltro,
    filtro,
    preSelecionado: atualOferecido ? valorDoItem(e.atual!.profissionalId, e.atual!.inicio) : null,
    alterando: e.alterando,
    proximoEhDados: pendentes.length === 0,
    vazio: semHorario ? (e.disponibilidade.vazioPorConflito ? 'conflito' : 'calendario') : null,
    aviso: e.aviso,
    horarioPerdidoIso: e.horarioPerdidoIso,
    consulta: { s: e.s, data: chaveDeData(e.data), h: valoresDosItens(e.itens) },
  };
}

/** Aviso e horário perdido de um item que deixou de ser oferecido (5.7). */
function perdaDoItem(d: DisponibilidadeDoServico, x: ItemDaUrl): { aviso: CodigoAviso; horarioPerdidoIso: string | null } {
  return d.profissionais.some((p) => p.profissionalId === x.profissionalId)
    ? { aviso: 'horario_indisponivel', horarioPerdidoIso: x.inicio.toISOString() }
    : { aviso: 'profissional_indisponivel', horarioPerdidoIso: null };
}

const voltarAosServicos: VisaoDoPasso = { passo: 'servicos', marcados: [], aviso: 'servico_indisponivel' };

/**
 * View-model do passo pedido. Se algo mudou desde o passo anterior (serviço desativado, profissional
 * inativo, horário tomado), devolve o passo válido mais avançado com um aviso de código fechado. Cada passo
 * que calcula horários faz UMA consulta de disponibilidade (6 instruções SQL, D-018/D-050 CA-3).
 */
export async function carregarPasso(ctx: PublicoContext, passo: PassoLido, contexto: Contexto): Promise<VisaoDoPasso> {
  const { servicos, regras, agora } = contexto;
  if (passo.passo === 'servicos') {
    const ofertaveis = new Set(servicos.map((s) => s.id.toLowerCase()));
    return { passo: 'servicos', marcados: passo.marcados.filter((id) => ofertaveis.has(id)), aviso: passo.aviso };
  }
  const selecao = montarSelecao(servicos, passo.s);
  if (selecao === null) return voltarAosServicos;

  const ultima = somarDias(regras.hoje, regras.janelaDias);
  if (passo.passo === 'data') {
    const fim = somarDias(passo.de, DIAS_POR_PAGINA - 1);
    const ate = compararDatas(fim, ultima) > 0 ? ultima : fim;
    const r = await consultarDisponibilidadePorServico(ctx, { servicoIds: passo.s, de: passo.de, ate, agora });
    if (r.resultado !== 'ok') return voltarAosServicos;
    // DA-2: o dia é oferecido se CADA serviço tem ao menos um horário nele (não garante a combinação).
    const temNoDia = (d: DataCivil) =>
      r.servicos.every((sv) => sv.profissionais.some((p) => p.dias.some((x) => compararDatas(x.data, d) === 0 && x.horarios.length > 0)));
    const anterior = somarDias(passo.de, -DIAS_POR_PAGINA);
    const proxima = somarDias(passo.de, DIAS_POR_PAGINA);
    return {
      passo: 'data',
      s: passo.s,
      selecao,
      de: chaveDeData(passo.de),
      dias: datasDoPeriodo(passo.de, ate).map((d) => ({ data: chaveDeData(d), temHorarios: temNoDia(d) })),
      anterior: compararDatas(passo.de, regras.hoje) > 0
        ? chaveDeData(compararDatas(anterior, regras.hoje) < 0 ? regras.hoje : anterior)
        : null,
      proxima: compararDatas(proxima, ultima) <= 0 ? chaveDeData(proxima) : null,
      aviso: passo.aviso,
    };
  }

  if (passo.passo === 'servico') {
    // Itens de outros serviços com profissional fora da equipe ativa contam como pendentes e não ocupam nada.
    const nomes = new Map(contexto.equipe.map((p) => [p.id.toLowerCase(), p.nome]));
    const itens = passo.itens.map((x, k) => (k === passo.indice || (x !== null && nomes.has(x.profissionalId)) ? x : null));
    const outros = itens.map((x, k) => (k === passo.indice ? null : x));
    const r = await consultarDisponibilidadePorServico(ctx, {
      servicoIds: passo.s,
      de: passo.data,
      ate: passo.data,
      agora,
      escolhidos: comoEscolhidos(passo.s, outros),
      calcular: [passo.s[passo.indice]],
    });
    if (r.resultado !== 'ok') return voltarAosServicos;
    const d = r.servicos[0];
    const atual = passo.preSelecionado;
    const perda = atual !== null && !horarioOferecido(d, atual.profissionalId, atual.inicio) ? perdaDoItem(d, atual) : null;
    return visaoDoServico({
      s: passo.s,
      data: passo.data,
      fuso: r.fuso,
      selecao,
      indice: passo.indice,
      itens,
      disponibilidade: d,
      nomes,
      filtro: passo.filtro,
      atual,
      alterando: passo.alterando,
      aviso: perda?.aviso ?? passo.aviso,
      horarioPerdidoIso: perda?.horarioPerdidoIso ?? null,
    });
  }

  // Dados: UMA consulta com todos os itens como escolhidos e todos os serviços calculados. O serviço k é
  // calculado sem o próprio item, então "item k oferecido" = item k cabe com todos os outros (RN-7..RN-10).
  // O primeiro item que não cabe volta ao passo dele, montado com o MESMO resultado (sem segunda consulta).
  const r = await consultarDisponibilidadePorServico(ctx, {
    servicoIds: passo.s,
    de: passo.data,
    ate: passo.data,
    agora,
    escolhidos: comoEscolhidos(passo.s, passo.itens),
  });
  if (r.resultado !== 'ok') return voltarAosServicos;
  const nomes = new Map(r.servicos.flatMap((sv) => sv.profissionais.map((p) => [p.profissionalId, p.nome] as const)));
  const caiu = passo.itens.findIndex((x, k) => !horarioOferecido(r.servicos[k], x.profissionalId, x.inicio));
  if (caiu >= 0) {
    const perda = perdaDoItem(r.servicos[caiu], passo.itens[caiu]);
    return visaoDoServico({
      s: passo.s,
      data: passo.data,
      fuso: r.fuso,
      selecao,
      indice: caiu,
      itens: passo.itens.map((x, k) => (k === caiu ? null : x)),
      disponibilidade: r.servicos[caiu],
      nomes,
      filtro: null,
      atual: null,
      alterando: false,
      aviso: perda.aviso,
      horarioPerdidoIso: perda.horarioPerdidoIso,
    });
  }
  const itens = passo.itens
    .map((x, k) => itemEscolhido(k, selecao.servicos[k], x, nomes.get(x.profissionalId)!))
    .sort(porInicio);
  const consulta: ConsultaDaUrl = { s: passo.s, data: chaveDeData(passo.data), h: valoresDosItens(passo.itens) };
  return {
    passo: 'dados',
    s: passo.s,
    data: chaveDeData(passo.data),
    fuso: r.fuso,
    selecao,
    itens,
    totalCentavos: itens.reduce((t, i) => t + i.precoCentavos, 0),
    consulta,
  };
}

/**
 * Como `carregarPasso`, mas os passos que calculam disponibilidade (data, serviço e dados) consomem o
 * limite de consultas do IP (D-027 RN-9). Excedido: `{ passo: 'limitado' }` e NENHUM cálculo é feito (CA-14).
 * O passo de serviços não calcula horários e não consome cota.
 */
export async function carregarPassoComLimite(
  ctx: PublicoContext,
  passo: PassoLido,
  contexto: Contexto & { ip: string },
  limitar: typeof limitarPorIp = limitarPorIp,
): Promise<VisaoDoPasso> {
  if (passo.passo !== 'servicos') {
    const r = await limitar(contexto.ip, 'disponibilidade', contexto.agora);
    if (!r.permitido) return { passo: 'limitado' };
  }
  return carregarPasso(ctx, passo, contexto);
}
