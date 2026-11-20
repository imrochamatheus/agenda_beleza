// Conversão entre hora local de parede de um fuso IANA e instantes UTC (D-016 §3.1, D-16). Puro, só
// `Intl` (tzdata do ICU do Node), sem dependência nova, sem next/*, sem Prisma e sem @/server/**.
// É a ÚNICA conversão hora local → UTC do projeto: a E3.1 deve usar instanteDeHoraLocal/partesLocais
// daqui para transformar a jornada (hora de parede) em instantes, com a mesma regra RN-3.
//
// Regras (spec D-016):
// - RN-2: dia inteiro de D1 a D2 (inclusivas) = [00:00 local de D1, 00:00 local de D2+1), por data de
//   calendário (o dia local pode ter 23 h ou 25 h), nunca somando 24 h.
// - RN-3: hora local inexistente (salto do horário de verão) → primeiro instante válido depois do salto
//   (o instante da transição); hora local repetida (recuo) → PRIMEIRA ocorrência (o menor instante).
//
// Premissa: no máximo uma transição de deslocamento em ±24 h de qualquer instante (verdade para todo o
// tzdata pós-1970). Os formatadores ficam em cache por fuso.

/** Data de calendário sem fuso. mes 1..12. */
export type DataCivil = { readonly ano: number; readonly mes: number; readonly dia: number };

const MS_MIN = 60_000;
const MS_DIA = 24 * 60 * MS_MIN;
const MINUTOS_NO_DIA = 1440;

const formatadores = new Map<string, Intl.DateTimeFormat>();

function criarFormatador(fuso: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: fuso,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    numberingSystem: 'latn',
  });
}

function formatador(fuso: string): Intl.DateTimeFormat {
  const existente = formatadores.get(fuso);
  if (existente) return existente;
  let f: Intl.DateTimeFormat;
  try {
    f = criarFormatador(fuso);
  } catch (erro) {
    throw new RangeError(`Fuso horário inválido: "${fuso}"`, { cause: erro });
  }
  formatadores.set(fuso, f);
  return f;
}

/** '' , não-string ou zona desconhecida pelo Intl → RangeError('Fuso horário inválido: "<x>"'). Devolve o próprio fuso. */
export function validarFuso(fuso: unknown): string {
  if (typeof fuso !== 'string' || fuso === '') {
    throw new RangeError(`Fuso horário inválido: "${String(fuso)}"`);
  }
  formatador(fuso);
  return fuso;
}

/** Inteiros, ano 1900..2999, mês 1..12, dia válido no mês (bissexto). */
export function ehDataCivilValida(d: DataCivil): boolean {
  if (typeof d !== 'object' || d === null) return false;
  const { ano, mes, dia } = d;
  if (![ano, mes, dia].every((n) => Number.isInteger(n))) return false;
  if (ano < 1900 || ano > 2999 || mes < 1 || mes > 12 || dia < 1) return false;
  return dia <= new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

function exigirData(d: DataCivil): void {
  if (!ehDataCivilValida(d)) {
    throw new RangeError(`Data inválida: ${JSON.stringify(d)}`);
  }
}

const paraUtc = (d: DataCivil): number => Date.UTC(d.ano, d.mes - 1, d.dia);

function deUtc(ms: number): DataCivil {
  const t = new Date(ms);
  return { ano: t.getUTCFullYear(), mes: t.getUTCMonth() + 1, dia: t.getUTCDate() };
}

/** Aritmética de calendário via Date.UTC (n pode ser negativo). */
export function somarDias(d: DataCivil, n: number): DataCivil {
  exigirData(d);
  if (!Number.isInteger(n)) throw new RangeError(`Número de dias inválido: ${String(n)}`);
  return deUtc(paraUtc(d) + n * MS_DIA);
}

/** d2 − d1 em dias de calendário. */
export function diferencaEmDias(d1: DataCivil, d2: DataCivil): number {
  exigirData(d1);
  exigirData(d2);
  return Math.round((paraUtc(d2) - paraUtc(d1)) / MS_DIA);
}

export function compararDatas(a: DataCivil, b: DataCivil): -1 | 0 | 1 {
  const x = paraUtc(a);
  const y = paraUtc(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Hora de parede no fuso, lida como se fosse UTC (ms), para o instante `t`. */
function paredeComoUtc(t: number, fuso: string): number {
  const p: Record<string, number> = {};
  for (const parte of formatador(fuso).formatToParts(new Date(t))) {
    if (parte.type !== 'literal') p[parte.type] = Number(parte.value);
  }
  const hora = p.hour === 24 ? 0 : p.hour;
  return Date.UTC(p.year, p.month - 1, p.day, hora, p.minute, p.second);
}

/** Deslocamento do fuso no instante `t`, em ms (parede − UTC). Segundos de `t` são descartados. */
function deslocamento(t: number, fuso: string): number {
  const base = t - (((t % MS_MIN) + MS_MIN) % MS_MIN);
  return paredeComoUtc(base, fuso) - base;
}

/**
 * Instante UTC da hora de parede `minutosDoDia` (0..1439, inteiro) na data `data` no `fuso`.
 * RN-3: hora inexistente (salto) → primeiro instante válido depois do salto (o instante da transição);
 *       hora repetida (recuo) → PRIMEIRA ocorrência (o menor instante).
 * Data inválida, minutos fora de 0..1439 ou fuso inválido → RangeError.
 */
export function instanteDeHoraLocal(data: DataCivil, minutosDoDia: number, fuso: string): Date {
  validarFuso(fuso);
  exigirData(data);
  if (!Number.isInteger(minutosDoDia) || minutosDoDia < 0 || minutosDoDia >= MINUTOS_NO_DIA) {
    throw new RangeError(`Minutos do dia inválidos: ${String(minutosDoDia)}`);
  }
  const w = paraUtc(data) + minutosDoDia * MS_MIN;
  const oAntes = deslocamento(w - MS_DIA, fuso);
  const oDepois = deslocamento(w + MS_DIA, fuso);
  const validos = [...new Set([oAntes, oDepois])]
    .map((o) => w - o)
    .filter((t) => deslocamento(t, fuso) === w - t);
  if (validos.length > 0) {
    return new Date(Math.min(...validos));
  }
  // Salto: a hora de parede não existe. Busca o instante da transição (primeiro minuto com o
  // deslocamento posterior) entre as duas leituras possíveis.
  let baixo = w - oAntes; // ainda com o deslocamento anterior
  let alto = w - oDepois; // já com o deslocamento posterior
  if (baixo > alto) [baixo, alto] = [alto, baixo];
  while (alto - baixo > MS_MIN) {
    const meio = baixo + Math.floor((alto - baixo) / 2 / MS_MIN) * MS_MIN;
    if (deslocamento(meio, fuso) === oDepois) alto = meio;
    else baixo = meio;
  }
  return new Date(deslocamento(baixo, fuso) === oDepois ? baixo : alto);
}

/** RN-2: [00:00 local de d1, 00:00 local de d2+1), por calendário. d2 < d1 → RangeError. */
export function intervaloDeDiasInteiros(d1: DataCivil, d2: DataCivil, fuso: string): { inicio: Date; fim: Date } {
  exigirData(d1);
  exigirData(d2);
  if (compararDatas(d2, d1) < 0) {
    throw new RangeError('A data final não pode ser anterior à inicial');
  }
  return { inicio: instanteDeHoraLocal(d1, 0, fuso), fim: instanteDeHoraLocal(somarDias(d2, 1), 0, fuso) };
}

/** Data civil e minutos do dia (0..1439) do instante no fuso. Inversa parcial de instanteDeHoraLocal. */
export function partesLocais(instante: Date, fuso: string): { data: DataCivil; minutosDoDia: number } {
  validarFuso(fuso);
  if (!(instante instanceof Date) || Number.isNaN(instante.getTime())) {
    throw new RangeError('Instante inválido');
  }
  const parede = paredeComoUtc(instante.getTime(), fuso);
  const data = deUtc(parede);
  const minutosDoDia = Math.floor((parede - paraUtc(data)) / MS_MIN);
  return { data, minutosDoDia };
}

/**
 * true se `inicio` e `fim` são, cada um, a 00:00 local da própria data (pela regra RN-3, isto é,
 * x === instanteDeHoraLocal(partesLocais(x).data, 0)). Usado só para exibição.
 */
export function ehDiaInteiro(inicio: Date, fim: Date, fuso: string): boolean {
  const meiaNoite = (x: Date) => instanteDeHoraLocal(partesLocais(x, fuso).data, 0, fuso).getTime() === x.getTime();
  return meiaNoite(inicio) && meiaNoite(fim);
}
