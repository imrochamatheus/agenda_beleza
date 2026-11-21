'use server';

import { redirect } from 'next/navigation';

import { PARAMETRO_DENUNCIA, VALOR_DENUNCIA_RECEBIDA } from '@/config/denuncia';
import { ROTAS } from '@/config/navegacao';
import { MENSAGENS_DENUNCIA } from '@/server/denuncias/tipos';
import { validarDenuncia } from '@/server/denuncias/validacao';
import { vitrineHabilitada } from '@/server/env';
import { TOKEN_TURNSTILE_SIMULADO } from '@/server/integrations/turnstile/port';
import { lerFormularioDenuncia } from '@/app/(publico)/[slug]/_denuncia/formulario';
import type { EstadoDenuncia } from '@/app/(publico)/[slug]/_denuncia/estado';

// Ação de demonstração de /dev/denuncia (D-035): só a validação PURA e a checagem do token simulado, sem
// banco, sessão nem repositório; nada é gravado. O sucesso faz PRG como a ação real. Desligada a vitrine,
// devolve o estado anterior.
export async function demonstrarDenunciaAcao(anterior: EstadoDenuncia, fd: FormData): Promise<EstadoDenuncia> {
  if (!vitrineHabilitada(process.env)) return anterior;
  const { entrada, valores } = lerFormularioDenuncia(fd, 'desconhecido');
  const v = validarDenuncia(entrada);
  if (!v.ok) return { status: 'invalido', mensagem: null, erros: v.erros, valores };
  if (entrada.tokenHumano !== TOKEN_TURNSTILE_SIMULADO) {
    return { status: 'humano', mensagem: MENSAGENS_DENUNCIA.humano, erros: {}, valores };
  }
  redirect(`${ROTAS.devDenuncia}?${PARAMETRO_DENUNCIA}=${VALOR_DENUNCIA_RECEBIDA}#avaliacoes`);
}
