// Resultado das ações de moderação para o PRG (D-035): lista FECHADA de códigos no `?resultado=`, nunca
// texto livre nem id. Sem next/*, sem banco.
import { MENSAGENS_MODERACAO } from '@/server/denuncias/tipos';
import type { ResultadoModeracao } from '@/server/denuncias/tipos';
import type { ResultadoAcaoAdmin } from '@/server/tenant/define-acao-admin';

export const CODIGOS_RESULTADO = [
  'retirada',
  'restaurada',
  'arquivadas',
  'estado_atual',
  'sem_pendentes',
  'motivo_invalido',
  'motivo_dados',
  'negado',
  'nao_encontrada',
] as const;
export type CodigoResultado = (typeof CODIGOS_RESULTADO)[number];

export type OperacaoModeracao = 'retirar' | 'restaurar' | 'arquivar';

export const MENSAGEM_NEGADO = 'Você não tem permissão para esta ação.';

export const TEXTOS_RESULTADO: Record<CodigoResultado, { variante: 'sucesso' | 'aviso' | 'erro'; texto: string }> = {
  retirada: { variante: 'sucesso', texto: MENSAGENS_MODERACAO.retirada },
  restaurada: { variante: 'sucesso', texto: MENSAGENS_MODERACAO.restaurada },
  arquivadas: { variante: 'sucesso', texto: MENSAGENS_MODERACAO.arquivadas },
  estado_atual: { variante: 'aviso', texto: MENSAGENS_MODERACAO.recusadoEstado },
  sem_pendentes: { variante: 'aviso', texto: MENSAGENS_MODERACAO.semPendentes },
  motivo_invalido: { variante: 'erro', texto: MENSAGENS_MODERACAO.motivoObrigatorio },
  motivo_dados: { variante: 'erro', texto: MENSAGENS_MODERACAO.motivoComDados },
  negado: { variante: 'erro', texto: MENSAGEM_NEGADO },
  nao_encontrada: { variante: 'erro', texto: MENSAGENS_MODERACAO.naoEncontrada },
};

/** Valor do `?resultado=` → código conhecido, ou null (qualquer outra coisa é ignorada). */
export function lerResultado(v: unknown): CodigoResultado | null {
  const x = Array.isArray(v) ? v[0] : v;
  return typeof x === 'string' && (CODIGOS_RESULTADO as readonly string[]).includes(x) ? (x as CodigoResultado) : null;
}

/** Resultado da ação → código do PRG, ou `nao_autenticado` (a casca redireciona para /admin/entrar). */
export function codigoDoResultado(
  operacao: OperacaoModeracao,
  r: ResultadoAcaoAdmin<ResultadoModeracao>,
): CodigoResultado | 'nao_autenticado' {
  if (!r.ok) {
    if (r.status === 401) return 'nao_autenticado';
    return r.status === 403 ? 'negado' : 'nao_encontrada';
  }
  const d = r.dados;
  if (d.resultado === 'invalido') return d.erro === MENSAGENS_MODERACAO.motivoComDados ? 'motivo_dados' : 'motivo_invalido';
  if (d.resultado === 'recusado') return d.motivo === 'sem_pendentes' ? 'sem_pendentes' : 'estado_atual';
  return operacao === 'retirar' ? 'retirada' : operacao === 'restaurar' ? 'restaurada' : 'arquivadas';
}
