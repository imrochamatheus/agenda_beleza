/// <reference types="vite/client" />
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { verificarAcoes } from '@/server/tenant/registro';

// D-033: provas estáticas, sem banco. CA-3 (nenhuma ação/rota edita ou apaga auditoria) e CA-11
// (só repos/auditoria.ts toca a tabela; o serviço não importa Prisma nem next/*).

const RAIZ = join(process.cwd(), 'src');
const REPO = 'server/repos/auditoria.ts';

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? arquivos(p) : [p];
  });
}

const ehTeste = (p: string) => /\.test\.tsx?$/.test(p) || p.includes(`${join('src', 'generated')}`);
const producao = arquivos(RAIZ).filter((p) => /\.tsx?$/.test(p) && !ehTeste(p));
const rel = (p: string) => relative(RAIZ, p).split('\\').join('/');
const fonte = (p: string) => readFileSync(p, 'utf8');

const acoes = import.meta.glob<Record<string, unknown>>('/src/**/*.acao.ts', { eager: true });

describe('CA-3: nada de edição ou remoção do log', () => {
  it('o registro de ações continua válido e nenhuma ação de produto menciona auditoria', () => {
    expect(verificarAcoes(acoes)).toEqual([]);
    const citam = producao.filter((p) => p.endsWith('.acao.ts') && /auditoria/i.test(fonte(p)));
    expect(citam.map(rel)).toEqual([]);
  });

  it('nenhuma rota de src/app/api menciona auditoria', () => {
    const rotas = arquivos(join(RAIZ, 'app', 'api')).filter((p) => /\.tsx?$/.test(p));
    expect(rotas.length).toBeGreaterThan(0);
    expect(rotas.filter((p) => /auditoria/i.test(fonte(p))).map(rel)).toEqual([]);
  });

  it('nenhum código de produção emite UPDATE/DELETE/TRUNCATE sobre auditoria', () => {
    const padrao = /\b(UPDATE|DELETE\s+FROM|TRUNCATE(\s+TABLE)?)\s+("?auditoria"?)\b/i;
    const prisma = /\bauditoria\s*\.\s*(update|updateMany|delete|deleteMany|upsert)\b/;
    const ruins = producao.filter((p) => padrao.test(fonte(p)) || prisma.test(fonte(p)));
    expect(ruins.map(rel)).toEqual([]);
  });
});

describe('CA-11: fronteira do módulo', () => {
  it('só repos/auditoria.ts acessa a tabela auditoria (Prisma ou SQL)', () => {
    const acessa = /\b(prisma|db|tx|client)\.auditoria\b|\bFROM\s+"?auditoria"?\b|\bINTO\s+"?auditoria"?\b/i;
    const quem = producao.filter((p) => acessa.test(fonte(p))).map(rel);
    expect(quem).toEqual([REPO]);
  });

  it('src/server/auditoria/** não importa Prisma gerado, o cliente do banco nem next/*', () => {
    const modulo = producao.filter((p) => rel(p).startsWith('server/auditoria/'));
    expect(modulo.length).toBeGreaterThanOrEqual(3);
    const proibido = /from\s+['"](@\/generated[^'"]*|@\/server\/repos\/db[^'"]*|\.\.?\/[^'"]*repos\/db|next(\/[^'"]*)?|@prisma\/[^'"]*)['"]/;
    expect(modulo.filter((p) => proibido.test(fonte(p))).map(rel)).toEqual([]);
  });
});
