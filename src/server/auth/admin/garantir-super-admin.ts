import { z } from 'zod';

import { inserirSuperAdmin, papelDoEmail } from '@/server/repos/admin';

import { gerarHashSenha } from '../senha';

// Criação idempotente do super admin (D-034 RN-1, RN-2). Único caminho de criação: nenhuma rota ou
// ação pública chega aqui (o script `superadmin:criar` e, depois, o seed da E9.2 a chamam).

export const SENHA_ADMIN_MIN = 12;
export const SENHA_ADMIN_MAX = 1024;
export const NOME_PADRAO_ADMIN = 'Administração';

/** Entrada inválida. A mensagem cita só o campo, nunca o valor (a senha não pode vazar). */
export class ErroSuperAdminInvalido extends Error {
  readonly campo: 'email' | 'senha';
  constructor(campo: 'email' | 'senha') {
    super(campo === 'email' ? 'SUPERADMIN_EMAIL inválido' : `SUPERADMIN_PASSWORD deve ter de ${SENHA_ADMIN_MIN} a ${SENHA_ADMIN_MAX} caracteres`);
    this.name = 'ErroSuperAdminInvalido';
    this.campo = campo;
  }
}

/** O e-mail já pertence a uma conta que não é super admin: nada é alterado. */
export class ErroContaNaoAdmin extends Error {
  constructor() {
    super('o e-mail informado já pertence a uma conta que não é de super admin');
    this.name = 'ErroContaNaoAdmin';
  }
}

const esquemaEmail = z.string().trim().toLowerCase().max(254).pipe(z.email());

export type DepsGarantir = {
  agora?: Date;
  gerarHash?: (senha: string) => Promise<string>;
};

/**
 * Cria o super admin se o e-mail estiver livre. Já super admin → 'existente' sem tocar em senha ou
 * TOTP (rodar de novo nunca "reseta"). Outro papel → ErroContaNaoAdmin. Corrida entre execuções:
 * `ON CONFLICT DO NOTHING` deixa uma só conta; as demais veem 'existente'.
 */
export async function garantirSuperAdmin(
  entrada: { email: unknown; senha: unknown },
  deps: DepsGarantir = {},
): Promise<'criado' | 'existente'> {
  const email = esquemaEmail.safeParse(entrada.email);
  if (!email.success) {
    throw new ErroSuperAdminInvalido('email');
  }
  const { senha } = entrada;
  if (typeof senha !== 'string' || senha.length < SENHA_ADMIN_MIN || senha.length > SENHA_ADMIN_MAX) {
    throw new ErroSuperAdminInvalido('senha');
  }

  // Hash fora de qualquer transação (custo do argon2).
  const senhaHash = await (deps.gerarHash ?? gerarHashSenha)(senha);
  const id = await inserirSuperAdmin({
    email: email.data,
    nome: NOME_PADRAO_ADMIN,
    senhaHash,
    agora: deps.agora ?? new Date(),
  });
  if (id !== null) {
    return 'criado';
  }
  const papel = await papelDoEmail(email.data);
  if (papel === 'super_admin') {
    return 'existente';
  }
  throw new ErroContaNaoAdmin();
}
