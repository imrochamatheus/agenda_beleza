import { afterEach, describe, expect, it } from 'vitest';

import { criarWhatsAppSimulado } from '@/server/integrations/whatsapp/simulado';
import { criarWhatsappReserva } from '@/worker/handlers/whatsapp-reserva';
import type { ContextoJob } from '@/worker/handlers/tipos';

import { chamadasDaChave, criarCenarioMensagem, criarMensagem, lerMensagem, lerTentativas, mensagensDaReservaDireto } from '../../support/mensagens';

import { limparFalhasForcadas, registrar } from './apoio';

// D-024 T-7: CA-4 (registro paralelo, sem 23505) e CA-9 (dois executores do mesmo job). Estabilidade ×10
// no comando documentado.

afterEach(limparFalhasForcadas);

const ctxJob = (): ContextoJob => ({ id: 'j', fila: 'whatsapp-reserva', tentativa: 1, tentativasMaximas: 5, agendadoPara: new Date(), sinal: new AbortController().signal, log: () => {} });

describe('CA-4: registro do mesmo evento em transações concorrentes', () => {
  it('10 registros em paralelo → 1 linha, 1 criada, nenhum erro (nada de 23505)', async () => {
    const s = await criarCenarioMensagem();
    const rs = await Promise.allSettled(Array.from({ length: 10 }, () => registrar(s, 'confirmacao')));
    expect(rs.filter((r) => r.status === 'rejected')).toEqual([]);
    const ok = rs.map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof registrar>>>).value);
    expect(ok.filter((r) => r.criada)).toHaveLength(1);
    expect(new Set(ok.map((r) => r.mensagemId)).size).toBe(1);
    expect(ok.filter((r) => r.precisaEnfileirar)).toHaveLength(1);
    expect(await mensagensDaReservaDireto(s.reservaId)).toHaveLength(1);
  });
});

describe('CA-9: o mesmo job executado por dois executores simultâneos', () => {
  it('uma chamada ao adaptador, uma tentativa e estado enviada (sem usar o pg-boss para deduplicar)', async () => {
    const s = await criarCenarioMensagem();
    const id = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, destinatarioE164: s.telefone });
    const simulado = criarWhatsAppSimulado();
    const h = criarWhatsappReserva({ whatsapp: () => simulado });
    const resultados = await Promise.allSettled(Array.from({ length: 6 }, () => h.processar({ mensagemId: id }, ctxJob())));
    expect(resultados.filter((r) => r.status === 'rejected')).toEqual([]);
    expect(await chamadasDaChave(`${s.reservaId}:confirmacao:0`)).toHaveLength(1);
    const t = await lerTentativas(id);
    expect(t).toHaveLength(1);
    expect(t[0].resultado).toBe('sucesso');
    expect((await lerMensagem(id)).estado).toBe('enviada');
  });

  it('job repetido depois de enviada não envia de novo (RN-10)', async () => {
    const s = await criarCenarioMensagem();
    const id = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, destinatarioE164: s.telefone });
    const h = criarWhatsappReserva({ whatsapp: () => criarWhatsAppSimulado() });
    await h.processar({ mensagemId: id }, ctxJob());
    await h.processar({ mensagemId: id }, ctxJob());
    expect(await chamadasDaChave(`${s.reservaId}:confirmacao:0`)).toHaveLength(1);
    expect(await lerTentativas(id)).toHaveLength(1);
  });
});
