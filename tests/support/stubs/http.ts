import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';

// Stub HTTP local para os adaptadores reais (RN-6; D-007 §8). Escuta em 127.0.0.1 numa porta
// efêmera, registra cada requisição recebida e responde conforme o modo:
// - `aceitar`: 200 com o JSON de `resposta` (padrão `{ "success": true }`);
// - `status500`: 500 com corpo JSON;
// - `naoJson`: 200 com corpo HTML;
// - `silencioso`: lê a requisição e nunca responde (o cliente cai no tempo-limite).
// Não é mock de banco: só substitui o provedor externo.

export type ModoHttp = 'aceitar' | 'status500' | 'naoJson' | 'silencioso';

export type RequisicaoRecebida = {
  metodo: string;
  caminho: string;
  cabecalhos: IncomingHttpHeaders;
  corpo: string;
};

export type StubHttp = {
  /** Origem do stub, sem barra final (ex.: `http://127.0.0.1:41234`). */
  readonly url: string;
  readonly requisicoes: RequisicaoRecebida[];
  definirModo(modo: ModoHttp): void;
  /** Corpo JSON devolvido no modo `aceitar`. */
  definirResposta(resposta: unknown): void;
  /** Encerra o servidor e derruba as conexões pendentes (inclusive as do modo `silencioso`). */
  fechar(): Promise<void>;
};

export async function iniciarStubHttp(
  opcoes: { modo?: ModoHttp; resposta?: unknown } = {},
): Promise<StubHttp> {
  let modo: ModoHttp = opcoes.modo ?? 'aceitar';
  let resposta: unknown = opcoes.resposta ?? { success: true };
  const requisicoes: RequisicaoRecebida[] = [];

  const servidor = createServer((req, res) => {
    const partes: Buffer[] = [];
    req.on('data', (parte: Buffer) => partes.push(parte));
    req.on('end', () => {
      requisicoes.push({
        metodo: req.method ?? '',
        caminho: req.url ?? '',
        cabecalhos: req.headers,
        corpo: Buffer.concat(partes).toString('utf8'),
      });
      switch (modo) {
        case 'aceitar':
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(resposta));
          return;
        case 'status500':
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: false, 'error-codes': ['internal-error'] }));
          return;
        case 'naoJson':
          res.writeHead(200, { 'content-type': 'text/html' });
          res.end('<html><body>Erro do proxy</body></html>');
          return;
        case 'silencioso':
          return;
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    servidor.once('error', reject);
    servidor.listen(0, '127.0.0.1', () => resolve());
  });
  const { port } = servidor.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requisicoes,
    definirModo(novo) {
      modo = novo;
    },
    definirResposta(nova) {
      resposta = nova;
    },
    fechar() {
      return new Promise<void>((resolve, reject) => {
        servidor.close((erro) => (erro ? reject(erro) : resolve()));
        servidor.closeAllConnections();
      });
    },
  };
}

/** Porta de 127.0.0.1 que estava livre e foi fechada: conectar nela dá ECONNREFUSED. */
export async function portaFechada(): Promise<number> {
  const servidor = createServer();
  await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', () => resolve()));
  const { port } = servidor.address() as AddressInfo;
  await new Promise<void>((resolve) => servidor.close(() => resolve()));
  return port;
}
