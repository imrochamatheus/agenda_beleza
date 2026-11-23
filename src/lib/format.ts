// Formatadores de exibição em pt-BR (D-009 RN-11). Fonte única: nenhum outro arquivo de src/
// formata moeda, data ou hora para exibição (CA-10). Puro: usável no servidor e em componentes
// cliente, com o mesmo resultado nos dois (sem divergência de hidratação). O único import é
// ./telefone (também puro), para validar o telefone gravado (D-020).

import { ehTelefoneBrE164 } from './telefone';

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

/**
 * Lista em português (D-024): [] → '', ['A'] → 'A', ['A', 'B'] → 'A e B', ['A', 'B', 'C'] → 'A, B e C'.
 * Mantém a ordem recebida; não deduplica nem corta nomes. Não texto na lista → TypeError.
 */
export function formatarLista(nomes: readonly string[]): string {
  if (!Array.isArray(nomes) || nomes.some((n) => typeof n !== 'string')) {
    throw new TypeError('formatarLista: espera uma lista de textos');
  }
  if (nomes.length <= 1) return nomes[0] ?? '';
  return `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`;
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

/** Forma curta (D-051, régua da semana): índice = dia da semana, 0 = domingo. */
const DIAS_DA_SEMANA_CURTOS = Object.freeze(['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']);

/** 0 → 'Dom', 1 → 'Seg' … 6 → 'Sáb'; fora de 0..6 inteiro → RangeError (D-051). */
export function formatarDiaDaSemanaCurto(dia: number): string {
  if (typeof dia !== 'number' || !Number.isInteger(dia) || dia < 0 || dia > 6) {
    throw new RangeError(`formatarDiaDaSemanaCurto: o dia deve ser inteiro de 0 a 6 (recebido: ${String(dia)})`);
  }
  return DIAS_DA_SEMANA_CURTOS[dia];
}

const MESES_CURTOS = Object.freeze(['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']);

/**
 * 'AAAA-MM-DD' → { dia: '1', mes: 'dez' } (dia sem zero à esquerda, mês curto minúsculo; D-051). Data civil,
 * sem fuso. Chave inválida → RangeError (mesma validação de `formatarDataCivil`).
 */
export function formatarDiaEMesCurtos(chave: string): { dia: string; mes: string } {
  const [dia, mes] = formatarDataCivil(chave).split('/');
  return { dia: String(Number(dia)), mes: MESES_CURTOS[Number(mes) - 1] };
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

/**
 * Data de calendário 'AAAA-MM-DD' (sem fuso) → 'dd/mm/aaaa'. Só reordena os campos, logo não
 * depende do fuso do processo. Fora do formato ou data inexistente → RangeError.
 */
export function formatarDataCivil(data: string): string {
  const m = typeof data === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(data) : null;
  if (m !== null) {
    const [, a, mes, dia] = m;
    const teste = new Date(Date.UTC(Number(a), Number(mes) - 1, Number(dia)));
    if (teste.getUTCFullYear() === Number(a) && teste.getUTCMonth() === Number(mes) - 1 && teste.getUTCDate() === Number(dia)) {
      return `${dia}/${mes}/${a}`;
    }
  }
  throw new RangeError(`formatarDataCivil: data fora do formato AAAA-MM-DD (${String(data)})`);
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

/**
 * Telefone gravado em E.164 brasileiro (D-020 RN-7): '+551134567890' → '(11) 3456-7890';
 * '+5511987654321' → '(11) 98765-4321'. Fora do formato gravado (ehTelefoneBrE164) → RangeError.
 */
export function formatarTelefone(e164: string): string {
  if (!ehTelefoneBrE164(e164)) {
    throw new RangeError(`formatarTelefone: telefone fora do formato gravado (${String(e164)})`);
  }
  const ddd = e164.slice(3, 5);
  const numero = e164.slice(5);
  const corte = numero.length - 4;
  return `(${ddd}) ${numero.slice(0, corte)}-${numero.slice(corte)}`;
}

/**
 * Telefone MASCARADO para o painel do super admin (D-045 RN-2): '+5571987651234' → '+55 (71) 9****-1234';
 * fixo '+557133451234' → '+55 (71) ****-1234'. Só DDD e os 4 últimos dígitos. Nulo, não texto ou fora do
 * formato gravado → '—' (nunca lança, nunca devolve dígitos do número).
 */
export function mascararTelefone(e164: unknown): string {
  if (!ehTelefoneBrE164(e164)) return '—';
  const ddd = e164.slice(3, 5);
  const numero = e164.slice(5);
  return `+55 (${ddd}) ${numero.length === 9 ? '9' : ''}****-${numero.slice(-4)}`;
}

/** CEP gravado com 8 dígitos (D-020 RN-6): '01310100' → '01310-100'. Fora de /^\d{8}$/ → RangeError. */
export function formatarCep(cep: string): string {
  if (typeof cep !== 'string' || !/^\d{8}$/.test(cep)) {
    throw new RangeError(`formatarCep: CEP fora do formato gravado (${String(cep)})`);
  }
  return `${cep.slice(0, 5)}-${cep.slice(5)}`;
}

/** Inteiro não negativo com milhar por '.' (D-020: contador da descrição): 1000 → '1.000'. Sem Intl. */
export function formatarInteiro(n: number): string {
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0) {
    throw new RangeError(`formatarInteiro: inteiro não negativo esperado (recebido: ${String(n)})`);
  }
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * Nota média com uma casa e vírgula (D-032): 4.3 → '4,3'; 5 → '5,0'. Espera o valor já arredondado
 * pelo banco (`round(avg, 1)`); entre 1 e 5, senão RangeError. Montado por texto, sem Intl.
 */
export function formatarNota(n: number): string {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 1 || n > 5) {
    throw new RangeError(`formatarNota: nota entre 1 e 5 esperada (recebido: ${String(n)})`);
  }
  return n.toFixed(1).replace('.', ',');
}

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/** 'novembro de 2026' no fuso (IANA) do salão (D-032 RN-8); nunca o dia exato. */
export function formatarMesAno(instante: Date, fuso?: string): string {
  const p = partes(instante, fuso);
  return `${MESES[Number(p.month) - 1]} de ${p.year}`;
}
