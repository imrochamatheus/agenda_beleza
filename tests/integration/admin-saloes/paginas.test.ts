import { randomUUID } from 'node:crypto';

import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import PaginaDoSalao from '@/app/admin/saloes/[id]/page';
import { editarSalaoAcao, estenderTesteAcao, reativarSalaoAcao, suspenderSalaoAcao } from '@/app/admin/saloes/acoes';
import { estadoEdicaoInicial, estadoExtensaoInicial, estadoSuspensaoInicial, valoresDoDetalhe } from '@/app/admin/saloes/estado';
import PaginaDeSaloes from '@/app/admin/saloes/page';
import { lerSalao } from '@/server/admin/saloes';

import { adminDeTeste, prefixoUnico, salaoComAssinatura, salaoEmTeste, salaoNoBanco } from '../../support/admin-saloes';
import type { AdminDeTeste } from '../../support/admin-saloes';
import { credencialDoGestor, credencialDoProfissional } from '../../support/auth';
import { conectar } from '../../support/sql';

// D-044 CA-10/CA-14 no servidor: páginas e casca de ações REAIS sobre o PostgreSQL. Só next/headers,
// next/navigation e next/cache são substituídos (cookies, redirect, notFound, revalidatePath).
class Redirecionado extends Error {
  constructor(readonly destino: string) {
    super(`NEXT_REDIRECT ${destino}`);
  }
}
const jar = vi.hoisted(() => ({ admin: undefined as string | undefined, salao: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nome: string) => {
      const v = nome === 'ab_admin' ? jar.admin : nome === 'ab_sessao' ? jar.salao : undefined;
      return v === undefined ? undefined : { name: nome, value: v };
    },
  }),
  headers: async () => ({ get: () => null }),
}));
vi.mock('next/navigation', () => ({
  redirect: (destino: string) => {
    throw new Redirecionado(destino);
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  usePathname: () => '/admin/saloes',
}));
const revalidar = vi.hoisted(() => vi.fn());
vi.mock('next/cache', () => ({ revalidatePath: revalidar }));

let c: pg.Client;
let adm: AdminDeTeste;
beforeAll(async () => {
  c = await conectar();
  adm = await adminDeTeste();
});
afterAll(async () => {
  await c.end();
});
beforeEach(() => {
  jar.admin = undefined;
  jar.salao = undefined;
  revalidar.mockClear();
});

const form = (campos: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
};
const destinoDe = async (p: Promise<unknown>) => ((await p.catch((e: unknown) => e)) as Redirecionado).destino;
const html = async (p: Promise<unknown>) => renderToStaticMarkup((await p) as ReactElement);
const lista = (q: Record<string, string> = {}) => PaginaDeSaloes({ searchParams: Promise.resolve(q) });
const detalhe = (id: string) => PaginaDoSalao({ params: Promise.resolve({ id }) });

describe('CA-10: páginas', () => {
  it('sem sessão: redireciona para /admin/entrar; gestor e profissional: "Acesso negado" sem dados', async () => {
    const s = await salaoComAssinatura('ativa');
    expect(await destinoDe(lista())).toBe('/admin/entrar');
    expect(await destinoDe(detalhe(s.salaoId))).toBe('/admin/entrar');
    for (const cred of [await credencialDoGestor(s), await credencialDoProfissional(s)]) {
      jar.salao = cred!.token;
      for (const pagina of [lista({ q: s.nome }), detalhe(s.salaoId)]) {
        const marcacao = await html(pagina);
        expect(marcacao).toContain('Acesso negado');
        expect(marcacao).not.toContain(s.nome);
        expect(marcacao).not.toContain(s.gestor.email);
      }
    }
  });

  it('admin: lista com nome, endereço, estado e e-mail do gestor; detalhe com os formulários; 404 para id ruim', async () => {
    const p = prefixoUnico();
    const s = await salaoEmTeste();
    await c.query('UPDATE salao SET nome = $2 WHERE id = $1', [s.salaoId, `Zulu ${p}`]);
    jar.admin = adm.cred.admin!.token;
    const l = await html(lista({ q: p }));
    expect(l).toContain(`Zulu ${p}`);
    expect(l).toContain(`/${s.slugAtual}`);
    expect(l).toContain('Em período de teste');
    expect(l).toContain(s.gestor.email);
    expect(l).toContain('Navegação da administração');
    expect(l).not.toMatch(/senha_hash|argon2|provedor/i);
    const d = await html(detalhe(s.salaoId));
    expect(d).toContain(`Zulu ${p}`);
    expect(d).toContain('Salvar alterações');
    expect(d).toContain('Ver novo fim');
    expect(d).toContain('Continuar');
    expect(d).not.toMatch(/senha_hash|argon2|PROVEDOR|provedor_assinatura/i);
    for (const id of ['nao-e-uuid', randomUUID()]) {
      await expect(detalhe(id)).rejects.toThrow('NEXT_NOT_FOUND');
    }
  });

  it('salão suspenso mostra o selo e a ação de reativar; sem assinatura mostra a recusa no lugar do campo', async () => {
    const s = await salaoComAssinatura(null);
    await c.query('UPDATE salao SET suspenso_manual_em = now() WHERE id = $1', [s.salaoId]);
    jar.admin = adm.cred.admin!.token;
    const d = await html(detalhe(s.salaoId));
    expect(d).toContain('Suspenso manualmente');
    expect(d).toContain('Reativar salão');
    expect(d).toContain('Este salão não tem assinatura.');
    expect(d).not.toContain('Ver novo fim');
  });
});

describe('CA-10: casca das ações', () => {
  const entradaEdicao = (s: { salaoId: string }, mudar: Record<string, string> = {}) =>
    form({ salaoId: s.salaoId, nome: 'Nome pela casca', slug: '', fuso: 'America/Sao_Paulo', grade: '15', antecedencia: '2', janela: '60', intervalo: '0', gestorNome: 'X Y', gestorEmail: 'x@exemplo.com.br', ...mudar });

  it('sem sessão: redireciona para /admin/entrar em todas as ações; nada muda', async () => {
    const s = await salaoEmTeste();
    expect(await destinoDe(editarSalaoAcao(estadoEdicaoInicial({} as never), entradaEdicao(s)))).toBe('/admin/entrar');
    expect(await destinoDe(suspenderSalaoAcao(estadoSuspensaoInicial(), form({ salaoId: s.salaoId, motivo: 'Motivo válido', etapa: 'confirmar' })))).toBe('/admin/entrar');
    expect(await destinoDe(reativarSalaoAcao(estadoSuspensaoInicial(), form({ salaoId: s.salaoId })))).toBe('/admin/entrar');
    expect(await destinoDe(estenderTesteAcao(estadoExtensaoInicial(), form({ salaoId: s.salaoId, dias: '3', etapa: 'previa' })))).toBe('/admin/entrar');
    expect((await salaoNoBanco(c, s.salaoId)).nome).toBe(s.nome);
    expect(revalidar).not.toHaveBeenCalled();
  });

  it('gestor: estado com "Acesso negado." e nada muda', async () => {
    const s = await salaoEmTeste();
    jar.salao = (await credencialDoGestor(s))!.token;
    const e = await suspenderSalaoAcao(estadoSuspensaoInicial(), form({ salaoId: s.salaoId, motivo: 'Motivo válido', etapa: 'confirmar' }));
    expect(e).toMatchObject({ mensagem: 'Acesso negado.', resultado: null });
    expect((await editarSalaoAcao(estadoEdicaoInicial({} as never), entradaEdicao(s))).mensagem).toBe('Acesso negado.');
    expect((await salaoNoBanco(c, s.salaoId)).suspenso_manual_em).toBeNull();
  });

  it('admin: id desconhecido vira mensagem; valores digitados voltam; campos extras são ignorados', async () => {
    jar.admin = adm.cred.admin!.token;
    const e = await editarSalaoAcao(estadoEdicaoInicial({} as never), entradaEdicao({ salaoId: randomUUID() }, { senha: 'nunca', slug: 'abc' }));
    expect(e.mensagem).toBe('Salão não encontrado.');
    expect(e.valores.nome).toBe('Nome pela casca');
    expect((e.valores as Record<string, string>).senha).toBeUndefined();
  });

  it('admin: editar, suspender (duas etapas), reativar e estender gravam e revalidam a página', async () => {
    const s = await salaoEmTeste();
    jar.admin = adm.cred.admin!.token;
    const d = await lerSalao(adm.ctx, s.salaoId);
    const inicial = estadoEdicaoInicial(valoresDoDetalhe(d));
    const ed = await editarSalaoAcao(inicial, entradaEdicao(s, { slug: d.slug, gestorNome: d.gestor!.nome, gestorEmail: d.gestor!.email, nome: 'Nome novo da casca' }));
    expect(ed.resultado).toEqual({ resultado: 'editado' });
    expect(ed.mensagem).toBeNull();
    expect((await salaoNoBanco(c, s.salaoId)).nome).toBe('Nome novo da casca');
    expect(revalidar).toHaveBeenCalledWith(`/admin/saloes/${s.salaoId}`);

    const previa = await suspenderSalaoAcao(estadoSuspensaoInicial(), form({ salaoId: s.salaoId, motivo: '  Motivo   válido ', etapa: 'previa' }));
    expect(previa.resultado).toEqual({ resultado: 'previa', motivo: 'Motivo válido' });
    expect((await salaoNoBanco(c, s.salaoId)).suspenso_manual_em).toBeNull();
    const conf = await suspenderSalaoAcao(previa, form({ salaoId: s.salaoId, motivo: 'Motivo válido', etapa: 'confirmar' }));
    expect(conf.resultado).toEqual({ resultado: 'suspenso' });
    expect((await salaoNoBanco(c, s.salaoId)).suspenso_manual_em).not.toBeNull();
    expect((await reativarSalaoAcao(conf, form({ salaoId: s.salaoId, motivo: '' }))).resultado).toEqual({ resultado: 'reativado' });

    const pe = await estenderTesteAcao(estadoExtensaoInicial(), form({ salaoId: s.salaoId, dias: '4', etapa: 'previa' }));
    expect(pe.resultado).toMatchObject({ resultado: 'previa', dias: 4 });
    const ee = await estenderTesteAcao(pe, form({ salaoId: s.salaoId, dias: '4', testeFimEmEsperado: s.fim!.toISOString(), etapa: 'confirmar' }));
    expect(ee.resultado).toMatchObject({ resultado: 'estendido', dias: 4 });
    expect(ee.valores.dias).toBe('4');
  });
});
