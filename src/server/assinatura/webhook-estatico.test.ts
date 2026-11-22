import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { config } from '@/proxy';

// D-041 CA-12/CA-13 (estático): a rota não toca repositórios nem Prisma; o segredo e a validação
// do webhook só existem atrás de `integracoes().mercadoPago`; só repositórios importam o Prisma.

const RAIZ = path.resolve(__dirname, '../..');
const ler = (p: string) => readFileSync(path.join(RAIZ, p), 'utf8');

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? arquivos(p) : /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}

describe('fronteiras do webhook (D-041)', () => {
  it('CA-12: a rota não importa repos nem Prisma', () => {
    const rota = ler('app/api/webhooks/mercadopago/route.ts');
    const imports = rota.split('\n').filter((l) => /^\s*import\b/.test(l)).join('\n');
    expect(imports).not.toMatch(/repos|prisma|generated/i);
    expect(rota).toMatch(/tratarWebhook/);
  });

  it('CA-13: a rota está fora do matcher do proxy', () => {
    for (const m of config.matcher) {
      expect(m.startsWith('/painel') || m.startsWith('/admin')).toBe(true);
    }
  });

  it('CA-13: segredo e validação do simulado só são importados dentro de integrations', () => {
    const intrusos = arquivos(RAIZ)
      .filter((f) => !f.includes(`${path.sep}integrations${path.sep}`))
      .filter((f) => /SEGREDO_WEBHOOK_SIMULADO|validarNotificacaoSimulada|MP_WEBHOOK/.test(readFileSync(f, 'utf8')));
    expect(intrusos).toEqual([]);
  });

  it('só repositórios importam o Prisma no módulo de assinatura e na rota', () => {
    const alvos = [...arquivos(path.join(RAIZ, 'server/assinatura')), ...arquivos(path.join(RAIZ, 'app/api/webhooks'))];
    const intrusos = alvos.filter((f) => /generated\/prisma|@prisma\/|repos\/db['"]/.test(readFileSync(f, 'utf8')));
    expect(intrusos).toEqual([]);
  });
});
