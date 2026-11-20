import { validarDias } from '@/server/semana/validacao';
import type { IntervaloDoDia } from '@/server/semana/validacao';

import { MENSAGENS_FUNCIONAMENTO, MODOS_FUNCIONAMENTO } from './funcionamento-tipos';
import type { ErrosFuncionamento, ModoFuncionamento } from './funcionamento-tipos';

// Validação do horário de funcionamento (D-020 §3.4; RN-12, RN-14). Pura: reaproveita o núcleo da
// semana (as mesmas regras e mensagens por intervalo da jornada). Reutilizável pela E8.2.

const ehObjeto = (e: unknown): e is Record<string, unknown> => typeof e === 'object' && e !== null && !Array.isArray(e);

/**
 * Entrada que não é objeto → { formulario }. `modo` fora de MODOS_FUNCIONAMENTO → { modo } (A-12).
 * 'nao_informar' → ok SEM olhar `dias` (RN-14). 'informar' → validarDias(e.dias).
 */
export function validarFuncionamento(
  e: unknown,
):
  | { ok: true; modo: 'nao_informar' }
  | { ok: true; modo: 'informar'; intervalos: IntervaloDoDia[] }
  | { ok: false; erros: ErrosFuncionamento } {
  if (!ehObjeto(e)) return { ok: false, erros: { formulario: MENSAGENS_FUNCIONAMENTO.formulario } };
  const modo = e.modo;
  if (typeof modo !== 'string' || !(MODOS_FUNCIONAMENTO as readonly string[]).includes(modo)) {
    return { ok: false, erros: { modo: MENSAGENS_FUNCIONAMENTO.modo } };
  }
  if ((modo as ModoFuncionamento) === 'nao_informar') return { ok: true, modo: 'nao_informar' };
  const r = validarDias(e.dias);
  if (!r.ok) return { ok: false, erros: { ...r.erros } };
  return { ok: true, modo: 'informar', intervalos: r.intervalos };
}
