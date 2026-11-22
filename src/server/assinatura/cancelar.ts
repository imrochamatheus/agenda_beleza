import { integracoes } from '@/server/integrations/registry';
import { ErroMercadoPago } from '@/server/integrations/mercadopago/port';
import type { PortaMercadoPago } from '@/server/integrations/mercadopago/port';
import { NaoImplementado } from '@/server/integrations/nao-implementado';
import { repos } from '@/server/repos';
import { emTransacao } from '@/server/repos/transacao';
import type { ContextoEscopado } from '@/server/tenant/context';

import type { EntradaCancelar, ResultadoCancelar } from './cancelar-tipos';
import { aplicarEventoAssinatura } from './servico';

// Cancelamento pelo gestor (D-042 RN-2..RN-6). Ordem: ler o estado (sem trava) → provedor FORA de
// transação (idempotente) → UMA transação curta: `confirmarProvedor` (trava `assinatura` FOR NO KEY
// UPDATE e confere o vínculo) + `aplicarEventoAssinatura({ tipo: 'cancelamento' })`. Nenhuma trava de
// `salao` aqui (como webhook, retorno e job). O estado local só muda depois do provedor confirmar.

export type DepsCancelar = {
  mp?: PortaMercadoPago;
  log?: (evento: string, campos: Record<string, unknown>) => void;
};

const CANCELAVEIS = ['pendente', 'em_teste', 'ativa', 'em_carencia', 'suspensa'];

export async function cancelarAssinatura(
  ctx: ContextoEscopado,
  entrada: EntradaCancelar,
  agora: Date,
  deps: DepsCancelar = {},
): Promise<ResultadoCancelar> {
  const d = await repos().assinaturas.lerDetalhe(ctx);
  if (d.suspensoManualEm !== null) return { resultado: 'recusado', motivo: 'manual' };
  const a = d.assinatura;
  if (a === null) return { resultado: 'recusado', motivo: 'estado' };
  if (a.estado === 'cancelada') return { resultado: 'ja_cancelada', acessoAte: a.acessoAte, fuso: d.fuso };
  if (!CANCELAVEIS.includes(a.estado)) return { resultado: 'recusado', motivo: 'estado' };
  if (entrada.estadoVisto !== undefined && entrada.estadoVisto !== a.estado) return { resultado: 'mudou' };

  if (a.provedorAssinaturaId !== null) {
    try {
      await (deps.mp ?? integracoes().mercadoPago).cancelarAssinatura(a.provedorAssinaturaId);
    } catch (e) {
      if (!(e instanceof ErroMercadoPago) && !(e instanceof NaoImplementado)) throw e;
      deps.log?.('assinatura.cancelar_provedor_falhou', { assinaturaId: a.id });
      return { resultado: 'provedor_indisponivel' };
    }
  }

  try {
    return await emTransacao(async (r): Promise<ResultadoCancelar> => {
      if (!(await r.assinaturas.confirmarProvedor(ctx, { id: a.id, provedorId: a.provedorAssinaturaId }))) {
        return { resultado: 'mudou' };
      }
      const res = await aplicarEventoAssinatura(ctx, { tipo: 'cancelamento' }, agora, {
        r,
        assinaturaId: a.id,
        ...(deps.log ? { log: deps.log } : {}),
      });
      if (res.resultado !== 'aplicado' && res.resultado !== 'sem_efeito') return { resultado: 'mudou' };
      const atual = await r.assinaturas.travar(ctx, { assinaturaId: a.id });
      if (atual === null || atual === 'ocupada') return { resultado: 'mudou' };
      if (atual.estado === 'cancelada') {
        return res.resultado === 'aplicado'
          ? { resultado: 'cancelada', para: 'cancelada', acessoAte: atual.acessoAte, fuso: d.fuso }
          : { resultado: 'ja_cancelada', acessoAte: atual.acessoAte, fuso: d.fuso };
      }
      if (atual.estado === 'encerrada') {
        return res.resultado === 'aplicado'
          ? { resultado: 'cancelada', para: 'encerrada', acessoAte: null, fuso: d.fuso }
          : { resultado: 'recusado', motivo: 'estado' };
      }
      return { resultado: 'mudou' };
    });
  } catch {
    // O provedor já pode ter cancelado: o webhook ou o retorno convergem e repetir é idempotente.
    deps.log?.('assinatura.cancelar_pos_provedor_falhou', { assinaturaId: a.id });
    return { resultado: 'tente_novamente' };
  }
}
