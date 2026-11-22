import type { JsonObjeto } from '@/server/auditoria/tipos';
import { listarAuditoria as consultar } from '@/server/repos/auditoria';
import { exigirAdmin } from '@/server/tenant/context';
import type { AdminContext } from '@/server/tenant/context';

import type { ListaAuditoria } from './auditoria-tipos';
import { intervaloDoPeriodo, lerFiltrosAuditoria } from './auditoria-validacao';
import { montarFiltroDeSalao } from './filtro-salao';
import { LIMITE_SELECT_SALOES, deslocamentoDaPagina, totalDePaginas } from './paginacao';
import type { Consulta } from './paginacao';

// Consulta de auditoria do super admin (D-045 RN-15). Somente leitura; NÃO audita a própria leitura (RN-3).
// Sem next/*, sem Prisma. `antes`/`depois` saem como gravados (já sem segredos); a tela só escapa.

export type DepsListagemAuditoria = { limiteSelectSaloes?: number };

const objeto = (v: unknown): JsonObjeto | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as JsonObjeto) : null);

export async function listarAuditoria(ctx: AdminContext, sp: Consulta, deps: DepsListagemAuditoria = {}): Promise<ListaAuditoria> {
  exigirAdmin(ctx);
  const { filtros, erros, ignorados, ecoes } = lerFiltrosAuditoria(sp);
  const periodo = intervaloDoPeriodo(filtros.de, filtros.ate);
  const [{ itens, total }, salao] = await Promise.all([
    consultar(
      { salaoId: filtros.salaoId, ator: filtros.ator, acao: filtros.acao, resultado: filtros.resultado, de: periodo.de, ate: periodo.ate },
      deslocamentoDaPagina(filtros.pagina),
    ),
    montarFiltroDeSalao(deps.limiteSelectSaloes ?? LIMITE_SELECT_SALOES),
  ]);
  return {
    itens: itens.map((l) => ({
      id: l.id,
      acao: l.acao,
      entidade: l.entidade,
      resultado: l.resultado,
      ocorridoEm: l.ocorridoEm.toISOString(),
      atorEmail: l.atorEmail,
      salaoId: l.salaoId,
      salaoNome: l.salaoNome,
      antes: objeto(l.antes),
      depois: objeto(l.depois),
    })),
    total,
    pagina: filtros.pagina,
    paginas: totalDePaginas(total),
    filtros,
    erros,
    ignorados,
    ecoes,
    salao,
  };
}
