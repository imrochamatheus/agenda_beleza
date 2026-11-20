'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { ROTAS } from '@/config/navegacao';
import { salvarJornada } from '@/server/jornadas/jornadas.acao';
import { MENSAGENS_JORNADA } from '@/server/jornadas/tipos';

import { lerFormularioJornada } from './estado';
import type { EstadoFormularioJornada } from './estado';

// Casca Next de /painel/profissionais/[id]/jornada (D-015 §3.6): só converte FormData → entrada e o
// resultado da ação (defineAcao, que lê o cookie) → estado do formulário. Não acessa repositórios.
// `redirect` é sempre chamado fora de try. Sucesso → PRG para `?salva=1` (D-17): o formulário renasce
// do banco, já na forma canônica, com e sem JavaScript.

function rotaDaJornada(id: string | undefined): string {
  return id ? ROTAS.jornada(id) : ROTAS.profissionais;
}

/** Formulário "Salvar jornada" (funciona sem JavaScript). */
export async function salvarJornadaAcao(_anterior: EstadoFormularioJornada, fd: FormData): Promise<EstadoFormularioJornada> {
  const { entrada, valores } = lerFormularioJornada(fd);
  const r = await salvarJornada(entrada);
  const rota = rotaDaJornada(entrada.profissionalId);
  if (!r.ok) {
    if (r.erro === 'nao_autenticado') redirect(`${ROTAS.entrar}?proximo=${encodeURIComponent(rota)}`);
    const mensagem = r.erro === 'acesso_negado' ? MENSAGENS_JORNADA.acessoNegado : MENSAGENS_JORNADA.naoEncontrado;
    return { mensagem, erros: {}, valores };
  }
  if (r.dados.resultado === 'invalido') {
    return { mensagem: null, erros: r.dados.erros, valores };
  }
  revalidatePath(rota);
  redirect(`${rota}?salva=1`);
}
