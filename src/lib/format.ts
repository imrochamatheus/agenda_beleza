// Formatadores de exibição em pt-BR (D-009 RN-11). Fonte única: nenhum outro arquivo de src/
// formata moeda, data ou hora para exibição (CA-10). Puro e sem imports: usável no servidor e em
// componentes cliente, com o mesmo resultado nos dois (sem divergência de hidratação).

/** Igual ao @default de salao.fuso (prisma/schema.prisma); um teste compara os dois (D-14). */
export const FUSO_PADRAO = 'America/Sao_Paulo';

const NBSP = ' ';
const MENOS = '−';

/**
 * Valor em reais sem o símbolo: milhar com '.' + ',' + 2 casas, a partir de centavos inteiros
 * (8000 → '80,00'; 123456 → '1.234,56'). Valor inicial do campo de preço (D-014 §3.4).
 * Montado por texto e aritmética inteira, sem Intl nem ponto flutuante.
 */
export function formatarMoedaSemSimbolo(centavos: number): string {
  if (typeof centavos !== 'number') {
    throw new TypeError('formatarMoeda: o valor deve ser um número inteiro de centavos');
  }
  if (!Number.isSafeInteger(centavos)) {
    throw new RangeError(
      `formatarMoeda: centavos deve ser um inteiro seguro (recebido: ${String(centavos)})`,
    );
  }
  if (centavos < 0) {
    throw new RangeError(`formatarMoeda: o valor não pode ser negativo (recebido: ${centavos})`);
  }
  const digitos = String(centavos).padStart(3, '0');
  const inteiro = digitos.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const fracao = digitos.slice(-2);
  return `${inteiro},${fracao}`;
}

/** `R$` + U+00A0 + formatarMoedaSemSimbolo(centavos) (D-13). */
export function formatarMoeda(centavos: number): string {
  return `R$${NBSP}${formatarMoedaSemSimbolo(centavos)}`;
}

/**
 * Duração em minutos para exibição (D-014 D-7): 45 → '45 min'; 60 → '1 h'; 90 → '1 h 30 min'.
 * Só inteiro > 0: não número → TypeError; 0, negativo, fracionário ou NaN → RangeError.
 */
export function formatarDuracao(minutos: number): string {
  if (typeof minutos !== 'number') {
    throw new TypeError('formatarDuracao: o valor deve ser um número inteiro de minutos');
  }
  if (!Number.isSafeInteger(minutos) || minutos <= 0) {
    throw new RangeError(`formatarDuracao: minutos deve ser um inteiro maior que zero (recebido: ${String(minutos)})`);
  }
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  if (horas === 0) return `${resto} min`;
  return resto === 0 ? `${horas} h` : `${horas} h ${resto} min`;
}

/** Último minuto representável do dia local (24:00, só como fim de intervalo; D-015 RN-3). */
const MINUTOS_NO_DIA = 1440;

function validarMinutosDoDia(min: number, nome: string): void {
  if (typeof min !== 'number') {
    throw new TypeError(`${nome}: o valor deve ser um número inteiro de minutos`);
  }
  if (!Number.isInteger(min) || min < 0 || min > MINUTOS_NO_DIA) {
    throw new RangeError(`${nome}: minutos do dia devem ser inteiros de 0 a 1440 (recebido: ${String(min)})`);
  }
}

/**
 * Minutos do dia em hora local de parede (D-015 CA-20): 0 → '00:00'; 545 → '09:05'; 1440 → '24:00'.
 * Sem fuso: a jornada já é hora local (RN-10). Não número → TypeError; não inteiro, NaN, < 0 ou
 * > 1440 → RangeError.
 */
export function formatarMinutosDoDia(min: number): string {
  validarMinutosDoDia(min, 'formatarMinutosDoDia');
  const h = String(Math.floor(min / 60)).padStart(2, '0');
  const m = String(min % 60).padStart(2, '0');
  return `${h}:${m}`;
}

/** (720, 780) → '12:00–13:00' (meia-risca U+2013). As duas pontas válidas e inicio < fim. */
export function formatarFaixaDeMinutos(inicioMin: number, fimMin: number): string {
  validarMinutosDoDia(inicioMin, 'formatarFaixaDeMinutos');
  validarMinutosDoDia(fimMin, 'formatarFaixaDeMinutos');
  if (inicioMin >= fimMin) {
    throw new RangeError(`formatarFaixaDeMinutos: o início deve ser antes do fim (${inicioMin} ≥ ${fimMin})`);
  }
  return `${formatarMinutosDoDia(inicioMin)}–${formatarMinutosDoDia(fimMin)}`;
}

/** Tabela fixa (sem Intl): índice = dia da semana, 0 = domingo (D-015 RN-15). */
const DIAS_DA_SEMANA = Object.freeze([
  'Domingo',
  'Segunda-feira',
  'Terça-feira',
  'Quarta-feira',
  'Quinta-feira',
  'Sexta-feira',
  'Sábado',
]);

/** 0 → 'Domingo', 1 → 'Segunda-feira' … 6 → 'Sábado'; fora de 0..6 inteiro → RangeError. */
export function formatarDiaDaSemana(dia: number): string {
  if (typeof dia !== 'number' || !Number.isInteger(dia) || dia < 0 || dia > 6) {
    throw new RangeError(`formatarDiaDaSemana: o dia deve ser inteiro de 0 a 6 (recebido: ${String(dia)})`);
  }
  return DIAS_DA_SEMANA[dia];
}

type Partes = { day: string; month: string; year: string; hour: string; minute: string };

const formatadores = new Map<string, Intl.DateTimeFormat>();
const formatadoresDeslocamento = new Map<string, Intl.DateTimeFormat>();

/** Cria (ou reaproveita) um formatador do Intl; fuso inexistente vira RangeError em pt-BR. */
function obterFormatador(
  cache: Map<string, Intl.DateTimeFormat>,
  fuso: string,
  criar: (fuso: string) => Intl.DateTimeFormat,
): Intl.DateTimeFormat {
  const existente = cache.get(fuso);
  if (existente) return existente;
  let formatador: Intl.DateTimeFormat;
  try {
    formatador = criar(fuso);
  } catch (erro) {
    throw new RangeError(`Fuso horário inválido: "${fuso}"`, { cause: erro });
  }
  cache.set(fuso, formatador);
  return formatador;
}

function validarEntrada(instante: Date, fuso: string | undefined): string {
  if (!(instante instanceof Date)) {
    throw new TypeError('O instante deve ser um Date');
  }
  if (Number.isNaN(instante.getTime())) {
    throw new RangeError('Não é possível formatar uma data inválida');
  }
  const escolhido = fuso === undefined ? FUSO_PADRAO : fuso;
  if (typeof escolhido !== 'string' || escolhido === '') {
    throw new RangeError(`Fuso horário inválido: "${String(escolhido)}"`);
  }
  return escolhido;
}

function partes(instante: Date, fuso: string | undefined): Partes {
  const escolhido = validarEntrada(instante, fuso);
  const formatador = obterFormatador(
    formatadores,
    escolhido,
    (timeZone) =>
      new Intl.DateTimeFormat('pt-BR', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
        numberingSystem: 'latn',
      }),
  );
  const saida: Partes = { day: '', month: '', year: '', hour: '', minute: '' };
  for (const parte of formatador.formatToParts(instante)) {
    if (parte.type in saida) saida[parte.type as keyof Partes] = parte.value;
  }
  // Garantia para motores que ainda devolvem '24' à meia-noite com h23.
  if (saida.hour === '24') saida.hour = '00';
  return saida;
}

/** dd/mm/aaaa no fuso (IANA). `fuso` omitido → FUSO_PADRAO; '' ou inexistente → RangeError. */
export function formatarData(instante: Date, fuso?: string): string {
  const p = partes(instante, fuso);
  return `${p.day}/${p.month}/${p.year}`;
}

/** HH:mm, 00..23, no fuso (IANA). */
export function formatarHora(instante: Date, fuso?: string): string {
  const p = partes(instante, fuso);
  return `${p.hour}:${p.minute}`;
}

/** 'dd/mm/aaaa HH:mm' com um único U+0020, sem vírgula. */
export function formatarDataHora(instante: Date, fuso?: string): string {
  const p = partes(instante, fuso);
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

/**
 * Deslocamento do fuso no instante: 'UTC−03:00' (sinal U+2212), 'UTC+05:30', 'UTC+00:00'.
 * Usado pela SlotGrid para desambiguar rótulos repetidos (D-21).
 */
export function formatarDeslocamentoUtc(instante: Date, fuso?: string): string {
  const escolhido = validarEntrada(instante, fuso);
  const formatador = obterFormatador(
    formatadoresDeslocamento,
    escolhido,
    (timeZone) => new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }),
  );
  const nome =
    formatador.formatToParts(instante).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const casado = /^GMT([+-])(\d{2}):(\d{2})$/.exec(nome);
  if (!casado) return 'UTC+00:00';
  const sinal = casado[1] === '-' ? MENOS : '+';
  return `UTC${sinal}${casado[2]}:${casado[3]}`;
}

/**
 * Período de um bloqueio (D-016 §3.5, RN-19), no fuso do salão:
 * - `diaInteiro` e uma única data → '25/12/2026 (dia inteiro)';
 * - `diaInteiro` e várias datas → '24/12/2026 a 26/12/2026' (a última data é a de `fim − 1 ms`, o que
 *   vale também nos dias de 23 h e 25 h);
 * - senão → '25/12/2026 22:00 a 26/12/2026 02:00' (data e hora nas duas pontas).
 * `diaInteiro` vem do servidor (a classificação depende da regra de horário de verão, que este arquivo
 * não calcula). Instante inválido, `fim <= inicio` ou fuso inválido → erro.
 */
export function formatarPeriodoBloqueio(inicio: Date, fim: Date, fuso: string, diaInteiro: boolean): string {
  validarEntrada(inicio, fuso);
  validarEntrada(fim, fuso);
  if (fim.getTime() <= inicio.getTime()) {
    throw new RangeError('formatarPeriodoBloqueio: o fim deve ser posterior ao início');
  }
  if (!diaInteiro) {
    return `${formatarDataHora(inicio, fuso)} a ${formatarDataHora(fim, fuso)}`;
  }
  const primeira = formatarData(inicio, fuso);
  const ultima = formatarData(new Date(fim.getTime() - 1), fuso);
  return primeira === ultima ? `${primeira} (dia inteiro)` : `${primeira} a ${ultima}`;
}
