'use server';

import { lerFormularioFuncionamento, valoresDoFuncionamento } from '@/app/painel/configuracoes/funcionamento/estado';
import type { EstadoFuncionamento } from '@/app/painel/configuracoes/funcionamento/estado';
import { vitrineHabilitada } from '@/server/env';
import { MENSAGENS_FUNCIONAMENTO as M } from '@/server/salao/funcionamento-tipos';
import type { Funcionamento } from '@/server/salao/funcionamento-tipos';
import { validarFuncionamento } from '@/server/salao/funcionamento-validacao';
import { montarSemana } from '@/server/semana/montagem';

// Ação de demonstração de /dev/funcionamento (D-020 §3.9, D-14): só roda a validação PURA do servidor,
// sem banco, sessão nem rede; nada é gravado. Desligada a vitrine, devolve o estado anterior sem
// processar. Sucesso com a semana canônica (montarSemana).

export async function demonstrarFuncionamentoAcao(anterior: EstadoFuncionamento, fd: FormData): Promise<EstadoFuncionamento> {
  if (!vitrineHabilitada(process.env)) return anterior;
  const { entrada, modo, valores } = lerFormularioFuncionamento(fd);
  const v = validarFuncionamento(entrada);
  if (!v.ok) {
    return { mensagem: null, sucesso: null, erros: v.erros, modo, valores };
  }
  const f: Funcionamento = v.modo === 'informar' ? { definido: true, semana: montarSemana(v.intervalos) } : { definido: false };
  return { mensagem: null, sucesso: M.demonstracao, erros: {}, modo: v.modo, valores: valoresDoFuncionamento(f), funcionamento: f };
}
