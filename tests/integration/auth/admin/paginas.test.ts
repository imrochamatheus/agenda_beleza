import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import PaginaAdmin from '@/app/admin/page';
import PaginaAdminEntrar from '@/app/admin/entrar/page';
import { sairAdminAcao } from '@/app/admin/acoes';
import { cadastrarTotpAcao, entrarAdminAcao, verificarTotpAcao } from '@/app/admin/entrar/acoes';
import { ESTADO_INICIAL_ADMIN } from '@/app/admin/entrar/estado';
import { decifrarSegredo } from '@/server/auth/admin/cifra';
import { MENSAGENS_ADMIN } from '@/server/auth/admin/login-admin';
import { codigoDoPasso, passoDe } from '@/server/auth/admin/totp';
import { obterPrisma } from '@/server/repos/db';
import { hashDoToken } from '@/server/tenant/sessao';

import { criarSessao } from '../../../support/auth';
import { SENHA_DE_TESTE, criarSalaoCompleto } from '../../../support/factories';

import { CHAVE, criarAdmin } from './apoio';

// D-034 CA-2, CA-4, CA-9, CA-12: páginas e ações reais de /admin sobre o PostgreSQL. Só next/headers e
// next/navigation são substituídos (cookies e redirect); nada de banco é simulado.

class Redirecionado extends Error {
  constructor(readonly destino: string) {
    super(`NEXT_REDIRECT ${destino}`);
  }
}
type Gravado = { valor: string; atributos: Record<string, unknown> };
const jar = vi.hoisted(() => ({ admin: undefined as string | undefined, salao: undefined as string | undefined, gravados: [] as { nome: string; valor: string; atributos: Record<string, unknown> }[] }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nome: string) => {
      const v = nome === 'ab_admin' ? jar.admin : nome === 'ab_sessao' ? jar.salao : undefined;
      return v === undefined ? undefined : { name: nome, value: v };
    },
    set: (nome: string, valor: string, atributos: Record<string, unknown>) => {
      jar.gravados.push({ nome, valor, atributos });
      if (nome === 'ab_admin') jar.admin = valor === '' ? undefined : valor;
    },
  }),
}));
vi.mock('next/navigation', () => ({
  redirect: (destino: string) => {
    throw new Redirecionado(destino);
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

const form = (campos: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
};
const destinoDe = async (p: Promise<unknown>) => ((await p.catch((e: unknown) => e)) as Redirecionado).destino;
const ultimoAdmin = (): Gravado & { nome: string } => [...jar.gravados].reverse().find((g) => g.nome === 'ab_admin')!;
async function html(props: { aviso?: string } = {}): Promise<string> {
  const el = (await PaginaAdminEntrar({ searchParams: Promise.resolve(props) })) as ReactElement;
  return renderToStaticMarkup(el);
}
const codigoAgora = (segredo: string, delta = 0) => codigoDoPasso(segredo, passoDe(new Date()) + delta);

beforeAll(() => {
  vi.stubEnv('ADMIN_TOTP_CHAVE', CHAVE.toString('base64'));
});
beforeEach(() => {
  jar.admin = undefined;
  jar.salao = undefined;
  jar.gravados.length = 0;
});
afterEach(() => vi.restoreAllMocks());

describe('fluxo completo pelas ações e páginas', () => {
  it('primeiro acesso: senha → cadastro (QR + chave) → código → /admin → sair → código no próximo login', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const admin = await criarAdmin('nenhum');

    // Sem cookie: formulário de senha (nenhuma consulta de etapa).
    expect(await html()).toContain('Entrar na administração');

    // Etapa 1 com senha errada: mensagem genérica, nenhum cookie.
    const errada = await entrarAdminAcao(ESTADO_INICIAL_ADMIN, form({ email: admin.email, senha: 'errada' }));
    expect(errada).toMatchObject({ mensagem: MENSAGENS_ADMIN.credenciais, email: admin.email });
    expect(jar.gravados).toEqual([]);

    // Etapa 1 certa: cookie da pré-sessão (Strict, Path /admin, 10 min) e redirect (PRG).
    expect(await destinoDe(entrarAdminAcao(ESTADO_INICIAL_ADMIN, form({ email: admin.email, senha: SENHA_DE_TESTE })))).toBe('/admin/entrar');
    expect(ultimoAdmin().atributos).toMatchObject({ httpOnly: true, sameSite: 'strict', path: '/admin', maxAge: 600 });

    // Cadastro: QR em SVG e chave em texto; recarregar mostra a MESMA chave.
    const tela = await html();
    expect(tela).toContain('Configurar autenticador');
    expect(tela).toContain('<svg');
    expect(tela).not.toMatch(/https?:\/\//);
    const chave = /<code[^>]*>([A-Z2-7 ]+)<\/code>/.exec(tela)![1];
    expect(await html()).toContain(chave);
    const u = await obterPrisma().usuario.findUniqueOrThrow({ where: { id: admin.id } });
    const segredo = decifrarSegredo(u.totpSegredoCifrado!, admin.id, CHAVE);
    expect(chave.replace(/ /g, '')).toBe(segredo);

    // Formato inválido e código errado: mensagens; nada ativado.
    expect((await cadastrarTotpAcao(ESTADO_INICIAL_ADMIN, form({ codigo: 'abc' }))).erros.codigo).toBe(MENSAGENS_ADMIN.codigoVazio);
    expect((await cadastrarTotpAcao(ESTADO_INICIAL_ADMIN, form({ codigo: codigoAgora(segredo, 5) }))).mensagem).toBe(MENSAGENS_ADMIN.codigo);

    // Código certo: cookie admin de 8 h e redirect para /admin.
    expect(await destinoDe(cadastrarTotpAcao(ESTADO_INICIAL_ADMIN, form({ codigo: codigoAgora(segredo) })))).toBe('/admin');
    expect(ultimoAdmin().atributos).toMatchObject({ sameSite: 'strict', path: '/admin', maxAge: 28_800 });

    // /admin: nome, "Sair" e NENHUM link para telas inexistentes (CA-12); /admin/entrar leva a /admin.
    const painel = renderToStaticMarkup((await PaginaAdmin()) as ReactElement);
    expect(painel).toContain('Olá, Admin de teste');
    expect(painel).toContain(admin.email);
    expect(painel).toContain('Sair');
    expect(painel).not.toContain('/admin/saloes');
    expect(await destinoDe(PaginaAdminEntrar({ searchParams: Promise.resolve({}) }))).toBe('/admin');

    // Sair: revoga, apaga o cookie (Max-Age 0) e volta ao login.
    const token = jar.admin!;
    expect(await destinoDe(sairAdminAcao())).toBe('/admin/entrar');
    expect(ultimoAdmin()).toMatchObject({ valor: '', atributos: { maxAge: 0, path: '/admin' } });
    const sessao = await obterPrisma().sessao.findUniqueOrThrow({ where: { tokenHash: hashDoToken(token) } });
    expect(sessao.revogadaEm).not.toBeNull();
    expect(await destinoDe(PaginaAdmin())).toBe('/admin/entrar');
    // Sair de novo, sem cookie, é idempotente.
    expect(await destinoDe(sairAdminAcao())).toBe('/admin/entrar');

    // Próximo login: etapa do código (TOTP já ativo). O passo aceito no cadastro não vale de novo.
    expect(await destinoDe(entrarAdminAcao(ESTADO_INICIAL_ADMIN, form({ email: admin.email, senha: SENHA_DE_TESTE })))).toBe('/admin/entrar');
    expect(await html()).toContain('Verificação em duas etapas');
    const repetido = await verificarTotpAcao(ESTADO_INICIAL_ADMIN, form({ codigo: codigoAgora(segredo) }));
    expect(repetido.mensagem).toBe(MENSAGENS_ADMIN.codigo);
    // Mesmo com o código de um passo posterior: aceito.
    const proximo = codigoDoPasso(segredo, passoDe(new Date()) + 1);
    expect(await destinoDe(verificarTotpAcao(ESTADO_INICIAL_ADMIN, form({ codigo: proximo })))).toBe('/admin');
  }, 30_000);

  it('limite de falhas do TOTP e sessão expirada redirecionam com o aviso', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const admin = await criarAdmin('ativo');
    await destinoDe(entrarAdminAcao(ESTADO_INICIAL_ADMIN, form({ email: admin.email, senha: SENHA_DE_TESTE })));
    for (let i = 0; i < 5; i += 1) {
      expect((await verificarTotpAcao(ESTADO_INICIAL_ADMIN, form({ codigo: '000000' }))).mensagem).toBe(MENSAGENS_ADMIN.codigo);
    }
    expect((await verificarTotpAcao(ESTADO_INICIAL_ADMIN, form({ codigo: codigoAgora(admin.segredo!) }))).mensagem).toBe(MENSAGENS_ADMIN.limite);

    // Sem cookie ou com pré-sessão revogada: apaga o cookie e volta ao login com aviso.
    jar.admin = undefined;
    expect(await destinoDe(verificarTotpAcao(ESTADO_INICIAL_ADMIN, form({ codigo: '123456' })))).toBe('/admin/entrar?aviso=expirou');
    expect(await html({ aviso: 'expirou' })).toContain('Sua verificação expirou');
  });

  it('cadastro concluído por outra aba: a página volta a pedir só o código; token inválido mostra a senha', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const admin = await criarAdmin('nenhum');
    await destinoDe(entrarAdminAcao(ESTADO_INICIAL_ADMIN, form({ email: admin.email, senha: SENHA_DE_TESTE })));
    await html();
    const u = await obterPrisma().usuario.findUniqueOrThrow({ where: { id: admin.id } });
    const segredo = decifrarSegredo(u.totpSegredoCifrado!, admin.id, CHAVE);
    const outraAba = jar.admin!;
    await destinoDe(cadastrarTotpAcao(ESTADO_INICIAL_ADMIN, form({ codigo: codigoAgora(segredo) })));
    // A pré-sessão da outra aba, agora de um usuário já ativado, tenta o cadastro de novo.
    jar.admin = outraAba;
    expect(await destinoDe(cadastrarTotpAcao(ESTADO_INICIAL_ADMIN, form({ codigo: codigoAgora(segredo, 1) })))).toBe('/admin/entrar?aviso=expirou');
    jar.admin = 'token-que-nao-existe';
    expect(await html()).toContain('Entrar na administração');
  });
});

describe('/admin para quem não é admin (CA-4)', () => {
  it('gestor e profissional veem "Acesso negado" sem dados; sem cookie → redirect', async () => {
    const s = await criarSalaoCompleto();
    expect(await destinoDe(PaginaAdmin())).toBe('/admin/entrar');
    for (const usuarioId of [s.gestor.usuarioId, s.profissional.usuarioId]) {
      jar.salao = (await criarSessao(usuarioId)).token;
      const tela = renderToStaticMarkup((await PaginaAdmin()) as ReactElement);
      expect(tela).toContain('Acesso negado');
      expect(tela).not.toContain('Olá,');
    }
  });
});
