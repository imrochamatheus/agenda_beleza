'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { ROTAS } from '@/config/navegacao';
import { reenviarMensagemAcao } from '@/server/admin/mensagens.acao';
import { codigoDoReenvio } from '@/server/admin/mensagens-tipos';
import { hrefDaFila, lerFiltrosMensagens } from '@/server/admin/mensagens-validacao';

// Casca Next do reenvio (D-045 CA-14): só converte FormData → entrada e o resultado → PRG com código de lista
// fechada (`?reenvio=`). NUNCA toca repositórios nem a sessão: a autorização é de `defineAcaoAdmin` (também em
// POST direto). Os filtros voltam validados (nada do formulário vira URL sem passar por `lerFiltrosMensagens`).
// 401 → /admin/entrar; 403 → a própria tela (que mostra "Acesso negado"); 404 → `?reenvio=inexistente`.
// `redirect` lança: sempre fora de try.

const texto = (v: FormDataEntryValue | null): string | undefined => (typeof v === 'string' ? v : undefined);

export async function reenviarAcao(fd: FormData): Promise<void> {
  const { filtros } = lerFiltrosMensagens({
    estado: texto(fd.get('estado')),
    tipo: texto(fd.get('tipo')),
    salao: texto(fd.get('salao')),
    pagina: texto(fd.get('pagina')),
  });
  const r = await reenviarMensagemAcao({ mensagemId: texto(fd.get('mensagemId')) });
  if (!r.ok && r.erro === 'nao_autenticado') redirect(ROTAS.adminEntrar);
  const extra: Record<string, string> = {};
  if (r.ok) extra.reenvio = codigoDoReenvio(r.dados);
  else if (r.erro === 'nao_encontrado') extra.reenvio = 'inexistente';
  revalidatePath(ROTAS.adminMensagens);
  redirect(hrefDaFila(ROTAS.adminMensagens, filtros, filtros.pagina, extra));
}
