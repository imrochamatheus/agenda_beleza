import { randomBytes } from 'node:crypto';

import { entrar } from '@/server/auth/login';
import { obterPrisma } from '@/server/repos/db';
import { hashDoToken } from '@/server/tenant/sessao';
import type { Credencial } from '@/server/tenant/sessao';

import { SENHA_DE_TESTE, hashDaSenhaDeTeste } from './factories';
import type { SalaoCompleto } from './factories';
import { emailNovo } from './sql';

// Autenticação de teste (D-005 §3.7): usuário + sessão REAIS na tabela `sessao`, gravadas com o hash de
// produção (`hashDoToken`). Devolve a credencial (token em claro, como viria do cookie) que o núcleo de
// `defineAcao` e `resolverTenant`/`resolverAdmin` aceitam. `criarSessao` forja sessões (expiradas,
// revogadas, com TOTP); o login real (D-010) é `entrarDeVerdade`.

const HORA_MS = 60 * 60 * 1000;

export type OpcoesSessao = {
  /** Padrão: agora + 1 h. */
  expiraEm?: Date;
  revogadaEm?: Date | null;
  totpVerificadoEm?: Date | null;
};

export async function criarSessao(
  usuarioId: string,
  o: OpcoesSessao = {},
): Promise<{ token: string; credencial: Credencial; sessaoId: string }> {
  const token = randomBytes(32).toString('base64url');
  const sessao = await obterPrisma().sessao.create({
    data: {
      usuarioId,
      tokenHash: hashDoToken(token),
      expiraEm: o.expiraEm ?? new Date(Date.now() + HORA_MS),
      revogadaEm: o.revogadaEm ?? null,
      totpVerificadoEm: o.totpVerificadoEm ?? null,
    },
    select: { id: true },
  });
  return { token, credencial: { token }, sessaoId: sessao.id };
}

export async function credencialDoGestor(s: SalaoCompleto, o?: OpcoesSessao): Promise<Credencial> {
  return (await criarSessao(s.gestor.usuarioId, o)).credencial;
}

export async function credencialDoProfissional(s: SalaoCompleto, o?: OpcoesSessao): Promise<Credencial> {
  return (await criarSessao(s.profissional.usuarioId, o)).credencial;
}

/**
 * Super admin (sem salão) com sessão; `totpVerificado` preenche `totp_verificado_em` da sessão.
 * Senha SENHA_DE_TESTE (hash argon2id real), para provar que /entrar o recusa (D-010 RN-25).
 */
export async function criarSuperAdmin(
  o: { totpVerificado?: boolean } = {},
): Promise<{ usuarioId: string; email: string; credencial: Credencial }> {
  const email = emailNovo();
  const usuario = await obterPrisma().usuario.create({
    data: {
      salaoId: null,
      papel: 'super_admin',
      email,
      nome: 'Super admin de teste',
      senhaHash: await hashDaSenhaDeTeste(),
      emailConfirmadoEm: new Date(),
      totpSegredoCifrado: 'segredo-cifrado-ficticio',
      totpAtivadoEm: new Date(),
    },
    select: { id: true },
  });
  const { credencial } = await criarSessao(usuario.id, {
    totpVerificadoEm: o.totpVerificado ? new Date() : null,
  });
  return { usuarioId: usuario.id, email, credencial };
}

/**
 * Login REAL (D-010): chama o serviço `entrar` com e-mail e senha (padrão SENHA_DE_TESTE) e devolve o
 * token que iria no cookie. Lança se o login não for aceito. O log do login é descartado.
 */
export async function entrarDeVerdade(
  email: string,
  o: { senha?: string; agora?: Date } = {},
): Promise<{ token: string; credencial: Credencial }> {
  const r = await entrar(
    { email, senha: o.senha ?? SENHA_DE_TESTE },
    { ...(o.agora ? { agora: o.agora } : {}), log: () => {} },
  );
  if (!r.ok) {
    throw new Error(`login de teste recusado: ${r.motivo === 'recusado' ? r.mensagem : 'validação'}`);
  }
  return { token: r.token, credencial: { token: r.token } };
}
