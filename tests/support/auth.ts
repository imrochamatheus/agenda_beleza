import { randomBytes } from 'node:crypto';

import { obterPrisma } from '@/server/repos/db';
import { hashDoToken } from '@/server/tenant/sessao';
import type { Credencial } from '@/server/tenant/sessao';

import type { SalaoCompleto } from './factories';
import { emailNovo } from './sql';

// Autenticação de teste (D-005 §3.7): usuário + sessão REAIS na tabela `sessao`, gravadas com o hash de
// produção (`hashDoToken`). Devolve a credencial (token em claro, como viria do cookie) que o núcleo de
// `defineAcao` e `resolverTenant`/`resolverAdmin` aceitam. Login e renovação são da E1.2.

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

/** Super admin (sem salão) com sessão; `totpVerificado` preenche `totp_verificado_em` da sessão. */
export async function criarSuperAdmin(
  o: { totpVerificado?: boolean } = {},
): Promise<{ usuarioId: string; credencial: Credencial }> {
  const usuario = await obterPrisma().usuario.create({
    data: {
      salaoId: null,
      papel: 'super_admin',
      email: emailNovo(),
      nome: 'Super admin de teste',
      senhaHash: 'hash-de-teste-sem-uso',
      emailConfirmadoEm: new Date(),
      totpSegredoCifrado: 'segredo-cifrado-ficticio',
      totpAtivadoEm: new Date(),
    },
    select: { id: true },
  });
  const { credencial } = await criarSessao(usuario.id, {
    totpVerificadoEm: o.totpVerificado ? new Date() : null,
  });
  return { usuarioId: usuario.id, credencial };
}
