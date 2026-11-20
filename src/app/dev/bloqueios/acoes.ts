'use server';

import { redirect } from 'next/navigation';

import { estadoInicial, lerFormularioBloqueio, VALORES_VAZIOS } from '@/app/painel/bloqueios/estado';
import type { EstadoFormularioBloqueio } from '@/app/painel/bloqueios/estado';
import { ROTAS } from '@/config/navegacao';
import { formatarDataHora, formatarPeriodoBloqueio } from '@/lib/format';
import { MENSAGENS_BLOQUEIO } from '@/server/bloqueios/tipos';
import type { AvisoReservas } from '@/server/bloqueios/tipos';
import { resolverPeriodo } from '@/server/bloqueios/validacao';
import { vitrineHabilitada } from '@/server/env';
import { ehDiaInteiro } from '@/server/tempo/fuso';

// Ações de demonstração de /dev/bloqueios (D-016 §3.8, D-24): só rodam a validação PURA do servidor
// (resolverPeriodo no fuso America/Sao_Paulo), sem banco, sessão nem rede. Desligada a vitrine,
// devolvem o estado inicial / não redirecionam (R-12). "Salvar" e "Remover" aqui não gravam nada.

const FUSO = 'America/Sao_Paulo';
const HORA_MS = 60 * 60_000;
const MODOS = ['gestor', 'profissional', 'edicao'] as const;

/** Aviso fixo com duas reservas de exemplo (uma de cliente anonimizada) a partir do início salvo. */
function avisoDeExemplo(inicio: Date): AvisoReservas {
  const r = (id: string, desloc: number, profissionalNome: string, cliente: string) => ({
    id,
    profissionalNome,
    inicioLocal: formatarDataHora(new Date(inicio.getTime() + desloc), FUSO),
    fimLocal: formatarDataHora(new Date(inicio.getTime() + desloc + HORA_MS), FUSO),
    cliente,
  });
  return { total: 2, reservas: [r('exemplo-1', 0, 'Ana Demonstração', 'Joana Exemplo'), r('exemplo-2', HORA_MS, 'Ana Demonstração', 'cliente removida')] };
}

async function demonstrar(fd: FormData, modo: 'criar' | 'editar'): Promise<EstadoFormularioBloqueio> {
  const { entrada, valores } = lerFormularioBloqueio(fd, modo);
  const v = resolverPeriodo(entrada, FUSO, new Date(), { edicao: modo === 'editar' });
  if (!v.ok) {
    return { mensagem: null, erros: v.erros, valores, salvo: null };
  }
  // Como no serviço real: o gestor (formulário com select) precisa escolher o alvo.
  if (modo === 'criar' && entrada.alvo !== undefined && entrada.alvo.trim() === '') {
    return { mensagem: null, erros: { alvo: MENSAGENS_BLOQUEIO.alvo }, valores, salvo: null };
  }
  const periodo = formatarPeriodoBloqueio(v.inicio, v.fim, FUSO, ehDiaInteiro(v.inicio, v.fim, FUSO));
  return { mensagem: null, erros: {}, valores: modo === 'criar' ? VALORES_VAZIOS : valores, salvo: { periodo, aviso: avisoDeExemplo(v.inicio) } };
}

export async function demonstrarCriacaoAcao(_anterior: EstadoFormularioBloqueio, fd: FormData): Promise<EstadoFormularioBloqueio> {
  if (!vitrineHabilitada(process.env)) return estadoInicial();
  return demonstrar(fd, 'criar');
}

export async function demonstrarEdicaoAcao(anterior: EstadoFormularioBloqueio, fd: FormData): Promise<EstadoFormularioBloqueio> {
  if (!vitrineHabilitada(process.env)) return estadoInicial(anterior.valores);
  return demonstrar(fd, 'editar');
}

/**
 * "Remover" da lista de demonstração, ligada a um modo por `.bind` (o FormData chega como argumento
 * extra e é ignorado): PRG para `?remocao=ok&modo=`.
 */
export async function demonstrarRemocaoAcao(modo: string): Promise<void> {
  if (!vitrineHabilitada(process.env)) return;
  const destino = (MODOS as readonly string[]).includes(modo) ? modo : 'gestor';
  redirect(`${ROTAS.devBloqueios}?remocao=ok&modo=${destino}`);
}
