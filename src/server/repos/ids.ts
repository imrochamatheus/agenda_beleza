/** UUID textual 8-4-4-4-12 em hexadecimal, de qualquer versão (o banco usa gen_random_uuid()). */
const PADRAO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Verdadeiro só para strings no formato UUID. Os repositórios usam isto para responder
 * `NaoEncontrado` a um ID malformado ANTES de consultar (CA-8): sem isso o driver lançaria 22P02.
 */
export function ehUuid(v: unknown): v is string {
  return typeof v === 'string' && PADRAO_UUID.test(v);
}
