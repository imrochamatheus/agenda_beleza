'use server';

import { redirect } from 'next/navigation';

import { ROTAS } from '@/config/navegacao';
import { vitrineHabilitada } from '@/server/env';
import { validarAlt, validarPosicaoEsperada } from '@/server/fotos/validacao';

// Ações de demonstração de /dev/fotos (D-021 §3.6, D-10): só rodam a validação PURA do servidor, sem
// banco, sessão nem armazenamento; nada é gravado. PRG `?acao=` (lista fechada) como a página real.
// Desligada a vitrine, redirecionam sem processar.

function voltar(codigo: string): never {
  redirect(`${ROTAS.devFotos}?acao=${codigo}`);
}

function campo(fd: FormData, nome: string): string | undefined {
  const v = fd.get(nome);
  return typeof v === 'string' ? v : undefined;
}

export async function demonstrarAltAcao(fd: FormData): Promise<void> {
  if (!vitrineHabilitada(process.env)) redirect(ROTAS.devFotos);
  const alt = validarAlt(campo(fd, 'alt'));
  voltar(alt.ok ? 'alt_ok' : alt.codigo);
}

export async function demonstrarMoverAcao(fd: FormData): Promise<void> {
  if (!vitrineHabilitada(process.env)) redirect(ROTAS.devFotos);
  const esperada = validarPosicaoEsperada(campo(fd, 'posicaoEsperada'));
  voltar(esperada === null ? 'ordem_mudou' : 'movida');
}

export async function demonstrarRemoverAcao(): Promise<void> {
  if (!vitrineHabilitada(process.env)) redirect(ROTAS.devFotos);
  voltar('removida');
}
