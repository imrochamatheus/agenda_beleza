import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { anonimizarCliente } from '@/server/clientes/anonimizar';
import { enfileirarMensagens } from '@/server/mensagens/enfileirar';
import { criarTenantContext } from '@/server/tenant/context';

import { chamadasDaChave, criarCenarioMensagem, criarMensagem, lerMensagem, lerTentativas } from '../../support/mensagens';
import type { CenarioMensagem } from '../../support/mensagens';
import { criarPipeline, esperarJob, registrar } from '../mensagens/apoio';
import type { Pipeline } from '../mensagens/apoio';
import { FILA } from '@/server/queue/filas';

// D-031 CA-3 e CA-7: o worker pg-boss real processa o job de uma mensagem pendente de cliente anonimizada
// (cancelada_anonimizacao, sem chamada ao WhatsApp simulado) e uma mensagem aberta no instante da
// anonimização não recupera o dado pessoal.

let p: Pipeline;
beforeAll(async () => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  p = await criarPipeline({ semWorker: true });
  // O worker instala o esquema e cria as filas; depois para, para o job esperar a anonimização.
  await p.iniciar();
  await p.parar();
}, 60_000);
afterAll(async () => {
  await p?.encerrar();
  vi.restoreAllMocks();
});

const gestorDe = (s: CenarioMensagem) =>
  criarTenantContext({ usuarioId: randomUUID(), papel: 'gestor', salaoId: s.salaoId, profissionalId: null });

describe('CA-3: job de mensagem pendente da cliente anonimizada', () => {
  it('o worker encerra a mensagem como cancelada_anonimizacao e o adaptador simulado não recebe envio', async () => {
    const s = await criarCenarioMensagem();
    const r = await registrar(s, 'confirmacao');
    expect(r.estado).toBe('pendente');
    await enfileirarMensagens([r], { enfileirar: p.enfileirar });
    const jobId = p.jobs.at(-1) as string;
    const outra = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, tipo: 'cancelamento', revisao: 1, estado: 'falhou', erroCodigo: 'erro_x', destinatarioE164: s.telefone });

    const a = await anonimizarCliente(gestorDe(s), { clienteId: s.clienteId }, new Date());
    expect(a).toEqual({ resultado: 'anonimizada', canceladas: 2 });

    await p.iniciar();
    const j = await esperarJob(p, FILA.whatsappReserva, jobId);
    expect(j.state).toBe('completed');
    const m = await lerMensagem(r.mensagemId);
    expect(m.estado).toBe('cancelada_anonimizacao');
    expect(m.destinatarioE164).toBeNull();
    expect(await lerTentativas(r.mensagemId)).toHaveLength(0);
    expect(await chamadasDaChave(r.chave)).toHaveLength(0);
    expect((await lerMensagem(outra)).estado).toBe('cancelada_anonimizacao');
  }, 40_000);
});
