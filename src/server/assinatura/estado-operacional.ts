import { decidirEstadoEfetivo } from '@/domain/assinatura';
import type { EstadoEfetivo } from '@/domain/assinatura';
import { repos } from '@/server/repos';
import type { ContextoDeLeituraDeAgenda } from '@/server/tenant/context';

export type { EstadoEfetivo, CapacidadeOperacional } from '@/domain/assinatura';
export { TABELA_CAPACIDADES, CAPACIDADES_OPERACIONAIS } from '@/domain/assinatura';

/**
 * Estado efetivo do salão do contexto (D-037 §3.3): suspensão manual, assinatura mais recente e a
 * tabela de capacidades. Só leitura; a E6.4 a aplica em `defineAcao` e na página pública.
 */
export async function estadoEfetivoDoSalao(ctx: ContextoDeLeituraDeAgenda, agora: Date): Promise<EstadoEfetivo> {
  const bruto = await repos().assinaturas.lerEstadoBruto(ctx);
  return decidirEstadoEfetivo(bruto, agora);
}
