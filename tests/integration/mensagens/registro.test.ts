import { describe, expect, it } from 'vitest';

import { registrarMensagem } from '@/server/mensagens/registrar';
import { criarRepos } from '@/server/repos';
import { emTransacao } from '@/server/repos/transacao';
import { obterPrisma } from '@/server/repos/db';

import {
  anonimizarCliente,
  criarCenarioMensagem,
  criarMensagem,
  criarOutraReserva,
  lerMensagem,
  mensagensDaReservaDireto,
  mudarReserva,
} from '../../support/mensagens';

import { ctxDo, itensDa, registrar } from './apoio';

// D-024 T-7: registro (outbox) contra o PostgreSQL real. CA-4 (registro duplicado), CA-5, CA-13/CA-14
// (elegibilidade no registro), CA-19 (atomicidade com a reserva). D-050: item da mensagem (RN-29); a
// substituição (RN-31) saiu do registro e está em substituicao.test.ts.

describe('registro: revisão, chave e estado inicial (RN-2, RN-8)', () => {
  it('confirmacao nasce pendente com o telefone e revisão 0; chave reserva:tipo:revisao', async () => {
    const s = await criarCenarioMensagem({ revisao: 4 });
    const r = await registrar(s, 'confirmacao');
    expect(r).toMatchObject({ criada: true, tipo: 'confirmacao', revisao: 0, estado: 'pendente', chave: `${s.reservaId}:confirmacao:0`, precisaEnfileirar: true });
    expect(await lerMensagem(r.mensagemId)).toMatchObject({ estado: 'pendente', destinatarioE164: s.telefone, parametros: null, provedorMensagemId: null, salaoId: s.salaoId });
  });

  it('remarcacao e cancelamento usam reserva.revisao; convite usa 0', async () => {
    const s = await criarCenarioMensagem({ revisao: 2, status: 'confirmado' });
    expect((await registrar(s, 'remarcacao')).revisao).toBe(2);
    expect((await registrar(s, 'cancelamento')).revisao).toBe(2);
    expect((await registrar(s, 'convite_avaliacao')).revisao).toBe(0);
  });

  it('remarcacao com reserva.revisao 0 → RangeError e nada gravado', async () => {
    const s = await criarCenarioMensagem({ revisao: 0 });
    await expect(registrar(s, 'remarcacao')).rejects.toThrow(RangeError);
    expect(await mensagensDaReservaDireto(s.reservaId)).toEqual([]);
  });
});

describe('CA-4: o mesmo evento registrado duas vezes', () => {
  it('uma linha; a segunda devolve criada=false e não manda enfileirar', async () => {
    const s = await criarCenarioMensagem();
    const a = await registrar(s, 'confirmacao');
    const b = await registrar(s, 'confirmacao');
    expect(a.criada).toBe(true);
    expect(b).toMatchObject({ criada: false, mensagemId: a.mensagemId, precisaEnfileirar: false, chave: a.chave });
    expect(await mensagensDaReservaDireto(s.reservaId)).toHaveLength(1);
  });
});

describe('CA-14: elegibilidade por finalidade no registro (RN-8)', () => {
  it('sem consentimento de mensagens_reserva → nao_enviada/sem_consentimento, sem telefone, sem job', async () => {
    const s = await criarCenarioMensagem({ consentimentoMensagens: false });
    const r = await registrar(s, 'confirmacao');
    expect(r).toMatchObject({ estado: 'nao_enviada', precisaEnfileirar: false });
    expect(await lerMensagem(r.mensagemId)).toMatchObject({ estado: 'nao_enviada', erroCodigo: 'sem_consentimento', destinatarioE164: null });
  });

  it.each(['equipe', 'publico'] as const)('consentimento de origem %s → pendente', async (origem) => {
    const s = await criarCenarioMensagem({ consentimentoMensagens: false });
    await obterPrisma().consentimento.create({ data: { salaoId: s.salaoId, clienteId: s.clienteId, finalidade: 'mensagens_reserva', origem, versaoTermos: 'v' } });
    expect((await registrar(s, 'confirmacao')).estado).toBe('pendente');
  });

  it('convite: consentimento de mensagens_reserva sozinho → nao_enviada; com o do convite → pendente', async () => {
    const so = await criarCenarioMensagem({ consentimentoMensagens: true, consentimentoConvite: false, status: 'concluido' });
    expect((await registrar(so, 'convite_avaliacao')).estado).toBe('nao_enviada');
    const com = await criarCenarioMensagem({ consentimentoMensagens: false, consentimentoConvite: true, status: 'concluido' });
    expect((await registrar(com, 'convite_avaliacao')).estado).toBe('pendente');
  });
});

describe('CA-13: cliente anonimizada no registro', () => {
  it.each(['confirmacao', 'remarcacao', 'cancelamento', 'convite_avaliacao'] as const)('%s nasce cancelada_anonimizacao, sem telefone e sem job', async (tipo) => {
    const s = await criarCenarioMensagem({ anonimizada: true, revisao: 1, consentimentoConvite: true });
    const r = await registrar(s, tipo);
    expect(r).toMatchObject({ estado: 'cancelada_anonimizacao', precisaEnfileirar: false });
    expect(await lerMensagem(r.mensagemId)).toMatchObject({ destinatarioE164: null, parametros: null });
  });
});

describe('D-050: registro por item (RN-29) e sem substituição (RN-31 é do chamador)', () => {
  it('remarcacao/cancelamento de um item gravam reserva_item_id; confirmacao e "cancelar todos" ficam sem item', async () => {
    const s = await criarCenarioMensagem({ revisao: 2 });
    const [x, y] = await itensDa(s.reservaId);
    const rem = await registrar(s, 'remarcacao', new Date(), { reservaItemId: x.id });
    await mudarReserva(s.reservaId, { revisao: 3 });
    const canc = await registrar(s, 'cancelamento', new Date(), { reservaItemId: y.id });
    await mudarReserva(s.reservaId, { revisao: 4 });
    const todos = await registrar(s, 'cancelamento');
    const conf = await registrar(s, 'confirmacao');
    const lidas = await obterPrisma().mensagem.findMany({
      where: { reservaId: s.reservaId },
      select: { id: true, reservaItemId: true, tipo: true, revisao: true },
    });
    const por = new Map(lidas.map((m) => [m.id, m]));
    expect(por.get(rem.mensagemId)).toMatchObject({ reservaItemId: x.id, tipo: 'remarcacao', revisao: 2 });
    expect(por.get(canc.mensagemId)).toMatchObject({ reservaItemId: y.id, tipo: 'cancelamento', revisao: 3 });
    expect(por.get(todos.mensagemId)).toMatchObject({ reservaItemId: null, tipo: 'cancelamento', revisao: 4 });
    expect(por.get(conf.mensagemId)).toMatchObject({ reservaItemId: null, tipo: 'confirmacao', revisao: 0 });
  });

  it('reservaItemId em confirmacao/convite → RangeError e nada gravado', async () => {
    const s = await criarCenarioMensagem({ revisao: 1, status: 'concluido', consentimentoConvite: true });
    const [x] = await itensDa(s.reservaId);
    for (const tipo of ['confirmacao', 'convite_avaliacao'] as const) {
      await expect(registrar(s, tipo, new Date(), { reservaItemId: x.id })).rejects.toThrow(RangeError);
    }
    expect(await mensagensDaReservaDireto(s.reservaId)).toEqual([]);
  });

  it('item malformado → NaoEncontrado; item de outra reserva do salão → FK (23503) desfaz tudo', async () => {
    const s = await criarCenarioMensagem({ revisao: 1 });
    await expect(registrar(s, 'remarcacao', new Date(), { reservaItemId: 'nao-uuid' })).rejects.toMatchObject({ name: 'NaoEncontrado' });
    const outra = await criarOutraReserva(s, { revisao: 1 });
    const [alheio] = await itensDa(outra);
    const erro = await registrar(s, 'remarcacao', new Date(), { reservaItemId: alheio.id }).then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(String(erro)).toContain('mensagem_salao_id_reserva_id_reserva_item_id_fkey');
    expect(await mensagensDaReservaDireto(s.reservaId)).toEqual([]);
  });

  it('cancelamento com reserva.revisao 0 → RangeError (D-050 RN-28: cancelar sempre incrementa)', async () => {
    const s = await criarCenarioMensagem({ revisao: 0, status: 'cancelado' });
    await expect(registrar(s, 'cancelamento')).rejects.toThrow(RangeError);
    expect(await mensagensDaReservaDireto(s.reservaId)).toEqual([]);
  });

  it('registrar não substitui nenhuma pendente (nem obsoleta): isso é do substituirNaoVigentes', async () => {
    const s = await criarCenarioMensagem({ revisao: 3, status: 'cancelado' });
    const conf = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, tipo: 'confirmacao', revisao: 0 });
    const rem1 = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, tipo: 'remarcacao', revisao: 1 });
    await registrar(s, 'cancelamento');
    expect((await lerMensagem(conf)).estado).toBe('pendente');
    expect((await lerMensagem(rem1)).estado).toBe('pendente');
  });
});

describe('CA-19: atomicidade com a transação do evento (RN-3, RN-24)', () => {
  it('rollback depois de registrar não deixa mensagem', async () => {
    const s = await criarCenarioMensagem();
    await expect(
      emTransacao(async (r) => {
        await registrarMensagem(ctxDo(s), { reservaId: s.reservaId, tipo: 'confirmacao' }, new Date(), r);
        throw new Error('falha do evento');
      }),
    ).rejects.toThrow('falha do evento');
    expect(await mensagensDaReservaDireto(s.reservaId)).toEqual([]);
  });

  it('violação da exclusion constraint (23P01) depois de registrar desfaz a mensagem e o job nunca existiu', async () => {
    const s = await criarCenarioMensagem();
    const db = obterPrisma();
    const [item] = await itensDa(s.reservaId);
    const erro = await db
      .$transaction(async (tx) => {
        await registrarMensagem(ctxDo(s), { reservaId: s.reservaId, tipo: 'confirmacao' }, new Date(), criarRepos(tx));
        // D-050: outra reserva com um item do mesmo profissional e horário de um item existente: o banco recusa.
        const [nova] = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO reserva (salao_id, cliente_id, inicio, fim, status, origem)
          VALUES (${s.salaoId}::uuid, ${s.clienteId}::uuid, ${item.inicio}, ${item.fim}, 'confirmado', 'publico')
          RETURNING id::text AS id`;
        await tx.$executeRaw`
          INSERT INTO reserva_item (salao_id, reserva_id, servico_id, profissional_id, ordem, inicio, fim, ocupado_ate,
                                    status, preco_centavos, duracao_min)
          VALUES (${s.salaoId}::uuid, ${nova.id}::uuid, ${s.servicoIds[0]}::uuid, ${s.profissionalId}::uuid, 0,
                  ${item.inicio}, ${item.fim}, ${item.ocupadoAte}, 'confirmado', 5000, 30)`;
      })
      .then(
        () => null,
        (e: unknown) => e as Error,
      );
    expect(erro).not.toBeNull();
    expect(String((erro as Error).message)).toContain('reserva_item_sem_sobreposicao');
    expect(await mensagensDaReservaDireto(s.reservaId)).toEqual([]);
  });

  it('transação confirmada: reserva e mensagem aparecem juntas', async () => {
    const s = await criarCenarioMensagem();
    const r = await registrar(s, 'confirmacao');
    expect((await lerMensagem(r.mensagemId)).reservaId).toBe(s.reservaId);
  });
});

describe('registro depois de mudanças na reserva', () => {
  it('registro não valida o status (a coerência é conferida no envio, RN-16)', async () => {
    const s = await criarCenarioMensagem({ status: 'confirmado' });
    await mudarReserva(s.reservaId, { status: 'cancelado' });
    expect((await registrar(s, 'confirmacao')).estado).toBe('pendente');
  });

  it('anonimizar depois de registrada não altera o registro (quem decide é o envio ou a E5.2)', async () => {
    const s = await criarCenarioMensagem();
    const r = await registrar(s, 'confirmacao');
    await anonimizarCliente(s.clienteId);
    expect((await lerMensagem(r.mensagemId)).estado).toBe('pendente');
  });
});
