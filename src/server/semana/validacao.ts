import { z } from 'zod';

import { DIAS_SEMANA, LIMITES_SEMANA, MENSAGENS_INTERVALO } from './tipos';
import type { DiaSemana, ErroIntervalo, ErrosDia, ErrosSemana, LinhaEntrada } from './tipos';

// Validação e canonização da semana horária (D-020 §3.1; regras 1..4 da D-015). Pura: sem banco nem
// imports de runtime de @/server/** fora desta pasta. O servidor é a autoridade: o `pattern` do
// campo é só conveniência. As exclusions do banco continuam sendo a garantia final.

/** Intervalo validado e canônico de um dia. */
export type IntervaloDoDia = { diaSemana: DiaSemana; inicioMin: number; fimMin: number };

const PADRAO_HORARIO = /^(\d{1,2}):(\d{2})$/;

/**
 * "H:MM" ou "HH:MM" (com trim; ≤ 10 caracteres; h ≤ 24, m ≤ 59, 24 só com :00) → minutos do dia.
 * Fora disso → 'formato'; minutos fora do passo de 5 → 'granularidade'.
 */
export function converterHorario(
  v: unknown,
): { ok: true; min: number } | { ok: false; erro: 'formato' | 'granularidade' } {
  if (typeof v !== 'string' || v.length > LIMITES_SEMANA.horarioMaxCaracteres) {
    return { ok: false, erro: 'formato' };
  }
  const casado = PADRAO_HORARIO.exec(v.trim());
  if (!casado) return { ok: false, erro: 'formato' };
  const h = Number(casado[1]);
  const m = Number(casado[2]);
  if (h > 24 || m > 59 || (h === 24 && m !== 0)) return { ok: false, erro: 'formato' };
  if (m % LIMITES_SEMANA.passoMin !== 0) return { ok: false, erro: 'granularidade' };
  return { ok: true, min: h * 60 + m };
}

/** Forma dos dias: 7 dias explícitos; dia vazio = `intervalos: []`; campos extras recusados. */
const esquemaDias = z
  .array(
    z.strictObject({
      diaSemana: z.number().int().min(0).max(6),
      intervalos: z
        .array(z.strictObject({ inicio: z.string().optional(), fim: z.string().optional() }))
        .max(LIMITES_SEMANA.linhasRecebidasMax),
    }),
  )
  .length(DIAS_SEMANA.length);

type LinhaValida = { indice: number; inicioMin: number; fimMin: number };

/** Erro de campo de horário (formato/granularidade) → mensagem. */
function mensagemDeHorario(erro: 'formato' | 'granularidade'): string {
  return erro === 'formato' ? MENSAGENS_INTERVALO.formato : MENSAGENS_INTERVALO.granularidade;
}

/** Regra 2 (por linha): vazia → ignorada; senão o intervalo ou os erros da linha. */
function validarLinha(linha: LinhaEntrada): { vazia: true } | { vazia: false; erro?: ErroIntervalo; min?: [number, number] } {
  const inicio = (linha.inicio ?? '').trim();
  const fim = (linha.fim ?? '').trim();
  if (inicio === '' && fim === '') return { vazia: true };
  const erro: ErroIntervalo = {};
  let ini: number | null = null;
  let fi: number | null = null;
  if (inicio === '') {
    erro.inicio = MENSAGENS_INTERVALO.faltaInicio;
  } else {
    const c = converterHorario(linha.inicio);
    if (!c.ok) erro.inicio = mensagemDeHorario(c.erro);
    else if (c.min >= LIMITES_SEMANA.fimMax) erro.inicio = MENSAGENS_INTERVALO.inicio24;
    else ini = c.min;
  }
  if (fim === '') {
    erro.fim = MENSAGENS_INTERVALO.faltaFim;
  } else {
    const c = converterHorario(linha.fim);
    if (!c.ok) erro.fim = mensagemDeHorario(c.erro);
    else fi = c.min;
  }
  if (ini !== null && fi !== null) {
    if (fi <= ini) return { vazia: false, erro: { intervalo: MENSAGENS_INTERVALO.ordem } };
    return { vazia: false, min: [ini, fi] };
  }
  return { vazia: false, erro };
}

/** Regra 3 (por dia): limite, sobreposição (marca as duas linhas) e, sem erros, a lista ordenada. */
function validarDia(intervalos: readonly LinhaEntrada[]): { erros: ErrosDia | null; validas: LinhaValida[] } {
  const errosLinhas: Record<number, ErroIntervalo> = {};
  const validas: LinhaValida[] = [];
  let naoVazias = 0;
  intervalos.forEach((linha, indice) => {
    const r = validarLinha(linha);
    if (r.vazia) return;
    naoVazias += 1;
    if (r.erro) errosLinhas[indice] = r.erro;
    else if (r.min) validas.push({ indice, inicioMin: r.min[0], fimMin: r.min[1] });
  });
  const erros: ErrosDia = {};
  if (naoVazias > LIMITES_SEMANA.intervalosPorDia) erros.dia = MENSAGENS_INTERVALO.limite;
  validas.sort((a, b) => a.inicioMin - b.inicioMin || a.fimMin - b.fimMin || a.indice - b.indice);
  // Linha que alcança mais longe até aqui: uma linha pode sobrepor uma anterior não vizinha.
  let maisLonge: LinhaValida | null = null;
  for (const atual of validas) {
    if (maisLonge && maisLonge.fimMin > atual.inicioMin) {
      errosLinhas[maisLonge.indice] = { intervalo: MENSAGENS_INTERVALO.sobreposicao };
      errosLinhas[atual.indice] = { intervalo: MENSAGENS_INTERVALO.sobreposicao };
    }
    if (!maisLonge || atual.fimMin > maisLonge.fimMin) maisLonge = atual;
  }
  if (Object.keys(errosLinhas).length > 0) erros.intervalos = errosLinhas;
  return { erros: Object.keys(erros).length > 0 ? erros : null, validas };
}

/** Une contíguos (fim de um = início do seguinte); entrada ordenada e sem sobreposição. */
function unirContiguos(validas: readonly LinhaValida[]): { inicioMin: number; fimMin: number }[] {
  const saida: { inicioMin: number; fimMin: number }[] = [];
  for (const v of validas) {
    const ultimo = saida.at(-1);
    if (ultimo && ultimo.fimMin === v.inicioMin) ultimo.fimMin = v.fimMin;
    else saida.push({ inicioMin: v.inicioMin, fimMin: v.fimMin });
  }
  return saida;
}

/** Resultado único (congelado) para forma de entrada inválida. */
export const FORMULARIO_INVALIDO: { ok: false; erros: ErrosSemana } = Object.freeze({
  ok: false,
  erros: Object.freeze({ formulario: MENSAGENS_INTERVALO.formulario }),
}) as { ok: false; erros: ErrosSemana };

/**
 * Valida os 7 dias (regras 1..4 da D-015). Forma inválida → `FORMULARIO_INVALIDO`. Todos os erros de
 * campo voltam juntos; sem erros, devolve os intervalos canônicos ordenados por (diaSemana, inicioMin).
 */
export function validarDias(
  dias: unknown,
): { ok: true; intervalos: IntervaloDoDia[] } | { ok: false; erros: ErrosSemana } {
  const entrada = esquemaDias.safeParse(dias);
  if (!entrada.success) return FORMULARIO_INVALIDO;
  const lista = entrada.data;
  if (new Set(lista.map((d) => d.diaSemana)).size !== DIAS_SEMANA.length) return FORMULARIO_INVALIDO;

  const errosDias: Partial<Record<DiaSemana, ErrosDia>> = {};
  const intervalos: IntervaloDoDia[] = [];
  for (const dia of [...lista].sort((a, b) => a.diaSemana - b.diaSemana)) {
    const diaSemana = dia.diaSemana as DiaSemana;
    const { erros, validas } = validarDia(dia.intervalos);
    if (erros) {
      errosDias[diaSemana] = erros;
      continue;
    }
    for (const i of unirContiguos(validas)) intervalos.push({ diaSemana, ...i });
  }
  if (Object.keys(errosDias).length > 0) return { ok: false, erros: { dias: errosDias } };
  return { ok: true, intervalos };
}
