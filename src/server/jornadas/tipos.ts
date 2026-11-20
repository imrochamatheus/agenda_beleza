// Contratos da jornada semanal (D-015 §3.1). Arquivo SEM imports de servidor de runtime: os
// componentes cliente o importam (só tipos e constantes). Os resultados de negócio são discriminados
// por `resultado` dentro de `{ ok: true, dados }`; ErroDeDominio continua só com 401/403/404.
//
// A jornada é hora LOCAL de parede do salão em minutos do dia (RN-10): sem conversão para UTC ao
// gravar nem ao exibir. `diaSemana`: 0 = domingo … 6 = sábado (RN-15, como Date#getDay e
// EXTRACT(DOW)). Intervalos semiabertos [início, fim), 0 ≤ início < fim ≤ 1440 (RN-3).

import { LIMITES_SEMANA, MENSAGENS_INTERVALO } from '@/server/semana/tipos';
import type { DiaEntrada as DiaEntradaSemana, DiaSemanaHoraria, ErrosSemana, SemanaHoraria } from '@/server/semana/tipos';

// D-020 (A-1): o núcleo da semana mora em src/server/semana/; este arquivo é uma fachada com a mesma
// API e os mesmos textos de antes (CA-19).
export { DIAS_SEMANA, ORDEM_EXIBICAO_DIAS } from '@/server/semana/tipos';
export type { DiaSemana, ErroIntervalo, ErrosDia, IntervaloMin, LinhaEntrada } from '@/server/semana/tipos';

export const LIMITES_JORNADA = LIMITES_SEMANA;

export type DiaJornada = DiaSemanaHoraria;
/** Sempre 7 itens, índice = diaSemana (0..6); intervalos canônicos (RN-5). */
export type SemanaJornada = SemanaHoraria;
export type ErrosJornada = ErrosSemana;
export type DiaEntrada = DiaEntradaSemana;
export type EntradaSalvarJornada = { profissionalId: unknown; dias: unknown };

export type ResultadoSalvarJornada =
  | { resultado: 'salvo'; semana: SemanaJornada; inseridos: number; removidos: number }
  | { resultado: 'invalido'; erros: ErrosJornada };

export type JornadaVisao = {
  profissional: { id: string; nome: string; ativo: boolean };
  semana: SemanaJornada;
  /** RN-8 / CA-15. */
  semIntervalos: boolean;
  /** pode(ctx.papel, 'jornada.editar') === 'salao'. */
  editavel: boolean;
};

export const MENSAGENS_JORNADA = Object.freeze({
  ...MENSAGENS_INTERVALO,
  resumoErros: 'Corrija os campos indicados para salvar a jornada.',
  salva: 'Jornada salva.',
  /** Só na página de demonstração /dev/jornada (D-11). */
  demonstracao: 'Jornada válida (demonstração: nada foi gravado).',
  semIntervalos: 'Sem nenhum intervalo na semana, este profissional não terá horários disponíveis para reserva.',
  inativo: 'Profissional inativo: esta jornada só passa a valer quando ele for reativado.',
  somenteLeitura: 'Só o gestor do salão altera a jornada.',
  folga: 'Folga',
  naoEncontrado: 'Profissional não encontrado.',
  acessoNegado: 'Acesso negado.',
});
