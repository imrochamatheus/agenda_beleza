import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { consentimentoVigente } from '@/server/consentimento/leitura';
import { registrarConsentimento } from '@/server/consentimento/servico';

import { criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

import { AGORA, ctxPublico, fotografiaDoSalao, inserirCliente, linhasDe } from './apoio';

// D-023 T-5: CA-13 (RN-13). A troca de versão não reescreve nem invalida.

let c: pg.Client;
let s: SalaoCompleto;

beforeAll(async () => {
  c = await conectar();
  s = await criarSalaoCompleto();
});
afterAll(async () => {
  await c.end();
});
beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('CA-13: mudança de versão', () => {
  it('V1 fica intacta, V2 é nova e a vigente devolve a versão da linha mais recente', async () => {
    const clienteId = await inserirCliente(c, s.salaoId, 'Versionada');
    const entrada = (agora: Date) => ({ clienteId, finalidade: 'mensagens_reserva' as const, origem: 'publico' as const, agora });
    const v1 = await registrarConsentimento(ctxPublico(s), entrada(AGORA), undefined, { versaoVigente: () => 'v1-teste' });
    const fotoV1 = (await fotografiaDoSalao(c, s.salaoId)).filter((l) => (l as { id: string }).id === v1.id);
    expect((await consentimentoVigente(ctxPublico(s), clienteId, 'mensagens_reserva'))?.versaoTermos).toBe('v1-teste');

    const v2 = await registrarConsentimento(ctxPublico(s), entrada(new Date(AGORA.getTime() + 60_000)), undefined, { versaoVigente: () => 'v2-teste' });
    const linhas = await linhasDe(c, clienteId);
    expect(linhas.map((l) => l.versao_termos)).toEqual(['v1-teste', 'v2-teste']);
    expect((await fotografiaDoSalao(c, s.salaoId)).filter((l) => (l as { id: string }).id === v1.id)).toEqual(fotoV1);
    const vigente = await consentimentoVigente(ctxPublico(s), clienteId, 'mensagens_reserva');
    expect(vigente).toMatchObject({ id: v2.id, versaoTermos: 'v2-teste' });
  });

  it('o chamador nunca informa a versão: sem deps, vale a do config', async () => {
    const clienteId = await inserirCliente(c, s.salaoId, 'Config');
    const v = await registrarConsentimento(ctxPublico(s), { clienteId, finalidade: 'mensagens_reserva', origem: 'publico', agora: AGORA });
    const { VERSAO_TERMOS } = await import('@/config/termos');
    expect(v.versaoTermos).toBe(VERSAO_TERMOS);
  });
});
