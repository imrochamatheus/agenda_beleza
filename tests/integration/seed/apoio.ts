import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { vi } from 'vitest';

import { integracoes, redefinirIntegracoes } from '@/server/integrations/registry';

// Apoio dos testes do seed (D-036): armazenamento simulado num diretório temporário por arquivo.
export function prepararArmazenamento(): { dir: string; encerrar: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'seed-teste-'));
  vi.stubEnv('ARMAZENAMENTO_DIR', dir);
  vi.stubEnv('STORAGE_ADAPTER', 'simulado');
  vi.stubEnv('APP_URL', 'http://localhost:3000');
  redefinirIntegracoes();
  integracoes();
  return {
    dir,
    encerrar: () => {
      rmSync(dir, { recursive: true, force: true });
      vi.unstubAllEnvs();
      redefinirIntegracoes();
    },
  };
}

/** Tabelas semeadas, na ordem de contagem. */
export const TABELAS_SEMEADAS = [
  'salao', 'salao_slug', 'usuario', 'profissional', 'servico', 'servico_profissional', 'jornada',
  'salao_funcionamento', 'bloqueio', 'cliente', 'consentimento', 'reserva', 'reserva_item', 'salao_foto',
  'avaliacao', 'assinatura',
] as const;
