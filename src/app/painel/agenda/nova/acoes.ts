'use server';

import { redirect } from 'next/navigation';

import { ROTAS } from '@/config/navegacao';
import { criarReservaManual } from '@/server/reservas/reservas-equipe.acao';

import { aplicarLinha, estadoInicial, lerFormularioReservaManual, MENSAGENS_FORMULARIO_RESERVA, paraEstado } from './estado';
import type { EstadoReservaManual } from './estado';

// Casca Next de /painel/agenda/nova (D-029; D-050 §3.11): só converte FormData → entrada e o resultado da
// ação (defineAcao, que lê o cookie) → estado do formulário. Não acessa repositórios. `redirect` fora de try.
// Sem PRG: o aviso de encaixe e os erros voltam na resposta do POST (funciona sem JavaScript).
// "Adicionar outro serviço"/"Remover" (`linha`) só devolvem o estado com uma linha a mais/a menos e os
// valores ecoados, SEM chamar o serviço (nada é lido nem gravado).

export async function criarReservaManualAcao(_anterior: EstadoReservaManual, fd: FormData): Promise<EstadoReservaManual> {
  const { entrada, valores, chave, linha } = lerFormularioReservaManual(fd);
  if (linha !== null) return aplicarLinha(valores, chave, linha);
  const r = await criarReservaManual(entrada);
  if (!r.ok) {
    if (r.erro === 'nao_autenticado') {
      redirect(`${ROTAS.entrar}?proximo=${encodeURIComponent(ROTAS.novaReserva)}`);
    }
    const mensagem = r.erro === 'acesso_negado' ? MENSAGENS_FORMULARIO_RESERVA.acessoNegado : MENSAGENS_FORMULARIO_RESERVA.naoEncontrado;
    return { ...estadoInicial(chave, valores), mensagem };
  }
  return paraEstado(r.dados, valores, { chave, novaChave: crypto.randomUUID(), baseAgenda: ROTAS.agenda });
}
