// Exigências de ambiente do Mercado Pago real (D-046). Sem imports: este módulo entra no bundle do check-env.

export const SELETOR = 'MP_ADAPTER';

/** Variáveis do provedor, declaradas no .env.example (só exigidas no modo real). */
export const CHAVES = ['MP_ACCESS_TOKEN', 'MP_WEBHOOK_SECRET', 'MP_PREAPPROVAL_PLAN_ID'] as const;

/** Configuração do adaptador real, só em memória (RN-15). */
export type ConfigMercadoPagoReal = {
  accessToken: string;
  webhookSecret: string;
  planoId: string;
};
export type ConfigReal = ConfigMercadoPagoReal;

function preenchida(v: string | undefined): v is string {
  return v !== undefined && v.trim() !== '';
}

/**
 * `fonte` já vem com string vazia convertida em ausente. Exige as três `MP_*` e `APP_URL` https
 * (o padrão `http://localhost` não é https, então a ausência também é recusada). Nunca devolve valores.
 */
export function lerConfigReal(
  fonte: Record<string, string | undefined>,
): { ok: true; config: ConfigMercadoPagoReal } | { ok: false; variaveis: string[] } {
  const ruins: string[] = CHAVES.filter((c) => !preenchida(fonte[c]));
  const appUrl = fonte.APP_URL;
  if (!preenchida(appUrl) || !/^https:\/\/[^\s/]/i.test(appUrl.trim())) ruins.push('APP_URL');
  if (ruins.length > 0) return { ok: false, variaveis: ruins.sort() };
  return {
    ok: true,
    config: {
      accessToken: fonte.MP_ACCESS_TOKEN!.trim(),
      webhookSecret: fonte.MP_WEBHOOK_SECRET!.trim(),
      planoId: fonte.MP_PREAPPROVAL_PLAN_ID!.trim(),
    },
  };
}
