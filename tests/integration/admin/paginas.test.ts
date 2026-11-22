import { randomUUID } from 'node:crypto';

import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import PaginaDeAuditoria from '@/app/admin/auditoria/page';
import PaginaDeMensagens from '@/app/admin/mensagens/page';
import { reenviarAcao } from '@/app/admin/mensagens/acoes';
import PaginaDeAssinatura from '@/app/admin/saloes/[id]/assinatura/page';
import PaginaDoSalao from '@/app/admin/saloes/[id]/page';

import { adminDeTeste, salaoComAssinatura } from '../../support/admin-saloes';
import type { AdminDeTeste } from '../../support/admin-saloes';
import { contarAuditoria } from '../../support/auditoria';
import { credencialDoGestor, credencialDoProfissional } from '../../support/auth';
import { anonimizarCliente, criarCenarioMensagem, criarMensagem, lerMensagem } from '../../support/mensagens';
import { conectar } from '../../support/sql';

// D-045 CA-5, CA-6, CA-7, CA-8, CA-13, CA-14 no servidor: páginas e casca REAIS sobre o PostgreSQL. Só next/headers,
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
  usePathname: () => '/admin/mensagens',
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
  await c?.end();
});
beforeEach(() => {
  jar.admin = undefined;
  jar.salao = undefined;
});

const destinoDe = async (p: Promise<unknown>) => ((await p.catch((e: unknown) => e)) as Redirecionado).destino;
const html = async (p: Promise<unknown>) => renderToStaticMarkup((await p) as ReactElement);
const mensagens = (q: Record<string, string> = {}) => PaginaDeMensagens({ searchParams: Promise.resolve(q) });
const auditoria = (q: Record<string, string> = {}) => PaginaDeAuditoria({ searchParams: Promise.resolve(q) });
const assinatura = (id: string) => PaginaDeAssinatura({ params: Promise.resolve({ id }) });
const form = (campos: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
};

describe('CA-6: acesso às três páginas', () => {
  it('sem sessão: redireciona para /admin/entrar; gestor e profissional: "Acesso negado" sem dados', async () => {
    const s = await salaoComAssinatura('ativa');
    for (const p of [() => mensagens(), () => auditoria(), () => assinatura(s.salaoId)]) expect(await destinoDe(p())).toBe('/admin/entrar');
    for (const cred of [await credencialDoGestor(s), await credencialDoProfissional(s)]) {
      jar.salao = cred!.token;
      for (const pagina of [mensagens(), auditoria(), assinatura(s.salaoId)]) {
        const marcacao = await html(pagina);
        expect(marcacao).toContain('Acesso negado');
        expect(marcacao).not.toContain(s.nome);
      }
    }
  });
});

describe('CA-5 e CA-8: o HTML da fila', () => {
  it('telefone mascarado, cliente removida sem dígito, nada de parâmetros, link, provedor ou nome da cliente', async () => {
    const a = await criarCenarioMensagem({ salaoNome: 'Salão Página Um' });
    const b = await criarCenarioMensagem({ salaoNome: 'Salão Página Dois' });
    const idA = await criarMensagem({ salaoId: a.salaoId, reservaId: a.reservaId, estado: 'falhou', erroCodigo: 'resultado_incerto', destinatarioE164: a.telefone, provedorMensagemId: 'wamid.SEGREDO999' });
    await c.query(`UPDATE mensagem SET parametros = '{"link":"https://x.test/avaliar/TOKENSECRETO"}'::jsonb WHERE id = $1`, [idA]);
    await criarMensagem({ salaoId: b.salaoId, reservaId: b.reservaId, estado: 'enviada', destinatarioE164: b.telefone });
    await anonimizarCliente(b.clienteId);
    jar.admin = adm.cred.admin!.token;
    const h = await html(mensagens());
    expect(h).toContain('Salão Página Um');
    expect(h).toContain('Cliente removida');
    expect(h).toContain(`+55 (${a.telefone.slice(3, 5)}) `);
    for (const proibido of [a.telefone, a.telefone.slice(3), b.telefone, a.clienteNome, b.clienteNome, 'SEGREDO999', 'TOKENSECRETO', 'wamid', 'parametros', 'erro_detalhe', a.reservaId]) {
      expect(h, `HTML contém ${proibido}`).not.toContain(proibido);
    }
    const detalhe = await html(mensagens({ detalhe: idA }));
    for (const proibido of [a.telefone, 'SEGREDO999', 'TOKENSECRETO', a.clienteNome]) expect(detalhe).not.toContain(proibido);
    expect(detalhe).toContain('Nenhuma tentativa registrada');
    const conf = await html(mensagens({ confirmar: idA }));
    expect(conf).toContain('Reenviar esta mensagem?');
    expect(conf).not.toContain(a.telefone);
  });

  it('?detalhe malformado ou inexistente: 404; ?confirmar inválido: aviso, sem botão; ?reenvio fora da lista: sem alerta', async () => {
    jar.admin = adm.cred.admin!.token;
    await expect(mensagens({ detalhe: 'nao-uuid' })).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(mensagens({ detalhe: randomUUID() })).rejects.toThrow('NEXT_NOT_FOUND');
    const h = await html(mensagens({ confirmar: randomUUID(), reenvio: '<b>x</b>' }));
    expect(h).toContain('Esta mensagem não está mais com falha.');
    expect(h).not.toContain('Confirmar reenvio');
    expect(h).not.toContain('<b>x</b>');
  });

  it('filtros inválidos: aviso e lista inteira, sem 500', async () => {
    jar.admin = adm.cred.admin!.token;
    const h = await html(mensagens({ estado: 'xyz', salao: "'; DROP TABLE mensagem; --" }));
    expect(h).toContain('Filtro inválido ignorado.');
  });
});

describe('CA-14: casca do reenvio (PRG)', () => {
  it('sem sessão: /admin/entrar e nada muda; admin: PRG com código fechado e filtros validados', async () => {
    const s = await criarCenarioMensagem();
    const id = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, estado: 'falhou', destinatarioE164: s.telefone });
    expect(await destinoDe(reenviarAcao(form({ mensagemId: id })))).toBe('/admin/entrar');
    expect((await lerMensagem(id)).estado).toBe('falhou');

    jar.admin = adm.cred.admin!.token;
    const logs = vi.spyOn(console, 'error').mockImplementation(() => {});
    const destino = await destinoDe(reenviarAcao(form({ mensagemId: id, estado: 'falhou', tipo: 'xyz', salao: 'lixo', pagina: '2' })));
    logs.mockRestore();
    expect(destino).toMatch(/^\/admin\/mensagens\?estado=falhou&pagina=2&reenvio=(ok|ok_fila)$/);
    expect((await lerMensagem(id)).estado).toBe('pendente');
    expect(revalidar).toHaveBeenCalledWith('/admin/mensagens');
    // O segundo POST (duplo clique ou recarregar) cai em "recusada" e não duplica a auditoria.
    const n = await contarAuditoria(c);
    expect(await destinoDe(reenviarAcao(form({ mensagemId: id })))).toBe('/admin/mensagens?reenvio=recusada');
    expect(await contarAuditoria(c)).toBe(n);
  });

  it('403 (gestor): volta para a tela sem código e não toca a mensagem; id inexistente: ?reenvio=inexistente', async () => {
    const s = await criarCenarioMensagem();
    const id = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, estado: 'falhou', destinatarioE164: s.telefone });
    const dono = await salaoComAssinatura('ativa');
    jar.salao = (await credencialDoGestor(dono))!.token;
    expect(await destinoDe(reenviarAcao(form({ mensagemId: id })))).toBe('/admin/mensagens');
    expect((await lerMensagem(id)).estado).toBe('falhou');
    jar.salao = undefined;
    jar.admin = adm.cred.admin!.token;
    expect(await destinoDe(reenviarAcao(form({ mensagemId: randomUUID() })))).toBe('/admin/mensagens?reenvio=inexistente');
    expect(await destinoDe(reenviarAcao(form({})))).toBe('/admin/mensagens?reenvio=inexistente');
  });
});

describe('auditoria e assinatura: páginas', () => {
  it('auditoria: renderiza a lista e o diff; ler não audita (CA-7)', async () => {
    jar.admin = adm.cred.admin!.token;
    const s = await criarCenarioMensagem();
    const id = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, estado: 'falhou', destinatarioE164: s.telefone });
    jar.admin = adm.cred.admin!.token;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await destinoDe(reenviarAcao(form({ mensagemId: id })));
    vi.restoreAllMocks();
    const n = await contarAuditoria(c);
    const h = await html(auditoria({ salao: s.salaoId }));
    expect(h).toContain('Mensagem reenviada');
    expect(h).toContain('Ver alterações (');
    expect(h).toContain(s.salaoNome);
    expect(h).not.toContain(s.telefone);
    await html(auditoria({ acao: 'mensagem.reenviar', de: '2020-01-01', pagina: '2' }));
    expect(await contarAuditoria(c)).toBe(n);
  });

  it('assinatura: salão sem assinatura mostra o vazio; id ruim é 404', async () => {
    jar.admin = adm.cred.admin!.token;
    const s = await salaoComAssinatura(null);
    const h = await html(assinatura(s.salaoId));
    expect(h).toContain('Este salão ainda não tem assinatura');
    expect(h).toContain('Auditoria deste salão');
    const com = await salaoComAssinatura('ativa');
    expect(await html(assinatura(com.salaoId))).toContain('Resumo');
    for (const id of ['nao-uuid', randomUUID()]) await expect(assinatura(id)).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('o detalhe do salão (D-044) ganhou os links "Assinatura e eventos" e "Auditoria deste salão"', async () => {
    jar.admin = adm.cred.admin!.token;
    const s = await salaoComAssinatura('em_teste');
    const h = await html(PaginaDoSalao({ params: Promise.resolve({ id: s.salaoId }) }));
    expect(h).toContain(`/admin/saloes/${s.salaoId}/assinatura`);
    expect(h).toContain(`/admin/auditoria?salao=${s.salaoId}`);
    expect(h).toContain('Assinatura e eventos');
  });
});
