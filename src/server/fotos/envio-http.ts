import { ROTAS } from '@/config/navegacao';
import type { ResultadoAcao } from '@/server/tenant/define-acao';

import { lerCorpoEnvio } from './multipart';
import type { CodigoEnvio, EntradaEnvio, ResultadoEnvio } from './tipos';

// Tradução HTTP do envio (D-021 §3.4; A-3, A-4). Sem next/*: só Request/Response. Ordem: método e
// Origin (403, sem ler o corpo) → ação (sessão, papel e capacidade ANTES de ler o corpo, pela entrada
// adiada) → 303 para a página com o código fechado do resultado.

export type DepsEnvioHttp = {
  /** Em produção, `enviarFoto`; nos testes, `(i) => enviarFoto.executar(credencial, i, deps)`. */
  executar: (entrada: EntradaEnvio) => Promise<ResultadoAcao<ResultadoEnvio>>;
  appUrl: string;
  /** Destino do 303 e do 401 (a vitrine usa outro). */
  destino?: string;
};

function redirecionar(local: string): Response {
  return new Response(null, { status: 303, headers: { location: local, 'cache-control': 'no-store' } });
}

const comCodigo = (destino: string, codigo: CodigoEnvio) => `${destino}?envio=${codigo}`;

export async function tratarEnvio(request: Request, deps: DepsEnvioHttp): Promise<Response> {
  const destino = deps.destino ?? ROTAS.configuracoesFotos;
  if (request.method !== 'POST') {
    return new Response(null, { status: 405, headers: { allow: 'POST' } });
  }
  const origem = request.headers.get('origin');
  if (origem === null || origem !== new URL(deps.appUrl).origin) {
    return new Response('Origem não permitida. Acesse pelo endereço configurado em APP_URL.', {
      status: 403,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
  let r: ResultadoAcao<ResultadoEnvio>;
  try {
    r = await deps.executar({ obterCorpo: () => lerCorpoEnvio(request) });
  } catch (e) {
    console.error(JSON.stringify({ evento: 'foto.envio_falhou', erro: e instanceof Error ? e.name : 'erro' }));
    return redirecionar(comCodigo(destino, 'falha'));
  }
  if (!r.ok) {
    if (r.status === 401) {
      return redirecionar(`${ROTAS.entrar}?proximo=${encodeURIComponent(destino)}`);
    }
    return redirecionar(comCodigo(destino, r.status === 403 ? 'negado' : 'falha'));
  }
  return redirecionar(comCodigo(destino, r.dados.resultado === 'ok' ? 'ok' : r.dados.codigo));
}
