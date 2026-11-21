import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { codigoDoPasso, gerarSegredo, passoDe } from '@/server/auth/admin/totp';
import { cifrarSegredo } from '@/server/auth/admin/cifra';
import { obterPrisma } from '@/server/repos/db';

import { SENHA_DE_TESTE, hashDaSenhaDeTeste } from '../../../support/factories';
import { emailNovo } from '../../../support/sql';

// Apoio dos testes do super admin (D-034): chave fixa por arquivo, conta com TOTP ativo ou pendente,
// código TOTP do instante e empacotamento do script `superadmin:criar` para processo filho.

export const CHAVE = randomBytes(32);
export const SENHA_ADMIN = 'Senha-do-admin-123';
export const RAIZ = join(import.meta.dirname, '..', '..', '..', '..');

export type AdminDeTeste = { id: string; email: string; segredo: string | null };

/** Super admin com senha SENHA_ADMIN. `totp`: 'ativo' (segredo cifrado + ativado), 'pendente' (só segredo) ou 'nenhum'. */
export async function criarAdmin(totp: 'ativo' | 'pendente' | 'nenhum', agora = new Date()): Promise<AdminDeTeste> {
  const email = emailNovo();
  const u = await obterPrisma().usuario.create({
    data: {
      salaoId: null,
      papel: 'super_admin',
      email,
      nome: 'Admin de teste',
      senhaHash: await hashDaSenhaDeTeste(),
      emailConfirmadoEm: agora,
    },
    select: { id: true },
  });
  let segredo: string | null = null;
  if (totp !== 'nenhum') {
    segredo = gerarSegredo();
    await obterPrisma().usuario.update({
      where: { id: u.id },
      data: {
        totpSegredoCifrado: cifrarSegredo(segredo, u.id, CHAVE),
        totpAtivadoEm: totp === 'ativo' ? agora : null,
      },
    });
  }
  return { id: u.id, email, segredo };
}

export { SENHA_DE_TESTE };

/** Código do passo `passoDe(agora) + delta`. */
export function codigoEm(segredo: string, agora: Date, delta = 0): string {
  return codigoDoPasso(segredo, passoDe(agora) + delta);
}

/** Empacota o script superadmin-criar com os mesmos argumentos do `build:node` (sem shell: caminho com espaço). */
export function empacotarScript(): { arquivo: string; limpar(): void } {
  const pacote = JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
  const [binario, ...args] = pacote.scripts['build:node'].split(/\s+/);
  if (binario !== 'esbuild') throw new Error('build:node mudou de forma: atualize apoio.ts');
  const pasta = join(RAIZ, 'node_modules', '.cache', 'agenda-beleza', `admin-${process.env.VITEST_POOL_ID}-${process.pid}`);
  const r = spawnSync(
    join(RAIZ, 'node_modules', '.bin', 'esbuild'),
    [...args.map((a) => (a === '--outdir=dist' ? `--outdir=${pasta}` : a)), '--out-extension:.js=.mjs', '--log-level=warning'],
    { cwd: RAIZ, encoding: 'utf8' },
  );
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`esbuild falhou: ${r.stderr}`);
  return { arquivo: join(pasta, 'scripts', 'superadmin-criar.mjs'), limpar: () => rmSync(pasta, { recursive: true, force: true }) };
}

/** Login real (etapas 1 e 2) no instante `agora`: devolve o admin e o token da sessão admin. */
export async function abrirSessaoAdmin(agora: Date): Promise<{ admin: AdminDeTeste; token: string }> {
  const { entrarAdmin, verificarTotpAdmin } = await import('@/server/auth/admin/login-admin');
  const admin = await criarAdmin('ativo', agora);
  const e1 = await entrarAdmin({ email: admin.email, senha: SENHA_DE_TESTE }, { agora, chave: CHAVE, log: () => {} });
  if (!e1.ok) throw new Error('etapa 1 falhou');
  const e2 = await verificarTotpAdmin(e1.token, codigoEm(admin.segredo!, agora), { agora, chave: CHAVE, log: () => {} });
  if (!e2.ok) throw new Error('etapa 2 falhou');
  return { admin, token: e2.token };
}
