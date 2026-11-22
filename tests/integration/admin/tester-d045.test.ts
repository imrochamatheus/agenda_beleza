import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import PaginaDeAuditoria from '@/app/admin/auditoria/page';
import PaginaDeMensagens from '@/app/admin/mensagens/page';
import { reenviarMensagemAdmin } from '@/server/admin/mensagens';

import { adminDeTeste } from '../../support/admin-saloes';
import type { AdminDeTeste } from '../../support/admin-saloes';
import { contarAuditoria } from '../../support/auditoria';
import { criarSuperAdmin } from '../../support/auth';
import { criarCenarioMensagem, criarMensagem, lerMensagem } from '../../support/mensagens';
import { conectar } from '../../support/sql';

// Testes do tester (D-045): gatilho de banco na auditoria, admin sem TOTP nas páginas, XSS na auditoria.
const jar = vi.hoisted(() => ({ admin: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (n: string) => (n === 'ab_admin' && jar.admin ? { name: n, value: jar.admin } : undefined) }),
  headers: async () => ({ get: () => null }),
}));
vi.mock('next/navigation', () => ({
  redirect: (d: string) => { throw new Error('NEXT_REDIRECT ' + d); },
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
  usePathname: () => '/admin/mensagens',
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let c: pg.Client;
let adm: AdminDeTeste;
beforeAll(async () => { c = await conectar(); adm = await adminDeTeste(); });
afterAll(async () => { await c?.end(); });

describe('tester', () => {
  it('gatilho de banco que rejeita a auditoria reverte a volta a pendente', async () => {
    const s = await criarCenarioMensagem({});
    const id = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, estado: 'falhou', erroCodigo: 'resultado_incerto', destinatarioE164: s.telefone });
    await c.query(`CREATE FUNCTION t_rej() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.acao = 'mensagem.reenviar' THEN RAISE EXCEPTION 'rejeitada'; END IF; RETURN NEW; END $$`);
    await c.query(`CREATE TRIGGER t_rej BEFORE INSERT ON auditoria FOR EACH ROW EXECUTE FUNCTION t_rej()`);
    const jobs: unknown[] = [];
    const antes = await contarAuditoria(c);
    try {
      await expect(reenviarMensagemAdmin(adm.ctx, id, new Date(), { enfileirar: async (...a: unknown[]) => { jobs.push(a); return null as never; } })).rejects.toThrow();
    } finally {
      await c.query('DROP TRIGGER t_rej ON auditoria'); await c.query('DROP FUNCTION t_rej()');
    }
    expect((await lerMensagem(id)).estado).toBe('falhou');
    expect(jobs).toHaveLength(0);
    expect(await contarAuditoria(c)).toBe(antes);
  });

  it('admin sem TOTP: as páginas não mostram dados (nem redirecionam para dados)', async () => {
    const semTotp = await criarSuperAdmin({ totpVerificado: false });
    jar.admin = semTotp.credencial.admin?.token ?? semTotp.credencial.salao?.token;
    for (const p of [PaginaDeMensagens({ searchParams: Promise.resolve({}) }), PaginaDeAuditoria({ searchParams: Promise.resolve({}) })]) {
      const r = await Promise.resolve(p).then((e) => renderToStaticMarkup(e as ReactElement), (e: Error) => e.message);
      expect(r).toMatch(/Acesso negado|NEXT_REDIRECT/);
      expect(r).not.toContain('Fila de mensagens');
      expect(r).not.toContain('Registros de auditoria');
    }
    jar.admin = undefined;
  });

  it('XSS em antes/depois e e-mail do ator é texto', async () => {
    await c.query(`INSERT INTO auditoria (id, ator_id, ator_email_informado, acao, entidade, entidade_id, resultado, antes, depois, ocorrido_em)
      VALUES (gen_random_uuid(), NULL, '<img src=x onerror=alert(1)>@x.com', 'login.falha', 'usuario', gen_random_uuid(), 'falha', '{"nome":"<script>alert(1)</script>"}'::jsonb, '{"x":"\"><svg onload=1>"}'::jsonb, now())`).catch(async () => {
      await c.query(`INSERT INTO auditoria (ator_email_informado, acao, entidade, resultado, antes, depois) VALUES ('<img src=x onerror=alert(1)>@x.com','login.falha','usuario','falha','{"nome":"<script>alert(1)</script>"}'::jsonb,'{"x":"\\"><svg onload=1>"}'::jsonb)`);
    });
    jar.admin = adm.cred.admin!.token;
    const h = renderToStaticMarkup((await PaginaDeAuditoria({ searchParams: Promise.resolve({}) })) as ReactElement);
    expect(h).toContain('&lt;script&gt;alert');
    expect(h).not.toContain('<script>alert');
    expect(h).not.toContain('<img src=x');
    expect(h).not.toContain('<svg onload');
  });
});
