// Reconhecimento da violação da exclusion constraint de reserva (D-025 A-8, RN-3). Só `23P01` COM o
// nome `reserva_item_sem_sobreposicao` (D-050 §3.3: a anti-sobreposição por profissional passou para
// os itens; o nome antigo `reserva_sem_sobreposicao` deixou de existir e NÃO é aceito): nenhum dos dois
// sozinho basta. `reserva_item_mesma_reserva_sem_sobreposicao` NUNCA é reconhecida (indica falha da
// checagem pura `conferirItens`, que roda antes do INSERT/UPDATE; dba.md M-6). A citação é sempre o
// nome ENTRE ASPAS, então o nome da outra exclusion (que contém o sufixo) não casa. Puro, sem imports
// de servidor.
//
// Forma real capturada no Prisma 7 (adaptador pg), INSERT bruto ($executeRaw/$queryRaw, com ou sem
// transação): PrismaClientKnownRequestError, `code = 'P2010'`, sem `cause`,
// `meta.driverAdapterError.cause = { originalCode: '23P01', code: '23P01', originalMessage/message:
// 'conflicting key value violates exclusion constraint "reserva_item_sem_sobreposicao"', detail, … }`.
// O nome da restrição só aparece nesses textos do driver; não há campo `constraint` separado.

export const RESTRICAO_SOBREPOSICAO = 'reserva_item_sem_sobreposicao';
const SQLSTATE_EXCLUSAO = '23P01';

type Obj = Record<string, unknown>;

function obj(v: unknown): Obj | null {
  return typeof v === 'object' && v !== null ? (v as Obj) : null;
}

function texto(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Cita a restrição por nome entre aspas, como o PostgreSQL a escreve (não por substring solta). */
function citaRestricao(...textos: unknown[]): boolean {
  return textos.some((t) => texto(t).includes(`"${RESTRICAO_SOBREPOSICAO}"`));
}

/** Erro cru do `pg`: `code` e `constraint`. */
function ehErroDoPg(e: Obj): boolean {
  return e.code === SQLSTATE_EXCLUSAO && e.constraint === RESTRICAO_SOBREPOSICAO;
}

/** Erro do adaptador: `P2010` com o SQLSTATE e o nome na causa do driver. */
function ehErroDoPrisma(e: Obj): boolean {
  if (e.code !== 'P2010') return false;
  const meta = obj(e.meta);
  const causa = obj(obj(meta?.driverAdapterError)?.cause);
  const sqlstate = causa?.originalCode ?? causa?.code ?? meta?.code;
  if (sqlstate !== SQLSTATE_EXCLUSAO) return false;
  return (
    texto(causa?.constraint) === RESTRICAO_SOBREPOSICAO ||
    citaRestricao(causa?.originalMessage, causa?.message, meta?.message, e.message)
  );
}

export function ehConflitoDeSobreposicao(e: unknown): boolean {
  const o = obj(e);
  if (o === null) return false;
  return ehErroDoPg(o) || ehErroDoPrisma(o);
}
