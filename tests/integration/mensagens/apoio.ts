import type { PgBoss } from 'pg-boss';

import { criarWhatsAppSimulado } from '@/server/integrations/whatsapp/simulado';
import { enfileirarMensagens } from '@/server/mensagens/enfileirar';
import { registrarMensagem } from '@/server/mensagens/registrar';
import type { GeradorLinkAvaliacao, ResultadoRegistro, TipoMensagem } from '@/server/mensagens/tipos';
import { type ClienteFila, criarClienteFila } from '@/server/queue/client';
import { obterPrisma } from '@/server/repos/db';
import { emTransacao } from '@/server/repos/transacao';
import { contextoDeSistema } from '@/server/tenant/context';
import { criarReconciliarMensagens } from '@/worker/handlers/reconciliar-mensagens';
import { criarWhatsappReserva } from '@/worker/handlers/whatsapp-reserva';
import type { DefinicaoFila } from '@/worker/handlers/tipos';

import { abrirBossDeTeste, envDeTeste, esperar, fecharBoss, iniciarWorkerDeTeste } from '../../support/fila';
import type { WorkerEmTeste } from '../../support/fila';
import { lerMensagem } from '../../support/mensagens';
import type { CenarioMensagem, EstadoMsg } from '../../support/mensagens';

// Apoio dos testes de integração das mensagens (D-024 T-7): pipeline completo com pg-boss real, WhatsApp
// simulado, relógio e gerador de link injetáveis. Espera sempre por polling com prazo, nunca sleep fixo.

export const ctxDo = (c: Pick<CenarioMensagem, 'salaoId'>) => contextoDeSistema(c.salaoId, 'teste');

export type OpcoesPipeline = {
  /** Sobrescritas do ambiente da fila (padrão: 4 retentativas, atraso de 1 s, backoff ligado). */
  env?: Record<string, string>;
  gerarLink?: GeradorLinkAvaliacao;
  agora?: () => Date;
  /** Inclui o handler da reconciliação (e seu cron) no worker. Padrão: não. */
  reconciliacao?: boolean;
  /** Não inicia o worker agora (ver `iniciar`). */
  semWorker?: boolean;
};

export type Pipeline = {
  simulado: ReturnType<typeof criarWhatsAppSimulado>;
  clienteFila: ClienteFila;
  boss: PgBoss;
  worker: () => WorkerEmTeste;
  /** Linhas JSON do worker, de todas as execuções. */
  logs: () => string[];
  /** IDs dos jobs criados por `enfileirar`, na ordem. */
  jobs: string[];
  enfileirar: ClienteFila['enfileirar'];
  iniciar(): Promise<void>;
  parar(): Promise<void>;
  encerrar(): Promise<void>;
};

export async function criarPipeline(o: OpcoesPipeline = {}): Promise<Pipeline> {
  const env = { QUEUE_RETRY_LIMIT: '4', QUEUE_RETRY_DELAY_SECONDS: '1', QUEUE_RETRY_BACKOFF: 'true', ...o.env };
  const simulado = criarWhatsAppSimulado();
  const clienteFila = criarClienteFila(envDeTeste(env));
  const jobs: string[] = [];
  const enfileirar: ClienteFila['enfileirar'] = async (fila, payload, opcoes) => {
    const r = await clienteFila.enfileirar(fila, payload, opcoes);
    if (r.criado) jobs.push(r.id);
    return r;
  };
  const definicoes: DefinicaoFila[] = [
    criarWhatsappReserva({ whatsapp: () => simulado, gerarLink: o.gerarLink, ...(o.agora ? { agora: o.agora } : {}) }),
    ...(o.reconciliacao ? [criarReconciliarMensagens({ enfileirar, ...(o.agora ? { agora: o.agora } : {}) })] : []),
  ];
  const boss = await abrirBossDeTeste();
  let atual: WorkerEmTeste | undefined;
  const linhas: string[] = [];
  const iniciar = async () => {
    atual = await iniciarWorkerDeTeste({ env, definicoes });
  };
  const parar = async () => {
    if (!atual) return;
    const w = atual;
    atual = undefined;
    await w.encerrar();
    linhas.push(...w.log.linhas, ...w.log.erros);
  };
  if (!o.semWorker) await iniciar();
  return {
    simulado,
    clienteFila,
    boss,
    jobs,
    enfileirar,
    worker: () => {
      if (!atual) throw new Error('worker parado');
      return atual;
    },
    logs: () => [...linhas, ...(atual ? [...atual.log.linhas, ...atual.log.erros] : [])],
    iniciar,
    parar,
    async encerrar() {
      await parar();
      await clienteFila.encerrar();
      await fecharBoss(boss);
    },
  };
}

/** Limpa a fila FIFO de falhas forçadas do simulado (compartilhada pela base do arquivo). */
export async function limparFalhasForcadas(): Promise<void> {
  await obterPrisma().$executeRaw`DELETE FROM sim_whatsapp_falha_forcada`;
}

/** Registra na transação (como faria a E3.x) e devolve o resultado, sem enfileirar. */
export async function registrar(c: CenarioMensagem, tipo: TipoMensagem, agora: Date = new Date()): Promise<ResultadoRegistro> {
  return emTransacao((r) => registrarMensagem(ctxDo(c), { reservaId: c.reservaId, tipo }, agora, r));
}

/** Registra e, depois do commit, enfileira pelo cliente do pipeline. */
export async function registrarEEnfileirar(p: Pipeline, c: CenarioMensagem, tipo: TipoMensagem): Promise<ResultadoRegistro> {
  const r = await registrar(c, tipo);
  await enfileirarMensagens([r], { enfileirar: p.enfileirar });
  return r;
}

/** Espera a mensagem chegar a um dos estados. */
export async function esperarMensagem(id: string, estados: EstadoMsg | EstadoMsg[], prazoMs = 20_000) {
  const alvo = Array.isArray(estados) ? estados : [estados];
  return esperar(async () => {
    const m = await lerMensagem(id);
    return alvo.includes(m.estado) ? m : null;
  }, prazoMs, `a mensagem ${id} em ${alvo.join('|')}`);
}

/** Espera o job (do pg-boss) terminar e devolve o estado. */
export async function esperarJob(p: Pipeline, fila: string, id: string, prazoMs = 20_000) {
  return esperar(async () => {
    const j = await p.boss.getJobById<unknown>(fila, id);
    return j && ['completed', 'failed', 'cancelled'].includes(j.state) ? j : null;
  }, prazoMs, `o job ${id} terminar`);
}
