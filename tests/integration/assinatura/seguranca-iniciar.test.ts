import { afterAll, describe, expect, it } from 'vitest';

import { iniciarAssinatura } from '@/server/assinatura/assinatura.acao';
import { encerrarPrisma, obterPrisma } from '@/server/repos/db';

import { credencialDoGestor, credencialDoProfissional } from '../../support/auth';
import { criarDoisSaloes } from '../../support/factories';
import { vigenteDe, simDoSalao } from './apoio-iniciar';
import { criarAssinaturaEm } from '../../support/assinatura';

// D-040 CA-4 (nenhum dado de cartão), CA-5 (isolamento e papéis) e a ação ponta a ponta com o simulado.

afterAll(async () => {
  await encerrarPrisma();
});

const AGORA = new Date();

describe('ação iniciarAssinatura', () => {
  it('CA-5: o gestor do salão A só cria linha para A; B fica intocado', async () => {
    const { a, b } = await criarDoisSaloes();
    const r = await iniciarAssinatura.executar(await credencialDoGestor(a), undefined, { agora: AGORA });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.dados.resultado).toBe('iniciada');
    expect(await vigenteDe(a.salaoId)).toHaveLength(1);
    expect(await vigenteDe(b.salaoId)).toHaveLength(0);
    expect(await simDoSalao(a.salaoId)).toHaveLength(1);
    expect(await simDoSalao(b.salaoId)).toHaveLength(0);
    expect((await simDoSalao(a.salaoId))[0].emailPagador).toBe(a.gestor.email);
  });

  it('CA-5: profissional recebe 403 e anônimo 401, sem efeito', async () => {
    const { a } = await criarDoisSaloes();
    const p = await iniciarAssinatura.executar(await credencialDoProfissional(a), undefined, { agora: AGORA });
    expect(p).toMatchObject({ ok: false, status: 403 });
    const n = await iniciarAssinatura.executar({ token: 'x'.repeat(43) }, undefined, { agora: AGORA });
    expect(n).toMatchObject({ ok: false, status: 401 });
    expect(await vigenteDe(a.salaoId)).toHaveLength(0);
    expect(await simDoSalao(a.salaoId)).toHaveLength(0);
  });

  it('a capacidade `assinatura` vale em qualquer estado (suspensa recusa por ja_existe, não por política)', async () => {
    const { a } = await criarDoisSaloes();
    await criarAssinaturaEm(a.salaoId, 'suspensa');
    const r = await iniciarAssinatura.executar(await credencialDoGestor(a), undefined, { agora: AGORA });
    expect(r).toEqual({ ok: true, dados: { resultado: 'recusado', motivo: 'ja_existe' } });
  });
});

describe('CA-4: nenhum dado de cartão', () => {
  it('nenhuma coluna casa cart/card/cvv/pan (padrão revisado, sem falso positivo)', async () => {
    const colunas = await obterPrisma().$queryRaw<{ t: string; c: string }[]>`
      SELECT table_name AS t, column_name AS c FROM information_schema.columns
       WHERE table_schema = 'public'
         AND (column_name ~* '(^|_)(cart|cartao|card|cvv|cvc|pan)(_|$)' OR column_name ~* 'cart[aã]o|card_?number|numero_cartao')`;
    expect(colunas).toEqual([]);
  });

  it('o fluxo não grava sequência de 13 a 19 dígitos em webhook_evento.payload nem nas tabelas da assinatura', async () => {
    const { a } = await criarDoisSaloes();
    await iniciarAssinatura.executar(await credencialDoGestor(a), undefined, { agora: AGORA });
    const corpos = await obterPrisma().$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM webhook_evento WHERE payload::text ~ '[0-9]{13,19}'`;
    expect(Number(corpos[0].n)).toBe(0);
    const sim = await obterPrisma().$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM sim_mp_assinatura
       WHERE referencia_externa = ${a.salaoId} AND (email_pagador || url_retorno) ~ '[0-9]{13,19}'`;
    expect(Number(sim[0].n)).toBe(0);
  });
});
