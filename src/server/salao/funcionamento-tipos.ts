import { MENSAGENS_INTERVALO } from '@/server/semana/tipos';
import type { ErrosSemana, SemanaHoraria } from '@/server/semana/tipos';

// Contratos e mensagens do horário de funcionamento do salão (D-020 §3.4; RN-11..RN-17). Client-safe:
// só importa constantes e tipos de src/server/semana/tipos.ts (também client-safe). A validação está
// em funcionamento-validacao.ts.

export type ModoFuncionamento = 'informar' | 'nao_informar';
export const MODOS_FUNCIONAMENTO: readonly ModoFuncionamento[] = Object.freeze(['nao_informar', 'informar']);

/** RN-13/RN-17. Com definido true: 7 dias (índice = diaSemana), dia sem intervalos = fechado. */
export type Funcionamento = { definido: false } | { definido: true; semana: SemanaHoraria };
export type ErrosFuncionamento = ErrosSemana & { modo?: string };
export type EntradaFuncionamento = { modo?: unknown; dias?: unknown };
export type ResultadoSalvarFuncionamento =
  | { resultado: 'salvo'; funcionamento: Funcionamento; alterado: boolean }
  | { resultado: 'invalido'; erros: ErrosFuncionamento };

export const MENSAGENS_FUNCIONAMENTO = Object.freeze({
  ...MENSAGENS_INTERVALO,
  modo: 'Escolha se o horário de funcionamento será informado.',
  opcaoNaoInformar: 'Não informar (a disponibilidade segue só a jornada de cada profissional)',
  opcaoInformar: 'Informar o horário abaixo',
  ajudaNaoInformar: 'Com "Não informar", os horários digitados abaixo são descartados ao salvar.',
  ajudaFeriados: 'Para feriados e fechamentos em datas específicas, use um bloqueio do salão inteiro.',
  fechado: 'Fechado',
  /** Resumo de um dia enquanto o funcionamento não foi informado. */
  diaNaoInformado: 'Não informado',
  naoInformado: 'Horário de funcionamento não informado: os horários oferecidos seguem só a jornada de cada profissional.',
  todosFechados: 'Todos os dias estão fechados: o salão não terá horários disponíveis para reserva.',
  resumoErros: 'Corrija os campos indicados para salvar o horário de funcionamento.',
  salvo: 'Horário de funcionamento salvo.',
  demonstracao: 'Horário válido (demonstração: nada foi gravado).',
  acessoNegado: 'Acesso negado.',
});
