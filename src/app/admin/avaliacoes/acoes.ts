'use server';

import { redirect } from 'next/navigation';

import { CAMPOS_MODERACAO, PARAMETRO_RESULTADO } from '@/config/moderacao';
import { ROTAS } from '@/config/navegacao';
import { arquivarDenuncias, restaurarAvaliacao, retirarAvaliacao } from '@/server/denuncias/denuncias.acao';
import { ehUuid } from '@/server/repos/ids';

import { codigoDoResultado } from './resultado';
import type { OperacaoModeracao } from './resultado';
import type { ResultadoAcaoAdmin } from '@/server/tenant/define-acao-admin';
import type { ResultadoModeracao } from '@/server/denuncias/tipos';

// Casca Next da moderação (D-035): só converte FormData e resultados; nunca toca repositórios nem a
// sessão (a autorização é de `defineAcaoAdmin`, no servidor, também para POST direto). Sempre PRG com um
// código de lista fechada; sem sessão de admin (401) volta para /admin/entrar.
const texto = (v: FormDataEntryValue | null): string => (typeof v === 'string' ? v : '');

function concluir(id: string, operacao: OperacaoModeracao, r: ResultadoAcaoAdmin<ResultadoModeracao>): never {
  const codigo = codigoDoResultado(operacao, r);
  if (codigo === 'nao_autenticado') redirect(ROTAS.adminEntrar);
  // Id malformado não vira caminho: volta para a fila.
  const base = ehUuid(id) ? ROTAS.adminAvaliacao(id) : ROTAS.adminAvaliacoes;
  redirect(`${base}?${PARAMETRO_RESULTADO}=${codigo}`);
}

export async function retirarAcao(fd: FormData): Promise<void> {
  const avaliacaoId = texto(fd.get(CAMPOS_MODERACAO.avaliacao));
  concluir(avaliacaoId, 'retirar', await retirarAvaliacao({ avaliacaoId, motivo: texto(fd.get(CAMPOS_MODERACAO.motivo)) }));
}

export async function restaurarAcao(fd: FormData): Promise<void> {
  const avaliacaoId = texto(fd.get(CAMPOS_MODERACAO.avaliacao));
  concluir(avaliacaoId, 'restaurar', await restaurarAvaliacao({ avaliacaoId, motivo: texto(fd.get(CAMPOS_MODERACAO.motivo)) }));
}

export async function arquivarAcao(fd: FormData): Promise<void> {
  const avaliacaoId = texto(fd.get(CAMPOS_MODERACAO.avaliacao));
  const denunciaId = texto(fd.get(CAMPOS_MODERACAO.denuncia));
  concluir(avaliacaoId, 'arquivar', await arquivarDenuncias({ avaliacaoId, ...(denunciaId === '' ? {} : { denunciaId }) }));
}
