// Montagem da semana, pausas e diferença para a gravação da jornada (D-015 §3.3). D-020 (A-1): o
// código mora em src/server/semana/montagem.ts; este arquivo é uma fachada com a mesma API (CA-19).
// `diferenca` aceita JornadaLinhaDTO (estruturalmente compatível).

export { diferenca, montarSemana, pausasDe } from '@/server/semana/montagem';
