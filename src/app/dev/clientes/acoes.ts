'use server';

import { estadoInicial, lerFormularioCliente } from '@/app/painel/clientes/estado';
import type { EstadoFormularioCliente } from '@/app/painel/clientes/estado';
import { vitrineHabilitada } from '@/server/env';
import { MENSAGENS_CLIENTE } from '@/server/clientes/tipos';
import { validarEntradaCliente } from '@/server/clientes/validacao';
import { formatarTelefone } from '@/lib/format';

import { CLIENTE_DETALHE_DEMONSTRACAO, CLIENTE_EXISTENTE_DEMONSTRACAO, TELEFONE_EM_USO_DEMONSTRACAO } from './demonstracao';

// Ação de demonstração de /dev/clientes (D-022 §3.6): só roda a validação PURA do servidor, sem banco,
// sessão nem rede; nada é gravado. Desligada a vitrine, devolve o estado anterior sem processar.
// O telefone da demonstração (igual ao atual) é "sem alteração"; TELEFONE_EM_USO_DEMONSTRACAO simula o
// de outra cliente.

export async function demonstrarEdicaoAcao(anterior: EstadoFormularioCliente, fd: FormData): Promise<EstadoFormularioCliente> {
  if (!vitrineHabilitada(process.env)) return anterior;
  const { entrada, valores } = lerFormularioCliente(fd);
  const v = validarEntradaCliente(entrada);
  if (!v.ok) {
    return { ...estadoInicial(valores), erros: v.erros };
  }
  if (v.telefoneE164 === TELEFONE_EM_USO_DEMONSTRACAO) {
    return { ...estadoInicial(valores), erros: { telefone: MENSAGENS_CLIENTE.telefoneEmUso }, existente: CLIENTE_EXISTENTE_DEMONSTRACAO };
  }
  const semAlteracao = v.nome === CLIENTE_DETALHE_DEMONSTRACAO.nome && v.telefoneE164 === CLIENTE_DETALHE_DEMONSTRACAO.telefone;
  return {
    ...estadoInicial({ nome: v.nome, telefone: formatarTelefone(v.telefoneE164) }),
    sucesso: semAlteracao ? MENSAGENS_CLIENTE.semAlteracao : MENSAGENS_CLIENTE.salva,
  };
}
