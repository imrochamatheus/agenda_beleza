import type { PortaArmazenamento } from '@/server/integrations/armazenamento/port';
import { integracoes } from '@/server/integrations/registry';
import { buscarChaveDaFoto } from '@/server/repos/foto-publica';

// Entrega pública de uma foto (D-021 §3.4; RN-14, A-16). Sem sessão, sem filtro de suspensão. Recebe
// o id (nunca a chave nem um caminho); inexistente, malformado ou removido → 404 sem corpo útil.

export type DepsEntrega = {
  armazenamento?: PortaArmazenamento;
  buscarChave?: (id: string) => Promise<string | null>;
};

const CABECALHOS_BASE = {
  'x-content-type-options': 'nosniff',
  'cache-control': 'public, max-age=3600',
} as const;

function registrar(evento: string, dados: Record<string, unknown>): void {
  console.warn(JSON.stringify({ evento, ...dados }));
}

const naoEncontrada = () => new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });

/** `If-None-Match` com lista, `*` e prefixo `W/` (A-16). */
function casaEtag(cabecalho: string | null, etag: string): boolean {
  if (cabecalho === null) return false;
  if (cabecalho.trim() === '*') return true;
  return cabecalho.split(',').some((p) => p.trim().replace(/^W\//u, '') === etag);
}

export async function servirFoto(id: string, request: Request, deps: DepsEntrega = {}): Promise<Response> {
  const chave = await (deps.buscarChave ?? buscarChaveDaFoto)(id);
  if (chave === null) {
    return naoEncontrada();
  }
  const etag = `"${id.toLowerCase()}"`;
  if (casaEtag(request.headers.get('if-none-match'), etag)) {
    return new Response(null, { status: 304, headers: { ...CABECALHOS_BASE, etag } });
  }
  let bytes: Uint8Array | null;
  try {
    bytes = await (deps.armazenamento ?? integracoes().armazenamento).ler(chave);
  } catch (e) {
    registrar('armazenamento.falha_ao_ler', { fotoId: id, erro: e instanceof Error ? e.name : 'erro' });
    return new Response(null, { status: 502, headers: { 'cache-control': 'no-store' } });
  }
  if (bytes === null) {
    registrar('armazenamento.objeto_ausente', { fotoId: id, chave });
    return naoEncontrada();
  }
  return new Response(bytes as BodyInit, {
    status: 200,
    headers: {
      ...CABECALHOS_BASE,
      'content-type': 'image/webp',
      'content-disposition': 'inline',
      'content-length': String(bytes.byteLength),
      etag,
    },
  });
}
