// Reconhecimento da violação do UNIQUE (salao_id, telefone_e164) (D-022 A-4). Só esta restrição: qualquer
// outro erro sobe. Sem imports de servidor: puro, com teste de unidade.

export const RESTRICAO_TELEFONE_UNICO = 'cliente_salao_id_telefone_e164_key';

function texto(v: unknown): string {
  try {
    return typeof v === 'string' ? v : JSON.stringify(v) ?? '';
  } catch {
    return '';
  }
}

/**
 * true se `e` é a violação (23505) do UNIQUE de telefone da cliente. Aceita `P2002` (target ou
 * restrição citando telefone_e164) e `P2010` (consulta bruta, `meta.code = '23505'`) com o nome da
 * restrição, na mensagem ou na meta.
 */
export function ehViolacaoDeTelefoneUnico(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const { code, meta, message } = e as { code?: unknown; meta?: unknown; message?: unknown };
  const m = (meta ?? {}) as { code?: unknown; target?: unknown };
  const evidencias = `${texto(meta)} ${texto(message)}`;
  if (code === 'P2002') {
    return texto(m.target).includes('telefone_e164') || evidencias.includes(RESTRICAO_TELEFONE_UNICO);
  }
  if (code === 'P2010') {
    return (m.code === '23505' || evidencias.includes('23505')) && evidencias.includes(RESTRICAO_TELEFONE_UNICO);
  }
  return false;
}
