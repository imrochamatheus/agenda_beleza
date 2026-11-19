import { randomUUID } from 'node:crypto';

import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PRECO_MENSAL_CENTAVOS } from '@/config/plano';
import { criarIntegracoes } from '@/server/integrations/registry';
import {
  CHAVE_SITE_TURNSTILE_SIMULADA,
  TOKEN_TURNSTILE_SIMULADO,
} from '@/server/integrations/turnstile/simulado';

import { conectar, emailNovo, telefoneNovo } from '../../support/sql';

// Registro contra o PostgreSQL real (RN-14, R-9): as portas obtidas do registro em modo simulado
// gravam nas tabelas dos simulados. CA-3 pela porta do registro e CA-1 (cada porta é o simulado,
// provado pelo efeito no banco). A fonte é explícita: um .env local em "real" não interfere.
// DATABASE_URL do processo já aponta para a base deste worker (tests/support/setup-arquivo.ts).

const APP_URL = 'http://localhost:3000';

const registro = criarIntegracoes({
  ...process.env,
  APP_URL,
  EMAIL_ADAPTER: 'simulado',
  WHATSAPP_ADAPTER: 'simulado',
  MP_ADAPTER: 'simulado',
  TURNSTILE_ADAPTER: 'simulado',
});

let c: pg.Client;

beforeAll(async () => {
  c = await conectar();
});
afterAll(async () => {
  await c.end();
});

describe('CA-3: e-mail pela porta do registro', () => {
  it('CA-3: destinatário, assunto e o link do corpo são lidos de email_log iguais aos enviados', async () => {
    const para = emailNovo();
    const link = `${APP_URL}/convite/aceitar?token=${randomUUID()}`;
    const texto = `Você foi convidada para a equipe.\n\nAceite o convite em:\n${link}\n`;

    const { provedorId } = await registro.email.enviar({ para, assunto: 'Convite para a equipe', texto });

    const r = await c.query<{ id: string; destinatario: string; assunto: string; corpo: string }>(
      'SELECT id::text AS id, destinatario, assunto, corpo FROM email_log WHERE destinatario = $1',
      [para],
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ id: provedorId, destinatario: para, assunto: 'Convite para a equipe' });
    const extraido = /https?:\/\/\S+/.exec(r.rows[0].corpo)?.[0];
    expect(extraido).toBe(link);
  });
});

describe('CA-1: as portas do registro são os simulados (efeito no banco)', () => {
  it('CA-1: modos simulados', () => {
    expect(registro.modos).toEqual({
      email: 'simulado',
      whatsapp: 'simulado',
      mercadoPago: 'simulado',
      turnstile: 'simulado',
    });
  });

  it('CA-1: MP do registro cria a assinatura em sim_mp_assinatura, com urlCheckout em APP_URL', async () => {
    const salaoId = randomUUID();
    const { assinaturaId, urlCheckout } = await registro.mercadoPago.criarAssinatura({
      salaoId,
      emailPagador: emailNovo(),
      urlRetorno: `${APP_URL}/assinatura/retorno`,
    });

    expect(urlCheckout).toBe(`${APP_URL}/dev/mp-checkout?assinatura=${assinaturaId}`);
    const r = await c.query(
      'SELECT referencia_externa, estado::text AS estado, valor_centavos FROM sim_mp_assinatura WHERE id = $1',
      [assinaturaId],
    );
    expect(r.rows).toEqual([
      { referencia_externa: salaoId, estado: 'pendente', valor_centavos: PRECO_MENSAL_CENTAVOS },
    ]);
  });

  it('CA-1: WhatsApp do registro registra a chamada em sim_whatsapp_chamada', async () => {
    const destinatario = telefoneNovo();
    const chave = `${randomUUID()}:confirmacao:1`;

    const { provedorMensagemId } = await registro.whatsapp.enviarModelo({
      destinatarioE164: destinatario,
      modelo: 'confirmacao',
      parametros: { nome: 'Ana' },
      chaveIdempotencia: chave,
    });

    const r = await c.query(
      `SELECT destinatario, resultado::text AS resultado, provedor_mensagem_id
       FROM sim_whatsapp_chamada WHERE chave_idempotencia = $1`,
      [chave],
    );
    expect(r.rows).toEqual([{ destinatario, resultado: 'sucesso', provedor_mensagem_id: provedorMensagemId }]);
  });

  it('CA-1: Turnstile do registro aceita o token documentado e expõe a chave simulada', async () => {
    await expect(registro.turnstile.validar({ token: TOKEN_TURNSTILE_SIMULADO })).resolves.toEqual({
      valido: true,
    });
    await expect(registro.turnstile.validar({ token: 'outro' })).resolves.toEqual({
      valido: false,
      motivo: 'token_invalido',
    });
    expect(registro.turnstile.chaveDoSite()).toBe(CHAVE_SITE_TURNSTILE_SIMULADA);
  });
});
