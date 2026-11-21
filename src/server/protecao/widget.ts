// Dados do widget Turnstile para a página (D-027 RN-6). Simulado: a página entrega o token documentado
// como campo oculto. Real: a chave pública do site (lida a cada chamada) para o script oficial.
import { integracoes } from '@/server/integrations/registry';
import { TOKEN_TURNSTILE_SIMULADO } from '@/server/integrations/turnstile/port';
import { modoSelecionado } from '@/server/env';

import type { DadosDoWidget } from './widget-tipos';

export function widgetHumano(fonte: Record<string, string | undefined> = process.env): DadosDoWidget {
  const real = modoSelecionado(fonte, 'TURNSTILE_ADAPTER') === 'real';
  return real
    ? { modo: 'real', chaveDoSite: integracoes().turnstile.chaveDoSite(), tokenSimulado: '', controleDeTeste: false }
    : {
        modo: 'simulado',
        chaveDoSite: '',
        tokenSimulado: TOKEN_TURNSTILE_SIMULADO,
        // O seletor de token inválido só existe com a vitrine (E4.4/E2E); nunca na página pública em produção.
        controleDeTeste: fonte.VITRINE_COMPONENTES === 'true' || fonte.NODE_ENV === 'development',
      };
}
