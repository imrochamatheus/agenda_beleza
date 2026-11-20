// Estado e leitura do formulário de jornada (D-015 §3.6). D-020 (A-7): a lógica do editor de semana mora
// em src/app/painel/_componentes/semana/formulario.ts; aqui ficam as mesmas exportações de antes, com o
// prefixo `jornada` e o texto "Folga" fixados. Sem imports de servidor de runtime além de
// @/server/jornadas/tipos (só tipos e constantes).
import * as semana from '@/app/painel/_componentes/semana/formulario';
import type { CampoHorario, ValorLinha, ValoresSemana } from '@/app/painel/_componentes/semana/formulario';
import { MENSAGENS_JORNADA } from '@/server/jornadas/tipos';
import type { DiaJornada, DiaSemana, ErrosJornada } from '@/server/jornadas/tipos';

export type { CampoHorario, ValorLinha } from '@/app/painel/_componentes/semana/formulario';
/** Valores dos campos: 6 linhas por dia (índice = diaSemana). */
export type ValoresJornada = ValoresSemana;

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

/** Prefixo dos ids da jornada na página. */
export const PREFIXO_JORNADA = 'jornada';

/** Nome do campo no FormData: `inicio-<dia>-<n>` / `fim-<dia>-<n>` (n a partir de 0). */
export const nomeDoCampo = semana.nomeDoCampo;

/** Id do campo na página: `jornada-<dia>-<n>-inicio` / `jornada-<dia>-<n>-fim`. */
export function idDoCampo(dia: DiaSemana, n: number, campo: CampoHorario): string {
  return semana.idDoCampo(PREFIXO_JORNADA, dia, n, campo);
}

/** Id do erro de uma linha (intervalo) e do erro do dia (limite). */
export const idDoErroDaLinha = (dia: DiaSemana, n: number) => semana.idDoErroDaLinha(PREFIXO_JORNADA, dia, n);
export const idDoErroDoDia = (dia: DiaSemana) => semana.idDoErroDoDia(PREFIXO_JORNADA, dia);

/** Semana gravada → valores dos campos (HH:MM), completando com linhas vazias até 6. */
export const valoresDaSemana = semana.valoresDaSemana;

export type EntradaDoFormulario = {
  profissionalId: string | undefined;
  dias: { diaSemana: number; intervalos: ValorLinha[] }[];
};

/**
 * Só os 7 × 6 × 2 nomes conhecidos (extras e arquivos ignorados) e o `profissionalId`. `valores` volta
 * aos campos cortado em `horarioMaxCaracteres`; `entrada` vai inteira para a validação.
 */
export function lerFormularioJornada(fd: FormData): { entrada: EntradaDoFormulario; valores: ValoresJornada } {
  const id = fd.get('profissionalId');
  const { dias, valores } = semana.lerSemanaDoFormulario(fd);
  return {
    entrada: { profissionalId: typeof id === 'string' ? id : undefined, dias: dias as EntradaDoFormulario['dias'] },
    valores,
  };
}

/** Intervalos do dia ("09:00–12:00, 13:00–18:00") ou "Folga" (RN-8). */
export function textoDosIntervalos(dia: DiaJornada): string {
  return semana.textoDosIntervalos(dia, MENSAGENS_JORNADA.folga);
}

/** Pausas do dia ("Pausa 12:00–13:00", "Pausas 10:00–10:30, 12:00–13:00") ou null. */
export const textoDasPausas = semana.textoDasPausas;

/** Resumo de uma linha do dia, para o `<summary>`: intervalos e pausas separados por " · ". */
export function resumoDoDia(dia: DiaJornada): string {
  return semana.resumoDoDia(dia, MENSAGENS_JORNADA.folga);
}
