'use server';

import { redirect } from 'next/navigation';

import { CAMPOS_MODERACAO, PARAMETRO_RESULTADO } from '@/config/moderacao';
import { ROTAS } from '@/config/navegacao';
import { vitrineHabilitada } from '@/server/env';
import { validarMotivoModeracao } from '@/server/denuncias/validacao';
import { MENSAGENS_MODERACAO } from '@/server/denuncias/tipos';
import type { CodigoResultado } from '@/app/admin/avaliacoes/resultado';

// Ações de demonstração de /dev/moderacao (D-035): só a validação PURA do motivo, sem banco, sessão nem
// repositório; nada é gravado. Fazem PRG como as reais. Desligada a vitrine, não fazem nada.
const DESTINO = `${ROTAS.devModeracao}?vista=detalhe`;

function ir(codigo: CodigoResultado): never {
  redirect(`${DESTINO}&${PARAMETRO_RESULTADO}=${codigo}`);
}

function comMotivo(fd: FormData, sucesso: CodigoResultado): never {
  const m = validarMotivoModeracao(fd.get(CAMPOS_MODERACAO.motivo));
  if (m.ok) ir(sucesso);
  ir(m.erro === MENSAGENS_MODERACAO.motivoComDados ? 'motivo_dados' : 'motivo_invalido');
}

export async function retirarDemonstracao(fd: FormData): Promise<void> {
  if (!vitrineHabilitada(process.env)) return;
  comMotivo(fd, 'retirada');
}

export async function restaurarDemonstracao(fd: FormData): Promise<void> {
  if (!vitrineHabilitada(process.env)) return;
  comMotivo(fd, 'restaurada');
}

export async function arquivarDemonstracao(): Promise<void> {
  if (!vitrineHabilitada(process.env)) return;
  ir('arquivadas');
}
