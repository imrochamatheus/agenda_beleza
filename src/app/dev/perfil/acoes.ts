'use server';

import { estadoPerfilInicial, lerFormularioPerfil } from '@/app/painel/configuracoes/perfil/estado';
import type { EstadoPerfil } from '@/app/painel/configuracoes/perfil/estado';
import { vitrineHabilitada } from '@/server/env';
import { MENSAGENS_PERFIL as M } from '@/server/salao/perfil-tipos';
import { perfilParaColunas, validarPerfil, valoresDoPerfil } from '@/server/salao/perfil-validacao';

// Ação de demonstração de /dev/perfil (D-020 §3.9, D-14): só roda a validação PURA do servidor, sem banco,
// sessão nem rede; nada é gravado. Desligada a vitrine, devolve o estado anterior sem processar.

export async function demonstrarPerfilAcao(anterior: EstadoPerfil, fd: FormData): Promise<EstadoPerfil> {
  if (!vitrineHabilitada(process.env)) return anterior;
  const { entrada, valores } = lerFormularioPerfil(fd);
  const v = validarPerfil(entrada);
  if (!v.ok) {
    return { mensagem: null, sucesso: null, erros: v.erros, valores };
  }
  return { ...estadoPerfilInicial(valoresDoPerfil(perfilParaColunas(v.perfil))), sucesso: M.demonstracao };
}
