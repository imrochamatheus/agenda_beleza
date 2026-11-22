import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { NAVEGACAO_ADMIN, NAVEGACAO_ADMIN_DISPONIVEL, ROTAS, ROTAS_ADMIN_EXISTENTES } from './navegacao';

// D-044: o menu do admin nunca leva a uma tela que não existe.
describe('menu do admin só com rotas que existem', () => {
  it('cada rota de ROTAS_ADMIN_EXISTENTES tem page.tsx em src/app', () => {
    expect(ROTAS_ADMIN_EXISTENTES.length).toBeGreaterThan(0);
    for (const chave of ROTAS_ADMIN_EXISTENTES) {
      expect(existsSync(join(process.cwd(), 'src/app', ROTAS[chave], 'page.tsx')), `${chave}: sem page.tsx`).toBe(true);
    }
  });

  it('o menu disponível é exatamente NAVEGACAO_ADMIN filtrada por essa lista, e tem Salões', () => {
    expect(NAVEGACAO_ADMIN_DISPONIVEL.map((i) => i.chave)).toEqual(NAVEGACAO_ADMIN.filter((i) => (ROTAS_ADMIN_EXISTENTES as readonly string[]).includes(i.chave)).map((i) => i.chave));
    expect(NAVEGACAO_ADMIN_DISPONIVEL.map((i) => i.href)).toContain(ROTAS.adminSaloes);
    for (const i of NAVEGACAO_ADMIN_DISPONIVEL) expect(existsSync(join(process.cwd(), 'src/app', i.href, 'page.tsx'))).toBe(true);
    expect(Object.isFrozen(NAVEGACAO_ADMIN_DISPONIVEL)).toBe(true);
  });

  it('o menu mostra Salões, Mensagens e Auditoria, nessa ordem (D-045)', () => {
    expect(NAVEGACAO_ADMIN_DISPONIVEL.map((i) => i.chave)).toEqual(['adminSaloes', 'adminMensagens', 'adminAuditoria']);
    expect(NAVEGACAO_ADMIN_DISPONIVEL.map((i) => i.href)).toEqual([ROTAS.adminSaloes, ROTAS.adminMensagens, ROTAS.adminAuditoria]);
  });

  it('os itens do menu que ainda não têm tela ficam de fora (nenhum link para 404)', () => {
    const fora = NAVEGACAO_ADMIN.filter((i) => !NAVEGACAO_ADMIN_DISPONIVEL.includes(i));
    for (const i of fora) expect(existsSync(join(process.cwd(), 'src/app', i.href, 'page.tsx'))).toBe(false);
  });

  it('a assinatura do salão existe como rota com page.tsx e a vitrine tem a sua', () => {
    expect(existsSync(join(process.cwd(), 'src/app/admin/saloes/[id]/assinatura/page.tsx'))).toBe(true);
    expect(ROTAS.adminSalaoAssinatura('abc')).toBe('/admin/saloes/abc/assinatura');
    expect(ROTAS.devAdminMensagens).toBe('/dev/admin-mensagens');
  });
});
