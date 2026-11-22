import type { ConfigWhatsAppReal } from './ambiente';
import { ErroEnvioPermanente } from './port';
import type { EnvioModelo, ModeloWhatsApp } from './port';

// D-047: ÚNICO lugar com nomes de campos, códigos e enumerações da WhatsApp Cloud API. Puro: sem
// rede, sem ambiente, sem relógio. O que a documentação oficial não confirma está marcado NÃO
// CONFIRMADO (README, "Pendente de validação na Meta") e é trocável aqui sem tocar o resto.

/** Ordem fixa dos parâmetros posicionais de cada modelo (RN-7). */
export const ORDEM_PARAMETROS: Readonly<Record<ModeloWhatsApp, readonly string[]>> = {
  confirmacao: ['salao', 'servicos', 'profissional', 'data', 'horario'],
  remarcacao: ['salao', 'servicos', 'profissional', 'data', 'horario'],
  cancelamento: ['salao', 'servicos', 'data', 'horario'],
  convite_avaliacao: ['salao', 'link'],
};

/** NÃO CONFIRMADO oficialmente (nenhuma fonte): teto defensivo por parâmetro, em code points. */
export const LIMITE_PARAMETRO = 1024;
/** NÃO CONFIRMADO oficialmente: parâmetro vazio é enviado como "-". */
export const PARAMETRO_VAZIO = '-';

/** Só os dígitos do E.164 (`+5511987654321` → `5511987654321`). */
export function somenteDigitos(e164: string): string {
  return e164.replace(/\D/g, '');
}

/**
 * NÃO CONFIRMADO oficialmente (terceiros): parâmetro sem `\n`, `\t` e sem mais de 4 espaços
 * seguidos. Troca esses por um espaço, colapsa, apara; vazio vira "-"; trunca com "…" sem partir
 * um par substituto.
 */
export function normalizarParametro(texto: string): string {
  const limpo = texto.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();
  if (limpo === '') return PARAMETRO_VAZIO;
  const pontos = Array.from(limpo);
  if (pontos.length <= LIMITE_PARAMETRO) return limpo;
  return pontos.slice(0, LIMITE_PARAMETRO - 1).join('') + '…';
}

export function caminhoDeEnvio(config: ConfigWhatsAppReal): string {
  return `/${config.versaoApi}/${config.phoneNumberId}/messages`;
}

export type CorpoEnvio = {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: 'template';
  template: {
    name: string;
    language: { code: string };
    components: { type: 'body'; parameters: { type: 'text'; text: string }[] }[];
  };
};

/** Entrada já validada por `validarEnvioModelo`. Parâmetro ausente ⇒ permanente `parametro_ausente`. */
export function montarCorpo(config: ConfigWhatsAppReal, e: EnvioModelo): CorpoEnvio {
  const parameters = ORDEM_PARAMETROS[e.modelo].map((nome) => {
    const v = Object.hasOwn(e.parametros, nome) ? e.parametros[nome] : undefined;
    if (typeof v !== 'string') throw new ErroEnvioPermanente('parametro_ausente');
    return { type: 'text' as const, text: normalizarParametro(v) };
  });
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: somenteDigitos(e.destinatarioE164),
    type: 'template',
    template: {
      name: config.modelos[e.modelo],
      language: { code: config.idioma },
      components: [{ type: 'body', parameters }],
    },
  };
}

export type Classificacao =
  | { tipo: 'sucesso'; id: string }
  | { tipo: 'temporario'; codigo: string }
  | { tipo: 'permanente'; codigo: string };

const FAIXAS_CONFIGURACAO: readonly [number, number][] = [[200, 299]];

/** `error.code` → [tipo, codigo]. Significados confirmados na página oficial de erros; o HTTP de cada um NÃO. */
const CODIGOS_META: ReadonlyMap<number, readonly ['temporario' | 'permanente', string]> = new Map<
  number,
  readonly ['temporario' | 'permanente', string]
>([
  ...[4, 80007, 130429, 131048, 131056].map((c) => [c, ['temporario', 'limite_de_taxa']] as const),
  ...[1, 2, 131000, 131016, 131057, 133004].map((c) => [c, ['temporario', 'provedor_indisponivel']] as const),
  ...[0, 10, 190, 131005, 368, 131031, 131037, 131042, 131045].map(
    (c) => [c, ['temporario', 'configuracao_invalida']] as const,
  ),
  [131026, ['permanente', 'numero_invalido']],
  // 131030 NÃO consta da página oficial (fonte secundária): mantido como recusa do destinatário.
  [131030, ['permanente', 'destinatario_recusado']],
  [131021, ['permanente', 'destinatario_recusado']],
  [131049, ['permanente', 'nao_entregue']],
  [130472, ['permanente', 'nao_entregue']],
  ...[132001, 132015, 132016, 132007].map((c) => [c, ['permanente', 'modelo_invalido']] as const),
  ...[132000, 132005, 132012, 131008, 131009].map((c) => [c, ['permanente', 'parametros_invalidos']] as const),
  ...[100, 131047, 131051, 135000].map((c) => [c, ['permanente', 'requisicao_invalida']] as const),
]);

/** Lista fechada de `codigo` produzidos aqui (documentada no README e em docs/whatsapp-templates.md). */
export const CODIGOS_ERRO_WHATSAPP = [
  'limite_de_taxa',
  'provedor_indisponivel',
  'configuracao_invalida',
  'numero_invalido',
  'destinatario_recusado',
  'nao_entregue',
  'modelo_invalido',
  'parametros_invalidos',
  'requisicao_invalida',
  'resposta_inesperada',
  'resposta_invalida',
  'parametro_ausente',
  'rede',
  'timeout',
] as const;

/** Só o inteiro `error.code` é lido do corpo; nada mais dele é propagado. */
function lerCodigoDeErro(texto: string): number | null {
  try {
    const json: unknown = JSON.parse(texto);
    if (typeof json !== 'object' || json === null) return null;
    const erro = (json as { error?: unknown }).error;
    if (typeof erro !== 'object' || erro === null) return null;
    const codigo = (erro as { code?: unknown }).code;
    return typeof codigo === 'number' && Number.isInteger(codigo) ? codigo : null;
  } catch {
    return null;
  }
}

function lerIdDaMensagem(texto: string): string | null {
  try {
    const json: unknown = JSON.parse(texto);
    if (typeof json !== 'object' || json === null) return null;
    const mensagens = (json as { messages?: unknown }).messages;
    if (!Array.isArray(mensagens)) return null;
    const id = (mensagens[0] as { id?: unknown } | undefined)?.id;
    return typeof id === 'string' && id !== '' ? id : null;
  } catch {
    return null;
  }
}

/** Ordem do design §3.1: 5xx e 429 vencem; depois `error.code`; HTTP só como reserva. */
export function classificarResposta(r: { status: number; texto: string }): Classificacao {
  const { status, texto } = r;
  if (status >= 200 && status < 300) {
    const id = lerIdDaMensagem(texto);
    return id === null ? { tipo: 'temporario', codigo: 'resposta_invalida' } : { tipo: 'sucesso', id };
  }
  if (status >= 500) return { tipo: 'temporario', codigo: 'provedor_indisponivel' };
  if (status === 429) return { tipo: 'temporario', codigo: 'limite_de_taxa' };

  const codigo = lerCodigoDeErro(texto);
  if (codigo !== null) {
    const conhecido = CODIGOS_META.get(codigo);
    if (conhecido) return { tipo: conhecido[0], codigo: conhecido[1] };
    if (FAIXAS_CONFIGURACAO.some(([a, b]) => codigo >= a && codigo <= b)) {
      return { tipo: 'temporario', codigo: 'configuracao_invalida' };
    }
  }
  if (status === 401 || status === 403) return { tipo: 'temporario', codigo: 'configuracao_invalida' };
  if (status >= 400) return { tipo: 'permanente', codigo: 'requisicao_invalida' };
  return { tipo: 'temporario', codigo: 'resposta_inesperada' };
}
