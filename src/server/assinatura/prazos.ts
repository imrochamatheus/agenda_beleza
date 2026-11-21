import { repoAssinaturaSistema } from '@/server/repos/assinatura';
import type { RepoAssinaturaSistema } from '@/server/repos/assinatura';
import { contextoDeSistema } from '@/server/tenant/context';

import { LOTE_PRAZOS, MAX_LOTES_POR_EXECUCAO } from './config';
import { aplicarEventoAssinatura } from './servico';

// Job de prazos (D-037 §3.2): chama o MESMO ponto único com o evento `prazo`, uma transação por
// assinatura; falha numa assinatura é logada (só ids) e o lote segue. Log com ids e contagens.

export type ResumoPrazos = { examinadas: number; transitadas: number; ignoradas: number; falhas: number; ocupadas: number };

export type DependenciasPrazos = {
  sistema?: RepoAssinaturaSistema;
  log?: (evento: string, campos: Record<string, unknown>) => void;
  aplicar?: typeof aplicarEventoAssinatura;
};

export async function processarPrazos(agora: Date, deps: DependenciasPrazos = {}): Promise<ResumoPrazos> {
  const sistema = deps.sistema ?? repoAssinaturaSistema();
  const aplicar = deps.aplicar ?? aplicarEventoAssinatura;
  const log = deps.log ?? (() => {});
  const resumo: ResumoPrazos = { examinadas: 0, transitadas: 0, ignoradas: 0, falhas: 0, ocupadas: 0 };
  let cursor: string | null = null;

  for (let lote = 0; lote < MAX_LOTES_POR_EXECUCAO; lote++) {
    const candidatas = await sistema.listarVencidas(agora, cursor, LOTE_PRAZOS);
    for (const c of candidatas) {
      resumo.examinadas++;
      try {
        const r = await aplicar(contextoDeSistema(c.salaoId, 'assinatura-prazos'), { tipo: 'prazo' }, agora, {
          assinaturaId: c.id,
          pularTravada: true,
          log,
        });
        if (r.resultado === 'aplicado') resumo.transitadas++;
        else if (r.resultado === 'ocupada') resumo.ocupadas++;
        else resumo.ignoradas++;
      } catch {
        resumo.falhas++;
        log('assinatura.prazo_falhou', { assinaturaId: c.id, salaoId: c.salaoId });
      }
    }
    if (candidatas.length < LOTE_PRAZOS) break;
    cursor = candidatas[candidatas.length - 1].id;
  }
  log('assinatura.prazos', resumo);
  return resumo;
}
