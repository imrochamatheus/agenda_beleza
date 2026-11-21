import { ehCapacidade, ehPapelDeSalao } from './context';
import { metadadosDaAcao } from './define-acao';

export type MotivoProblema = 'nao_e_acao' | 'sem_capacidade' | 'capacidade_invalida' | 'sem_papeis';
export type ProblemaRegistro = { arquivo: string; exportacao: string; motivo: MotivoProblema };

/**
 * Confere a convenção `*.acao.ts` (CA-4): toda exportação de cada módulo deve ser produto de
 * `defineAcao`, com capacidade no conjunto CAPACIDADES e ao menos um papel de salão válido.
 * `modulos` é o resultado de `import.meta.glob('/src/**\/*.acao.ts', { eager: true })`.
 * Devolve a lista de problemas (vazia = registro válido), ordenada por arquivo e exportação.
 */
export function verificarAcoes(
  modulos: Record<string, Record<string, unknown>>,
): ProblemaRegistro[] {
  const problemas: ProblemaRegistro[] = [];
  for (const arquivo of Object.keys(modulos).sort()) {
    const modulo = modulos[arquivo];
    for (const exportacao of Object.keys(modulo).sort()) {
      const motivo = motivoDoProblema(modulo[exportacao]);
      if (motivo) {
        problemas.push({ arquivo, exportacao, motivo });
      }
    }
  }
  return problemas;
}

function motivoDoProblema(valor: unknown): MotivoProblema | null {
  const metadados = metadadosDaAcao(valor);
  if (!metadados) {
    return 'nao_e_acao';
  }
  // Ação do super admin (`defineAcaoAdmin`, D-035): só o papel `admin`, sem capacidade de salão.
  if ((metadados as { tipo?: unknown }).tipo === 'admin' && (metadados.papeis as readonly string[]).join() === 'admin') {
    return null;
  }
  if (metadados.capacidade === undefined || metadados.capacidade === null) {
    return 'sem_capacidade';
  }
  if (!ehCapacidade(metadados.capacidade)) {
    return 'capacidade_invalida';
  }
  const { papeis } = metadados;
  if (!Array.isArray(papeis) || papeis.length === 0 || !papeis.every(ehPapelDeSalao)) {
    return 'sem_papeis';
  }
  return null;
}
