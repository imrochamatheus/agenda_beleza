import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CHAVES, lerConfigReal, SELETOR } from './ambiente';

const OK = {
  MP_ACCESS_TOKEN: 'APP_USR-token-secreto',
  MP_WEBHOOK_SECRET: 'segredo-webhook',
  MP_PREAPPROVAL_PLAN_ID: 'plano123',
  APP_URL: 'https://agenda.exemplo.com.br',
};

describe('mercadopago/ambiente (D-046)', () => {
  it('declara o seletor e as três variáveis do provedor', () => {
    expect(SELETOR).toBe('MP_ADAPTER');
    expect([...CHAVES]).toEqual(['MP_ACCESS_TOKEN', 'MP_WEBHOOK_SECRET', 'MP_PREAPPROVAL_PLAN_ID']);
  });

  it('não importa nada (entra no bundle do check-env)', () => {
    const fonte = readFileSync(fileURLToPath(new URL('./ambiente.ts', import.meta.url)), 'utf8');
    expect(fonte).not.toMatch(/^import /m);
  });

  it('CA-4: com as três variáveis e APP_URL https devolve a config', () => {
    expect(lerConfigReal(OK)).toEqual({
      ok: true,
      config: { accessToken: 'APP_USR-token-secreto', webhookSecret: 'segredo-webhook', planoId: 'plano123' },
    });
  });

  it('CA-3: nomeia todas as ausentes, ordenadas, sem valores', () => {
    const r = lerConfigReal({ APP_URL: 'https://x.com.br' });
    expect(r).toEqual({
      ok: false,
      variaveis: ['MP_ACCESS_TOKEN', 'MP_PREAPPROVAL_PLAN_ID', 'MP_WEBHOOK_SECRET'],
    });
  });

  it.each(['MP_ACCESS_TOKEN', 'MP_WEBHOOK_SECRET', 'MP_PREAPPROVAL_PLAN_ID'])('CA-3: %s ausente ou em branco', (chave) => {
    expect(lerConfigReal({ ...OK, [chave]: undefined })).toEqual({ ok: false, variaveis: [chave] });
    expect(lerConfigReal({ ...OK, [chave]: '  ' })).toEqual({ ok: false, variaveis: [chave] });
  });

  it.each(['http://agenda.exemplo.com.br', 'agenda.exemplo.com.br', undefined, 'https://'])(
    'CA-4: APP_URL %s é recusada nomeando APP_URL',
    (appUrl) => {
      expect(lerConfigReal({ ...OK, APP_URL: appUrl })).toEqual({ ok: false, variaveis: ['APP_URL'] });
    },
  );
});
