// Reescolha depois de um conflito (D-036 DEF-1; D-050 CA-10, §3.10). Sem next/*. Quando o horário de algum
// item é tomado entre a escolha e o envio, a ação devolve, NA RESPOSTA, qual item caiu e os horários
// atualizados dele no mesmo dia; os outros itens ficam, e nome, telefone e aceites ficam no estado do
// formulário (nunca na URL: PII). Os horários vêm só de `consultarDisponibilidadePorServico` (sem segunda
// implementação). Os itens que caíram são RECALCULADOS aqui (o 23P01 não diz qual item foi, R-6).
import { consultarDisponibilidadePorServico, horarioOferecido } from '@/server/disponibilidade/servico';
import { limitarPorIp } from '@/server/protecao/limite';
import { resolverSalaoPorSlug } from '@/server/repos/publico';
import type { PublicoContext } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';

import { comoEscolhidos, itemEscolhido, porInicio, profissionaisComHorarios } from './pagina';
import { chaveDeData, lerData, lerHorario, lerServicoIds, lerUuid, slugPlausivel, valorDoItem, valoresDosItens } from './passos';
import type { ItemDaUrl } from './passos';
import type { ItemDaReescolha, ItemEscolhido, ReescolhaDosItens } from './tipos';

export type SelecaoDaReescolha = {
  s: readonly string[];
  /** AAAA-MM-DD. */
  data: string;
  /** Um por serviço, na ordem de `s`; `inicio` em ISO UTC canônico. */
  itens: readonly { profissionalId: string; inicio: string }[];
};

export type OpcoesDaReescolha = {
  /**
   * Índices a reabrir mesmo que ainda estejam livres: o reenvio da reescolha com erro de validação (nome,
   * telefone, aceite) continua mostrando as grades desses itens, com a escolha nova pré-selecionada.
   */
  reabrir?: readonly number[];
  /** Ponto de injeção do limite (só testes). */
  limitar?: typeof limitarPorIp;
};

function lerSelecaoDaReescolha(x: SelecaoDaReescolha): { s: string[]; data: ReturnType<typeof lerData>; itens: ItemDaUrl[] } | null {
  const s = lerServicoIds([...x.s]);
  const data = lerData(x.data);
  if (s === null || data === null || !Array.isArray(x.itens) || x.itens.length !== s.length) return null;
  const itens: ItemDaUrl[] = [];
  for (const i of x.itens) {
    const profissionalId = lerUuid(i?.profissionalId);
    const inicio = lerHorario(i?.inicio);
    if (profissionalId === null || inicio === null) return null;
    itens.push({ profissionalId, inicio });
  }
  return { s, data, itens };
}

async function contextoDoSlug(slug: string): Promise<PublicoContext | null> {
  if (!slugPlausivel(slug)) return null;
  try {
    const r = await resolverSalaoPorSlug(slug);
    return r.historico ? null : r.contexto;
  } catch (e) {
    if (e instanceof NaoEncontrado) return null;
    throw e;
  }
}

/**
 * Itens que caíram (não são mais oferecidos com os demais) e as alternativas de cada um. Uma unidade do
 * limite de consultas do IP ('disponibilidade'); uma consulta de disponibilidade, e uma segunda só quando 2+
 * itens precisam de novo horário (as alternativas de cada um descontam apenas os itens MANTIDOS).
 * `null`: slug, salão ou seleção inválidos, ou algum serviço deixou de ser ofertável (a casca volta aos
 * serviços com `servico_indisponivel`).
 */
export async function reescolhaDosItens(
  slug: string,
  selecao: SelecaoDaReescolha,
  agora: Date,
  ip: string,
  opcoes: OpcoesDaReescolha = {},
): Promise<ReescolhaDosItens | null> {
  const ctx = await contextoDoSlug(slug);
  const sel = lerSelecaoDaReescolha(selecao);
  if (ctx === null || sel === null || sel.data === null) return null;
  const { s, itens } = sel;
  const data = sel.data;

  const limite = await (opcoes.limitar ?? limitarPorIp)(ip, 'disponibilidade', agora);
  if (!limite.permitido) return { resultado: 'limitado' };

  const todos = await consultarDisponibilidadePorServico(ctx, {
    servicoIds: s,
    de: data,
    ate: data,
    agora,
    escolhidos: comoEscolhidos(s, itens),
  });
  if (todos.resultado !== 'ok') return null;

  const reabrir = new Set((opcoes.reabrir ?? []).filter((k) => Number.isInteger(k) && k >= 0 && k < s.length));
  const caiu = itens.map((x, k) => !horarioOferecido(todos.servicos[k], x.profissionalId, x.inicio));
  const abertos = s.map((_, k) => k).filter((k) => caiu[k] || reabrir.has(k));
  if (abertos.length === 0) return { resultado: 'sem_queda' };

  // Com um só item aberto, a primeira consulta já o calculou sem ele e com todos os outros (os mantidos).
  let alternativas = todos;
  if (abertos.length > 1) {
    const segunda = await consultarDisponibilidadePorServico(ctx, {
      servicoIds: s,
      de: data,
      ate: data,
      agora,
      escolhidos: comoEscolhidos(s, itens.map((x, k) => (abertos.includes(k) ? null : x))),
      calcular: abertos.map((k) => s[k]),
    });
    if (segunda.resultado !== 'ok') return null;
    alternativas = segunda;
  }
  const porServico = new Map(alternativas.servicos.map((d) => [d.servicoId, d]));
  const nomes = new Map(todos.servicos.flatMap((d) => d.profissionais.map((p) => [p.profissionalId, p.nome] as const)));

  const mantidos: ItemEscolhido[] = [];
  const abertosDto: ItemDaReescolha[] = [];
  for (const [k, x] of itens.entries()) {
    const d = todos.servicos[k];
    const servico = { id: d.servicoId, nome: d.nome, precoCentavos: d.precoCentavos, duracaoMin: d.duracaoMin };
    if (!abertos.includes(k)) {
      mantidos.push(itemEscolhido(k, servico, x, nomes.get(x.profissionalId)!));
      continue;
    }
    const alt = porServico.get(s[k])!;
    abertosDto.push({
      indice: k,
      servicoId: s[k],
      servicoNome: d.nome,
      horarioAnteriorIso: x.inicio.toISOString(),
      profissionalAnteriorNome: nomes.get(x.profissionalId) ?? null,
      profissionais: profissionaisComHorarios(alt, data),
      caiu: caiu[k],
      preSelecionado: !caiu[k] && horarioOferecido(alt, x.profissionalId, x.inicio) ? valorDoItem(x.profissionalId, x.inicio) : null,
    });
  }
  return {
    resultado: 'reescolher',
    fuso: todos.fuso,
    data: chaveDeData(data),
    mantidos: mantidos.sort(porInicio),
    itens: abertosDto,
    consulta: { s, data: chaveDeData(data), h: valoresDosItens(itens) },
  };
}
