import { ErroProvedor, OperacaoInvalidaNoProvedor, RecursoNaoEncontradoNoProvedor } from './port';

// Cliente HTTP mínimo do adaptador real (D-046, RN-3, RN-8, RN-14, RN-15). `fetch` nativo,
// injetável nos testes. Nenhuma mensagem, `cause` ou log leva token, URL, cabeçalho ou corpo.

export const URL_BASE_PADRAO = 'https://api.mercadopago.com';
export const TEMPO_LIMITE_MS = 10_000;

/** GET: 2 repetições (200 e 400 ms). POST de criação: 1 repetição, só em 429 ou falha de conexão. PUT: nenhuma. */
const ESPERAS_GET_MS = [200, 400] as const;
const ESPERAS_POST_MS = [200] as const;

export type Metodo = 'GET' | 'POST' | 'PUT';

export type OpcoesHttp = {
  token: string;
  urlBase?: string;
  fetchImpl?: typeof fetch;
  esperar?: (ms: number) => Promise<void>;
  timeoutMs?: number;
};

export type Requisicao = {
  metodo: Metodo;
  caminho: string;
  corpo?: unknown;
  /** `X-Idempotency-Key` (só no POST de criação; a MESMA chave em todas as tentativas). */
  idempotencia?: string;
};

export type ClienteHttp = { requisitar(r: Requisicao): Promise<unknown> };

const ID_VALIDO = /^[A-Za-z0-9_-]{1,64}$/;

/** RN-14: valida o id antes do HTTP e o devolve codificado para o caminho. */
export function idParaCaminho(id: string): string {
  if (typeof id !== 'string' || !ID_VALIDO.test(id)) throw new RecursoNaoEncontradoNoProvedor();
  return encodeURIComponent(id);
}

function traduzirStatus(status: number): Error {
  if (status === 404) return new RecursoNaoEncontradoNoProvedor();
  if (status === 400 || status === 409 || status === 422) return new OperacaoInvalidaNoProvedor();
  return new ErroProvedor();
}

const esperarPadrao = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms));

function foiTempoLimite(e: unknown): boolean {
  return e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
}

export function criarClienteHttp(opcoes: OpcoesHttp): ClienteHttp {
  const base = (opcoes.urlBase ?? URL_BASE_PADRAO).replace(/\/+$/, '');
  const fetchImpl = opcoes.fetchImpl ?? fetch;
  const esperar = opcoes.esperar ?? esperarPadrao;
  const limite = opcoes.timeoutMs ?? TEMPO_LIMITE_MS;
  const { token } = opcoes;

  async function uma(r: Requisicao): Promise<{ status: number; texto: string }> {
    const cabecalhos: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
    if (r.corpo !== undefined) cabecalhos['Content-Type'] = 'application/json';
    if (r.idempotencia !== undefined) cabecalhos['X-Idempotency-Key'] = r.idempotencia;
    const resposta = await fetchImpl(`${base}${r.caminho}`, {
      method: r.metodo,
      headers: cabecalhos,
      body: r.corpo === undefined ? undefined : JSON.stringify(r.corpo),
      signal: AbortSignal.timeout(limite),
      redirect: 'error',
    });
    return { status: resposta.status, texto: await resposta.text() };
  }

  return {
    async requisitar(r) {
      const esperas = r.metodo === 'GET' ? ESPERAS_GET_MS : r.metodo === 'POST' ? ESPERAS_POST_MS : [];
      for (let i = 0; ; i++) {
        const podeRepetir = i < esperas.length;
        let resposta: { status: number; texto: string };
        try {
          resposta = await uma(r);
        } catch (e) {
          // POST não repete em timeout: o servidor pode ter criado o recurso (idempotência não confirmada).
          if (podeRepetir && !(r.metodo === 'POST' && foiTempoLimite(e))) {
            await esperar(esperas[i]);
            continue;
          }
          throw new ErroProvedor();
        }
        const { status, texto } = resposta;
        if (status >= 200 && status < 300) {
          try {
            return JSON.parse(texto) as unknown;
          } catch {
            throw new ErroProvedor();
          }
        }
        const transitorio = status === 429 || (status >= 500 && r.metodo === 'GET');
        if (transitorio && podeRepetir) {
          await esperar(esperas[i]);
          continue;
        }
        throw traduzirStatus(status);
      }
    },
  };
}
