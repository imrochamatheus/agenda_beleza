// Exigências de ambiente do Mercado Pago real. Sem imports: este módulo entra no bundle do check-env.
// E0.6 (D-1): o adaptador real ainda não existe, então MP_ADAPTER=real é recusado na inicialização,
// nomeando o seletor. A E6.6 troca a recusa pelas exigências próprias (MP_ACCESS_TOKEN,
// MP_WEBHOOK_SECRET, MP_PREAPPROVAL_PLAN_ID...), editando só este arquivo.

export const SELETOR = 'MP_ADAPTER';

/** Variáveis do provedor, declaradas no .env.example (nenhuma até a E6.6). */
export const CHAVES = [] as const;

/** Configuração do adaptador real; vazia até a E6.6. */
export type ConfigMercadoPagoReal = Readonly<Record<string, never>>;
export type ConfigReal = ConfigMercadoPagoReal;

// Não lê a fonte (o contrato comum aceita omitir o parâmetro); a E6.6 passa a lê-la.
export function lerConfigReal():
  | { ok: true; config: ConfigMercadoPagoReal }
  | { ok: false; variaveis: string[] } {
  return { ok: false, variaveis: [SELETOR] };
}
