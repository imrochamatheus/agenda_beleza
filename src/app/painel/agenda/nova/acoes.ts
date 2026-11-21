'use server';

import { redirect } from 'next/navigation';

import { ROTAS } from '@/config/navegacao';
import { criarReservaManual } from '@/server/reservas/reservas-equipe.acao';

import { lerFormularioReservaManual, MENSAGENS_FORMULARIO_RESERVA, paraEstado } from './estado';
import type { EstadoReservaManual } from './estado';

// Casca Next de /painel/agenda/nova (D-029): só converte FormData → entrada e o resultado da ação
// (defineAcao, que lê o cookie) → estado do formulário. Não acessa repositórios. `redirect` fora de try.
// Sem PRG: o aviso de encaixe e os erros voltam na resposta do POST (funciona sem JavaScript).

export async function criarReservaManualAcao(anterior: EstadoReservaManual, fd: FormData): Promise<EstadoReservaManual> {
  const { entrada, valores, chave } = lerFormularioReservaManual(fd);
  const r = await criarReservaManual(entrada);
  if (!r.ok) {
    if (r.erro === 'nao_autenticado') {
      redirect(`${ROTAS.entrar}?proximo=${encodeURIComponent(ROTAS.novaReserva)}`);
    }
    const mensagem = r.erro === 'acesso_negado' ? MENSAGENS_FORMULARIO_RESERVA.acessoNegado : MENSAGENS_FORMULARIO_RESERVA.naoEncontrado;
    return { ...anterior, mensagem, erros: {}, valores, chave, motivos: null, criada: null };
  }
  return paraEstado(r.dados, valores, { chave, novaChave: crypto.randomUUID(), baseAgenda: ROTAS.agenda });
}
