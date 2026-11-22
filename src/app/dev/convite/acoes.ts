'use server';

import type { EstadoConvite } from '@/app/(publico)/convite/[token]/estado';
import { MENSAGENS_CONVITE, validarSenhaDoConvite } from '@/server/auth/convite';
import { vitrineHabilitada } from '@/server/env';

// Ação de demonstração de /dev/convite (D-039): só a validação PURA da senha, sem banco, sessão nem
// repositório; nada é gravado. Desligada a vitrine, devolve o estado anterior sem processar.
export async function demonstrarConviteAcao(anterior: EstadoConvite, fd: FormData): Promise<EstadoConvite> {
  if (!vitrineHabilitada(process.env)) return anterior;
  const senha = fd.get('senha');
  const v = validarSenhaDoConvite(typeof senha === 'string' ? senha : undefined);
  if (!v.ok) return { status: 'formulario', mensagem: null, erroSenha: v.erro };
  return { status: 'sucesso', mensagem: MENSAGENS_CONVITE.sucesso, erroSenha: null };
}
