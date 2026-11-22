import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { arquivarAcao, restaurarAcao, retirarAcao } from '@/app/admin/avaliacoes/acoes';
import PaginaDeModeracao from '@/app/admin/avaliacoes/[id]/page';
import PaginaFilaDeAvaliacoes from '@/app/admin/avaliacoes/page';
import { denunciarAcao } from '@/app/(publico)/[slug]/acoes';
import { ESTADO_INICIAL_DENUNCIA } from '@/app/(publico)/[slug]/_denuncia/estado';
import { TOKEN_TURNSTILE_SIMULADO } from '@/server/integrations/turnstile/port';

import { credencialDoGestor, credencialDoProfissional, criarSuperAdmin } from '../../support/auth';
import { contarAuditoria } from '../../support/auditoria';
import { criarAvaliacao, denunciasDe, linhaDaAvaliacao, semearPendentes } from '../../support/denuncias';
import { conectar } from '../../support/sql';
import { salaoNovo } from '../avaliacoes/apoio';

// D-035 CA-9, CA-2 (resposta uniforme da ação pública) e CA-10: páginas e ações reais de /admin/avaliacoes
// sobre o PostgreSQL. Só next/headers e next/navigation são substituídos (cookies, redirect, notFound).

class Redirecionado extends Error {
  constructor(readonly destino: string) {
    super(`NEXT_REDIRECT ${destino}`);
  }
}
const jar = vi.hoisted(() => ({ admin: undefined as string | undefined, salao: undefined as string | undefined, ip: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nome: string) => {
      const v = nome === 'ab_admin' ? jar.admin : nome === 'ab_sessao' ? jar.salao : undefined;
      return v === undefined ? undefined : { name: nome, value: v };
    },
  }),
  headers: async () => ({ get: (n: string) => (n === 'x-forwarded-for' ? (jar.ip ?? null) : null) }),
}));
vi.mock('next/navigation', () => ({
  redirect: (destino: string) => {
    throw new Redirecionado(destino);
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  // O menu do admin (D-044) é um componente cliente que lê o caminho.
  usePathname: () => '/admin',
}));

let c: pg.Client;
beforeAll(async () => {
  c = await conectar();
});
afterAll(async () => {
  await c.end();
});
beforeEach(() => {
  jar.admin = undefined;
  jar.salao = undefined;
  jar.ip = undefined;
});

const form = (campos: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
};
const destinoDe = async (p: Promise<unknown>) => ((await p.catch((e: unknown) => e)) as Redirecionado).destino;
const props = (q: Record<string, string> = {}) => ({ searchParams: Promise.resolve(q) });
const html = async (p: Promise<unknown>) => renderToStaticMarkup((await p) as ReactElement);

describe('CA-9: páginas', () => {
  it('sem sessão: redireciona para /admin/entrar; gestor e profissional: "Acesso negado" sem dados', async () => {
    const s = await salaoNovo();
    const a = await criarAvaliacao(c, s, { comentario: 'COMENTARIO-SECRETO' });
    expect(await destinoDe(PaginaFilaDeAvaliacoes(props()))).toBe('/admin/entrar');
    expect(await destinoDe(PaginaDeModeracao({ params: Promise.resolve({ id: a.avaliacaoId }), ...props() }))).toBe('/admin/entrar');
    for (const cred of [await credencialDoGestor(s), await credencialDoProfissional(s)]) {
      jar.salao = cred!.token;
      for (const pagina of [PaginaFilaDeAvaliacoes(props()), PaginaDeModeracao({ params: Promise.resolve({ id: a.avaliacaoId }), ...props() })]) {
        const marcacao = await html(pagina);
        expect(marcacao).toContain('Acesso negado');
        expect(marcacao).not.toContain('COMENTARIO-SECRETO');
        expect(marcacao).not.toContain('Retirar avaliação');
      }
    }
  });

  it('super admin com TOTP vê a fila e o detalhe; id desconhecido ou malformado é 404', async () => {
    const adm = await criarSuperAdmin({ totpVerificado: true });
    const s = await salaoNovo();
    const a = await criarAvaliacao(c, s, { comentario: 'Comentário visível ao admin' });
    await semearPendentes(c, s, a.avaliacaoId, 2);
    jar.admin = adm.credencial!.token;
    const fila = await html(PaginaFilaDeAvaliacoes(props({ salao: s.salaoId })));
    expect(fila).toContain('Moderação de avaliações');
    expect(fila).toContain('Comentário visível ao admin');
    expect(fila).toContain('2 denúncias pendentes');
    expect(fila).not.toContain(a.clienteId);
    const det = await html(PaginaDeModeracao({ params: Promise.resolve({ id: a.avaliacaoId }), ...props({ resultado: 'retirada' }) }));
    expect(det).toContain('Retirar avaliação');
    expect(det).toContain('Avaliação retirada da página pública.');
    await expect(PaginaDeModeracao({ params: Promise.resolve({ id: '00000000-0000-4000-8000-000000000000' }), ...props() })).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(PaginaDeModeracao({ params: Promise.resolve({ id: 'xx' }), ...props() })).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

describe('CA-9: ações da casca (POST direto)', () => {
  it('sem sessão volta para /admin/entrar; sessão de salão volta com "negado"; nada muda', async () => {
    const s = await salaoNovo();
    const a = await criarAvaliacao(c, s);
    const aud = await contarAuditoria(c);
    const campos = { avaliacao_id: a.avaliacaoId, motivo: 'Motivo qualquer' };
    expect(await destinoDe(retirarAcao(form(campos)))).toBe('/admin/entrar');
    expect(await destinoDe(restaurarAcao(form(campos)))).toBe('/admin/entrar');
    expect(await destinoDe(arquivarAcao(form({ avaliacao_id: a.avaliacaoId })))).toBe('/admin/entrar');
    jar.salao = (await credencialDoGestor(s))!.token;
    expect(await destinoDe(retirarAcao(form(campos)))).toBe(`/admin/avaliacoes/${a.avaliacaoId}?resultado=negado`);
    expect(await destinoDe(arquivarAcao(form({ avaliacao_id: a.avaliacaoId })))).toBe(`/admin/avaliacoes/${a.avaliacaoId}?resultado=negado`);
    expect((await linhaDaAvaliacao(c, a.avaliacaoId)).retirada_em).toBeNull();
    expect(await contarAuditoria(c)).toBe(aud);
  });

  it('super admin: retirar, restaurar e arquivar com PRG e códigos fechados; efeitos reais', async () => {
    const adm = await criarSuperAdmin({ totpVerificado: true });
    jar.admin = adm.credencial!.token;
    const s = await salaoNovo();
    const a = await criarAvaliacao(c, s);
    await semearPendentes(c, s, a.avaliacaoId, 2);
    const base = `/admin/avaliacoes/${a.avaliacaoId}`;
    expect(await destinoDe(retirarAcao(form({ avaliacao_id: a.avaliacaoId, motivo: 'ab' })))).toBe(`${base}?resultado=motivo_invalido`);
    expect(await destinoDe(retirarAcao(form({ avaliacao_id: a.avaliacaoId, motivo: 'a@b.com por favor' })))).toBe(`${base}?resultado=motivo_dados`);
    expect((await linhaDaAvaliacao(c, a.avaliacaoId)).retirada_em).toBeNull();
    expect(await destinoDe(retirarAcao(form({ avaliacao_id: a.avaliacaoId, motivo: 'Conteúdo ofensivo' })))).toBe(`${base}?resultado=retirada`);
    expect((await linhaDaAvaliacao(c, a.avaliacaoId)).retirada_por).toBe(adm.usuarioId);
    expect(await destinoDe(retirarAcao(form({ avaliacao_id: a.avaliacaoId, motivo: 'Conteúdo ofensivo' })))).toBe(`${base}?resultado=estado_atual`);
    expect(await destinoDe(restaurarAcao(form({ avaliacao_id: a.avaliacaoId, motivo: 'Foi um engano' })))).toBe(`${base}?resultado=restaurada`);
    expect(await destinoDe(arquivarAcao(form({ avaliacao_id: a.avaliacaoId })))).toBe(`${base}?resultado=sem_pendentes`);
    // Id malformado: volta para a fila, nunca para um caminho montado com o valor recebido.
    expect(await destinoDe(retirarAcao(form({ avaliacao_id: '../x', motivo: 'Motivo qualquer' })))).toBe('/admin/avaliacoes?resultado=nao_encontrada');
    const outra = await criarAvaliacao(c, s);
    await semearPendentes(c, s, outra.avaliacaoId, 2);
    const [d1] = await denunciasDe(c, outra.avaliacaoId);
    expect(await destinoDe(arquivarAcao(form({ avaliacao_id: outra.avaliacaoId, denuncia_id: d1.id })))).toBe(`/admin/avaliacoes/${outra.avaliacaoId}?resultado=arquivadas`);
    expect((await denunciasDe(c, outra.avaliacaoId)).filter((d) => d.resolvida_em !== null)).toHaveLength(1);
  });
});

describe('ação pública de denúncia (casca)', () => {
  it('válida: PRG para /{slug}?denuncia=recebida e uma linha; salão inexistente: o mesmo PRG sem gravar; erros no estado', async () => {
    const s = await salaoNovo();
    const a = await criarAvaliacao(c, s);
    jar.ip = `203.0.113.${50 + Math.floor(Math.random() * 100)}`;
    const ok = form({ slug: s.slugAtual, avaliacao_id: a.avaliacaoId, motivo: 'spam', texto: 'x', 'cf-turnstile-response': TOKEN_TURNSTILE_SIMULADO });
    expect(await destinoDe(denunciarAcao(ESTADO_INICIAL_DENUNCIA, ok))).toBe(`/${s.slugAtual}?denuncia=recebida#avaliacoes`);
    expect(await denunciasDe(c, a.avaliacaoId)).toHaveLength(1);
    jar.ip = '203.0.113.7';
    const alvoInexistente = form({ slug: 'nao-existe-mesmo', avaliacao_id: a.avaliacaoId, motivo: 'spam', 'cf-turnstile-response': TOKEN_TURNSTILE_SIMULADO });
    expect(await destinoDe(denunciarAcao(ESTADO_INICIAL_DENUNCIA, alvoInexistente))).toBe('/nao-existe-mesmo?denuncia=recebida#avaliacoes');
    const aberrante = form({ slug: '//evil.example', avaliacao_id: a.avaliacaoId, motivo: 'spam', 'cf-turnstile-response': TOKEN_TURNSTILE_SIMULADO });
    expect(await destinoDe(denunciarAcao(ESTADO_INICIAL_DENUNCIA, aberrante))).toBe('/?denuncia=recebida#avaliacoes');
    expect(await denunciasDe(c, a.avaliacaoId)).toHaveLength(1);
    const semMotivo = await denunciarAcao(ESTADO_INICIAL_DENUNCIA, form({ slug: s.slugAtual, avaliacao_id: a.avaliacaoId, texto: 'meu texto' }));
    expect(semMotivo).toMatchObject({ status: 'invalido', valores: { texto: 'meu texto' }, erros: { motivo: expect.any(String) } });
    const humano = await denunciarAcao(ESTADO_INICIAL_DENUNCIA, form({ slug: s.slugAtual, avaliacao_id: a.avaliacaoId, motivo: 'spam', 'cf-turnstile-response': 'ruim' }));
    expect(humano.status).toBe('humano');
  });
});
