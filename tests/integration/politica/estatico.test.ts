import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

// D-038 RN-5 e RN-9: provas estáticas. Mutação de equipe só por `defineAcao` (a política mora lá); a rota de
// upload e as cascas `'use server'` do painel não tocam repositório nem armazenamento; nenhum atalho para
// `permitirTudo` em código de produção; a política única não é copiada.
const RAIZ = join(process.cwd(), 'src');
const arquivos = (d: string): string[] =>
  readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? arquivos(join(d, n)) : [join(d, n)]));
const rel = (p: string) => relative(RAIZ, p).split('\\').join('/');
const producao = arquivos(RAIZ).filter((p) => /\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p) && !p.includes('/generated/'));
const fonte = (p: string) => readFileSync(p, 'utf8');
const importa = (src: string, alvo: RegExp) => [...src.matchAll(/^import\s[^;]*?from\s+['"]([^'"]+)['"]/gm)].some((m) => alvo.test(m[1]));

describe('D-038: toda mutação de equipe passa por defineAcao', () => {
  it('nenhum route.ts de /api/painel/** importa repositório ou armazenamento; todos usam ação (`*.acao`)', () => {
    const rotas = producao.filter((p) => /^app\/api\/painel\/.*route\.ts$/.test(rel(p)));
    expect(rotas.map(rel)).toContain('app/api/painel/fotos/route.ts');
    for (const p of rotas) {
      const src = fonte(p);
      expect(importa(src, /@\/server\/repos|@\/server\/integrations|@\/generated\/prisma/), rel(p)).toBe(false);
      expect(importa(src, /\.acao$/), rel(p)).toBe(true);
    }
  });

  it("cascas 'use server' do painel não importam repositório nem Prisma", () => {
    const cascas = producao.filter((p) => rel(p).startsWith('app/painel/') && /^['"]use server['"]/m.test(fonte(p)));
    expect(cascas.length).toBeGreaterThan(5);
    for (const p of cascas) {
      expect(importa(fonte(p), /@\/server\/repos|@\/generated\/prisma|@\/server\/integrations/), rel(p)).toBe(false);
    }
  });

  it('nenhum código de produção usa permitirTudo e a política real é a única implementação', () => {
    const usa = producao.filter((p) => /permitirTudo/.test(fonte(p))).map(rel);
    expect(usa).toEqual(['server/tenant/politica.ts']);
    const definem = producao.filter((p) => /decidirPolitica\s*\(/.test(fonte(p)) && /export function decidirPolitica/.test(fonte(p))).map(rel);
    expect(definem).toEqual(['server/assinatura/politica-operacao.ts']);
  });

  it('defineAcao, criarReserva e alteracao-comum usam a política por estado; defineAcaoAdmin não', () => {
    for (const f of ['server/tenant/define-acao.ts', 'server/reservas/criar-reserva.ts', 'server/reservas/alteracao-comum.ts']) {
      expect(fonte(join(RAIZ, f)), f).toContain('assinatura/politica-operacao');
    }
    expect(fonte(join(RAIZ, 'server/tenant/define-acao-admin.ts'))).not.toMatch(/politica/i);
  });

  it('`agendamentoDisponivel` não tem lista própria de estados da assinatura', () => {
    const f = fonte(join(RAIZ, 'server/reserva-publica/agendamento.ts'));
    for (const estado of ['pendente', 'suspensa', 'encerrada', 'cancelada', 'em_carencia']) {
      expect(f.replace(/\/\/.*$/gm, '')).not.toContain(`'${estado}'`);
    }
  });
});
