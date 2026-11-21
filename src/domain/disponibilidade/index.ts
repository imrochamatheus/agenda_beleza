// API pública do domínio de disponibilidade (D-018).
export { calcularDisponibilidade } from './calcular';
export { datasDoPeriodo, diaDaSemana, gradeDoDia, limitesDaJanela, periodoDeLeitura } from './calendario';
export { janelasDoDia, validarFuncionamento } from './funcionamento';
export type {
  AgendaDoProfissional,
  DataCivil,
  DiaDeDisponibilidade,
  DisponibilidadeCalculada,
  EntradaDeCalculo,
  FuncionamentoDeAgenda,
  HorarioOferecido,
  Intervalo,
  IntervaloMin,
  LinhaDeJornada,
  RegrasDeAgenda,
} from './tipos';
