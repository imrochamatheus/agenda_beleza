// Reconhecimento da violação do UNIQUE de e-mail do usuário (D-044 R-3), na troca do e-mail do gestor
// que perde a corrida contra outro cadastro. Só `usuario_email_key` com SQLSTATE 23505: qualquer outro
// erro sobe. Mesma forma de D-022 (`P2010` do adaptador, com o nome na causa do driver). Puro.

export const RESTRICAO_EMAIL_UNICO = 'usuario_email_key';
const SQLSTATE_UNICO = '23505';

type Obj = Record<string, unknown>;

const obj = (v: unknown): Obj | null => (typeof v === 'object' && v !== null ? (v as Obj) : null);
const texto = (v: unknown): string => {
  try {
    return typeof v === 'string' ? v : (JSON.stringify(v) ?? '');
  } catch {
    return '';
  }
};

export function ehViolacaoDeEmailUnico(e: unknown): boolean {
  const o = obj(e);
  if (o === null) return false;
  const meta = obj(o.meta);
  const causa = obj(obj(meta?.driverAdapterError)?.cause);
  const evidencias = `${texto(meta)} ${texto(o.message)}`;
  if (o.code === 'P2002') {
    return texto(meta?.target).includes('email') || evidencias.includes(RESTRICAO_EMAIL_UNICO);
  }
  if (o.code === 'P2010') {
    const sqlstate = causa?.originalCode ?? causa?.code ?? meta?.code;
    return sqlstate === SQLSTATE_UNICO && evidencias.includes(RESTRICAO_EMAIL_UNICO);
  }
  // Erro cru do `pg`.
  return o.code === SQLSTATE_UNICO && o.constraint === RESTRICAO_EMAIL_UNICO;
}
