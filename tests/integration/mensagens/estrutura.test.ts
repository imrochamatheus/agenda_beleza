import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// D-024 T-7: CA-26 (estrutura). Usa a configuração real do ESLint e varre o código.

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const eslint = new ESLint({ cwd: RAIZ });
const TIMEOUT_MS = 120_000;

function arquivos(pasta: string, ext = /\.(ts|tsx)$/): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(path.join(RAIZ, pasta))) {
    const rel = path.join(pasta, nome);
    if (statSync(path.join(RAIZ, rel)).isDirectory()) saida.push(...arquivos(rel, ext));
    else if (ext.test(nome)) saida.push(rel);
  }
  return saida;
}
const producao = (lista: string[]) => lista.filter((f) => !/\.test\.tsx?$/.test(f));
const ler = (rel: string) => readFileSync(path.join(RAIZ, rel), 'utf8');

async function importa(arquivo: string, codigo: string): Promise<string[]> {
  const [r] = await eslint.lintText(`${codigo}\n`, { filePath: path.join(RAIZ, arquivo), warnIgnored: true });
  return r.messages.filter((m) => m.ruleId === 'no-restricted-imports').map((m) => m.message);
}

describe('CA-26: src/server/mensagens não importa banco, SDKs, adaptadores nem pg-boss', () => {
  const ARQ = 'src/server/mensagens/x.ts';
  it.each([
    "import { PrismaClient } from '@/generated/prisma/client';",
    "import { obterPrisma } from '@/server/repos/db';",
    "import PgBoss from 'pg-boss';",
    "import { criarWhatsAppReal } from '@/server/integrations/whatsapp/real';",
    "import { criarWhatsAppSimulado } from '@/server/integrations/whatsapp/simulado';",
    "import nodemailer from 'nodemailer';",
  ])('barra: %s', async (codigo) => {
    expect((await importa(ARQ, codigo)).length).toBeGreaterThanOrEqual(1);
  }, TIMEOUT_MS);

  it.each([
    "import { repos } from '@/server/repos';",
    "import type { PortaWhatsApp } from '@/server/integrations/whatsapp/port';",
    "import { enfileirar } from '@/server/queue/client';",
    "import { integracoes } from '@/server/integrations/registry';",
  ])('permite: %s', async (codigo) => {
    expect(await importa(ARQ, codigo)).toEqual([]);
  }, TIMEOUT_MS);

  it('o código real de mensagens, dos handlers e dos repositórios de mensagem passa no lint sem avisos', async () => {
    const alvo = [
      ...producao(arquivos('src/server/mensagens')),
      'src/worker/handlers/whatsapp-reserva.ts',
      'src/worker/handlers/reconciliar-mensagens.ts',
      'src/server/repos/mensagem.ts',
      'src/server/repos/mensagem-sistema.ts',
    ];
    const rs = await eslint.lintFiles(alvo);
    const problemas = rs.flatMap((r) => r.messages.map((m) => `${r.filePath}: ${m.ruleId} ${m.message}`));
    expect(problemas).toEqual([]);
  }, TIMEOUT_MS);
});

describe('CA-26: sem rota, sem ação, sem "use server" e sem repositório em src/app', () => {
  it('src/server/mensagens não tem "use server" nem arquivo *.acao.ts', () => {
    const todos = arquivos('src/server/mensagens');
    expect(todos.filter((f) => f.endsWith('.acao.ts'))).toEqual([]);
    for (const f of producao(todos)) expect(ler(f), f).not.toMatch(/['"]use server['"]/);
  });

  it('nada em src/app importa os repositórios de mensagem nem o módulo de mensagens', () => {
    for (const f of arquivos('src/app')) {
      const t = ler(f);
      expect(t, f).not.toMatch(/repos\/mensagem/);
      // D-043 (E7.3): a UI só lê a situação por estes módulos (rótulos e tipos client-safe e a consulta
      // com escopo de agenda.ver); pipeline, registro, envio e reenvio seguem fora de src/app.
      expect(t, f).not.toMatch(/@\/server\/mensagens(?!\/(rotulos|situacao-tipos|tipos|consultar-por-reserva)')/);
    }
  });
});

describe('CA-26: o pipeline só escreve em mensagem e mensagem_tentativa', () => {
  const PERMITIDAS = new Set(['mensagem', 'mensagem_tentativa']);
  const alvo = (sql: string) => [...sql.matchAll(/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"?([a-z_]+)"?/gi)].map((m) => m[1].toLowerCase());

  it.each(['src/server/repos/mensagem.ts', 'src/server/repos/mensagem-sistema.ts'])('%s só tem INSERT/UPDATE/DELETE nas duas tabelas', (f) => {
    const sql = ler(f)
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join('\n')
      .replace(/FOR\s+(NO\s+KEY\s+)?UPDATE/gi, 'FOR LOCK');
    const alvos = alvo(sql);
    expect(alvos.length).toBeGreaterThan(0);
    expect(alvos.filter((t) => !PERMITIDAS.has(t))).toEqual([]);
  });

  it('os handlers não têm SQL nem Prisma: só chamam serviços e repositórios de sistema', () => {
    for (const f of ['src/worker/handlers/whatsapp-reserva.ts', 'src/worker/handlers/reconciliar-mensagens.ts']) {
      const t = ler(f);
      expect(t, f).not.toMatch(/\$(executeRaw|queryRaw)|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|generated\/prisma/);
    }
  });
});

describe('CA-26 / RN-21: nenhuma variável de ambiente nova', () => {
  it('config.ts e o pipeline não leem process.env; .env.example não ganha prazos de mensagem', () => {
    for (const f of [...producao(arquivos('src/server/mensagens')), 'src/worker/handlers/whatsapp-reserva.ts', 'src/worker/handlers/reconciliar-mensagens.ts']) {
      expect(ler(f), f).not.toMatch(/process\.env|import\.meta\.env/);
    }
    expect(ler('.env.example')).not.toMatch(/PRAZO_PENDENTE|PRAZO_ENVIANDO|LOTE_RECONCILIACAO|MENSAGEM/i);
    expect(ler('src/server/env.ts')).not.toMatch(/PRAZO_PENDENTE|PRAZO_ENVIANDO|LOTE_RECONCILIACAO/);
  });
});
