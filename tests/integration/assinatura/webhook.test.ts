import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import { POST } from '@/app/api/webhooks/mercadopago/route';
import { notificacaoSimulada } from '@/server/integrations/mercadopago/webhook-simulado';
import { encerrarPrisma, obterPrisma } from '@/server/repos/db';
import { repoWebhookSistema } from '@/server/repos/webhook';

import { criarSalaoComAssinatura, iso, lerAssinatura, pagamentosDe, transicoesDe } from '../../support/assinatura';
import { AGORA, adulterada, enviar, espiar, eventoPorChave, eventosDoSalao, mp, novaChave, pedido, salaoComMp } from './apoio-webhook';

// D-041: webhook do MP contra o PostgreSQL real e o MP simulado (CA-1 a CA-10).

afterAll(async () => {
  await encerrarPrisma();
});

const corpoDe = async (r: Response) => (await r.json()) as Record<string, unknown>;
const D = (s: string) => new Date(s);
const nPagamento = (pagamentoId: string, chave = novaChave()) => notificacaoSimulada('pagamento', pagamentoId, AGORA, chave);
const nAssinatura = (simId: string, chave = novaChave()) => notificacaoSimulada('assinatura', simId, AGORA, chave);
const comDigitos = (n: ReturnType<typeof nPagamento>) => JSON.stringify({ ...(n.corpo as object), id: '4111111111111111', cartao: { numero: '4111 1111 1111 1111' }, action: 'x4111111111111111y' });

describe('origem inválida (CA-1, CA-4, CA-5)', () => {
  it('CA-1: assinatura adulterada → 401, linha rejeitada sem salão, nada muda e o provedor não é consultado', async () => {
    const s = await salaoComMp('suspensa');
    const { pagamentoId, notificacao } = await mp.aprovarCobranca(s.simId, { em: AGORA });
    const antes = await lerAssinatura(s.assinaturaId);
    const espiao = espiar();
    const r = await enviar(adulterada(notificacao), { mp: espiao });
    expect(r.status).toBe(401);
    expect(await corpoDe(r)).toEqual({ erro: 'nao_autorizado' });
    expect(espiao.chamadas).toEqual([]);
    const [l] = await eventoPorChave(notificacao.cabecalhos['x-request-id']);
    expect([l.origemValida, l.resultado, l.salaoId]).toEqual([false, 'rejeitado', null]);
    expect(l.processadoEm).not.toBeNull();
    expect(await lerAssinatura(s.assinaturaId)).toEqual(antes);
    expect(await transicoesDe(s.assinaturaId)).toHaveLength(0);
    expect(await pagamentosDe(s.assinaturaId)).toHaveLength(0);
    expect(pagamentoId).toBeTruthy();
  });

  it('sem x-request-id o evento é inválido mesmo com a assinatura certa; chave é o hash do corpo', async () => {
    const s = await salaoComMp('suspensa');
    const { pagamentoId } = await mp.aprovarCobranca(s.simId, { em: AGORA });
    const n = nPagamento(pagamentoId);
    const resto = Object.fromEntries(Object.entries(n.cabecalhos).filter(([k]) => k !== 'x-request-id'));
    const r = await enviar({ ...n, cabecalhos: resto });
    expect(r.status).toBe(401);
    expect(await pagamentosDe(s.assinaturaId)).toHaveLength(0);
  });

  it('CA-5: forjado com o mesmo x-request-id não bloqueia o legítimo, em qualquer ordem', async () => {
    for (const forjadoAntes of [true, false]) {
      const s = await salaoComMp('suspensa');
      const { pagamentoId } = await mp.aprovarCobranca(s.simId, { em: AGORA });
      const chave = novaChave();
      const legitimo = nPagamento(pagamentoId, chave);
      const forjado = adulterada(legitimo);
      if (forjadoAntes) expect((await enviar(forjado)).status).toBe(401);
      expect((await enviar(legitimo)).status).toBe(200);
      if (!forjadoAntes) expect((await enviar(forjado)).status).toBe(401);
      const linhas = await eventoPorChave(chave);
      expect(linhas.map((l) => [l.origemValida, l.resultado]).sort()).toEqual([[false, 'rejeitado'], [true, 'processado']]);
      expect((await lerAssinatura(s.assinaturaId)).estado).toBe('ativa');
    }
  });

  it('CA-4: corpo malicioso com 16 dígitos nunca chega a payload nem a erro (inválido e válido)', async () => {
    const s = await salaoComMp('suspensa');
    const { pagamentoId } = await mp.aprovarCobranca(s.simId, { em: AGORA });
    const valido = nPagamento(pagamentoId);
    const invalido = adulterada(nPagamento(pagamentoId));
    expect((await enviar(invalido, { corpo: comDigitos(invalido) })).status).toBe(401);
    expect((await enviar(valido, { corpo: comDigitos(valido) })).status).toBe(200);
    for (const n of [valido, invalido]) {
      const [l] = await eventoPorChave(n.cabecalhos['x-request-id']);
      expect(l.recebidoEm).toBeTruthy();
      expect(l.tipo).not.toBeNull();
      expect(JSON.stringify(l.payload)).not.toMatch(/\d{13,}/);
      expect(l.erro ?? '').not.toMatch(/\d{13,}/);
      expect(JSON.stringify(l.payload)).not.toMatch(/cartao/);
    }
  });

  it('limite global de inválidos: acima dele, 401 sem persistir', async () => {
    const agora = D('2031-01-01T00:00:00Z');
    const base = notificacaoSimulada('pagamento', randomUUID(), agora);
    const chaves: string[] = [];
    const resultados: number[] = [];
    for (let i = 0; i < 4; i++) {
      const n = adulterada(notificacaoSimulada('pagamento', randomUUID(), agora, novaChave()));
      chaves.push(n.cabecalhos['x-request-id']);
      resultados.push((await enviar(n, { agora, limiteInvalidos: 2 })).status);
    }
    expect(resultados).toEqual([401, 401, 401, 401]);
    const persistidas = await Promise.all(chaves.map((c) => eventoPorChave(c)));
    expect(persistidas.map((l) => l.length)).toEqual([1, 1, 0, 0]);
    expect(base).toBeTruthy();
  });
});

describe('efeito e idempotência (CA-2, CA-3, CA-6, CA-9)', () => {
  it('CA-2: aprovado 3 vezes em série: 200, 1 processado, 1 pagamento, 1 transição com evento_id', async () => {
    const s = await salaoComMp('suspensa');
    const { pagamentoId } = await mp.aprovarCobranca(s.simId, { em: AGORA });
    const n = nPagamento(pagamentoId);
    const rs = [await enviar(n), await enviar(n), await enviar(n)];
    expect(rs.map((r) => r.status)).toEqual([200, 200, 200]);
    const ev = await eventosDoSalao(s.salaoId);
    expect(ev.map((e) => e.resultado)).toEqual(['processado']);
    expect(ev[0].processadoEm).not.toBeNull();
    expect(await pagamentosDe(s.assinaturaId)).toHaveLength(1);
    const t = await transicoesDe(s.assinaturaId);
    expect(t).toHaveLength(1);
    expect(t[0].eventoId).toBe(ev[0].id);
    const a = await lerAssinatura(s.assinaturaId);
    expect([a.estado, iso(a.periodoPagoAte)]).toEqual(['ativa', '2027-06-10T12:00:00.000Z']);
  });

  it('CA-2: aprovado 3 vezes em paralelo com a mesma chave: 200 nas 3 e um só efeito', async () => {
    const s = await salaoComMp('suspensa');
    const { pagamentoId } = await mp.aprovarCobranca(s.simId, { em: AGORA });
    const n = nPagamento(pagamentoId);
    const rs = await Promise.all([enviar(n), enviar(n), enviar(n)]);
    expect(rs.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(await eventoPorChave(n.cabecalhos['x-request-id'])).toHaveLength(1);
    expect((await eventosDoSalao(s.salaoId)).map((e) => e.resultado)).toEqual(['processado']);
    expect(await pagamentosDe(s.assinaturaId)).toHaveLength(1);
    expect(await transicoesDe(s.assinaturaId)).toHaveLength(1);
  });

  it('CA-3: o estado consultado vence o payload (recusado), nunca aprova', async () => {
    const s = await salaoComMp('ativa', { periodoPagoAte: D('2027-05-20T00:00:00Z') });
    const { pagamentoId } = await mp.falharCobranca(s.simId, { em: AGORA });
    const n = nPagamento(pagamentoId);
    const corpo = JSON.stringify({ ...(n.corpo as object), action: 'payment.approved', status: 'approved' });
    expect((await enviar(n, { corpo })).status).toBe(200);
    const pg = await pagamentosDe(s.assinaturaId);
    expect(pg.map((p) => p.status)).toEqual(['recusado']);
    const a = await lerAssinatura(s.assinaturaId);
    expect(a.estado).toBe('em_carencia');
    expect(iso(a.periodoPagoAte)).toBe('2027-05-20T00:00:00.000Z');
  });

  it('CA-6: duas notificações distintas do mesmo pagamento: 2 processados e período estendido uma vez', async () => {
    const s = await salaoComMp('ativa', { periodoPagoAte: D('2027-05-20T00:00:00Z') });
    const { pagamentoId } = await mp.aprovarCobranca(s.simId, { em: AGORA });
    const rs = [await enviar(nPagamento(pagamentoId)), await enviar(nPagamento(pagamentoId))];
    expect(rs.map((r) => r.status)).toEqual([200, 200]);
    const ev = await eventosDoSalao(s.salaoId);
    expect(ev.map((e) => e.resultado)).toEqual(['processado', 'processado']);
    expect(ev.map((e) => e.erro).sort()).toEqual([null, 'pagamento_duplicado']);
    expect(await pagamentosDe(s.assinaturaId)).toHaveLength(1);
    expect(iso((await lerAssinatura(s.assinaturaId)).periodoPagoAte)).toBe('2027-06-20T00:00:00.000Z');
  });

  it('CA-9: aplicado também em suspensa, em_carencia e com o salão suspenso manualmente', async () => {
    const casos: [Parameters<typeof salaoComMp>[0], Parameters<typeof salaoComMp>[1]][] = [
      ['suspensa', {}],
      ['em_carencia', { carenciaAte: D('2027-05-12T00:00:00Z'), primeiraFalhaEm: D('2027-05-09T00:00:00Z') }],
    ];
    for (const [estado, campos] of casos) {
      const s = await salaoComMp(estado, campos);
      await obterPrisma().salao.update({ where: { id: s.salaoId }, data: { suspensoManualEm: AGORA } });
      const { pagamentoId } = await mp.aprovarCobranca(s.simId, { em: AGORA });
      expect((await enviar(nPagamento(pagamentoId))).status).toBe(200);
      expect((await lerAssinatura(s.assinaturaId)).estado).toBe('ativa');
    }
  });

  it('assinatura autorizada inicia o teste (CAS de D-040) com evento_id; repetida não duplica', async () => {
    const s = await salaoComMp('pendente');
    await mp.autorizar(s.simId, { em: AGORA });
    const n = nAssinatura(s.simId);
    expect((await enviar(n)).status).toBe(200);
    expect((await enviar(nAssinatura(s.simId))).status).toBe(200);
    const a = await lerAssinatura(s.assinaturaId);
    expect(a.estado).toBe('em_teste');
    const t = await transicoesDe(s.assinaturaId);
    expect(t).toHaveLength(1);
    const ev = await eventosDoSalao(s.salaoId);
    expect(ev.map((e) => e.id)).toContain(t[0].eventoId);
    expect(ev.map((e) => e.resultado)).toEqual(['processado', 'processado']);
  });

  it('assinatura cancelada no provedor aplica o cancelamento', async () => {
    const s = await salaoComMp('ativa', { periodoPagoAte: D('2027-05-20T00:00:00Z') });
    await mp.cancelar(s.simId, { em: AGORA });
    expect((await enviar(nAssinatura(s.simId))).status).toBe(200);
    expect((await lerAssinatura(s.assinaturaId)).estado).toBe('cancelada');
  });

  it('assinatura ainda pendente no provedor: ignorada com código fechado', async () => {
    const s = await salaoComMp('pendente');
    expect((await enviar(nAssinatura(s.simId))).status).toBe(200);
    const [e] = await eventosDoSalao(s.salaoId);
    expect([e.resultado, e.erro]).toEqual(['ignorado', 'estado_pendente']);
    expect((await lerAssinatura(s.assinaturaId)).estado).toBe('pendente');
  });

  it('evento que a máquina ignora vira ignorado, sem efeito', async () => {
    const s = await salaoComMp('encerrada');
    const { pagamentoId } = await mp.aprovarCobranca(s.simId, { em: AGORA });
    expect((await enviar(nPagamento(pagamentoId))).status).toBe(200);
    const [e] = await eventosDoSalao(s.salaoId);
    expect([e.resultado, e.erro]).toEqual(['ignorado', 'assinatura_encerrada']);
    expect((await lerAssinatura(s.assinaturaId)).estado).toBe('encerrada');
  });
});

describe('recurso desconhecido (CA-7) e isolamento', () => {
  it('assinatura do provedor sem vínculo local e id inexistente: 200, ignorado, sem efeito', async () => {
    const s = await criarSalaoComAssinatura('ativa');
    const { assinaturaId: solto } = await mp.criarAssinatura({ salaoId: s.salaoId, emailPagador: 'a@b.com', urlRetorno: 'http://localhost:3000/x' });
    await mp.autorizar(solto, { em: AGORA });
    const desconhecida = await enviar(nAssinatura(solto));
    expect(desconhecida.status).toBe(200);
    const inexistente = await enviar(nAssinatura(randomUUID()));
    expect(inexistente.status).toBe(200);
    const { pagamentoId } = await mp.aprovarCobranca(solto, { em: AGORA });
    expect((await enviar(nPagamento(pagamentoId))).status).toBe(200);
    const idsRecurso = [solto, pagamentoId];
    expect((await lerAssinatura(s.assinaturaId)).estado).toBe('ativa');
    expect(await pagamentosDe(s.assinaturaId)).toHaveLength(0);
    const erros = await obterPrisma().webhookEvento.findMany({ where: { recursoId: { in: idsRecurso } } });
    expect(erros.map((e) => [e.resultado, e.erro])).toEqual([['ignorado', 'assinatura_desconhecida'], ['ignorado', 'assinatura_desconhecida']]);
  });

  it('id inexistente no provedor: ignorado recurso_inexistente', async () => {
    const id = randomUUID();
    const n = nAssinatura(id);
    expect((await enviar(n)).status).toBe(200);
    const [e] = await eventoPorChave(n.cabecalhos['x-request-id']);
    expect([e.resultado, e.erro, e.salaoId]).toEqual(['ignorado', 'recurso_inexistente', null]);
  });

  it('vínculo de outro salão: vinculo_invalido, nada muda; o salão B nunca é tocado', async () => {
    const a = await criarSalaoComAssinatura('suspensa');
    const b = await salaoComMp('suspensa');
    const { assinaturaId: simDeB } = await mp.criarAssinatura({ salaoId: b.salaoId, emailPagador: 'a@b.com', urlRetorno: 'http://localhost:3000/x' });
    await mp.autorizar(simDeB, { em: AGORA });
    await obterPrisma().assinatura.update({ where: { id: a.assinaturaId }, data: { provedorAssinaturaId: simDeB } });
    const antesB = await lerAssinatura(b.assinaturaId);
    expect((await enviar(nAssinatura(simDeB))).status).toBe(200);
    const [e] = await eventosDoSalao(a.salaoId);
    expect([e.resultado, e.erro]).toEqual(['ignorado', 'vinculo_invalido']);
    expect((await lerAssinatura(a.assinaturaId)).estado).toBe('suspensa');
    expect(await lerAssinatura(b.assinaturaId)).toEqual(antesB);
  });

  it('pagamento do salão A só afeta A', async () => {
    const a = await salaoComMp('suspensa');
    const b = await salaoComMp('suspensa');
    const antesB = await lerAssinatura(b.assinaturaId);
    const { pagamentoId } = await mp.aprovarCobranca(a.simId, { em: AGORA });
    await enviar(nPagamento(pagamentoId));
    expect((await lerAssinatura(a.assinaturaId)).estado).toBe('ativa');
    expect(await lerAssinatura(b.assinaturaId)).toEqual(antesB);
    expect(await eventosDoSalao(b.salaoId)).toHaveLength(0);
  });
});

describe('falha transitória e lease (CA-8)', () => {
  it('ErroProvedor → 503 com Retry-After, linha erro; a reentrega reprocessa a mesma linha uma vez', async () => {
    const s = await salaoComMp('suspensa');
    const { pagamentoId } = await mp.aprovarCobranca(s.simId, { em: AGORA });
    const n = nPagamento(pagamentoId);
    await mp.forcarErro('consultarPagamento');
    const r1 = await enviar(n);
    expect(r1.status).toBe(503);
    expect(r1.headers.get('retry-after')).toBe('60');
    expect(await corpoDe(r1)).toEqual({ erro: 'indisponivel' });
    const [e1] = await eventoPorChave(n.cabecalhos['x-request-id']);
    expect([e1.resultado, e1.erro, e1.processadoEm]).toEqual(['erro', 'provedor_indisponivel', null]);
    expect((await lerAssinatura(s.assinaturaId)).estado).toBe('suspensa');
    expect(await pagamentosDe(s.assinaturaId)).toHaveLength(0);

    const r2 = await enviar(n, { agora: new Date(AGORA.getTime() + 1000) });
    expect(r2.status).toBe(200);
    const linhas = await eventoPorChave(n.cabecalhos['x-request-id']);
    expect(linhas).toHaveLength(1);
    expect(linhas[0].id).toBe(e1.id);
    expect([linhas[0].resultado, linhas[0].erro]).toEqual(['processado', null]);
    expect(await pagamentosDe(s.assinaturaId)).toHaveLength(1);
    expect((await lerAssinatura(s.assinaturaId)).estado).toBe('ativa');
  });

  it('consulta de assinatura também falha com 503', async () => {
    const s = await salaoComMp('pendente');
    await mp.forcarErro('consultarAssinatura');
    expect((await enviar(nAssinatura(s.simId))).status).toBe(503);
  });

  it('recebido recente (outra entrega em andamento): 200 sem processar; recebido antigo: reprocessa', async () => {
    const s = await salaoComMp('suspensa');
    const { pagamentoId } = await mp.aprovarCobranca(s.simId, { em: AGORA });
    const n = nPagamento(pagamentoId);
    await repoWebhookSistema().registrar({
      chaveDedupe: n.cabecalhos['x-request-id'], tipo: 'pagamento', recursoId: null, payload: {}, origemValida: true, agora: AGORA,
    });
    expect((await enviar(n, { agora: new Date(AGORA.getTime() + 60_000) })).status).toBe(200);
    expect(await pagamentosDe(s.assinaturaId)).toHaveLength(0);
    expect((await enviar(n, { agora: new Date(AGORA.getTime() + 3 * 60_000) })).status).toBe(200);
    expect(await pagamentosDe(s.assinaturaId)).toHaveLength(1);
    expect((await eventoPorChave(n.cabecalhos['x-request-id']))[0].resultado).toBe('processado');
  });

  it('persiste ANTES de consultar e consulta FORA de transação', async () => {
    const s = await salaoComMp('suspensa');
    const { pagamentoId } = await mp.aprovarCobranca(s.simId, { em: AGORA });
    const n = nPagamento(pagamentoId);
    const observado: { linha?: string; ociosas?: number } = {};
    const porta = espiar();
    const original = porta.consultarPagamento;
    porta.consultarPagamento = async (id) => {
      const [l] = await eventoPorChave(n.cabecalhos['x-request-id']);
      observado.linha = l?.resultado;
      const [{ n: ociosas }] = await obterPrisma().$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_stat_activity
         WHERE datname = current_database() AND state LIKE 'idle in transaction%'`;
      observado.ociosas = ociosas;
      return original(id);
    };
    expect((await enviar(n, { mp: porta })).status).toBe(200);
    expect(observado).toEqual({ linha: 'recebido', ociosas: 0 });
  });
});

describe('corpo e método (CA-10)', () => {
  it('acima de 16 KiB (em streaming e declarado): 413, sem consultar, sem gravar o corpo', async () => {
    const n = nPagamento(randomUUID());
    const espiao = espiar();
    const grande = JSON.stringify({ ...(n.corpo as object), lixo: 'x'.repeat(17 * 1024) });
    const r = await enviar(n, { mp: espiao, corpo: grande });
    expect(r.status).toBe(413);
    expect(await corpoDe(r)).toEqual({ erro: 'invalido' });
    const r2 = await enviar(n, { mp: espiao, corpo: grande, cabecalhos: { 'content-length': String(grande.length) } });
    expect(r2.status).toBe(413);
    expect(espiao.chamadas).toEqual([]);
    const linhas = await obterPrisma().webhookEvento.findMany({ where: { chaveDedupe: n.cabecalhos['x-request-id'] } });
    for (const l of linhas) {
      expect([l.origemValida, l.resultado, l.payload]).toEqual([false, 'rejeitado', {}]);
    }
  });

  it('JSON inválido: 400 sem lançar e sem consultar', async () => {
    const n = nPagamento(randomUUID());
    const espiao = espiar();
    const r = await enviar(n, { mp: espiao, corpo: '{nao-e-json' });
    expect(r.status).toBe(400);
    expect(espiao.chamadas).toEqual([]);
    const [l] = await eventoPorChave(n.cabecalhos['x-request-id']);
    expect([l.resultado, l.payload]).toEqual(['rejeitado', {}]);
  });

  it('método diferente de POST: 405', async () => {
    const n = nPagamento(randomUUID());
    const { tratarWebhook } = await import('@/server/assinatura/webhook-http');
    const r = await tratarWebhook(new Request('http://localhost:3000/api/webhooks/mercadopago', { method: 'GET' }));
    expect(r.status).toBe(405);
    expect(r.headers.get('allow')).toBe('POST');
    expect(n).toBeTruthy();
  });
});

describe('rota POST com o adaptador simulado do ambiente', () => {
  it('assinatura inválida → 401 e a rota registra a linha', async () => {
    const n = adulterada(nPagamento(randomUUID()));
    const r = await POST(pedido(n));
    expect(r.status).toBe(401);
    expect(await eventoPorChave(n.cabecalhos['x-request-id'])).toHaveLength(1);
  });
});
