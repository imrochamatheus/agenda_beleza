// Estado e conversão dos formulários das ações POR ITEM do detalhe da reserva (D-030; D-050 web-design §5.10,
// design §1.3 C2). Sem next/*, sem banco e sem imports de runtime de servidor além de tipos/constantes
// client-safe: é importado pelo componente cliente, pela casca 'use server' (acoes.ts), pela página e pelas
// vitrines. Abrir um formulário é GET (`?remarcar=<itemId>`, `?cancelar=<itemId>`, `?cancelar=todos`); erros
// voltam na resposta do POST (sem PRG); o sucesso é PRG para `?resultado=<código>` (lista fechada) + `#resultado`.
import { horaLocal, nomeDoProfissional, quantidadeDeServicos } from '@/app/painel/agenda/_componentes/roteiro';
import type { DetalheDaReserva, ItemDoDetalhe } from '@/server/agenda/tipos';
import { MENSAGEM_HORARIO_INDISPONIVEL, MENSAGENS_RESERVA_EQUIPE } from '@/server/reservas/tipos';
import type { MotivoEncaixe } from '@/server/reservas/tipos';
import { MENSAGENS_ALTERACAO } from '@/server/reservas/tipos-alteracao';
import type { EntradaRemarcarItem, ResultadoRemarcarItem, ResultadoStatusItem } from '@/server/reservas/tipos-alteracao';
import type { MotivoRecusaDeStatus } from '@/server/reservas/status';
import type { CodigoErro } from '@/server/tenant/erros';

type Parametros = Record<string, string | string[] | undefined>;
const umTexto = (v: string | string[] | undefined): string | null => (typeof v === 'string' ? v : null);
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Ids vêm da URL só para ESCOLHER entre os itens já lidos; nunca chegam ao banco por aqui. */
const ID = /^[0-9A-Za-z-]{1,64}$/;

// ── Resultado do PRG ────────────────────────────────────────────────────────────────────────────────────────

/** Lista fechada de resultados que a página mostra depois do redirect de sucesso. */
export const RESULTADOS_PRG = ['remarcado', 'cancelado', 'concluido', 'nao_compareceu', 'todos_cancelados'] as const;
export type CodigoPrg = (typeof RESULTADOS_PRG)[number];

/**
 * `item`: id do item alterado (o nome e a hora saem da leitura da página, não da URL); `de`: hora anterior
 * (HH:MM) da remarcação; `n`: serviços cancelados por "Cancelar todos".
 */
export type ResultadoPrg = { codigo: CodigoPrg; itemId: string | null; de: string | null; n: number | null };

/** `id` do alvo do resultado: o redirect leva a âncora e o navegador põe o foco nele. */
export const ANCORA_RESULTADO = 'resultado';

export function lerResultadoPrg(p: Parametros): ResultadoPrg | null {
  const codigo = umTexto(p.resultado);
  if (codigo === null || !(RESULTADOS_PRG as readonly string[]).includes(codigo)) return null;
  const item = umTexto(p.item);
  const de = umTexto(p.de);
  const n = umTexto(p.n);
  return {
    codigo: codigo as CodigoPrg,
    itemId: item !== null && ID.test(item) ? item : null,
    de: de !== null && HORA.test(de) ? de : null,
    n: n !== null && /^([1-9]|10)$/.test(n) ? Number(n) : null,
  };
}

/** Acrescenta parâmetros a uma base que pode já ter query (vitrine). */
function comParametros(base: string, params: Record<string, string>, ancora?: string): string {
  const q = new URLSearchParams(params).toString();
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${q === '' ? '' : `${sep}${q}`}${ancora ? `#${ancora}` : ''}`;
}

export function hrefDoResultado(base: string, r: Omit<ResultadoPrg, 'n' | 'de' | 'itemId'> & Partial<ResultadoPrg>): string {
  const params: Record<string, string> = { resultado: r.codigo };
  if (r.itemId) params.item = r.itemId;
  if (r.de) params.de = r.de;
  if (r.n) params.n = String(r.n);
  return comParametros(base, params, ANCORA_RESULTADO);
}

export const MENSAGENS_RESULTADO = Object.freeze({
  avisoCliente: 'A cliente será avisada se tiver aceitado as mensagens.',
  mensagemUnica: 'A cliente receberá uma única mensagem.',
  remarcadoSemItem: 'Serviço remarcado.',
  canceladoSemItem: 'Serviço cancelado.',
  concluidoSemItem: 'Serviço marcado como concluído.',
  naoCompareceuSemItem: 'Serviço marcado como não compareceu.',
});

/** Texto do resultado (web-design §5.10). Item ausente da leitura (ex.: id adulterado) → texto genérico. */
export function mensagemDoResultado(r: ResultadoPrg | null, d: Pick<DetalheDaReserva, 'itens' | 'fuso'>): string | null {
  if (r === null) return null;
  const i = r.itemId === null ? undefined : d.itens.find((x) => x.id === r.itemId);
  const M = MENSAGENS_RESULTADO;
  switch (r.codigo) {
    case 'remarcado':
      return i
        ? `${i.servicoNome}${r.de ? ` (${r.de})` : ''} foi remarcado para ${horaLocal(i.inicio, d.fuso)} com ${nomeDoProfissional(i)}.`
        : M.remarcadoSemItem;
    case 'cancelado':
      return `${i ? `${i.servicoNome} (${horaLocal(i.inicio, d.fuso)}) foi cancelado.` : M.canceladoSemItem} ${M.avisoCliente}`;
    case 'concluido':
      return i ? `${i.servicoNome} marcado como concluído.` : M.concluidoSemItem;
    case 'nao_compareceu':
      return i ? `${i.servicoNome} marcado como não compareceu.` : M.naoCompareceuSemItem;
    case 'todos_cancelados': {
      const n = r.n ?? 2;
      return `${quantidadeDeServicos(n)} ${n === 1 ? 'cancelado' : 'cancelados'}. ${M.mensagemUnica}`;
    }
  }
}

// ── Abertura por GET ────────────────────────────────────────────────────────────────────────────────────────

export type Abertura = { remarcar: string | null; cancelar: string | null; cancelarTodos: boolean };
export const NADA_ABERTO: Abertura = Object.freeze({ remarcar: null, cancelar: null, cancelarTodos: false });

export const ANCORA_REMARCAR = 'remarcar';
export const ANCORA_CANCELAR = 'cancelar';
export const ANCORA_CANCELAR_TODOS = 'cancelar-todos';

/**
 * Formulário aberto pela URL, conferido contra os itens VISÍVEIS e as ações que a máquina permite agora: id
 * desconhecido, de outro profissional ou sem a ação → nada aberto. Um só por vez (remarcar tem precedência).
 */
export function lerAbertura(p: Parametros, d: Pick<DetalheDaReserva, 'itens' | 'podeCancelarTodos'>): Abertura {
  const remarcar = umTexto(p.remarcar);
  const cancelar = umTexto(p.cancelar);
  const item = (id: string | null) => (id === null ? undefined : d.itens.find((i) => i.id === id));
  const r = item(remarcar);
  if (r?.acoes.remarcar) return { ...NADA_ABERTO, remarcar: r.id };
  if (cancelar === 'todos') return d.podeCancelarTodos ? { ...NADA_ABERTO, cancelarTodos: true } : NADA_ABERTO;
  const c = item(cancelar);
  return c?.acoes.cancelar ? { ...NADA_ABERTO, cancelar: c.id } : NADA_ABERTO;
}

export const hrefRemarcar = (base: string, itemId: string) => comParametros(base, { remarcar: itemId }, ANCORA_REMARCAR);
export const hrefCancelar = (base: string, itemId: string) => comParametros(base, { cancelar: itemId }, ANCORA_CANCELAR);
export const hrefCancelarTodos = (base: string) => comParametros(base, { cancelar: 'todos' }, ANCORA_CANCELAR_TODOS);

// ── Remarcar um item ────────────────────────────────────────────────────────────────────────────────────────

export type CampoRemarcar = 'servico' | 'profissional' | 'data' | 'hora';

export type ValoresRemarcar = {
  servicoId: string;
  /** Vazio = manter o atual (profissional logado: agenda própria). */
  profissionalId: string;
  /** AAAA-MM-DD; vazio = manter (a data é texto quando há outro item não cancelado, RN-22). */
  data: string;
  /** HH:MM */
  hora: string;
  confirmarEncaixe: boolean;
};

export type EstadoRemarcar = {
  /** Item do formulário que gerou este estado (a mensagem aparece na parada dele). */
  itemId: string | null;
  mensagem: string | null;
  erros: Partial<Record<CampoRemarcar, string>>;
  valores: ValoresRemarcar;
  motivos: MotivoEncaixe[] | null;
};

export const estadoRemarcarInicial = (itemId: string | null, valores: ValoresRemarcar): EstadoRemarcar => ({
  itemId,
  mensagem: null,
  erros: {},
  valores,
  motivos: null,
});

export const idDoCampoRemarcar = (c: CampoRemarcar): string => `remarcar-${c}`;

const texto = (v: FormDataEntryValue | null): string => (typeof v === 'string' ? v : '');

export function lerFormularioRemarcar(fd: FormData): { entrada: EntradaRemarcarItem; valores: ValoresRemarcar; itemId: string; de: string | null } {
  const valores: ValoresRemarcar = {
    servicoId: texto(fd.get('servicoId')).slice(0, 40),
    profissionalId: texto(fd.get('profissionalId')).slice(0, 40),
    data: texto(fd.get('data')).slice(0, 10),
    hora: texto(fd.get('hora')).slice(0, 5),
    confirmarEncaixe: fd.get('confirmarEncaixe') === 'on',
  };
  const de = texto(fd.get('de'));
  return {
    valores,
    itemId: texto(fd.get('itemId')),
    de: HORA.test(de) ? de : null,
    entrada: {
      reservaId: texto(fd.get('reservaId')),
      itemId: texto(fd.get('itemId')),
      servicoId: texto(fd.get('servicoId')),
      profissionalId: texto(fd.get('profissionalId')),
      data: texto(fd.get('data')),
      hora: texto(fd.get('hora')),
      confirmarEncaixe: fd.get('confirmarEncaixe'),
    },
  };
}

export const MENSAGENS_FORMULARIO_ALTERACAO = Object.freeze({
  /** DEF-1: 1ª opção (vazia) do select quando o profissional atual do item está inativo. */
  escolhaProfissional: 'Escolha a profissional',
  servicoIndisponivel: 'Este serviço não está disponível.',
  profissionalIndisponivel: 'Este profissional está inativo ou não realiza este serviço.',
  resumoErros: 'Corrija os campos indicados para remarcar o serviço.',
});

/** Desfecho de `remarcarItem` → estado do formulário (o sucesso não passa por aqui: é PRG). */
export function paraEstadoRemarcar(r: ResultadoRemarcarItem, itemId: string, valores: ValoresRemarcar): EstadoRemarcar {
  const base = estadoRemarcarInicial(itemId, valores);
  switch (r.resultado) {
    case 'atualizada':
      return base;
    case 'encaixe_requer_confirmacao':
      return { ...base, motivos: r.motivos, mensagem: MENSAGENS_RESERVA_EQUIPE.encaixeAviso };
    case 'horario_indisponivel':
      return { ...base, mensagem: r.causa === 'entre_itens' ? MENSAGENS_ALTERACAO.entre_itens : MENSAGEM_HORARIO_INDISPONIVEL };
    case 'servico_indisponivel':
      return { ...base, erros: { servico: MENSAGENS_FORMULARIO_ALTERACAO.servicoIndisponivel } };
    case 'profissional_indisponivel':
      return { ...base, erros: { profissional: MENSAGENS_FORMULARIO_ALTERACAO.profissionalIndisponivel } };
    case 'invalido': {
      const { servico, inicio, data, profissional } = r.erros;
      const erros: EstadoRemarcar['erros'] = {
        ...(servico && { servico }),
        ...(profissional && { profissional }),
        ...(data && { data }),
        ...(inicio && { hora: inicio }),
      };
      return { ...base, erros, mensagem: Object.keys(erros).length === 0 ? MENSAGENS_ALTERACAO.generico : null };
    }
    case 'recusado':
      return { ...base, mensagem: MENSAGENS_ALTERACAO[r.motivo] };
  }
}

// ── Cancelar item, marcar situação, cancelar todos ────────────────────────────────────────────────────────

/** Estado de cancelar e de marcar a situação de UM item: a recusa aparece na parada de `itemId`. */
export type EstadoDoItem = { itemId: string | null; mensagem: string | null };
export type EstadoCancelarTodos = { mensagem: string | null };

export const estadoDoItemInicial: EstadoDoItem = Object.freeze({ itemId: null, mensagem: null });
export const estadoCancelarTodosInicial: EstadoCancelarTodos = Object.freeze({ mensagem: null });

export const DESTINOS = ['concluido', 'nao_compareceu'] as const;

export const mensagemDaRecusaDeStatus = (m: MotivoRecusaDeStatus): string => MENSAGENS_ALTERACAO[m];

/** 403/404 da ação → texto uniforme (401 é redirect, tratado na casca). */
export function mensagemDeErro(erro: CodigoErro): string {
  return erro === 'acesso_negado' ? MENSAGENS_ALTERACAO.acessoNegado : erro === 'nao_encontrado' ? MENSAGENS_ALTERACAO.naoEncontrado : MENSAGENS_ALTERACAO.generico;
}

/** Código do PRG de sucesso de uma operação de status de item. */
export function codigoPrgDeStatus(r: Extract<ResultadoStatusItem, { resultado: 'atualizada' }>): CodigoPrg {
  return r.status === 'cancelado' ? 'cancelado' : r.status === 'concluido' ? 'concluido' : 'nao_compareceu';
}

// ── Textos por item (acessíveis) ──────────────────────────────────────────────────────────────────────────

/** "Escova 09:00" — usado na confirmação de "Cancelar todos". */
export const rotuloCurtoDoItem = (i: Pick<ItemDoDetalhe, 'servicoNome' | 'inicio'>, fuso: string): string =>
  `${i.servicoNome} ${horaLocal(i.inicio, fuso)}`;

export function textoConfirmarCancelamento(i: Pick<ItemDoDetalhe, 'servicoNome' | 'inicio' | 'profissionalNome' | 'profissionalAtivo'>, fuso: string): string {
  return `Cancelar ${i.servicoNome} (${horaLocal(i.inicio, fuso)} com ${nomeDoProfissional(i)})? O horário será liberado e a cliente será avisada, se tiver aceitado as mensagens. Os outros serviços continuam marcados.`;
}

export function textoConfirmarCancelarTodos(itens: readonly Pick<ItemDoDetalhe, 'servicoNome' | 'inicio'>[], fuso: string): string {
  const n = itens.length;
  return `Cancelar ${n === 1 ? 'o serviço que ainda pode ser cancelado' : `os ${n} serviços que ainda podem ser cancelados`} (${itens.map((i) => rotuloCurtoDoItem(i, fuso)).join(', ')})? Serviços concluídos ou já terminados ficam como estão. A cliente recebe uma única mensagem.`;
}
