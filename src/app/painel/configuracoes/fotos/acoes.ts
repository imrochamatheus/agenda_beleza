'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { ROTAS } from '@/config/navegacao';
import { editarAltDaFoto, moverFoto, removerFoto } from '@/server/fotos/fotos.acao';
import type { CodigoAcao } from '@/server/fotos/tipos';
import { MENSAGENS_FOTO } from '@/server/fotos/tipos';

// Casca Next de /painel/configuracoes/fotos (D-021 §3.6): só converte FormData → entrada e o resultado
// da ação (defineAcao, que lê o cookie) → PRG `?acao=<código>` de lista fechada. Não acessa
// repositórios. `redirect` sempre fora de try. O envio NÃO passa por aqui: é o route handler
// POST /api/painel/fotos (multipart de até 5 MB, que o limite de 1 MB das Server Actions não comporta).

type Resposta = { ok: true; dados: unknown } | { ok: false; erro: string };

function campo(fd: FormData, nome: string): string | undefined {
  const v = fd.get(nome);
  return typeof v === 'string' ? v : undefined;
}

function terminar(r: Resposta, sucesso: CodigoAcao): never {
  if (!r.ok && r.erro === 'nao_autenticado') {
    redirect(`${ROTAS.entrar}?proximo=${encodeURIComponent(ROTAS.configuracoesFotos)}`);
  }
  const codigo: CodigoAcao = r.ok ? sucesso : r.erro === 'acesso_negado' ? 'negado' : 'nao_encontrada';
  if (r.ok) revalidatePath(ROTAS.configuracoesFotos);
  redirect(`${ROTAS.configuracoesFotos}?acao=${codigo}`);
}

/** "Salvar descrição": `?acao=alt_ok|alt_vazio|alt_longo|nao_encontrada|negado`. */
export async function editarAltAcao(fd: FormData): Promise<void> {
  const r = await editarAltDaFoto({ fotoId: campo(fd, 'fotoId') as string, alt: campo(fd, 'alt') as string });
  if (r.ok && r.dados.resultado === 'invalido') {
    revalidatePath(ROTAS.configuracoesFotos);
    redirect(`${ROTAS.configuracoesFotos}?acao=${r.dados.erro === MENSAGENS_FOTO.alt_longo ? 'alt_longo' : 'alt_vazio'}`);
  }
  terminar(r, 'alt_ok');
}

/** "Mover para cima/baixo": `?acao=movida|ordem_mudou|na_ponta|nao_encontrada|negado`. */
export async function moverAcao(fd: FormData): Promise<void> {
  const r = await moverFoto({
    fotoId: campo(fd, 'fotoId') as string,
    direcao: campo(fd, 'direcao') as 'cima' | 'baixo',
    posicaoEsperada: campo(fd, 'posicaoEsperada') as unknown as number,
  });
  if (r.ok) {
    revalidatePath(ROTAS.configuracoesFotos);
    redirect(`${ROTAS.configuracoesFotos}?acao=${r.dados.resultado}`);
  }
  terminar(r, 'movida');
}

/** "Remover": `?acao=removida|nao_encontrada|negado`. */
export async function removerAcao(fd: FormData): Promise<void> {
  terminar(await removerFoto({ fotoId: campo(fd, 'fotoId') as string }), 'removida');
}
