import { ErroAuditoriaEntrada, ErroAuditoriaSegredo, MAX_BYTES, MAX_PROFUNDIDADE } from './tipos';

// Funções puras de validação do JSON de auditoria (D-033 §4). Nunca citam valores nas mensagens.

/** Termos longos, sem palavra comum que os contenha: casam por substring da chave normalizada. */
export const TERMOS_POR_SUBSTRING = [
  'senha', 'password', 'passwd', 'hash', 'totp', 'token', 'secret', 'segredo', 'cookie',
  'authorization', 'apikey', 'chaveapi', 'credencial', 'cvv', 'cartao', 'cardnumber',
] as const;

/** Termos curtos (falso positivo em substring: panorama, capital, hotpot): igualdade exata. */
export const TERMOS_EXATOS = ['pan', 'otp', 'pin', 'otpcode', 'codigootp'] as const;

/** Minúsculas, só [a-z0-9] (sem remover acentos: "cartão" vira "carto", e "cartao" é coberto). */
export function normalizarChave(chave: string): string {
  return chave.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function chaveEhProibida(chave: string): boolean {
  const n = normalizarChave(chave);
  return (TERMOS_EXATOS as readonly string[]).includes(n) || TERMOS_POR_SUBSTRING.some((t) => n.includes(t));
}

/** Verifica que `v` é JSON puro dentro dos limites. Lança ErroAuditoriaEntrada. `caminho` é só rótulo. */
export function validarJson(v: unknown, caminho: string): void {
  const visitando = new WeakSet<object>();
  const visitar = (x: unknown, prof: number): void => {
    if (x === null || typeof x === 'string' || typeof x === 'boolean') return;
    if (typeof x === 'number') {
      if (!Number.isFinite(x)) throw new ErroAuditoriaEntrada(`${caminho}: número não finito`);
      return;
    }
    if (typeof x !== 'object') throw new ErroAuditoriaEntrada(`${caminho}: valor não é JSON puro`);
    const proto = Object.getPrototypeOf(x) as unknown;
    if (!Array.isArray(x) && proto !== Object.prototype && proto !== null) {
      throw new ErroAuditoriaEntrada(`${caminho}: valor não é JSON puro`);
    }
    if (prof > MAX_PROFUNDIDADE) throw new ErroAuditoriaEntrada(`${caminho}: profundidade acima de ${MAX_PROFUNDIDADE}`);
    if (visitando.has(x)) throw new ErroAuditoriaEntrada(`${caminho}: referência circular`);
    visitando.add(x);
    for (const filho of Array.isArray(x) ? x : Object.values(x)) visitar(filho, prof + 1);
    visitando.delete(x);
  };
  visitar(v, 1);
  if (Buffer.byteLength(JSON.stringify(v), 'utf8') > MAX_BYTES) {
    throw new ErroAuditoriaEntrada(`${caminho}: acima de ${MAX_BYTES} bytes`);
  }
}

/** Varre objetos e arrays; lança ErroAuditoriaSegredo com o caminho da primeira chave suspeita. */
export function rejeitarSegredos(v: unknown, caminho: string): void {
  if (Array.isArray(v)) {
    v.forEach((x, i) => rejeitarSegredos(x, `${caminho}[${i}]`));
  } else if (typeof v === 'object' && v !== null) {
    for (const [k, x] of Object.entries(v)) {
      if (chaveEhProibida(k)) throw new ErroAuditoriaSegredo(`${caminho}.${k}`);
      rejeitarSegredos(x, `${caminho}.${k}`);
    }
  }
}
