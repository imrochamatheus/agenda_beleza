import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { encerrarPrisma } from '@/server/repos/db';
import { contextoDeSistema, criarAdminContext, criarTenantContext } from '@/server/tenant/context';
import type { ContextoEscopado } from '@/server/tenant/context';

import { temConsentimentoDeMensagens } from './leitura';
import { registrarConsentimento, registrarConsentimentoDaReserva } from './servico';
import { MENSAGENS_CONSENTIMENTO } from './tipos';

const SALAO = '11111111-1111-4111-8111-111111111111';
const CLIENTE = '33333333-3333-4333-8333-333333333333';
const equipe = criarTenantContext({ usuarioId: '22222222-2222-4222-8222-222222222222', papel: 'gestor', salaoId: SALAO, profissionalId: null });
const sistema = contextoDeSistema(SALAO, 'teste');
const agora = new Date('2026-11-21T12:00:00Z');

// Banco inacessível: as guardas abaixo têm de responder ANTES de qualquer consulta. O comportamento com
// dados reais está em tests/integration/consentimento/.
beforeEach(() => {
  vi.stubEnv('DATABASE_URL', 'postgresql://usuario:senha@127.0.0.1:1/z');
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await encerrarPrisma();
});

describe('CA-9: guardas de programação de registrarConsentimento', () => {
  it('origem incoerente com o contexto → RangeError', async () => {
    await expect(registrarConsentimento(equipe, { clienteId: CLIENTE, finalidade: 'mensagens_reserva', origem: 'publico', agora })).rejects.toBeInstanceOf(RangeError);
    await expect(registrarConsentimento(sistema, { clienteId: CLIENTE, finalidade: 'mensagens_reserva', origem: 'equipe', agora })).rejects.toBeInstanceOf(RangeError);
  });

  it('origem equipe só para mensagens_reserva (contexto de equipe)', async () => {
    for (const finalidade of ['convite_avaliacao', 'publicacao_avaliacao'] as const) {
      await expect(registrarConsentimento(equipe, { clienteId: CLIENTE, finalidade, origem: 'equipe', agora })).rejects.toBeInstanceOf(RangeError);
    }
  });

  it('finalidade fora do enum e agora inválida → RangeError', async () => {
    await expect(registrarConsentimento(sistema, { clienteId: CLIENTE, finalidade: 'outra' as never, origem: 'publico', agora })).rejects.toBeInstanceOf(RangeError);
    for (const ruim of [new Date('x'), '2026-11-21', undefined, null]) {
      await expect(registrarConsentimento(sistema, { clienteId: CLIENTE, finalidade: 'mensagens_reserva', origem: 'publico', agora: ruim as never })).rejects.toBeInstanceOf(RangeError);
    }
  });

  it('contexto admin ou publico → Error de escopo', async () => {
    await expect(
      registrarConsentimento(criarAdminContext(CLIENTE) as unknown as ContextoEscopado, { clienteId: CLIENTE, finalidade: 'mensagens_reserva', origem: 'publico', agora }),
    ).rejects.toThrow();
  });

  it('id de cliente que não é UUID → NaoEncontrado sem consultar', async () => {
    await expect(temConsentimentoDeMensagens(sistema, 'x')).rejects.toMatchObject({ name: 'NaoEncontrado' });
  });
});

describe('CA-1: registrarConsentimentoDaReserva valida antes de tocar o banco', () => {
  it.each([undefined, null, 'on', {}, { mensagensReserva: false }, { conviteAvaliacao: true }])('%j → ok:false', async (aceites) => {
    await expect(registrarConsentimentoDaReserva(sistema, { clienteId: CLIENTE, aceites, origem: 'publico', agora })).resolves.toEqual({
      ok: false,
      erros: { mensagensReserva: MENSAGENS_CONSENTIMENTO.mensagensReserva },
    });
  });

  it('aceite válido com origem incoerente → RangeError antes de escrever', async () => {
    await expect(registrarConsentimentoDaReserva(equipe, { clienteId: CLIENTE, aceites: { mensagensReserva: true }, origem: 'publico', agora })).rejects.toBeInstanceOf(RangeError);
    await expect(registrarConsentimentoDaReserva(sistema, { clienteId: CLIENTE, aceites: { mensagensReserva: true }, origem: 'equipe', agora })).rejects.toBeInstanceOf(RangeError);
  });
});

describe('CA-21: o módulo de consentimento não é uma ação nem usa next/*', () => {
  it("nenhum arquivo de src/server/consentimento tem 'use server' ou importa next/", () => {
    const pasta = fileURLToPath(new URL('./', import.meta.url));
    const arquivos = readdirSync(pasta).filter((n) => /\.ts$/.test(n) && !/\.test\.ts$/.test(n));
    expect(arquivos).toEqual(expect.arrayContaining(['servico.ts', 'leitura.ts', 'validacao.ts', 'formulario.ts', 'tipos.ts']));
    for (const nome of arquivos) {
      const texto = readFileSync(pasta + nome, 'utf8');
      expect(texto, nome).not.toMatch(/^\s*['"]use server['"]/m);
      expect(texto, nome).not.toMatch(/from ['"]next\//);
    }
  });
});
