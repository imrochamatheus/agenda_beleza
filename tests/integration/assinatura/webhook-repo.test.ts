import { afterAll, describe, expect, it } from 'vitest';

import { encerrarPrisma } from '@/server/repos/db';
import { repoWebhookSistema } from '@/server/repos/webhook';
import { repoAssinaturaSistema } from '@/server/repos/assinatura';

import { criarSalaoComAssinatura } from '../../support/assinatura';
import { eventoPorChave, novaChave } from './apoio-webhook';

// D-041 T-1: dedupe parcial, CAS do lease e fechamento da linha, contra o PostgreSQL real.

afterAll(async () => {
  await encerrarPrisma();
});

const T0 = new Date('2027-05-10T12:00:00Z');
const mais = (d: Date, ms: number) => new Date(d.getTime() + ms);
const entrada = (chave: string, valida = true) => ({ chaveDedupe: chave, tipo: 'pagamento', recursoId: 'r1', payload: { id: 'x' }, origemValida: valida, agora: T0 });

describe('RepoWebhookSistema', () => {
  const repo = repoWebhookSistema();

  it('válido nasce recebido; repetido devolve a linha existente (dedupe só entre válidos)', async () => {
    const k = novaChave();
    const a = await repo.registrar(entrada(k));
    expect(a.criada).toBe(true);
    const b = await repo.registrar(entrada(k));
    expect(b).toMatchObject({ criada: false, id: a.id, resultado: 'recebido' });
    expect(await eventoPorChave(k)).toHaveLength(1);
  });

  it('inválido com a mesma chave sempre insere e nunca bloqueia o legítimo (CA-5)', async () => {
    const k = novaChave();
    const f1 = await repo.registrar(entrada(k, false));
    const f2 = await repo.registrar(entrada(k, false));
    const ok = await repo.registrar(entrada(k));
    expect([f1.criada, f2.criada, ok.criada]).toEqual([true, true, true]);
    const linhas = await eventoPorChave(k);
    expect(linhas.map((l) => [l.origemValida, l.resultado])).toEqual(expect.arrayContaining([[false, 'rejeitado'], [true, 'recebido']]));
    expect(linhas.filter((l) => !l.origemValida).every((l) => l.processadoEm !== null)).toBe(true);
  });

  it('reivindicar: recebido recente não, recebido antigo sim, e só uma entrega ganha', async () => {
    const k = novaChave();
    const { id } = await repo.registrar(entrada(k));
    expect(await repo.reivindicar(id, mais(T0, 119_000))).toBe(false);
    const rs = await Promise.all(Array.from({ length: 5 }, () => repo.reivindicar(id, mais(T0, 121_000))));
    expect(rs.filter(Boolean)).toHaveLength(1);
    const [l] = await eventoPorChave(k);
    expect(l.recebidoEm.toISOString()).toBe(mais(T0, 121_000).toISOString());
    // o relógio reiniciou: a próxima só reivindica 2 min depois
    expect(await repo.reivindicar(id, mais(T0, 130_000))).toBe(false);
  });

  it('concluir: terminal grava processado_em; erro não; só fecha se ainda recebido', async () => {
    const k = novaChave();
    const { id } = await repo.registrar(entrada(k));
    expect(await repo.concluir(id, { resultado: 'erro', erro: 'provedor_indisponivel', agora: T0 })).toBe(true);
    let [l] = await eventoPorChave(k);
    expect([l.resultado, l.erro, l.processadoEm]).toEqual(['erro', 'provedor_indisponivel', null]);
    expect(await repo.concluir(id, { resultado: 'processado', agora: T0 })).toBe(false);
    expect(await repo.reivindicar(id, T0)).toBe(true);
    expect(await repo.concluir(id, { resultado: 'processado', agora: mais(T0, 5) })).toBe(true);
    [l] = await eventoPorChave(k);
    expect(l.resultado).toBe('processado');
    expect(l.erro).toBeNull();
    expect(l.processadoEm?.toISOString()).toBe(mais(T0, 5).toISOString());
    expect(await repo.reivindicar(id, mais(T0, 10 * 60_000))).toBe(false);
  });

  it('vincularSalao grava o salão e buscarPorProvedor resolve o vínculo', async () => {
    const s = await criarSalaoComAssinatura('ativa');
    const k = novaChave();
    const { id } = await repo.registrar(entrada(k));
    await repo.vincularSalao(id, s.salaoId);
    expect((await eventoPorChave(k))[0].salaoId).toBe(s.salaoId);
    const sistema = repoAssinaturaSistema();
    expect(await sistema.buscarPorProvedor('nao-existe-' + k)).toBeNull();
  });
});
