'use client';

import { useEffect } from 'react';

import { URL_SCRIPT_TURNSTILE as SCRIPT } from '@/server/integrations/turnstile/port';
import { TOKEN_INVALIDO_DE_TESTE } from '@/server/protecao/widget-tipos';
import type { DadosDoWidget } from '@/server/protecao/widget-tipos';


/**
 * Verificação humana da etapa de dados (D-027 RN-6). O campo `cf-turnstile-response` é o do Turnstile.
 * Simulado: campo oculto renderizado no servidor (funciona sem JavaScript); em vitrine/dev, um seletor
 * deixa enviar um token inválido, também sem JavaScript. Real: o widget oficial injeta o campo, então
 * exige JavaScript (sem ele a reserva é recusada, falha fechada).
 */
export function WidgetTurnstile({ dados }: { dados: DadosDoWidget }) {
  useEffect(() => {
    if (dados.modo !== 'real' || document.querySelector(`script[src="${SCRIPT}"]`)) return;
    const s = document.createElement('script');
    s.src = SCRIPT;
    s.async = true;
    s.defer = true;
    document.head.appendChild(s);
  }, [dados.modo]);

  if (dados.modo === 'real') {
    return <div className="cf-turnstile" data-sitekey={dados.chaveDoSite} data-language="pt-br" />;
  }
  if (dados.controleDeTeste) {
    return (
      <div>
        <label htmlFor="turnstile-simulado">Verificação simulada (somente desenvolvimento)</label>
        <select id="turnstile-simulado" name="cf-turnstile-response" defaultValue={dados.tokenSimulado}>
          <option value={dados.tokenSimulado}>Token válido</option>
          <option value={TOKEN_INVALIDO_DE_TESTE}>Token inválido</option>
          <option value="">Sem token</option>
        </select>
      </div>
    );
  }
  return <input type="hidden" name="cf-turnstile-response" value={dados.tokenSimulado} />;
}
