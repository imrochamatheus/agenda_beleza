import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { vi } from 'vitest';

import { enviarFoto } from '@/server/fotos/fotos.acao';
import { tratarEnvio } from '@/server/fotos/envio-http';
import { integracoes, redefinirIntegracoes } from '@/server/integrations/registry';
import type { Credencial } from '@/server/tenant/sessao';

import { TOKEN_UUID } from '../../support/imagens';

export { TOKEN_UUID };

// Apoio dos testes do serviço das fotos (D-021 T-7). Armazenamento simulado num diretório temporário
// por arquivo de teste; envio pelo `tratarEnvio` com a ação real (sessão real, banco real).

export const APP_URL = 'http://localhost:3000';

export type Armazenamento = {
  dir: string;
  /** Nomes dos objetos gravados (sem temporários). */
  objetos(): string[];
  limpar(): void;
};

/** Aponta ARMAZENAMENTO_DIR para um diretório novo e reconstrói o registro de integrações. */
export function prepararArmazenamento(): Armazenamento {
  const dir = mkdtempSync(join(tmpdir(), 'fotos-teste-'));
  vi.stubEnv('ARMAZENAMENTO_DIR', dir);
  vi.stubEnv('APP_URL', APP_URL);
  redefinirIntegracoes();
  // força a construção já com o diretório (e valida o ambiente)
  integracoes();
  return {
    dir,
    objetos() {
      try {
        return readdirSync(join(dir, 'fotos')).filter((n) => !n.includes('.tmp-'));
      } catch {
        return [];
      }
    },
    limpar() {
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
    },
  };
}

export function encerrarArmazenamento(a: Armazenamento): void {
  rmSync(a.dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  redefinirIntegracoes();
}

export type CamposEnvio = {
  arquivo?: Uint8Array | null;
  alt?: string | null;
  envio?: string | null;
  nome?: string;
  tipo?: string;
  /** Campos extras do formulário (ex.: salaoId forjado). */
  extras?: Record<string, string>;
};

/** Requisição multipart do envio. `origem`: undefined = APP_URL; null = sem cabeçalho. */
export async function requisicaoDeEnvio(c: CamposEnvio, origem: string | null | undefined = undefined, extra: Record<string, string> = {}): Promise<Request> {
  const f = new FormData();
  if (c.arquivo !== null && c.arquivo !== undefined) {
    f.append('foto', new Blob([c.arquivo as BlobPart], { type: c.tipo ?? 'image/jpeg' }), c.nome ?? 'foto.jpg');
  }
  if (c.alt !== null) f.append('alt', c.alt ?? 'Fachada do salão');
  if (c.envio !== null) f.append('envio', c.envio ?? TOKEN_UUID);
  for (const [k, v] of Object.entries(c.extras ?? {})) f.append(k, v);
  const base = new Request(`${APP_URL}/api/painel/fotos`, { method: 'POST', body: f });
  const corpo = new Uint8Array(await base.arrayBuffer());
  const headers: Record<string, string> = { 'content-type': base.headers.get('content-type')!, ...extra };
  const o = origem === undefined ? APP_URL : origem;
  if (o !== null) headers.origin = o;
  return new Request(`${APP_URL}/api/painel/fotos`, { method: 'POST', body: corpo as BodyInit, headers });
}

/** Envio completo: multipart → tratarEnvio → enviarFoto.executar com a credencial dada. */
export async function enviarPorHttp(cred: Credencial, c: CamposEnvio, origem: string | null | undefined = undefined): Promise<Response> {
  const req = await requisicaoDeEnvio(c, origem);
  return tratarEnvio(req, { executar: (i) => enviarFoto.executar(cred, i), appUrl: APP_URL });
}

/** Código do `?envio=` do 303 (ou o destino inteiro se não for `?envio=`). */
export function codigoDoRedirect(r: Response): string {
  const loc = r.headers.get('location') ?? '';
  return new URL(loc, APP_URL).searchParams.get('envio') ?? loc;
}

/** Captura de logs (info, warn, error) como texto único. */
export function capturarLogs() {
  const espioes = [vi.spyOn(console, 'info'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error'), vi.spyOn(console, 'log')];
  return () => espioes.flatMap((e) => e.mock.calls.map((c) => c.map(String).join(' '))).join('\n');
}
