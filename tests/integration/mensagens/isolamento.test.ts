import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { mensagensDaReserva } from '@/server/mensagens/leitura';
import { reenviarMensagem } from '@/server/mensagens/reenviar';
import { registrarMensagem } from '@/server/mensagens/registrar';
import { emTransacao } from '@/server/repos/transacao';

import { chamadasDaChave, checksumDeTabelas, criarCenarioMensagem, criarMensagem, lerMensagem, mensagensDaReservaDireto } from '../../support/mensagens';
import { telefoneNovo } from '../../support/sql';

import { criarPipeline, ctxDo, esperarMensagem, registrarEEnfileirar } from './apoio';
import type { Pipeline } from './apoio';

// D-024 T-7: CA-18 (isolamento entre salões) no registro, reenvio, leitura e no envio pelo worker.

let p: Pipeline;
beforeAll(async () => {
  p = await criarPipeline();
}, 60_000);
afterAll(async () => {
  await p?.encerrar();
});

describe('CA-18: contexto de outro salão', () => {
  it('registrar, reenviar e mensagensDaReserva com ids de S1 e contexto de S2 → NaoEncontrado, nada gravado e S1 idêntico', async () => {
    const s1 = await criarCenarioMensagem();
    const s2 = await criarCenarioMensagem();
    const falhou = await criarMensagem({ salaoId: s1.salaoId, reservaId: s1.reservaId, estado: 'falhou', destinatarioE164: s1.telefone });
    const antes = await checksumDeTabelas(['mensagem', 'mensagem_tentativa', 'reserva', 'cliente', 'consentimento'], s1.salaoId);
    const antesS2 = await checksumDeTabelas(['mensagem', 'reserva'], s2.salaoId);

    for (const tipo of ['confirmacao', 'remarcacao', 'cancelamento', 'convite_avaliacao'] as const) {
      await expect(emTransacao((r) => registrarMensagem(ctxDo(s2), { reservaId: s1.reservaId, tipo }, new Date(), r))).rejects.toMatchObject({ name: 'NaoEncontrado' });
    }
    await expect(reenviarMensagem(ctxDo(s2), falhou, new Date(), { enfileirar: p.enfileirar })).rejects.toMatchObject({ name: 'NaoEncontrado' });
    await expect(mensagensDaReserva(ctxDo(s2), s1.reservaId)).rejects.toMatchObject({ name: 'NaoEncontrado' });

    expect(await checksumDeTabelas(['mensagem', 'mensagem_tentativa', 'reserva', 'cliente', 'consentimento'], s1.salaoId)).toEqual(antes);
    expect(await checksumDeTabelas(['mensagem', 'reserva'], s2.salaoId)).toEqual(antesS2);
    expect((await lerMensagem(falhou)).estado).toBe('falhou');
  });

  it('o contexto de S1 funciona nos próprios ids (controle)', async () => {
    const s1 = await criarCenarioMensagem();
    const r = await emTransacao((r) => registrarMensagem(ctxDo(s1), { reservaId: s1.reservaId, tipo: 'confirmacao' }, new Date(), r));
    expect(r.criada).toBe(true);
    expect(await mensagensDaReserva(ctxDo(s1), s1.reservaId)).toHaveLength(1);
  });
});

describe('CA-18: o worker só lê o salão da mensagem', () => {
  it('mensagem de S1 com cliente de mesmo telefone em S2: parâmetros e destinatário vêm de S1', async () => {
    const telefone = telefoneNovo();
    const s1 = await criarCenarioMensagem({ telefone, salaoNome: 'Salão Aurora Isolado', servicos: ['Corte Aurora'], profissionalNome: 'Ana Aurora' });
    const s2 = await criarCenarioMensagem({ telefone, salaoNome: 'Salão Bromélia Isolado', servicos: ['Corte Bromélia'], profissionalNome: 'Bia Bromélia' });
    const r = await registrarEEnfileirar(p, s1, 'confirmacao');
    await esperarMensagem(r.mensagemId, 'enviada');
    const [c] = await chamadasDaChave(r.chave);
    expect(c.destinatario).toBe(telefone);
    expect(c.parametros).toMatchObject({ salao: 'Salão Aurora Isolado', itens: expect.stringMatching(/ Corte Aurora com Ana Aurora$/) });
    expect(JSON.stringify(c.parametros)).not.toMatch(/Bromélia/);
    expect(await mensagensDaReservaDireto(s2.reservaId)).toEqual([]);
  });

  it('mensagem cujo id é de S1 mas com o salão errado no repositório de sistema não é reivindicada', async () => {
    const s1 = await criarCenarioMensagem();
    const s2 = await criarCenarioMensagem();
    const id = await criarMensagem({ salaoId: s1.salaoId, reservaId: s1.reservaId, destinatarioE164: s1.telefone });
    const { criarRepoMensagemSistema } = await import('@/server/repos/mensagem-sistema');
    const r = await criarRepoMensagemSistema().iniciarEnvio(s2.salaoId, id, new Date(), () => ({ acao: 'enviar' }));
    expect(r).toEqual({ resultado: 'nao_reivindicada' });
    expect((await lerMensagem(id)).estado).toBe('pendente');
  });
});
