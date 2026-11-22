import { randomUUID } from 'node:crypto';

import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DIAS_TESTE, PRECO_MENSAL_CENTAVOS } from '@/config/plano';
import {
  ErroProvedor,
  OperacaoInvalidaNoProvedor,
  RecursoNaoEncontradoNoProvedor,
} from '@/server/integrations/mercadopago/port';
import type { NotificacaoWebhook } from '@/server/integrations/mercadopago/port';
import { criarMercadoPagoSimulado } from '@/server/integrations/mercadopago/simulado';
import { criarPrisma } from '@/server/repos/db';
import { repoSimMercadoPago } from '@/server/repos/sim-mercadopago';
import { emTransacao } from '@/server/repos/transacao';

import { urlDoWorker } from '../../support/db';
import { conectar, emailNovo } from '../../support/sql';

// MP simulado contra o PostgreSQL real (RN-12, RN-15, RN-17, RN-18): CA-15, CA-16 (ponta a ponta),
// CA-17, CA-18 e disparos concorrentes (dba.md §2.5). Relógio controlado: `agora` fixo e instantes
// explícitos nos disparos. Conferências de "nada mudou" por SQL direto (driver pg).

const APP_URL = 'http://localhost:3000';
const AGORA = new Date('2026-12-15T12:00:00.000Z');
const T = new Date('2026-12-01T15:30:00.000Z');
const DIA_MS = 86_400_000;

const mp = criarMercadoPagoSimulado({ appUrl: APP_URL, agora: () => AGORA });

let c: pg.Client;

beforeAll(async () => {
  c = await conectar();
});
afterAll(async () => {
  await c.end();
});

async function nova(salaoId: string = randomUUID()): Promise<string> {
  const { assinaturaId } = await mp.criarAssinatura({
    salaoId,
    emailPagador: emailNovo(),
    urlRetorno: `${APP_URL}/assinatura/retorno`,
  });
  return assinaturaId;
}

async function autorizada(em: Date = T): Promise<string> {
  const id = await nova();
  await mp.autorizar(id, { em });
  return id;
}

/** Linha bruta da assinatura (estado e datas), para conferir "nada mudou". */
async function linha(id: string) {
  const r = await c.query(
    `SELECT estado::text AS estado, autorizada_em, proxima_cobranca_em, cancelada_em, atualizado_em
     FROM sim_mp_assinatura WHERE id = $1`,
    [id],
  );
  return r.rows[0] as {
    estado: string;
    autorizada_em: Date | null;
    proxima_cobranca_em: Date | null;
    cancelada_em: Date | null;
    atualizado_em: Date;
  };
}

async function contar(tabela: 'sim_mp_pagamento' | 'sim_mp_adiamento', assinaturaId: string): Promise<number> {
  const r = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${tabela} WHERE assinatura_id = $1`, [
    assinaturaId,
  ]);
  return r.rows[0].n;
}

async function totalAssinaturas(): Promise<number> {
  const r = await c.query<{ n: number }>('SELECT count(*)::int AS n FROM sim_mp_assinatura');
  return r.rows[0].n;
}

describe('CA-15: ciclo de vida da assinatura simulada', () => {
  it('CA-15: criar → pendente, salaoId = A, valor de plano.ts e urlCheckout em /dev/mp-checkout', async () => {
    const salaoA = randomUUID();
    const email = emailNovo();
    const r = await mp.criarAssinatura({ salaoId: salaoA, emailPagador: email, urlRetorno: `${APP_URL}/volta?x=1` });

    expect(r.urlCheckout.startsWith(`${APP_URL}/dev/mp-checkout`)).toBe(true);
    expect(r.urlCheckout).toBe(`${APP_URL}/dev/mp-checkout?assinatura=${r.assinaturaId}`);
    expect(await mp.consultarAssinatura(r.assinaturaId)).toEqual({
      id: r.assinaturaId,
      salaoId: salaoA,
      estado: 'pendente',
      valorCentavos: PRECO_MENSAL_CENTAVOS,
      autorizadaEm: null,
      proximaCobrancaEm: null,
      canceladaEm: null,
    });
    expect(PRECO_MENSAL_CENTAVOS).toBe(7900);

    const bruta = await c.query(
      'SELECT referencia_externa, email_pagador, url_retorno, valor_centavos FROM sim_mp_assinatura WHERE id = $1',
      [r.assinaturaId],
    );
    expect(bruta.rows).toEqual([
      { referencia_externa: salaoA, email_pagador: email, url_retorno: `${APP_URL}/volta?x=1`, valor_centavos: 7900 },
    ]);
  });

  it('CA-15: appUrl com barra final não duplica a barra no urlCheckout', async () => {
    const r = await criarMercadoPagoSimulado({ appUrl: `${APP_URL}/` }).criarAssinatura({
      salaoId: randomUUID(),
      emailPagador: emailNovo(),
      urlRetorno: `${APP_URL}/volta`,
    });
    expect(r.urlCheckout).toBe(`${APP_URL}/dev/mp-checkout?assinatura=${r.assinaturaId}`);
  });

  it('CA-15: autorizar no instante T → autorizada, próxima cobrança = T + 30 dias (atualizado_em avança)', async () => {
    const id = await nova();
    const antes = await linha(id);
    await mp.autorizar(id, { em: T });

    const a = await mp.consultarAssinatura(id);
    expect(a.estado).toBe('autorizada');
    expect(a.autorizadaEm?.toISOString()).toBe(T.toISOString());
    expect(a.proximaCobrancaEm?.toISOString()).toBe(new Date(T.getTime() + DIAS_TESTE * DIA_MS).toISOString());
    expect(a.proximaCobrancaEm?.toISOString()).toBe('2026-12-31T15:30:00.000Z');
    expect(a.canceladaEm).toBeNull();
    expect((await linha(id)).atualizado_em.getTime()).toBeGreaterThan(antes.atualizado_em.getTime());
  });

  it('CA-15: autorizar sem instante usa o relógio do adaptador', async () => {
    const id = await nova();
    await mp.autorizar(id);
    const a = await mp.consultarAssinatura(id);
    expect(a.autorizadaEm?.toISOString()).toBe(AGORA.toISOString());
    expect(a.proximaCobrancaEm?.toISOString()).toBe('2027-01-14T12:00:00.000Z');
  });

  it('CA-15: cobrança aprovada → consultarPagamento aprovado, 7900, assinatura certa; próxima cobrança + 1 mês', async () => {
    const id = await autorizada();
    const em = new Date('2026-12-31T15:31:00.000Z');
    const { pagamentoId } = await mp.aprovarCobranca(id, { em });

    expect(await mp.consultarPagamento(pagamentoId)).toEqual({
      id: pagamentoId,
      assinaturaId: id,
      status: 'aprovado',
      valorCentavos: 7900,
      ocorridoEm: em,
    });
    const a = await mp.consultarAssinatura(id);
    expect(a.estado).toBe('autorizada');
    // 31/dez + 1 mês = 31/jan (somarUmMes sobre a próxima cobrança lida sob trava).
    expect(a.proximaCobrancaEm?.toISOString()).toBe('2027-01-31T15:30:00.000Z');

    await mp.aprovarCobranca(id, { em: new Date('2027-01-31T16:00:00.000Z') });
    // 31/jan + 1 mês = 28/fev (último dia do mês).
    expect((await mp.consultarAssinatura(id)).proximaCobrancaEm?.toISOString()).toBe('2027-02-28T15:30:00.000Z');
  });

  it('CA-15: cobrança aprovada sem instante grava o relógio do adaptador', async () => {
    const id = await autorizada();
    const { pagamentoId } = await mp.aprovarCobranca(id);
    expect((await mp.consultarPagamento(pagamentoId)).ocorridoEm.toISOString()).toBe(AGORA.toISOString());
  });

  it('CA-15: falha de cobrança → pagamento recusado; a assinatura continua autorizada com a mesma data', async () => {
    const id = await autorizada();
    const antes = await mp.consultarAssinatura(id);
    const em = new Date('2026-12-31T16:00:00.000Z');
    const { pagamentoId } = await mp.falharCobranca(id, { em });

    expect(await mp.consultarPagamento(pagamentoId)).toEqual({
      id: pagamentoId,
      assinaturaId: id,
      status: 'recusado',
      valorCentavos: 7900,
      ocorridoEm: em,
    });
    expect(await mp.consultarAssinatura(id)).toEqual(antes);
    const sem = await mp.falharCobranca(id);
    expect((await mp.consultarPagamento(sem.pagamentoId)).ocorridoEm.toISOString()).toBe(AGORA.toISOString());
  });

  it('CA-15: cancelamento (evento) → cancelada, com o instante do disparo', async () => {
    const id = await autorizada();
    const em = new Date('2027-01-05T10:00:00.000Z');
    await mp.cancelar(id, { em });
    const a = await mp.consultarAssinatura(id);
    expect(a.estado).toBe('cancelada');
    expect(a.canceladaEm?.toISOString()).toBe(em.toISOString());
    // Pendente também pode ser cancelada pelo evento; sem instante usa o relógio.
    const p = await nova();
    await mp.cancelar(p);
    expect((await mp.consultarAssinatura(p)).canceladaEm?.toISOString()).toBe(AGORA.toISOString());
  });

  it('CA-15: cobrar uma assinatura pendente → OperacaoInvalidaNoProvedor, sem novo pagamento', async () => {
    const id = await nova();
    await expect(mp.aprovarCobranca(id)).rejects.toBeInstanceOf(OperacaoInvalidaNoProvedor);
    await expect(mp.falharCobranca(id)).rejects.toBeInstanceOf(OperacaoInvalidaNoProvedor);
    expect(await contar('sim_mp_pagamento', id)).toBe(0);
    expect((await mp.consultarAssinatura(id)).estado).toBe('pendente');
  });

  it('CA-15: cobrar uma assinatura cancelada → OperacaoInvalidaNoProvedor, sem novo pagamento', async () => {
    const id = await autorizada();
    await mp.aprovarCobranca(id);
    await mp.cancelar(id);
    const antes = await linha(id);
    await expect(mp.aprovarCobranca(id)).rejects.toBeInstanceOf(OperacaoInvalidaNoProvedor);
    await expect(mp.falharCobranca(id)).rejects.toBeInstanceOf(OperacaoInvalidaNoProvedor);
    expect(await contar('sim_mp_pagamento', id)).toBe(1);
    expect(await linha(id)).toEqual(antes);
  });

  it('RN-17: autorizar uma autorizada ou cancelada, e cancelar (evento) uma cancelada → erro, sem efeito', async () => {
    const id = await autorizada();
    const autorizadaAntes = await linha(id);
    await expect(mp.autorizar(id, { em: AGORA })).rejects.toBeInstanceOf(OperacaoInvalidaNoProvedor);
    expect(await linha(id)).toEqual(autorizadaAntes);

    await mp.cancelar(id);
    const canceladaAntes = await linha(id);
    await expect(mp.autorizar(id)).rejects.toBeInstanceOf(OperacaoInvalidaNoProvedor);
    await expect(mp.cancelar(id)).rejects.toBeInstanceOf(OperacaoInvalidaNoProvedor);
    expect(await linha(id)).toEqual(canceladaAntes);
  });

  it('RN-12: cancelarAssinatura (porta) é idempotente e cancela pendente ou autorizada', async () => {
    const id = await autorizada();
    await mp.cancelarAssinatura(id);
    const a = await mp.consultarAssinatura(id);
    expect(a.estado).toBe('cancelada');
    expect(a.canceladaEm?.toISOString()).toBe(AGORA.toISOString());
    const antes = await linha(id);
    await expect(mp.cancelarAssinatura(id)).resolves.toBeUndefined();
    expect(await linha(id)).toEqual(antes);

    const p = await nova();
    await mp.cancelarAssinatura(p);
    expect((await mp.consultarAssinatura(p)).estado).toBe('cancelada');
  });

  it('RN-12: ID desconhecido ou que não é UUID → RecursoNaoEncontradoNoProvedor em toda operação', async () => {
    for (const id of [randomUUID(), 'nao-e-uuid', '']) {
      await expect(mp.consultarAssinatura(id)).rejects.toBeInstanceOf(RecursoNaoEncontradoNoProvedor);
      await expect(mp.consultarPagamento(id)).rejects.toBeInstanceOf(RecursoNaoEncontradoNoProvedor);
      await expect(mp.cancelarAssinatura(id)).rejects.toBeInstanceOf(RecursoNaoEncontradoNoProvedor);
      await expect(mp.adiarProximaCobranca(id, new Date(AGORA.getTime() + DIA_MS))).rejects.toBeInstanceOf(
        RecursoNaoEncontradoNoProvedor,
      );
      await expect(mp.urlAtualizarMeioPagamento(id)).rejects.toBeInstanceOf(RecursoNaoEncontradoNoProvedor);
      await expect(mp.autorizar(id)).rejects.toBeInstanceOf(RecursoNaoEncontradoNoProvedor);
      await expect(mp.aprovarCobranca(id)).rejects.toBeInstanceOf(RecursoNaoEncontradoNoProvedor);
      await expect(mp.falharCobranca(id)).rejects.toBeInstanceOf(RecursoNaoEncontradoNoProvedor);
      await expect(mp.cancelar(id)).rejects.toBeInstanceOf(RecursoNaoEncontradoNoProvedor);
      expect(await mp.listarAdiamentos(id)).toEqual([]);
    }
    // O ID de uma assinatura não é ID de pagamento.
    await expect(mp.consultarPagamento(await nova())).rejects.toBeInstanceOf(RecursoNaoEncontradoNoProvedor);
  });

  it('RN-12: ID que não é UUID é recusado sem consultar o banco (o erro forçado pendente não é consumido)', async () => {
    const id = await nova();
    await mp.forcarErro('consultarAssinatura');
    await expect(mp.consultarAssinatura('nao-e-uuid')).rejects.toBeInstanceOf(RecursoNaoEncontradoNoProvedor);
    // O erro forçado continua pendente: a próxima consulta válida o consome.
    await expect(mp.consultarAssinatura(id)).rejects.toBeInstanceOf(ErroProvedor);
    await expect(mp.consultarAssinatura(id)).resolves.toMatchObject({ id, estado: 'pendente' });
  });

  it('RN-12: criarAssinatura com entrada inválida → OperacaoInvalidaNoProvedor, sem gravar', async () => {
    const antes = await totalAssinaturas();
    const base = { salaoId: randomUUID(), emailPagador: emailNovo(), urlRetorno: `${APP_URL}/volta` };
    for (const e of [
      { ...base, salaoId: 'salao-a' },
      { ...base, emailPagador: 'nao-e-email' },
      { ...base, urlRetorno: '/relativa' },
      { ...base, urlRetorno: 'javascript:alert(1)' },
    ]) {
      await expect(mp.criarAssinatura(e)).rejects.toBeInstanceOf(OperacaoInvalidaNoProvedor);
    }
    expect(await totalAssinaturas()).toBe(antes);
  });

  it('CA-15: o estado gravado é lido por uma instância nova sobre outro cliente de banco (entre processos)', async () => {
    const outroCliente = criarPrisma(urlDoWorker(), { max: 2 });
    try {
      const outro = criarMercadoPagoSimulado({ appUrl: APP_URL, repo: repoSimMercadoPago(outroCliente) });
      const id = await autorizada();
      const { pagamentoId } = await mp.aprovarCobranca(id, { em: AGORA });

      expect(await outro.consultarAssinatura(id)).toEqual(await mp.consultarAssinatura(id));
      expect(await outro.consultarPagamento(pagamentoId)).toEqual(await mp.consultarPagamento(pagamentoId));

      // E o sentido inverso: o efeito gravado pelo outro cliente é visto pela aplicação.
      await outro.cancelar(id, { em: AGORA });
      expect((await mp.consultarAssinatura(id)).estado).toBe('cancelada');
    } finally {
      await outroCliente.$disconnect();
    }
  });

  it('RN-15: grava fora da transação de quem chama (o rollback do chamador não desfaz o efeito)', async () => {
    const id = await nova();
    const erro = new Error('falha proposital do chamador');
    await expect(
      emTransacao(async () => {
        await mp.autorizar(id, { em: T });
        throw erro;
      }),
    ).rejects.toBe(erro);
    expect((await mp.consultarAssinatura(id)).estado).toBe('autorizada');
  });
});

describe('CA-16: a notificação do disparo é válida para validarWebhook', () => {
  function adulterar(n: NotificacaoWebhook, f: (c: { cabecalhos: Record<string, string>; consulta: Record<string, string>; corpo: { data: { id: string } } }) => void): NotificacaoWebhook {
    const copia = structuredClone(n) as { cabecalhos: Record<string, string>; consulta: Record<string, string>; corpo: { data: { id: string } } };
    f(copia);
    return copia;
  }

  it('CA-16: autorização e cancelamento → { valida: true, tipo: assinatura, recursoId: id }', async () => {
    const id = await nova();
    const n = await mp.autorizar(id, { em: T });
    expect(n.consulta).toEqual({ 'data.id': id, type: 'subscription_preapproval' });
    expect(n.cabecalhos['x-signature']).toMatch(new RegExp(`^ts=${T.getTime()},v1=[0-9a-f]{64}$`));
    expect(await mp.validarWebhook(n)).toEqual({ valida: true, tipo: 'assinatura', recursoId: id });
    expect(await mp.validarWebhook(await mp.cancelar(id))).toEqual({ valida: true, tipo: 'assinatura', recursoId: id });
  });

  it('CA-16: cobrança aprovada e falha → { valida: true, tipo: pagamento, recursoId: pagamentoId }, consultável', async () => {
    const id = await autorizada();
    for (const disparo of [mp.aprovarCobranca, mp.falharCobranca]) {
      const { pagamentoId, notificacao } = await disparo(id, { em: AGORA });
      const v = await mp.validarWebhook(notificacao);
      expect(v).toEqual({ valida: true, tipo: 'pagamento', recursoId: pagamentoId });
      expect((await mp.consultarPagamento(pagamentoId)).assinaturaId).toBe(id);
    }
  });

  it('CA-16: data.id adulterado, cabeçalho de origem adulterado ou ausente → { valida: false }', async () => {
    const id = await nova();
    const outro = await nova();
    const n = await mp.autorizar(id);
    const casos = [
      adulterar(n, (x) => {
        x.consulta['data.id'] = outro;
        x.corpo.data.id = outro;
      }),
      adulterar(n, (x) => (x.consulta['data.id'] = outro)),
      adulterar(n, (x) => (x.cabecalhos['x-request-id'] = randomUUID())),
      // Troca o 1º dígito de v1 por outro (sempre diferente do original).
      adulterar(n, (x) => {
        x.cabecalhos['x-signature'] = x.cabecalhos['x-signature'].replace(/v1=(.)/, (_m, d: string) => `v1=${d === '0' ? '1' : '0'}`);
      }),
      adulterar(n, (x) => delete x.cabecalhos['x-signature']),
      adulterar(n, (x) => delete x.cabecalhos['x-request-id']),
    ];
    for (const caso of casos) expect(await mp.validarWebhook(caso)).toEqual({ valida: false });
    // A original continua válida (os casos acima não a alteraram).
    expect(await mp.validarWebhook(n)).toEqual({ valida: true, tipo: 'assinatura', recursoId: id });
  });
});

describe('CA-17: adiamento da próxima cobrança', () => {
  it('CA-17: D futura numa autorizada → registro (data anterior, D) e consultarAssinatura devolve D', async () => {
    const id = await autorizada();
    const anterior = (await mp.consultarAssinatura(id)).proximaCobrancaEm as Date;
    const D = new Date('2027-02-10T12:00:00.000Z');
    await mp.adiarProximaCobranca(id, D);

    expect((await mp.consultarAssinatura(id)).proximaCobrancaEm?.toISOString()).toBe(D.toISOString());
    const adiamentos = await mp.listarAdiamentos(id);
    expect(adiamentos.map((a) => [a.dataAnterior?.toISOString(), a.novaData.toISOString()])).toEqual([
      [anterior.toISOString(), D.toISOString()],
    ]);
    expect(adiamentos[0].criadoEm).toBeInstanceOf(Date);

    // Um segundo adiamento registra a data anterior = D; a ordem é a de registro.
    const D2 = new Date('2027-03-01T12:00:00.000Z');
    await mp.adiarProximaCobranca(id, D2);
    expect((await mp.listarAdiamentos(id)).map((a) => [a.dataAnterior?.toISOString(), a.novaData.toISOString()])).toEqual([
      [anterior.toISOString(), D.toISOString()],
      [D.toISOString(), D2.toISOString()],
    ]);
  });

  it('CA-17: D no passado, igual a agora ou inválida → OperacaoInvalidaNoProvedor e nada muda', async () => {
    const id = await autorizada();
    const antes = await linha(id);
    for (const D of [new Date(AGORA.getTime() - DIA_MS), AGORA, new Date(Number.NaN)]) {
      await expect(mp.adiarProximaCobranca(id, D)).rejects.toBeInstanceOf(OperacaoInvalidaNoProvedor);
    }
    await expect(mp.adiarProximaCobranca(id, '2027-02-10' as unknown as Date)).rejects.toBeInstanceOf(
      OperacaoInvalidaNoProvedor,
    );
    expect(await linha(id)).toEqual(antes);
    expect(await contar('sim_mp_adiamento', id)).toBe(0);
  });

  it('CA-17: numa assinatura pendente ou cancelada → OperacaoInvalidaNoProvedor e nada muda', async () => {
    const D = new Date(AGORA.getTime() + 10 * DIA_MS);
    const pendente = await nova();
    const cancelada = await autorizada();
    await mp.cancelar(cancelada);
    for (const id of [pendente, cancelada]) {
      const antes = await linha(id);
      await expect(mp.adiarProximaCobranca(id, D)).rejects.toBeInstanceOf(OperacaoInvalidaNoProvedor);
      expect(await linha(id)).toEqual(antes);
      expect(await contar('sim_mp_adiamento', id)).toBe(0);
    }
  });
});

describe('CA-18: erro forçado por operação', () => {
  it('CA-18: erro forçado em cancelarAssinatura → ErroProvedor, continua autorizada; a seguinte cancela', async () => {
    const id = await autorizada();
    await mp.forcarErro('cancelarAssinatura');
    const p = mp.cancelarAssinatura(id);
    await expect(p).rejects.toBeInstanceOf(ErroProvedor);
    await expect(p).rejects.toMatchObject({ codigo: 'falha_provedor' });
    expect((await mp.consultarAssinatura(id)).estado).toBe('autorizada');

    await mp.cancelarAssinatura(id);
    expect((await mp.consultarAssinatura(id)).estado).toBe('cancelada');
  });

  it('RN-18: o erro forçado de uma operação não afeta as outras e vale para uma chamada por linha', async () => {
    const id = await autorizada();
    await mp.forcarErro('cancelarAssinatura');
    await mp.forcarErro('cancelarAssinatura');
    // Outras operações seguem normais enquanto o erro de cancelar está pendente.
    await expect(mp.consultarAssinatura(id)).resolves.toMatchObject({ estado: 'autorizada' });
    await expect(mp.cancelarAssinatura(id)).rejects.toBeInstanceOf(ErroProvedor);
    await expect(mp.cancelarAssinatura(id)).rejects.toBeInstanceOf(ErroProvedor);
    await expect(mp.cancelarAssinatura(id)).resolves.toBeUndefined();
  });

  it('RN-18: erro forçado em cada operação da porta → ErroProvedor sem efeito; a chamada seguinte é normal', async () => {
    const id = await autorizada();
    const { pagamentoId } = await mp.aprovarCobranca(id, { em: AGORA });

    const totalAntes = await totalAssinaturas();
    await mp.forcarErro('criarAssinatura');
    await expect(nova()).rejects.toBeInstanceOf(ErroProvedor);
    expect(await totalAssinaturas()).toBe(totalAntes);
    await expect(nova()).resolves.toMatch(/^[0-9a-f-]{36}$/);

    await mp.forcarErro('consultarAssinatura');
    await expect(mp.consultarAssinatura(id)).rejects.toBeInstanceOf(ErroProvedor);
    await expect(mp.consultarAssinatura(id)).resolves.toMatchObject({ id });

    await mp.forcarErro('consultarPagamento');
    await expect(mp.consultarPagamento(pagamentoId)).rejects.toBeInstanceOf(ErroProvedor);
    await expect(mp.consultarPagamento(pagamentoId)).resolves.toMatchObject({ id: pagamentoId });

    const D = new Date(AGORA.getTime() + 5 * DIA_MS);
    const antes = await linha(id);
    await mp.forcarErro('adiarProximaCobranca');
    await expect(mp.adiarProximaCobranca(id, D)).rejects.toBeInstanceOf(ErroProvedor);
    expect(await linha(id)).toEqual(antes);
    expect(await contar('sim_mp_adiamento', id)).toBe(0);
    await mp.adiarProximaCobranca(id, D);
    expect(await contar('sim_mp_adiamento', id)).toBe(1);
  });

  it('D-042: urlAtualizarMeioPagamento devolve a URL do checkout simulado sem efeito; erro forçado; cancelada é inválida', async () => {
    const id = await autorizada();
    const antes = await linha(id);
    await expect(mp.urlAtualizarMeioPagamento(id)).resolves.toBe(`${APP_URL}/dev/mp-checkout?assinatura=${id}`);
    expect(await linha(id)).toEqual(antes);

    await mp.forcarErro('urlAtualizarMeioPagamento');
    await expect(mp.urlAtualizarMeioPagamento(id)).rejects.toBeInstanceOf(ErroProvedor);
    expect(await linha(id)).toEqual(antes);
    await expect(mp.urlAtualizarMeioPagamento(id)).resolves.toContain(id);

    await mp.cancelarAssinatura(id);
    await expect(mp.urlAtualizarMeioPagamento(id)).rejects.toBeInstanceOf(OperacaoInvalidaNoProvedor);
  });

  it('RN-18: forcarErro recusa operação desconhecida sem gravar', async () => {
    await expect(mp.forcarErro('validarWebhook' as never)).rejects.toBeInstanceOf(RangeError);
    const r = await c.query<{ n: number }>('SELECT count(*)::int AS n FROM sim_mp_erro_forcado');
    expect(r.rows[0].n).toBe(0);
  });

  it('RN-18: o erro forçado configurado por um cliente de banco é consumido por uma instância sobre outro', async () => {
    const outroCliente = criarPrisma(urlDoWorker(), { max: 2 });
    try {
      const outro = criarMercadoPagoSimulado({ appUrl: APP_URL, repo: repoSimMercadoPago(outroCliente) });
      const id = await autorizada();
      await mp.forcarErro('cancelarAssinatura');
      await expect(outro.cancelarAssinatura(id)).rejects.toBeInstanceOf(ErroProvedor);
      await outro.cancelarAssinatura(id);
      expect((await mp.consultarAssinatura(id)).estado).toBe('cancelada');
    } finally {
      await outroCliente.$disconnect();
    }
  });
});

describe('Disparos concorrentes (dba.md §2.4 e §2.5)', () => {
  it('dois aprovarCobranca simultâneos → 2 pagamentos e próxima cobrança avançada 2 meses', async () => {
    const id = await autorizada(new Date('2026-11-10T09:00:00.000Z'));
    // Próxima: 2026-12-10T09:00Z; + 2 meses = 2027-02-10T09:00Z.
    const [a, b] = await Promise.all([mp.aprovarCobranca(id, { em: AGORA }), mp.aprovarCobranca(id, { em: AGORA })]);
    expect(a.pagamentoId).not.toBe(b.pagamentoId);
    expect(await contar('sim_mp_pagamento', id)).toBe(2);
    expect((await mp.consultarAssinatura(id)).proximaCobrancaEm?.toISOString()).toBe('2027-02-10T09:00:00.000Z');
  });

  it('6 aprovações simultâneas → 6 pagamentos e próxima cobrança + 6 meses (cálculo sob trava)', async () => {
    const id = await autorizada(new Date('2026-11-10T09:00:00.000Z'));
    await Promise.all(Array.from({ length: 6 }, () => mp.aprovarCobranca(id, { em: AGORA })));
    expect(await contar('sim_mp_pagamento', id)).toBe(6);
    expect((await mp.consultarAssinatura(id)).proximaCobrancaEm?.toISOString()).toBe('2027-06-10T09:00:00.000Z');
  });

  it('autorizar simultâneo → exatamente 1 sucesso e os demais OperacaoInvalidaNoProvedor', async () => {
    const id = await nova();
    const r = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => mp.autorizar(id, { em: new Date(T.getTime() + i) })));
    const ok = r.filter((x) => x.status === 'fulfilled');
    const recusas = r.filter((x): x is PromiseRejectedResult => x.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(recusas).toHaveLength(7);
    for (const x of recusas) expect(x.reason).toBeInstanceOf(OperacaoInvalidaNoProvedor);
    expect((await mp.consultarAssinatura(id)).estado).toBe('autorizada');
  });

  it('5 erros forçados e 12 consultas simultâneas → exatamente 5 ErroProvedor (consumo atômico, 3 rodadas)', async () => {
    const id = await nova();
    // Abre as conexões do pool antes do disparo: nenhuma consulta começa "atrasada" pela conexão.
    await Promise.all(Array.from({ length: 16 }, () => mp.listarAdiamentos(id)));
    for (let rodada = 0; rodada < 3; rodada++) {
      for (let i = 0; i < 5; i++) await mp.forcarErro('consultarAssinatura');
      const r = await Promise.allSettled(Array.from({ length: 12 }, () => mp.consultarAssinatura(id)));
      const falhas = r.filter((x): x is PromiseRejectedResult => x.status === 'rejected');
      expect(falhas).toHaveLength(5);
      for (const x of falhas) expect(x.reason).toBeInstanceOf(ErroProvedor);
      const pendentes = await c.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM sim_mp_erro_forcado WHERE operacao = 'consultarAssinatura'",
      );
      expect(pendentes.rows[0].n).toBe(0);
    }
  });

  it('operações concorrentes sobre a mesma assinatura (cobranças, adiamento, cancelamentos) terminam sem erro de banco', async () => {
    const id = await autorizada();
    await mp.forcarErro('cancelarAssinatura');
    const D = new Date(AGORA.getTime() + 20 * DIA_MS);
    const r = await Promise.allSettled([
      mp.aprovarCobranca(id, { em: AGORA }),
      mp.falharCobranca(id, { em: AGORA }),
      mp.adiarProximaCobranca(id, D),
      mp.cancelarAssinatura(id),
      mp.cancelarAssinatura(id),
      mp.aprovarCobranca(id, { em: AGORA }),
    ]);
    // Só erros da porta (nunca deadlock ou erro de banco); exatamente 1 ErroProvedor (o forçado).
    const motivos = r.filter((x): x is PromiseRejectedResult => x.status === 'rejected').map((x) => x.reason);
    for (const m of motivos) {
      expect(m instanceof ErroProvedor || m instanceof OperacaoInvalidaNoProvedor).toBe(true);
    }
    expect(motivos.filter((m) => m instanceof ErroProvedor)).toHaveLength(1);
    expect((await mp.consultarAssinatura(id)).estado).toBe('cancelada');
  });
});
