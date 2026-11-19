import { randomUUID } from 'node:crypto';

import { repoSimWhatsApp } from '@/server/repos/sim-whatsapp';
import type { LinhaChamada, RepoSimWhatsApp, TipoFalhaSimulada } from '@/server/repos/sim-whatsapp';

import { ErroEnvioPermanente, ErroEnvioTemporario, validarEnvioModelo } from './port';
import type { PortaWhatsApp } from './port';

export type { LinhaChamada, TipoFalhaSimulada };

/** Código dos erros produzidos por uma falha forçada. */
export const CODIGO_FALHA_FORCADA = 'falha_forcada';

/** Prefixo do `provedorMensagemId` devolvido no sucesso (imita o `wamid` da Cloud API). */
export const PREFIXO_ID_MENSAGEM_SIMULADA = 'wamid.SIM.';

/** Controle do simulado, usado por testes e pela pessoa desenvolvedora (RN-4, RN-19). */
export interface ControleWhatsAppSimulado {
  /** As próximas `n` chamadas (n ≥ 1), de qualquer processo, falham com o tipo. */
  forcarFalhas(n: number, tipo: TipoFalhaSimulada): Promise<void>;
  listarChamadas(filtro?: { chaveIdempotencia?: string }): Promise<LinhaChamada[]>;
}

/**
 * WhatsApp simulado (RN-19). Toda chamada é registrada, inclusive as que falham. Entrada reprovada
 * em `validarEnvioModelo` vira falha permanente SEM consumir falha forçada. Nas demais, uma falha
 * forçada é consumida atomicamente entre processos e conexões. Não deduplica: isso é da E7.1.
 * `repo` só é informado pelos testes (outro cliente de banco).
 */
export function criarWhatsAppSimulado(
  o: { repo?: RepoSimWhatsApp } = {},
): PortaWhatsApp & ControleWhatsAppSimulado {
  const repo = o.repo ?? repoSimWhatsApp();
  return {
    async enviarModelo(e) {
      const erro = validarEnvioModelo(e);
      if (erro) {
        await repo.registrarChamada({ ...e, invalida: true }, gerarIdMensagem);
        throw erro;
      }
      const r = await repo.registrarChamada({ ...e, invalida: false }, gerarIdMensagem);
      if (r.resultado === 'sucesso') return { provedorMensagemId: r.provedorMensagemId };
      throw r.tipo === 'temporaria'
        ? new ErroEnvioTemporario(CODIGO_FALHA_FORCADA)
        : new ErroEnvioPermanente(CODIGO_FALHA_FORCADA);
    },

    forcarFalhas: (n, tipo) => repo.forcarFalhas(n, tipo),
    listarChamadas: (filtro) => repo.listarChamadas(filtro),
  };
}

function gerarIdMensagem(): string {
  return PREFIXO_ID_MENSAGEM_SIMULADA + randomUUID();
}
