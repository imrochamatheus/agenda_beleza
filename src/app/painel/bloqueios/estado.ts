// Estado e leitura do formulário de bloqueio (D-016 §3.7). Só tipos e constantes de
// @/server/bloqueios/tipos (arquivo sem imports de servidor de runtime): é importado por componentes
// cliente. Os textos de data/hora chegam prontos do servidor (format.ts); aqui não se formata nada.
import { LIMITES_BLOQUEIO, MENSAGENS_BLOQUEIO } from '@/server/bloqueios/tipos';
import type { AlvoBloqueio, AvisoReservas, CampoBloqueio, ErrosBloqueio, ValoresBloqueio } from '@/server/bloqueios/tipos';

export type EstadoFormularioBloqueio = {
  /** Erro geral (acesso negado, não encontrado). */
  mensagem: string | null;
  erros: ErrosBloqueio;
  /** Valores dos campos (preservados depois de um erro, com ou sem JavaScript). */
  valores: ValoresBloqueio;
  /** Depois de salvar: o período gravado e o aviso de reservas cobertas (D-19, sem PRG). */
  salvo: { periodo: string; aviso: AvisoReservas } | null;
};

export const VALORES_VAZIOS: ValoresBloqueio = Object.freeze({
  alvo: '',
  modo: 'horario',
  dataInicio: '',
  horaInicio: '',
  dataFim: '',
  horaFim: '',
  motivo: '',
});

export function estadoInicial(valores: ValoresBloqueio = VALORES_VAZIOS): EstadoFormularioBloqueio {
  return { mensagem: null, erros: {}, valores, salvo: null };
}

/** Id do campo na página: `bloqueio-<campo>` (o resumo de erros aponta para ele). */
export function idDoCampo(campo: CampoBloqueio): string {
  return `bloqueio-${campo}`;
}

/** Texto do FormData; ausente ou não texto (arquivo) → ''. */
const texto = (v: FormDataEntryValue | null): string => (typeof v === 'string' ? v : '');
/** Texto do FormData; ausente ou não texto → undefined. */
const opcional = (v: FormDataEntryValue | null): string | undefined => (typeof v === 'string' ? v : undefined);

export type EntradaDoFormulario = {
  modo: string;
  dataInicio: string;
  horaInicio: string;
  dataFim: string;
  horaFim: string;
  motivo: string;
  alvo?: string;
  id?: string;
};

/**
 * Lê só os nomes conhecidos (extras e arquivos ignorados): `alvo` só na criação, `id` só na edição.
 * `valores` volta aos campos cortado em `motivoMax` caracteres (não ecoa entradas enormes); `entrada`
 * vai inteira para a validação do servidor.
 */
export function lerFormularioBloqueio(fd: FormData, modo: 'criar' | 'editar'): { entrada: EntradaDoFormulario; valores: ValoresBloqueio } {
  const entrada: EntradaDoFormulario = {
    modo: texto(fd.get('modo')),
    dataInicio: texto(fd.get('dataInicio')),
    horaInicio: texto(fd.get('horaInicio')),
    dataFim: texto(fd.get('dataFim')),
    horaFim: texto(fd.get('horaFim')),
    motivo: texto(fd.get('motivo')),
  };
  if (modo === 'criar') {
    const alvo = opcional(fd.get('alvo'));
    if (alvo !== undefined) entrada.alvo = alvo;
  } else {
    const id = opcional(fd.get('id'));
    if (id !== undefined) entrada.id = id;
  }
  const corte = (v: string | undefined) => (v ?? '').slice(0, LIMITES_BLOQUEIO.motivoMax);
  const valores: ValoresBloqueio = {
    alvo: corte(entrada.alvo),
    modo: corte(entrada.modo),
    dataInicio: corte(entrada.dataInicio),
    horaInicio: corte(entrada.horaInicio),
    dataFim: corte(entrada.dataFim),
    horaFim: corte(entrada.horaFim),
    motivo: corte(entrada.motivo),
  };
  return { entrada, valores };
}

/** Rótulo do alvo de um bloqueio: "Salão inteiro" ou o nome do profissional, com "(inativo)". */
export function rotuloDoAlvo(alvo: AlvoBloqueio): string {
  if (alvo.tipo === 'salao') return MENSAGENS_BLOQUEIO.salaoInteiro;
  return alvo.ativo ? alvo.nome : `${alvo.nome} ${MENSAGENS_BLOQUEIO.inativo}`;
}
