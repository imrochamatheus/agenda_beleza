import { avisoDoPlano } from '@/server/assinatura/aviso';
import type { AvisoDePlano } from '@/server/assinatura/aviso';
import { estadoEfetivoDoSalao } from '@/server/assinatura/estado-operacional';
import { repos } from '@/server/repos';
import type { PapelDeSalao } from '@/server/tenant/context';
import { exigirContexto } from '@/server/tenant/next';

import { FaixaDoPlano } from '@/components/layout/FaixaDoPlano';

/**
 * Componente servidor do `PanelLayout` (D-038 §3.5): lê o estado efetivo do salão da sessão a cada
 * renderização (sem cache) e mostra a faixa do plano. Sem sessão (vitrines `/dev/*`, sem cookie) ou
 * com qualquer falha de leitura não mostra nada e não derruba a página; o servidor continua recusando
 * as escritas (a faixa nunca é controle de acesso). `papel` vem da página; o salão, da sessão.
 */
export async function AvisoDoPlano({ papel }: { papel: PapelDeSalao }) {
  const aviso = await lerAviso(papel);
  return aviso === null ? null : <FaixaDoPlano aviso={aviso} />;
}

async function lerAviso(papel: PapelDeSalao): Promise<AvisoDePlano | null> {
  try {
    const ctx = await exigirContexto();
    const agora = new Date();
    const [estado, config] = await Promise.all([estadoEfetivoDoSalao(ctx, agora), repos().saloes.obterConfiguracoes(ctx)]);
    return avisoDoPlano(estado, papel, config.fuso);
  } catch {
    return null;
  }
}
