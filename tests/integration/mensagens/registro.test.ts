import { describe, expect, it } from 'vitest';

import { registrarMensagem } from '@/server/mensagens/registrar';
import { criarRepos } from '@/server/repos';
import { emTransacao } from '@/server/repos/transacao';
import { obterPrisma } from '@/server/repos/db';

import {
  anonimizarCliente,
  criarCenarioMensagem,
  criarMensagem,
  lerMensagem,
  mensagensDaReservaDireto,
  mudarReserva,
} from '../../support/mensagens';

import { ctxDo, registrar } from './apoio';

// D-024 T-7: registro (outbox) contra o PostgreSQL real. CA-4 (registro duplicado), CA-5, CA-13/CA-14
// (elegibilidade no registro), CA-16 (substituição), CA-19 (atomicidade com a reserva).

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

describe('CA-16 / CA-5: substituição de pendentes (RN-7)', () => {
  it('cancelamento substitui confirmação e remarcações pendentes; enviando, enviada e falhou permanecem; outras reservas e salões não mudam', async () => {
    const s = await criarCenarioMensagem({ revisao: 3, status: 'cancelado' });
    const outraDoMesmoSalao = await criarCenarioMensagem();
    const pend = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, tipo: 'confirmacao', revisao: 0, destinatarioE164: s.telefone });
    const rem1 = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, tipo: 'remarcacao', revisao: 1, destinatarioE164: s.telefone });
    const rem3 = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, tipo: 'remarcacao', revisao: 3 });
    const env = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, tipo: 'remarcacao', revisao: 2, estado: 'enviando' });
    const enviada = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, tipo: 'remarcacao', revisao: 0, estado: 'enviada' });
    const falhou = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, tipo: 'remarcacao', revisao: 4, estado: 'falhou' });
    const convite = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, tipo: 'convite_avaliacao', revisao: 0 });
    const alheia = await criarMensagem({ salaoId: outraDoMesmoSalao.salaoId, reservaId: outraDoMesmoSalao.reservaId });
    const r = await registrar(s, 'cancelamento');
    expect(r).toMatchObject({ estado: 'pendente', revisao: 3 });
    for (const id of [pend, rem1, rem3]) expect((await lerMensagem(id)).estado).toBe('substituida');
    expect(await lerMensagem(pend)).toMatchObject({ erroCodigo: 'substituida', destinatarioE164: null });
    expect((await lerMensagem(env)).estado).toBe('enviando');
    expect((await lerMensagem(enviada)).estado).toBe('enviada');
    expect((await lerMensagem(falhou)).estado).toBe('falhou');
    expect((await lerMensagem(convite)).estado).toBe('pendente');
    expect((await lerMensagem(alheia)).estado).toBe('pendente');
  });

  it('remarcacao N substitui só confirmação e remarcações pendentes de revisão menor (CA-7)', async () => {
    const s = await criarCenarioMensagem({ revisao: 2 });
    const conf = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, tipo: 'confirmacao', revisao: 0 });
    const rem1 = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, tipo: 'remarcacao', revisao: 1 });
    const canc = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, tipo: 'cancelamento', revisao: 1 });
    const r = await registrar(s, 'remarcacao');
    expect(r).toMatchObject({ revisao: 2, estado: 'pendente' });
    expect((await lerMensagem(conf)).estado).toBe('substituida');
    expect((await lerMensagem(rem1)).estado).toBe('substituida');
    expect((await lerMensagem(canc)).estado).toBe('pendente');
    expect((await lerMensagem(r.mensagemId)).estado).toBe('pendente');
  });

  it('registro repetido não substitui de novo (só linha criada substitui)', async () => {
    const s = await criarCenarioMensagem({ revisao: 2 });
    await registrar(s, 'remarcacao');
    const velha = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, tipo: 'confirmacao', revisao: 0 });
    const outra = await registrar(s, 'remarcacao');
    expect(outra.criada).toBe(false);
    expect((await lerMensagem(velha)).estado).toBe('pendente');
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
    const existente = await db.reserva.findUniqueOrThrow({ where: { id: s.reservaId } });
    const erro = await db
      .$transaction(async (tx) => {
        await registrarMensagem(ctxDo(s), { reservaId: s.reservaId, tipo: 'cancelamento' }, new Date(), criarRepos(tx));
        // Mesmo profissional e horário da reserva existente: o banco recusa.
        await tx.$executeRaw`
          INSERT INTO reserva (salao_id, profissional_id, cliente_id, inicio, fim, ocupado_ate, status, origem)
          VALUES (${s.salaoId}::uuid, ${s.profissionalId}::uuid, ${s.clienteId}::uuid,
                  ${existente.inicio}, ${existente.fim}, ${existente.ocupadoAte}, 'confirmado', 'publico')`;
      })
      .then(
        () => null,
        (e: unknown) => e as Error,
      );
    expect(erro).not.toBeNull();
    expect(String((erro as Error).message)).toContain('reserva_sem_sobreposicao');
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
