// Limites por janela fixa (D-027). API reutilizável: E4.5 chama `limitarPorIp(ip, 'avaliacao', agora)` e
// E8.4 `limitarPorIp(ip, 'denuncia', agora)`; escopos não compartilham contador. A chamada K+1 é negada.
// `janela_inicio = floor(agora / janela) * janela` em UTC; um incremento atômico por chamada.
import { incrementarJanela } from '@/server/repos/rate-limit';

import { chaveIp, chaveNumero } from './chaves';
import { configDaProtecao } from './config';
import type { ConfigProtecao } from './config';
import type { EscopoIp, ResultadoLimite } from './tipos';

export type DependenciasLimite = {
  incrementar?: (chave: string, janelaInicio: Date) => Promise<number>;
  config?: ConfigProtecao;
  segredo?: string;
};

export function janelaDe(agora: Date, janelaSegundos: number): { inicio: Date; fim: Date } {
  const ms = janelaSegundos * 1000;
  const inicio = Math.floor(agora.getTime() / ms) * ms;
  return { inicio: new Date(inicio), fim: new Date(inicio + ms) };
}

async function contar(chave: string, agora: Date, limite: number, deps: DependenciasLimite, config: ConfigProtecao): Promise<ResultadoLimite> {
  const { inicio, fim } = janelaDe(agora, config.janelaSegundos);
  const contador = await (deps.incrementar ?? incrementarJanela)(chave, inicio);
  return contador > limite ? { permitido: false, reiniciaEm: fim } : { permitido: true };
}

/**
 * Consome uma unidade do limite do IP no escopo. Não lança por excesso: devolve `permitido: false`.
 * @param ip IP já extraído por `extrairIp` (nunca o cabeçalho cru).
 */
export function limitarPorIp(ip: string, escopo: EscopoIp, agora: Date, deps: DependenciasLimite = {}): Promise<ResultadoLimite> {
  const config = deps.config ?? configDaProtecao();
  return contar(chaveIp(escopo, ip), agora, config.limiteIp[escopo], deps, config);
}

/** Consome uma unidade do limite do número (E.164) neste salão. */
export function limitarPorNumero(salaoId: string, e164: string, agora: Date, deps: DependenciasLimite = {}): Promise<ResultadoLimite> {
  const config = deps.config ?? configDaProtecao();
  return contar(chaveNumero(salaoId, e164, deps.segredo), agora, config.limiteNumero, deps, config);
}
