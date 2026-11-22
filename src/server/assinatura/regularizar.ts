import { integracoes } from '@/server/integrations/registry';
import { ErroMercadoPago } from '@/server/integrations/mercadopago/port';
import { NaoImplementado } from '@/server/integrations/nao-implementado';
import { repos } from '@/server/repos';
import type { ContextoEscopado } from '@/server/tenant/context';

import { iniciarAssinatura } from './iniciar';
import type { DepsIniciar } from './iniciar';
import type { ResultadoRegularizar } from './regularizar-tipos';

// Regularizar / atualizar o meio de pagamento (D-042 RN-7). `pendente` volta ao checkout pelo
// `iniciarAssinatura`; `ativa`/`em_carencia`/`suspensa` pedem a URL ao provedor, FORA de transação e
// sem gravar nada: o estado só muda por webhook ou pela consulta do retorno (D-040).

const COM_URL_DO_PROVEDOR = ['ativa', 'em_carencia', 'suspensa'];

const ehUrlHttp = (u: unknown): u is string => {
  if (typeof u !== 'string') return false;
  try {
    const p = new URL(u).protocol;
    return p === 'http:' || p === 'https:';
  } catch {
    return false;
  }
};

export async function regularizarAssinatura(
  ctx: ContextoEscopado,
  agora: Date,
  deps: DepsIniciar = {},
): Promise<ResultadoRegularizar> {
  const d = await repos().assinaturas.lerDetalhe(ctx);
  if (d.suspensoManualEm !== null) return { resultado: 'recusado', motivo: 'manual' };
  const a = d.assinatura;
  if (a === null) return { resultado: 'recusado', motivo: 'estado' };

  if (a.estado === 'pendente') {
    const r = await iniciarAssinatura(ctx, agora, deps);
    switch (r.resultado) {
      case 'iniciada':
        return { resultado: 'iniciada', url: r.urlCheckout };
      case 'recusado':
        return { resultado: 'recusado', motivo: 'estado' };
      default:
        return r;
    }
  }
  if (!COM_URL_DO_PROVEDOR.includes(a.estado)) return { resultado: 'recusado', motivo: 'estado' };
  if (a.provedorAssinaturaId === null) return { resultado: 'recusado', motivo: 'sem_vinculo' };

  try {
    const url = await (deps.mp ?? integracoes().mercadoPago).urlAtualizarMeioPagamento(a.provedorAssinaturaId);
    if (!ehUrlHttp(url)) {
      deps.log?.('assinatura.regularizar_url_invalida', { assinaturaId: a.id });
      return { resultado: 'provedor_indisponivel' };
    }
    return { resultado: 'iniciada', url };
  } catch (e) {
    if (!(e instanceof ErroMercadoPago) && !(e instanceof NaoImplementado)) throw e;
    deps.log?.('assinatura.regularizar_falhou', { assinaturaId: a.id });
    return { resultado: 'provedor_indisponivel' };
  }
}
