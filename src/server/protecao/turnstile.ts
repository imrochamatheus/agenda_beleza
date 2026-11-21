// Verificação humana (D-027 RN-3) só pela porta `integracoes().turnstile`. Falha fechada: token
// ausente/inválido, provedor indisponível ou qualquer exceção → false.
import { integracoes } from '@/server/integrations/registry';

import type { PortaTurnstile } from '@/server/integrations/turnstile/port';

import { IP_DESCONHECIDO } from './tipos';

export async function verificarHumano(
  token: string | null,
  ip: string,
  porta?: Pick<PortaTurnstile, 'validar'>,
): Promise<boolean> {
  try {
    const r = await (porta ?? integracoes().turnstile).validar({ token, ...(ip !== IP_DESCONHECIDO && { ip }) });
    return r.valido;
  } catch {
    return false;
  }
}
