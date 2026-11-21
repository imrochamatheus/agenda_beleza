import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

// D-035 CA-9/CA-14: provas estáticas. Só o admin altera avaliações; só repos/ importa Prisma; literais
// que mantêm os índices parciais aplicáveis.
const RAIZ = join(process.cwd(), 'src');
const arquivos = (d: string): string[] =>
  readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? arquivos(join(d, n)) : [join(d, n)]));
const rel = (p: string) => relative(RAIZ, p).split('\\').join('/');
const producao = arquivos(RAIZ).filter((p) => /\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p) && !p.includes('/generated/'));
const fonte = (p: string) => readFileSync(p, 'utf8');

describe('D-035: fronteiras', () => {
  it('só repos/avaliacao.ts grava retirada_em; nenhuma tela ou ação de salão importa a moderação', () => {
    const grava = producao.filter((p) => /SET retirada_em\s*=/.test(fonte(p))).map(rel);
    expect(grava).toEqual(['server/repos/avaliacao.ts']);
    const doSalao = producao.filter((p) => rel(p).startsWith('app/painel/') || (rel(p).startsWith('server/') && /(profissionais|servicos|clientes|salao|bloqueios|jornadas|fotos|reservas)\//.test(rel(p))));
    const ruins = doSalao.filter((p) => /denuncias\/moderacao|denuncias\.acao|define-acao-admin|travarParaModerar/.test(fonte(p)));
    expect(ruins.map(rel)).toEqual([]);
  });

  it('só repos/ importa o Prisma gerado para as denúncias', () => {
    const quem = producao.filter((p) => /avaliacao_denuncia/.test(fonte(p)) && /@\/generated\/prisma/.test(fonte(p))).map(rel);
    expect(quem.every((q) => q.startsWith('server/repos/'))).toBe(true);
  });

  it('o INSERT público mantém a cláusula do índice parcial literal e o predicado de visibilidade único', () => {
    const f = fonte(join(RAIZ, 'server/repos/denuncia-publica.ts'));
    expect(f).toContain('ON CONFLICT (avaliacao_id, ip_hash) WHERE resolvida_em IS NULL DO NOTHING');
    expect(f).toContain('ondeAvaliacaoVisivel(salaoId)');
    expect(fonte(join(RAIZ, 'server/repos/denuncia.ts'))).toContain('resolvida_em IS NULL');
  });
});
