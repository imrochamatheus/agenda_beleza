// Telefone brasileiro (D-020 §3.2, RN-7). Puro e sem imports de servidor: usável no servidor e em
// componentes cliente. Fonte única da lista de DDDs: a E5.1 (telefone da cliente) importa daqui, sem
// copiar a lista. A exibição fica em src/lib/format.ts (formatarTelefone).

/** 67 DDDs brasileiros válidos (Anatel). */
export const DDDS_BRASIL: ReadonlySet<string> = new Set(
  [
    '11', '12', '13', '14', '15', '16', '17', '18', '19',
    '21', '22', '24', '27', '28',
    '31', '32', '33', '34', '35', '37', '38',
    '41', '42', '43', '44', '45', '46', '47', '48', '49',
    '51', '53', '54', '55',
    '61', '62', '63', '64', '65', '66', '67', '68', '69',
    '71', '73', '74', '75', '77', '79',
    '81', '82', '83', '84', '85', '86', '87', '88', '89',
    '91', '92', '93', '94', '95', '96', '97', '98', '99',
  ],
);

/** Texto bruto acima disso é recusado sem processar. */
export const TELEFONE_MAX_CARACTERES = 30;

/** 10 dígitos (DDD + fixo começando por 2–5) ou 11 (DDD + celular começando por 9), DDD da lista. */
function nacionalValido(d: string): boolean {
  if (!/^\d{10,11}$/.test(d) || !DDDS_BRASIL.has(d.slice(0, 2))) return false;
  const terceiro = d[2];
  return d.length === 10 ? terceiro >= '2' && terceiro <= '5' : terceiro === '9';
}

/**
 * RN-7: telefone brasileiro → E.164 (`+55DDNNNNNNNN` ou `+55DDNNNNNNNNN`). Aceita dígitos com espaços,
 * parênteses, hífens e pontos; prefixo opcional `+55` (o `+` só no início) ou `55` (só quando sobram
 * 10 ou 11 dígitos). Qualquer outra coisa (outro país, 0800/0300/4004, DDD inexistente, quantidade
 * errada, letras, não texto, acima de TELEFONE_MAX_CARACTERES) → null. Nunca lança.
 */
export function normalizarTelefoneBr(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > TELEFONE_MAX_CARACTERES) return null;
  const texto = v.trim();
  if (!/^[0-9 ()\-.+]+$/.test(texto)) return null;
  const temMais = texto.startsWith('+');
  if (texto.indexOf('+', 1) !== -1) return null;
  let digitos = texto.replace(/[ ()\-.+]/g, '');
  if (temMais) {
    if (!digitos.startsWith('55')) return null;
    digitos = digitos.slice(2);
  } else if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith('55')) {
    digitos = digitos.slice(2);
  }
  return nacionalValido(digitos) ? `+55${digitos}` : null;
}

/** true se `v` é um telefone gravado: `+55` + 10/11 dígitos, DDD da lista e a regra do 3º dígito. */
export function ehTelefoneBrE164(v: unknown): v is string {
  return typeof v === 'string' && /^\+55\d{10,11}$/.test(v) && nacionalValido(v.slice(3));
}
