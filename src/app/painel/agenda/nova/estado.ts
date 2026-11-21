// Estado e conversão do formulário de reserva manual (D-029). Sem next/*, sem banco e sem imports de
// servidor de runtime além de tipos/constantes client-safe: é importado por componentes cliente e pela
// casca 'use server' (acoes.ts), que só converte FormData e resultados.
import { hrefAgenda } from '@/app/painel/agenda/_componentes/links';
import { CAMPOS_CONSENTIMENTO } from '@/config/termos';
import { MENSAGEM_HORARIO_INDISPONIVEL, MENSAGENS_RESERVA_EQUIPE } from '@/server/reservas/tipos';
import type { EntradaReservaEquipe, MotivoEncaixe, ResultadoCriarReserva } from '@/server/reservas/tipos';

export type CampoReservaManual = 'servicos' | 'profissional' | 'data' | 'hora' | 'nome' | 'telefone';

export type ValoresReservaManual = {
  servicoIds: string[];
  profissionalId: string;
  /** AAAA-MM-DD */
  data: string;
  /** HH:MM */
  hora: string;
  nome: string;
  telefone: string;
  /** A cliente declarou o consentimento das mensagens da reserva. */
  mensagens: boolean;
  confirmarEncaixe: boolean;
};

export type EstadoReservaManual = {
  /** Erro ou aviso geral. */
  mensagem: string | null;
  erros: Partial<Record<CampoReservaManual, string>>;
  valores: ValoresReservaManual;
  /** Chave de idempotência do formulário (UUID); só muda depois de uma reserva criada. */
  chave: string;
  /** Motivos de encaixe aguardando a confirmação (a resposta traz a caixa "Confirmo o encaixe"). */
  motivos: MotivoEncaixe[] | null;
  criada: { encaixe: boolean; repetida: boolean; hrefAgenda: string } | null;
};

export const LIMITES_FORMULARIO = Object.freeze({ nome: 100, telefone: 30 });

export const MENSAGENS_FORMULARIO_RESERVA = Object.freeze({
  resumoErros: 'Corrija os campos indicados para registrar a reserva.',
  criada: 'Reserva registrada.',
  criadaEncaixe: 'Reserva registrada como encaixe.',
  repetida: 'Esta reserva já havia sido registrada.',
  servicoIndisponivel: 'Algum serviço escolhido não está disponível.',
  profissionalIndisponivel: 'Este profissional está inativo ou não realiza todos os serviços escolhidos.',
  chaveReutilizada: 'Este formulário já foi usado para outra reserva. Recarregue a página e tente de novo.',
  salaoIndisponivel: 'O salão não pode receber reservas agora.',
  acessoNegado: 'Acesso negado.',
  naoEncontrado: 'Profissional não encontrado.',
  generico: 'Não foi possível registrar a reserva. Confira os dados e tente de novo.',
});

export const valoresVazios = (extra: Partial<ValoresReservaManual> = {}): ValoresReservaManual => ({
  servicoIds: [],
  profissionalId: '',
  data: '',
  hora: '',
  nome: '',
  telefone: '',
  mensagens: false,
  confirmarEncaixe: false,
  ...extra,
});

export function estadoInicial(chave: string, valores: ValoresReservaManual): EstadoReservaManual {
  return { mensagem: null, erros: {}, valores, chave, motivos: null, criada: null };
}

/** Id do campo na página: `reserva-<campo>` (o resumo de erros aponta para ele). */
export const idDoCampo = (campo: CampoReservaManual): string => `reserva-${campo}`;

const texto = (v: FormDataEntryValue | null): string => (typeof v === 'string' ? v : '');

/** Lê só os nomes conhecidos (extras e arquivos ignorados); o eco volta cortado nos tetos. */
export function lerFormularioReservaManual(fd: FormData): { entrada: EntradaReservaEquipe; valores: ValoresReservaManual; chave: string } {
  const servicoIds = fd.getAll('s').filter((x): x is string => typeof x === 'string');
  const nome = texto(fd.get('nome'));
  const telefone = texto(fd.get('telefone'));
  const mensagens = fd.get(CAMPOS_CONSENTIMENTO.mensagensReserva);
  const confirmar = fd.get('confirmarEncaixe');
  const chave = texto(fd.get('chave'));
  return {
    chave,
    entrada: {
      servicoIds,
      profissionalId: texto(fd.get('profissionalId')),
      data: texto(fd.get('data')),
      hora: texto(fd.get('hora')),
      nome,
      telefone,
      aceites: { mensagensReserva: mensagens },
      confirmarEncaixe: confirmar,
      chaveRequisicao: chave === '' ? null : chave,
    },
    valores: {
      servicoIds: servicoIds.slice(0, 10),
      profissionalId: texto(fd.get('profissionalId')).slice(0, 40),
      data: texto(fd.get('data')).slice(0, 10),
      hora: texto(fd.get('hora')).slice(0, 5),
      nome: nome.slice(0, LIMITES_FORMULARIO.nome),
      telefone: telefone.slice(0, LIMITES_FORMULARIO.telefone),
      mensagens: mensagens === 'on',
      confirmarEncaixe: confirmar === 'on',
    },
  };
}

/**
 * Estado da resposta para cada desfecho de `criarReservaManual` (sem PRG: o aviso de encaixe e os erros
 * voltam na própria resposta, com os dados preservados, também sem JavaScript).
 */
export function paraEstado(
  r: ResultadoCriarReserva,
  valores: ValoresReservaManual,
  p: { chave: string; novaChave: string; baseAgenda: string },
): EstadoReservaManual {
  const base: EstadoReservaManual = { mensagem: null, erros: {}, valores, chave: p.chave, motivos: null, criada: null };
  switch (r.resultado) {
    case 'criada':
    case 'repetida': {
      const encaixe = r.reserva.encaixe;
      return {
        ...base,
        chave: p.novaChave,
        valores: valoresVazios({ profissionalId: valores.profissionalId, data: valores.data }),
        criada: {
          encaixe,
          repetida: r.resultado === 'repetida',
          hrefAgenda: hrefAgenda(p.baseAgenda, { data: valores.data, visao: 'dia', profissional: valores.profissionalId }),
        },
      };
    }
    case 'encaixe_requer_confirmacao':
      return { ...base, motivos: r.motivos, mensagem: MENSAGENS_RESERVA_EQUIPE.encaixeAviso };
    case 'horario_indisponivel':
      return { ...base, mensagem: MENSAGEM_HORARIO_INDISPONIVEL };
    case 'servico_indisponivel':
      return { ...base, erros: { servicos: MENSAGENS_FORMULARIO_RESERVA.servicoIndisponivel } };
    case 'profissional_indisponivel':
      return { ...base, erros: { profissional: MENSAGENS_FORMULARIO_RESERVA.profissionalIndisponivel } };
    case 'invalido': {
      const { servicos, inicio, nome, telefone, chave } = r.erros;
      const erros: EstadoReservaManual['erros'] = {
        ...(servicos && { servicos }),
        ...(inicio && { data: inicio }),
        ...(nome && { nome }),
        ...(telefone && { telefone }),
      };
      return { ...base, erros, mensagem: chave ?? (Object.keys(erros).length === 0 ? MENSAGENS_FORMULARIO_RESERVA.generico : null) };
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
