// Exigências de ambiente do WhatsApp real (D-047). Sem imports: este módulo entra no bundle do check-env.

export const SELETOR = 'WHATSAPP_ADAPTER';

/** Variáveis do provedor, declaradas no .env.example (só exigidas no modo real). */
export const CHAVES = [
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_API_VERSION',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_TEMPLATE_CANCELAMENTO',
  'WHATSAPP_TEMPLATE_CONFIRMACAO',
  'WHATSAPP_TEMPLATE_CONVITE_AVALIACAO',
  'WHATSAPP_TEMPLATE_IDIOMA',
  'WHATSAPP_TEMPLATE_REMARCACAO',
] as const;

/** Versão padrão da Graph API (única constante; sobrescrita por WHATSAPP_API_VERSION). NÃO validada na Meta. */
export const VERSAO_API_PADRAO = 'v25.0';
export const IDIOMA_PADRAO = 'pt_BR';

/** Idêntico a `ModeloWhatsApp` da porta (um teste compara); local para não importar a porta. */
export type ModeloConfigurado = 'confirmacao' | 'remarcacao' | 'cancelamento' | 'convite_avaliacao';

/** Configuração do adaptador real, só em memória. */
export type ConfigWhatsAppReal = {
  accessToken: string;
  phoneNumberId: string;
  versaoApi: string;
  idioma: string;
  modelos: Record<ModeloConfigurado, string>;
};
export type ConfigReal = ConfigWhatsAppReal;

const VARIAVEL_DO_MODELO: Record<ModeloConfigurado, string> = {
  confirmacao: 'WHATSAPP_TEMPLATE_CONFIRMACAO',
  remarcacao: 'WHATSAPP_TEMPLATE_REMARCACAO',
  cancelamento: 'WHATSAPP_TEMPLATE_CANCELAMENTO',
  convite_avaliacao: 'WHATSAPP_TEMPLATE_CONVITE_AVALIACAO',
};

const MODELOS = Object.keys(VARIAVEL_DO_MODELO) as ModeloConfigurado[];

function valor(fonte: Record<string, string | undefined>, chave: string): string | undefined {
  const v = fonte[chave]?.trim();
  return v === undefined || v === '' ? undefined : v;
}

/**
 * `fonte` já vem com string vazia convertida em ausente. Obrigatórias: token, phone number id e os
 * 4 nomes de modelo; versão e idioma têm padrão, mas se informados precisam ser válidos. Nunca
 * devolve valores, só nomes ordenados.
 */
export function lerConfigReal(
  fonte: Record<string, string | undefined>,
): { ok: true; config: ConfigWhatsAppReal } | { ok: false; variaveis: string[] } {
  const ruins: string[] = [];

  const accessToken = valor(fonte, 'WHATSAPP_ACCESS_TOKEN');
  if (accessToken === undefined) ruins.push('WHATSAPP_ACCESS_TOKEN');

  const phoneNumberId = valor(fonte, 'WHATSAPP_PHONE_NUMBER_ID');
  if (phoneNumberId === undefined || !/^\d{1,32}$/.test(phoneNumberId)) ruins.push('WHATSAPP_PHONE_NUMBER_ID');

  const versaoApi = valor(fonte, 'WHATSAPP_API_VERSION') ?? VERSAO_API_PADRAO;
  if (!/^v\d+\.\d+$/.test(versaoApi)) ruins.push('WHATSAPP_API_VERSION');

  const idioma = valor(fonte, 'WHATSAPP_TEMPLATE_IDIOMA') ?? IDIOMA_PADRAO;
  if (!/^[a-z]{2,3}(_[A-Z]{2})?$/.test(idioma)) ruins.push('WHATSAPP_TEMPLATE_IDIOMA');

  const modelos = {} as Record<ModeloConfigurado, string>;
  for (const m of MODELOS) {
    const nome = valor(fonte, VARIAVEL_DO_MODELO[m]);
    if (nome === undefined || !/^[a-z0-9_]{1,512}$/.test(nome)) ruins.push(VARIAVEL_DO_MODELO[m]);
    else modelos[m] = nome;
  }

  if (ruins.length > 0) return { ok: false, variaveis: ruins.sort() };
  return {
    ok: true,
    config: { accessToken: accessToken!, phoneNumberId: phoneNumberId!, versaoApi, idioma, modelos },
  };
}
