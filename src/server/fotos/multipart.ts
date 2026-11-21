// Leitura limitada do corpo multipart do envio (D-021 §3.4; RN-4, RN-17). Sem next/*.
import { LIMITE_CORPO_BYTES, LIMITES_FOTO } from './tipos';
import type { CorpoLido } from './tipos';

type Falha = Extract<CorpoLido, { ok: false }>;
const recusa = (codigo: Falha['codigo']): Falha => ({ ok: false, codigo });

/** Lê o corpo contando os bytes; passa do limite → null (e cancela a leitura). */
async function lerLimitado(request: Request): Promise<Uint8Array | null> {
  const corpo = request.body;
  if (!corpo) {
    return new Uint8Array(0);
  }
  const leitor = corpo.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > LIMITE_CORPO_BYTES) {
      await leitor.cancel().catch(() => undefined);
      return null;
    }
    partes.push(value);
  }
  const bytes = new Uint8Array(total);
  let pos = 0;
  for (const p of partes) {
    bytes.set(p, pos);
    pos += p.byteLength;
  }
  return bytes;
}

export async function lerCorpoEnvio(request: Request): Promise<CorpoLido> {
  const tipo = request.headers.get('content-type') ?? '';
  if (!/^multipart\/form-data\s*;/iu.test(tipo)) {
    return recusa('falha');
  }
  const declarado = request.headers.get('content-length');
  if (declarado !== null && /^\d+$/u.test(declarado) && Number(declarado) > LIMITE_CORPO_BYTES) {
    await request.body?.cancel().catch(() => undefined);
    return recusa('tamanho');
  }
  let bytes: Uint8Array | null;
  try {
    bytes = await lerLimitado(request);
  } catch {
    return recusa('falha');
  }
  if (bytes === null) {
    return recusa('tamanho');
  }
  let form: FormData;
  try {
    form = await new Response(bytes as BodyInit, { headers: { 'content-type': tipo } }).formData();
  } catch {
    return recusa('falha');
  }
  const arquivos = form.getAll('foto');
  const alts = form.getAll('alt');
  const tokens = form.getAll('envio');
  if (arquivos.length > 1 || alts.length > 1 || tokens.length > 1) {
    return recusa('falha');
  }
  const arquivo = arquivos[0];
  if (arquivo === undefined || typeof arquivo === 'string' || arquivo.size === 0) {
    return recusa('sem_arquivo');
  }
  if (arquivo.size > LIMITES_FOTO.maxBytes) {
    return recusa('tamanho');
  }
  const alt = alts[0];
  const envio = tokens[0];
  return {
    ok: true,
    arquivo: new Uint8Array(await arquivo.arrayBuffer()),
    alt: typeof alt === 'string' ? alt : '',
    envio: typeof envio === 'string' ? envio : '',
  };
}
