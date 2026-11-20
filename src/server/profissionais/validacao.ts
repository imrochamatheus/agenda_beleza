import { z } from 'zod';

import { normalizarNome } from '@/lib/texto';
import { esquemaEmail } from '@/server/auth/confirmacao-email';

import { MENSAGENS_PROFISSIONAL } from './tipos';
import type { ErrosProfissional } from './tipos';

// Validação dos dados do profissional (D-013 RN-9, §3.3). Pura: sem banco. Toda validação acontece
// no servidor; a do navegador é só conveniência.

export const LIMITES_PROFISSIONAL = Object.freeze({
  nome: Object.freeze({ min: 2, max: 100 }),
  email: Object.freeze({ max: 254 }),
});

export type DadosProfissional = { nome: string; email: string | null };

/** Só `nome` e `email` (opcional); qualquer outro campo, ou um valor que não é objeto, é recusado. */
const esquemaEntrada = z.strictObject({ nome: z.unknown(), email: z.unknown().optional() });

/** Ausente, null, '' ou só espaços → null (sem e-mail). */
function ehEmailVazio(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

/**
 * E-mail opcional normalizado: vazio → null; senão `esquemaEmail` (trim, minúsculas, até 254
 * caracteres, formato). `undefined` = inválido.
 */
export function normalizarEmailOpcional(v: unknown): string | null | undefined {
  if (ehEmailVazio(v)) {
    return null;
  }
  const r = esquemaEmail.safeParse(v);
  return r.success ? r.data : undefined;
}

/** RN-9. Todos os erros juntos. */
export function validarDadosProfissional(
  e: unknown,
): { ok: true; dados: DadosProfissional } | { ok: false; erros: ErrosProfissional } {
  const entrada = esquemaEntrada.safeParse(e);
  if (!entrada.success) {
    return { ok: false, erros: { formulario: MENSAGENS_PROFISSIONAL.formulario } };
  }
  const erros: ErrosProfissional = {};
  const nome = normalizarNome(entrada.data.nome, LIMITES_PROFISSIONAL.nome);
  if (nome === null) erros.nome = MENSAGENS_PROFISSIONAL.nome;
  const email = normalizarEmailOpcional(entrada.data.email);
  if (email === undefined) erros.email = MENSAGENS_PROFISSIONAL.email;
  if (nome === null || email === undefined) {
    return { ok: false, erros };
  }
  return { ok: true, dados: { nome, email } };
}
