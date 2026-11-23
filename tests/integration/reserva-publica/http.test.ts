import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { urlDoWorker } from '../../support/db';
import { criarCenarioReserva } from '../../support/reservas';

// D-026 T-3 (R-1, CA-3): o 308 do slug histórico precisa ser um STATUS HTTP real, não um meta-refresh
// dentro de uma resposta 200 em streaming. Prova com o servidor de produção (`next start`), apontado para a
// base deste worker, e `fetch` com `redirect: 'manual'`. Constrói o app se ainda não houver `.next`.

const RAIZ = resolve(import.meta.dirname, '../../..');
const NEXT = resolve(RAIZ, 'node_modules/next/dist/bin/next');
let filho: ChildProcess | undefined;
let base = '';
let log = '';

async function portaLivre(): Promise<number> {
  return new Promise((ok, falha) => {
    const s = createServer();
    s.once('error', falha);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => ok(port));
    });
  });
}

beforeAll(async () => {
  const env = { ...process.env, NODE_ENV: 'production' } as NodeJS.ProcessEnv;
  if (!existsSync(resolve(RAIZ, '.next/BUILD_ID'))) {
    execFileSync(process.execPath, [NEXT, 'build'], { cwd: RAIZ, env, stdio: 'ignore' });
  }
  const porta = await portaLivre();
  base = `http://127.0.0.1:${porta}`;
  filho = spawn(process.execPath, [NEXT, 'start', '-p', String(porta), '-H', '127.0.0.1'], {
    cwd: RAIZ,
    env: { ...env, DATABASE_URL: urlDoWorker() },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  filho.stdout?.on('data', (d: Buffer) => (log += d.toString()));
  filho.stderr?.on('data', (d: Buffer) => (log += d.toString()));
  const limite = Date.now() + 60_000;
  for (;;) {
    try {
      if ((await fetch(`${base}/termos`)).status === 200) break;
    } catch {
      // ainda subindo
    }
    if (Date.now() > limite) throw new Error(`next start não respondeu:\n${log}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}, 600_000);

afterAll(() => {
  if (filho && filho.exitCode === null) filho.kill('SIGKILL');
});

const pegar = (caminho: string) => fetch(`${base}${caminho}`, { redirect: 'manual' });

describe('CA-3: respostas HTTP reais', () => {
  it('slug histórico: 308 com Location do slug atual e a query preservada', async () => {
    const c = await criarCenarioReserva();
    const r = await pegar(`/${c.s.slugHistorico}?s=${c.A}&data=2026-12-01`);
    expect(r.status).toBe(308);
    expect(r.headers.get('location')).toBe(`/${c.s.slugAtual}?s=${c.A}&data=2026-12-01`);
    const semQuery = await pegar(`/${c.s.slugHistorico}`);
    expect(semQuery.status).toBe(308);
    expect(semQuery.headers.get('location')).toBe(`/${c.s.slugAtual}`);
  });

  it('slug atual: 200 com o nome do salão; inexistente e reservados: 404', async () => {
    const c = await criarCenarioReserva();
    const r = await pegar(`/${c.s.slugAtual}`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain(c.s.nome);
    for (const caminho of ['/nao-existe-xyz', '/Maiuscula', '/painel-que-nao-existe', '/favicon.ico']) {
      expect((await pegar(caminho)).status, caminho).toBe(404);
    }
  });

  it('rotas estáticas têm precedência: /termos e /privacidade seguem 200', async () => {
    expect((await pegar('/termos')).status).toBe(200);
    expect((await pegar('/privacidade')).status).toBe(200);
  });
});
