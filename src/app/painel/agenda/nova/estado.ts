// Estado e conversão do formulário de reserva manual (D-029; D-050 §3.11 e web-design §5.8: uma data e N
// linhas "Serviço n" com serviço, profissional e hora). Sem next/*, sem banco e sem imports de servidor de
// runtime além de tipos/constantes client-safe: é importado por componentes cliente e pela casca
// 'use server' (acoes.ts), que só converte FormData e resultados.
//
// FormData: `data`, `itens` (quantidade de linhas), `item-<n>-servico|profissional|hora` (n 1-based, como
// "Serviço n" na tela), `linha` (`adicionar` | `remover:<n>`; presente = só mexe nas linhas, sem gravar),
// `nome`, `telefone`, consentimento, `confirmarEncaixe`, `chave`.
import { hrefAgenda } from '@/app/painel/agenda/_componentes/links';
import { CAMPOS_CONSENTIMENTO } from '@/config/termos';
import type { ResultadoReservaEquipe } from '@/server/reservas/reserva-equipe';
import type { EntradaReservaEquipe, MotivoEncaixe, MotivosDoItem } from '@/server/reservas/tipos';

/** Máximo de linhas (RN-2). Igual a `MAXIMO_ITENS_EQUIPE` do servidor (que não é client-safe). */
export const MAXIMO_LINHAS = 10;

export type CampoGeral = 'data' | 'itens' | 'nome' | 'telefone';
export type CampoDaLinha = 'servico' | 'profissional' | 'hora';

export type ValoresDaLinha = { servicoId: string; profissionalId: string; /** HH:MM */ hora: string };

export type ValoresReservaManual = {
  /** AAAA-MM-DD */
  data: string;
  /** 1..10 linhas, na ordem da tela. */
  itens: ValoresDaLinha[];
  nome: string;
  telefone: string;
  /** A cliente declarou o consentimento das mensagens da reserva. */
  mensagens: boolean;
  confirmarEncaixe: boolean;
};

/** Item da reserva registrada, para o roteiro do resultado (textos formatados no componente, com o fuso). */
export type ItemRegistrado = {
  servicoId: string;
  profissionalId: string;
  inicioIso: string;
  fimIso: string;
  duracaoMin: number;
  encaixe: boolean;
};

export type EstadoReservaManual = {
  /** Erro geral (topo). */
  mensagem: string | null;
  /** "Linha de serviço adicionada." / "Serviço n removido." (role="status"). */
  statusLinha: string | null;
  erros: Partial<Record<CampoGeral, string>>;
  /** Por índice 0-based da linha. */
  errosPorLinha: Record<number, Partial<Record<CampoDaLinha, string>>>;
  valores: ValoresReservaManual;
  /** Chave de idempotência do formulário (UUID); só muda depois de uma reserva criada. */
  chave: string;
  /** Itens (índice 0-based) com motivo de encaixe aguardando a confirmação. */
  encaixe: MotivosDoItem[] | null;
  criada: { repetida: boolean; encaixes: number; hrefAgenda: string; itens: ItemRegistrado[] } | null;
  /** Linha (0-based) cuja legenda recebe o foco depois de adicionar/remover (só com JS). */
  foco: number | null;
};

export const LIMITES_FORMULARIO = Object.freeze({ nome: 100, telefone: 30 });

export const MENSAGENS_FORMULARIO_RESERVA = Object.freeze({
  resumoErros: 'Corrija os campos indicados para registrar a reserva.',
  criada: 'Reserva registrada.',
  criadaEncaixe: (n: number) => `Reserva registrada com encaixe em ${n} ${n === 1 ? 'serviço' : 'serviços'}.`,
  repetida: 'Esta reserva já havia sido registrada.',
  ocupado: 'Este horário já está ocupado na agenda do profissional. Escolha outro horário.',
  ocupadoGeral: 'Algum dos horários já está ocupado na agenda do profissional. Confira e escolha outro horário.',
  servicoIndisponivel: 'Algum serviço escolhido não está disponível.',
  profissionalIndisponivel: 'Este profissional está inativo ou não realiza este serviço.',
  chaveReutilizada: 'Este formulário já foi usado para outra reserva. Recarregue a página e tente de novo.',
  salaoIndisponivel: 'O salão não pode receber reservas agora.',
  acessoNegado: 'Acesso negado.',
  naoEncontrado: 'Profissional não encontrado.',
  generico: 'Não foi possível registrar a reserva. Confira os dados e tente de novo.',
  linhaAdicionada: 'Linha de serviço adicionada.',
  linhaRemovida: (n: number) => `Serviço ${n} removido.`,
  ajudaLinhas: 'Escolha o serviço, o profissional e a hora de cada um. Os horários de uma mesma cliente não podem se sobrepor.',
  ajudaData: 'Todos os serviços ficam neste dia.',
  ajudaAdicionar: 'Até 10 serviços.',
  encaixeTitulo: 'Atenção: encaixe',
  encaixeTexto: 'Alguns serviços estão fora das regras de agenda. Confira e confirme para registrar.',
  confirmarEncaixe: 'Confirmo o encaixe destes serviços',
});

/** Motivo curto, em minúsculas, para as frases "Serviço n — …: motivo; motivo." */
export const MOTIVO_CURTO: Readonly<Record<MotivoEncaixe, string>> = Object.freeze({
  fora_da_jornada: 'fora da jornada',
  bloqueado: 'horário bloqueado',
  fora_do_funcionamento: 'fora do funcionamento',
});

export const textoDosMotivos = (motivos: readonly MotivoEncaixe[]): string => `${motivos.map((m) => MOTIVO_CURTO[m]).join('; ')}.`;

export const linhaVazia = (profissionalId = ''): ValoresDaLinha => ({ servicoId: '', profissionalId, hora: '' });

export const valoresVazios = (extra: Partial<ValoresReservaManual> = {}): ValoresReservaManual => ({
  data: '',
  itens: [linhaVazia()],
  nome: '',
  telefone: '',
  mensagens: false,
  confirmarEncaixe: false,
  ...extra,
});

export function estadoInicial(chave: string, valores: ValoresReservaManual): EstadoReservaManual {
  return { mensagem: null, statusLinha: null, erros: {}, errosPorLinha: {}, valores, chave, encaixe: null, criada: null, foco: null };
}

/** Id de um campo geral na página: `reserva-<campo>` (o resumo de erros aponta para ele). */
export const idDoCampo = (campo: CampoGeral | 'servicos'): string => `reserva-${campo}`;
/** Id de um campo da linha (índice 0-based): `item-<n>-<campo>`, n 1-based (web-design §4.4). */
export const idDaLinha = (indice: number, campo: CampoDaLinha | 'legenda'): string => `item-${indice + 1}-${campo}`;

const texto = (v: FormDataEntryValue | null): string => (typeof v === 'string' ? v : '');

export type PedidoDeLinha = { tipo: 'adicionar' } | { tipo: 'remover'; indice: number };

/** Quantidade de linhas enviada: 1..10; ausente ou malformada → 1. */
function lerQuantidade(v: FormDataEntryValue | null): number {
  const t = texto(v);
  if (!/^\d{1,2}$/.test(t)) return 1;
  return Math.min(Math.max(Number(t), 1), MAXIMO_LINHAS);
}

function lerPedidoDeLinha(v: FormDataEntryValue | null, quantidade: number): PedidoDeLinha | null {
  const t = texto(v);
  if (t === 'adicionar') return { tipo: 'adicionar' };
  const m = /^remover:(\d{1,2})$/.exec(t);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= quantidade) return { tipo: 'remover', indice: Number(m[1]) - 1 };
  return null;
}

/** Lê só os nomes conhecidos (extras e arquivos ignorados); o eco volta cortado nos tetos. */
export function lerFormularioReservaManual(fd: FormData): {
  entrada: EntradaReservaEquipe;
  valores: ValoresReservaManual;
  chave: string;
  linha: PedidoDeLinha | null;
} {
  const quantidade = lerQuantidade(fd.get('itens'));
  const linhas = Array.from({ length: quantidade }, (_, k) => ({
    servicoId: texto(fd.get(`item-${k + 1}-servico`)),
    profissionalId: texto(fd.get(`item-${k + 1}-profissional`)),
    hora: texto(fd.get(`item-${k + 1}-hora`)),
  }));
  const nome = texto(fd.get('nome'));
  const telefone = texto(fd.get('telefone'));
  const mensagens = fd.get(CAMPOS_CONSENTIMENTO.mensagensReserva);
  const confirmar = fd.get('confirmarEncaixe');
  const chave = texto(fd.get('chave'));
  const data = texto(fd.get('data'));
  return {
    chave,
    linha: lerPedidoDeLinha(fd.get('linha'), quantidade),
    entrada: {
      data,
      itens: linhas,
      nome,
      telefone,
      aceites: { mensagensReserva: mensagens },
      confirmarEncaixe: confirmar,
      chaveRequisicao: chave === '' ? null : chave,
    },
    valores: {
      data: data.slice(0, 10),
      itens: linhas.map((l) => ({ servicoId: l.servicoId.slice(0, 40), profissionalId: l.profissionalId.slice(0, 40), hora: l.hora.slice(0, 5) })),
      nome: nome.slice(0, LIMITES_FORMULARIO.nome),
      telefone: telefone.slice(0, LIMITES_FORMULARIO.telefone),
      mensagens: mensagens === 'on',
      confirmarEncaixe: confirmar === 'on',
    },
  };
}

/**
 * "Adicionar outro serviço" / "Remover" (POST sem gravar): devolve o estado com uma linha a mais ou a menos e
 * TODOS os valores preservados; limpa erros, aviso de encaixe e a confirmação (as linhas mudaram).
 */
export function aplicarLinha(valores: ValoresReservaManual, chave: string, pedido: PedidoDeLinha): EstadoReservaManual {
  const base = estadoInicial(chave, { ...valores, confirmarEncaixe: false });
  if (pedido.tipo === 'adicionar') {
    if (valores.itens.length >= MAXIMO_LINHAS) return base;
    const itens = [...valores.itens, linhaVazia()];
    return { ...base, valores: { ...base.valores, itens }, statusLinha: MENSAGENS_FORMULARIO_RESERVA.linhaAdicionada, foco: itens.length - 1 };
  }
  if (valores.itens.length <= 1) return base;
  const itens = valores.itens.filter((_, k) => k !== pedido.indice);
  return {
    ...base,
    valores: { ...base.valores, itens },
    statusLinha: MENSAGENS_FORMULARIO_RESERVA.linhaRemovida(pedido.indice + 1),
    foco: Math.max(0, pedido.indice - 1),
  };
}

function erroNasLinhas(indices: readonly number[], campo: CampoDaLinha, mensagem: string): EstadoReservaManual['errosPorLinha'] {
  return Object.fromEntries(indices.map((k) => [k, { [campo]: mensagem }]));
}

/**
 * Estado da resposta para cada desfecho de `criarReservaManual` (sem PRG: o aviso de encaixe e os erros
 * voltam na própria resposta, com os dados preservados, também sem JavaScript).
 */
export function paraEstado(
  r: ResultadoReservaEquipe,
  valores: ValoresReservaManual,
  p: { chave: string; novaChave: string; baseAgenda: string },
): EstadoReservaManual {
  const base = estadoInicial(p.chave, valores);
  switch (r.resultado) {
    case 'criada':
    case 'repetida': {
      const itens = r.reserva.itens.map((i) => ({
        servicoId: i.servicoId,
        profissionalId: i.profissionalId,
        inicioIso: i.inicio.toISOString(),
        fimIso: i.fim.toISOString(),
        duracaoMin: i.duracaoMin,
        encaixe: i.encaixe,
      }));
      const profissionais = [...new Set(itens.map((i) => i.profissionalId))];
      return {
        ...base,
        chave: p.novaChave,
        valores: valoresVazios({ data: valores.data, itens: [linhaVazia(valores.itens[0]?.profissionalId ?? '')] }),
        criada: {
          repetida: r.resultado === 'repetida',
          encaixes: itens.filter((i) => i.encaixe).length,
          hrefAgenda: hrefAgenda(p.baseAgenda, { data: valores.data, visao: 'dia', profissional: profissionais.length === 1 ? profissionais[0] : null }),
          itens,
        },
      };
    }
    case 'encaixe_requer_confirmacao':
      return { ...base, encaixe: r.motivos };
    case 'horario_indisponivel':
      return r.itens.length > 0
        ? { ...base, errosPorLinha: erroNasLinhas(r.itens, 'hora', MENSAGENS_FORMULARIO_RESERVA.ocupado) }
        : { ...base, mensagem: MENSAGENS_FORMULARIO_RESERVA.ocupadoGeral };
    case 'servico_indisponivel':
      return { ...base, mensagem: MENSAGENS_FORMULARIO_RESERVA.servicoIndisponivel };
    case 'profissional_indisponivel':
      return r.itens.length > 0
        ? { ...base, errosPorLinha: erroNasLinhas(r.itens, 'profissional', MENSAGENS_FORMULARIO_RESERVA.profissionalIndisponivel) }
        : { ...base, mensagem: MENSAGENS_FORMULARIO_RESERVA.profissionalIndisponivel };
    case 'invalido': {
      const { data, itens, nome, telefone, chave, porItem } = r.erros;
      const erros: EstadoReservaManual['erros'] = {
        ...(data && { data }),
        ...(itens && { itens }),
        ...(nome && { nome }),
        ...(telefone && { telefone }),
      };
      const errosPorLinha: EstadoReservaManual['errosPorLinha'] = {};
      for (const [k, e] of Object.entries(porItem ?? {})) {
        errosPorLinha[Number(k)] = {
          ...(e.servico && { servico: e.servico }),
          ...(e.profissional && { profissional: e.profissional }),
          ...(e.inicio && { hora: e.inicio }),
        };
      }
      const vazio = Object.keys(erros).length === 0 && Object.keys(errosPorLinha).length === 0;
      return { ...base, erros, errosPorLinha, mensagem: chave ?? (vazio ? MENSAGENS_FORMULARIO_RESERVA.generico : null) };
    }
    case 'chave_reutilizada':
      return { ...base, mensagem: MENSAGENS_FORMULARIO_RESERVA.chaveReutilizada };
    case 'salao_indisponivel':
      return { ...base, mensagem: MENSAGENS_FORMULARIO_RESERVA.salaoIndisponivel };
    case 'recusado':
      return { ...base, mensagem: r.motivo };
    case 'consentimento_ausente':
      return { ...base, mensagem: MENSAGENS_FORMULARIO_RESERVA.generico };
  }
}
