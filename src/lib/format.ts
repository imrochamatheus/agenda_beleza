// Formatadores de exibição em pt-BR (D-009 RN-11). Fonte única: nenhum outro arquivo de src/
// formata moeda, data ou hora para exibição (CA-10). Puro e sem imports: usável no servidor e em
// componentes cliente, com o mesmo resultado nos dois (sem divergência de hidratação).

/** Igual ao @default de salao.fuso (prisma/schema.prisma); um teste compara os dois (D-14). */
export const FUSO_PADRAO = 'America/Sao_Paulo';

const NBSP = ' ';
const MENOS = '−';

/**
 * `R$` + U+00A0 + milhar com '.' + ',' + 2 casas, a partir de centavos inteiros (D-13).
 * Montado por texto e aritmética inteira, sem Intl nem ponto flutuante.
 */
export function formatarMoeda(centavos: number): string {
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
  return `R$${NBSP}${inteiro},${fracao}`;
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
