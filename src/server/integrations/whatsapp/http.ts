import { ErroEnvioTemporario } from './port';

// Cliente HTTP mínimo do adaptador real (D-047). `fetch` nativo, injetável. NUNCA retenta: a
// Cloud API não tem chave de idempotência em /messages. Nenhuma mensagem, `cause` ou log leva
// token, URL, cabeçalho ou corpo.

export const URL_BASE_PADRAO = 'https://graph.facebook.com';
/** Menor que o encerramento do worker (25 s). */
export const TIMEOUT_PADRAO_MS = 10_000;
const TETO_RESPOSTA_BYTES = 64 * 1024;

export type OpcoesHttp = {
  token: string;
  urlBase?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export type RespostaHttp = { status: number; texto: string };

function foiTempoLimite(e: unknown): boolean {
  return e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
}

export function criarClienteHttp(opcoes: OpcoesHttp) {
  const base = (opcoes.urlBase ?? URL_BASE_PADRAO).replace(/\/+$/, '');
  const fetchImpl = opcoes.fetchImpl ?? fetch;
  const limite = opcoes.timeoutMs ?? TIMEOUT_PADRAO_MS;
  const { token } = opcoes;

  return {
    /** Uma única requisição POST JSON. Falha de rede/timeout ⇒ ErroEnvioTemporario fixo, sem `cause`. */
    async postar(caminho: string, corpo: unknown): Promise<RespostaHttp> {
      try {
        const resposta = await fetchImpl(`${base}${caminho}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(corpo),
          signal: AbortSignal.timeout(limite),
          redirect: 'manual',
        });
        const texto = (await resposta.text()).slice(0, TETO_RESPOSTA_BYTES);
        return { status: resposta.status, texto };
      } catch (e) {
        throw new ErroEnvioTemporario(foiTempoLimite(e) ? 'timeout' : 'rede');
      }
    },
  };
}
