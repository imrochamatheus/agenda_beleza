import { decidirCheckoutSimulado } from '@/server/integrations/mercadopago/checkout-simulado';

// Decisão do checkout simulado (RN-20, CA-19): POST do formulário de /dev/mp-checkout.
// 303 para a urlRetorno GRAVADA, ou 404 (fora do modo simulado, sem tocar no banco; ID ou
// decisão inválidos; corpo que não é formulário). O ambiente é lido na requisição.
export const dynamic = 'force-dynamic';

const SEM_CACHE = { 'Cache-Control': 'no-store' };

export async function POST(req: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return new Response(null, { status: 404, headers: SEM_CACHE });
  }
  const r = await decidirCheckoutSimulado(form);
  if (r.status === 404) return new Response(null, { status: 404, headers: SEM_CACHE });
  return new Response(null, { status: 303, headers: { ...SEM_CACHE, Location: r.location } });
}
