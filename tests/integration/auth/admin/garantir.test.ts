import { spawnSync } from 'node:child_process';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ErroContaNaoAdmin,
  ErroSuperAdminInvalido,
  garantirSuperAdmin,
} from '@/server/auth/admin/garantir-super-admin';
import { verificarSenha } from '@/server/auth/senha';
import { obterPrisma } from '@/server/repos/db';

import { criarSalaoCompleto } from '../../../support/factories';
import type { SalaoCompleto } from '../../../support/factories';
import { emailNovo } from '../../../support/sql';

import { RAIZ, empacotarScript } from './apoio';

// D-034 CA-1: criação idempotente do super admin (serviço e script).
const SENHA = 'Senha-longa-12345';
let s: SalaoCompleto;
let pacote: ReturnType<typeof empacotarScript>;

beforeAll(async () => {
  s = await criarSalaoCompleto();
  pacote = empacotarScript();
}, 60_000);
afterAll(() => pacote.limpar());

const linhas = (email: string) => obterPrisma().usuario.findMany({ where: { email } });

describe('garantirSuperAdmin', () => {
  it('cria a conta (papel super_admin, sem salão, hash argon2id, e-mail confirmado) e na 2ª vez não altera nada', async () => {
    const email = emailNovo();
    expect(await garantirSuperAdmin({ email: `  ${email.toUpperCase()} `, senha: SENHA })).toBe('criado');
    const [antes] = await linhas(email);
    expect(antes).toMatchObject({ papel: 'super_admin', salaoId: null, totpSegredoCifrado: null, totpAtivadoEm: null });
    expect(antes.senhaHash).toMatch(/^\$argon2id\$/);
    expect(antes.emailConfirmadoEm).not.toBeNull();
    expect(await verificarSenha(antes.senhaHash, SENHA)).toBe(true);

    // 2ª execução, com OUTRA senha: não reseta senha nem TOTP.
    expect(await garantirSuperAdmin({ email, senha: 'Outra-senha-12345' })).toBe('existente');
    const depois = await linhas(email);
    expect(depois).toHaveLength(1);
    expect(depois[0].senhaHash).toBe(antes.senhaHash);
    expect(depois[0].atualizadoEm).toEqual(antes.atualizadoEm);
  });

  it('10 execuções em paralelo criam uma só conta (1 criado, 9 existente)', async () => {
    const email = emailNovo();
    const r = await Promise.all(Array.from({ length: 10 }, () => garantirSuperAdmin({ email, senha: SENHA })));
    expect(r.filter((x) => x === 'criado')).toHaveLength(1);
    expect(r.filter((x) => x === 'existente')).toHaveLength(9);
    expect(await linhas(email)).toHaveLength(1);
  }, 60_000);

  it('e-mail de gestor existente: erro e nada alterado (papel, senha e salão)', async () => {
    const antes = await obterPrisma().usuario.findUniqueOrThrow({ where: { id: s.gestor.usuarioId } });
    await expect(garantirSuperAdmin({ email: antes.email, senha: SENHA })).rejects.toBeInstanceOf(ErroContaNaoAdmin);
    const depois = await obterPrisma().usuario.findUniqueOrThrow({ where: { id: s.gestor.usuarioId } });
    expect(depois).toEqual(antes);
  });

  it('valida e-mail e senha sem citar valores', async () => {
    for (const email of ['', 'sem-arroba', undefined, 42]) {
      await expect(garantirSuperAdmin({ email, senha: SENHA })).rejects.toMatchObject({ campo: 'email' });
    }
    for (const senha of ['', 'curta-demais1'.slice(0, 11), 'x'.repeat(1025), undefined, 12345678901234]) {
      const e = await garantirSuperAdmin({ email: emailNovo(), senha }).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(ErroSuperAdminInvalido);
      expect(String((e as Error).message)).not.toContain('curta-demais1'.slice(0, 11));
      expect((e as ErroSuperAdminInvalido).campo).toBe('senha');
    }
  });
});

describe('npm run superadmin:criar (script em processo filho)', () => {
  function rodar(env: Record<string, string>) {
    return spawnSync(process.execPath, [pacote.arquivo], {
      cwd: RAIZ,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, DATABASE_URL: process.env.DATABASE_URL, ...env } as unknown as NodeJS.ProcessEnv,
    });
  }

  it('sai com 0 nas duas execuções, imprime criado/existente e nunca a senha', () => {
    const env = { SUPERADMIN_EMAIL: emailNovo(), SUPERADMIN_PASSWORD: SENHA };
    const a = rodar(env);
    const b = rodar(env);
    expect([a.status, a.stdout.trim()]).toEqual([0, 'criado']);
    expect([b.status, b.stdout.trim()]).toEqual([0, 'existente']);
    for (const r of [a, b]) {
      expect(r.stdout + r.stderr).not.toContain(SENHA);
    }
  }, 60_000);

  it('sai com 1, sem vazar a senha, com e-mail de gestor ou senha curta', () => {
    const gestor = rodar({ SUPERADMIN_EMAIL: 'gestor.inexistente@exemplo.test', SUPERADMIN_PASSWORD: 'curta' });
    expect(gestor.status).toBe(1);
    expect(gestor.stderr).toContain('SUPERADMIN_PASSWORD');
    expect(gestor.stderr).not.toContain('curta');
    const semBanco = spawnSync(process.execPath, [pacote.arquivo], {
      cwd: RAIZ,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, SUPERADMIN_EMAIL: emailNovo(), SUPERADMIN_PASSWORD: SENHA } as unknown as NodeJS.ProcessEnv,
    });
    expect(semBanco.status).toBe(1);
    expect(semBanco.stdout + semBanco.stderr).not.toContain(SENHA);
  }, 60_000);
});
