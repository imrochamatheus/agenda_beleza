// Exigências de ambiente do WhatsApp real. Sem imports: este módulo entra no bundle do check-env.
// E0.6 (D-1): o adaptador real ainda não existe, então WHATSAPP_ADAPTER=real é recusado na
// inicialização, nomeando o seletor. A E7.2 troca a recusa pelas exigências próprias (WHATSAPP_*),
// editando só este arquivo.

export const SELETOR = 'WHATSAPP_ADAPTER';

/** Variáveis do provedor, declaradas no .env.example (nenhuma até a E7.2). */
export const CHAVES = [] as const;

/** Configuração do adaptador real; vazia até a E7.2. */
export type ConfigWhatsAppReal = Readonly<Record<string, never>>;
export type ConfigReal = ConfigWhatsAppReal;

// Não lê a fonte (o contrato comum aceita omitir o parâmetro); a E7.2 passa a lê-la.
export function lerConfigReal():
  | { ok: true; config: ConfigWhatsAppReal }
  | { ok: false; variaveis: string[] } {
  return { ok: false, variaveis: [SELETOR] };
}
