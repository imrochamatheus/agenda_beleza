import { servirFoto } from '@/server/fotos/entrega';

// Entrega pública da foto por id (D-021 §3.6; RN-14). Sem sessão. Não há route.ts em /api/fotos: GET
// /api/fotos e /api/fotos/ respondem 404 (nada lista fotos).

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request, contexto: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await contexto.params;
  return servirFoto(id, request);
}
