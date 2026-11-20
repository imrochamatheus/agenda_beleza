// Estado e leitura do formulário de jornada (D-015 §3.6). Sem imports de servidor de runtime além de
// @/server/jornadas/tipos (arquivo só de tipos e constantes) e da formatação de @/lib/format.
import { formatarFaixaDeMinutos, formatarMinutosDoDia } from '@/lib/format';
import { DIAS_SEMANA, LIMITES_JORNADA, MENSAGENS_JORNADA } from '@/server/jornadas/tipos';
import type { DiaJornada, DiaSemana, ErrosJornada, IntervaloMin, SemanaJornada } from '@/server/jornadas/tipos';

export type ValorLinha = { inicio: string; fim: string };
/** Valores dos campos: 6 linhas por dia (índice = diaSemana). */
export type ValoresJornada = Record<DiaSemana, ValorLinha[]>;

export type EstadoFormularioJornada = {
  /** Erro geral (acesso negado, não encontrado) ou, com `sucesso`, mensagem de sucesso (demonstração). */
  mensagem: string | null;
  /** true → `mensagem` é de sucesso (Alert status); ausente/false → erro (Alert alert). */
  sucesso?: boolean;
  erros: ErrosJornada;
  /** Valores devolvidos aos campos depois de um erro; null → os da semana gravada. */
  valores: ValoresJornada | null;
};

export const ESTADO_INICIAL_FORMULARIO_JORNADA: EstadoFormularioJornada = Object.freeze({
  mensagem: null,
  erros: Object.freeze({}),
  valores: null,
}) as EstadoFormularioJornada;

export type CampoHorario = 'inicio' | 'fim';

/** Nome do campo no FormData: `inicio-<dia>-<n>` / `fim-<dia>-<n>` (n a partir de 0). */
export function nomeDoCampo(dia: DiaSemana, n: number, campo: CampoHorario): string {
  return `${campo}-${dia}-${n}`;
}

/** Id do campo na página: `jornada-<dia>-<n>-inicio` / `jornada-<dia>-<n>-fim`. */
export function idDoCampo(dia: DiaSemana, n: number, campo: CampoHorario): string {
  return `jornada-${dia}-${n}-${campo}`;
}

/** Id do erro de uma linha (intervalo) e do erro do dia (limite). */
export const idDoErroDaLinha = (dia: DiaSemana, n: number) => `jornada-${dia}-${n}-erro`;
export const idDoErroDoDia = (dia: DiaSemana) => `jornada-${dia}-erro`;

const linhasVazias = (quantas: number): ValorLinha[] => Array.from({ length: quantas }, () => ({ inicio: '', fim: '' }));

/** Semana gravada → valores dos campos (HH:MM), completando com linhas vazias até 6. */
export function valoresDaSemana(semana: SemanaJornada): ValoresJornada {
  const valores = {} as ValoresJornada;
  for (const dia of DIAS_SEMANA) {
    const intervalos = semana[dia]?.intervalos ?? [];
    const linhas = intervalos
      .slice(0, LIMITES_JORNADA.linhasPorDia)
      .map((i) => ({ inicio: formatarMinutosDoDia(i.inicioMin), fim: formatarMinutosDoDia(i.fimMin) }));
    valores[dia] = [...linhas, ...linhasVazias(LIMITES_JORNADA.linhasPorDia - linhas.length)];
  }
  return valores;
}

/** Texto do FormData; ausente ou não texto (arquivo) → ''. */
const texto = (v: FormDataEntryValue | null): string => (typeof v === 'string' ? v : '');

export type EntradaDoFormulario = {
  profissionalId: string | undefined;
  dias: { diaSemana: number; intervalos: { inicio: string; fim: string }[] }[];
};

/**
 * Só os 7 × 6 × 2 nomes conhecidos (extras e arquivos ignorados). `valores` volta aos campos cortado
 * em `horarioMaxCaracteres` (não ecoa entradas enormes); `entrada` vai inteira para a validação.
 */
export function lerFormularioJornada(fd: FormData): { entrada: EntradaDoFormulario; valores: ValoresJornada } {
  const id = fd.get('profissionalId');
  const valores = {} as ValoresJornada;
  const dias: EntradaDoFormulario['dias'] = [];
  for (const dia of DIAS_SEMANA) {
    const intervalos: { inicio: string; fim: string }[] = [];
    for (let n = 0; n < LIMITES_JORNADA.linhasPorDia; n += 1) {
      intervalos.push({ inicio: texto(fd.get(nomeDoCampo(dia, n, 'inicio'))), fim: texto(fd.get(nomeDoCampo(dia, n, 'fim'))) });
    }
    dias.push({ diaSemana: dia, intervalos });
    valores[dia] = intervalos.map((l) => ({
      inicio: l.inicio.slice(0, LIMITES_JORNADA.horarioMaxCaracteres),
      fim: l.fim.slice(0, LIMITES_JORNADA.horarioMaxCaracteres),
    }));
  }
  return { entrada: { profissionalId: typeof id === 'string' ? id : undefined, dias }, valores };
}

const faixas = (lista: readonly IntervaloMin[]) => lista.map((i) => formatarFaixaDeMinutos(i.inicioMin, i.fimMin)).join(', ');

/** Intervalos do dia ("09:00–12:00, 13:00–18:00") ou "Folga" (RN-8). */
export function textoDosIntervalos(dia: DiaJornada): string {
  return dia.intervalos.length === 0 ? MENSAGENS_JORNADA.folga : faixas(dia.intervalos);
}

/** Pausas do dia ("Pausa 12:00–13:00", "Pausas 10:00–10:30, 12:00–13:00") ou null. */
export function textoDasPausas(dia: DiaJornada): string | null {
  if (dia.pausas.length === 0) return null;
  return `${dia.pausas.length === 1 ? 'Pausa' : 'Pausas'} ${faixas(dia.pausas)}`;
}

/** Resumo de uma linha do dia, para o `<summary>`: intervalos e pausas separados por " · ". */
export function resumoDoDia(dia: DiaJornada): string {
  const pausas = textoDasPausas(dia);
  return pausas ? `${textoDosIntervalos(dia)} · ${pausas}` : textoDosIntervalos(dia);
}
