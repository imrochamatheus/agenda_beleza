'use server';

import { ESTADO_INICIAL_FORMULARIO_JORNADA, lerFormularioJornada, valoresDaSemana } from '@/app/painel/profissionais/[id]/jornada/estado';
import type { EstadoFormularioJornada } from '@/app/painel/profissionais/[id]/jornada/estado';
import { vitrineHabilitada } from '@/server/env';
import { montarSemana } from '@/server/jornadas/semana';
import { MENSAGENS_JORNADA } from '@/server/jornadas/tipos';
import { validarSemana } from '@/server/jornadas/validacao';

// Ação de demonstração de /dev/jornada (D-015 §3.7, D-11): só roda a validação PURA do servidor,
// sem banco, sessão nem rede. Desligada a vitrine, devolve o estado inicial sem processar nada (R-11).

export async function demonstrarJornadaAcao(_anterior: EstadoFormularioJornada, fd: FormData): Promise<EstadoFormularioJornada> {
  if (!vitrineHabilitada(process.env)) {
    return ESTADO_INICIAL_FORMULARIO_JORNADA;
  }
  const { entrada, valores } = lerFormularioJornada(fd);
  const v = validarSemana(entrada);
  if (!v.ok) {
    return { mensagem: null, erros: v.erros, valores };
  }
  return { mensagem: MENSAGENS_JORNADA.demonstracao, sucesso: true, erros: {}, valores: valoresDaSemana(montarSemana(v.intervalos)) };
}
