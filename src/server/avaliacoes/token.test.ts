import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { gerarToken, hashDoToken, tokenPlausivel } from './token';

const SEGREDO = 'a'.repeat(32);
const SALAO = '11111111-1111-4111-8111-111111111111';
const RESERVA = '22222222-2222-4222-8222-222222222222';

describe('token do convite (RN-2)', () => {
  it('é determinístico, base64url de 43 caracteres', () => {
    const t = gerarToken(SEGREDO, SALAO, RESERVA);
    expect(t).toBe(gerarToken(SEGREDO, SALAO, RESERVA));
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenPlausivel(t)).toBe(true);
  });

  it('muda com o segredo, o salão e a reserva', () => {
    const t = gerarToken(SEGREDO, SALAO, RESERVA);
    expect(gerarToken('b'.repeat(32), SALAO, RESERVA)).not.toBe(t);
    expect(gerarToken(SEGREDO, RESERVA, RESERVA)).not.toBe(t);
    expect(gerarToken(SEGREDO, SALAO, SALAO)).not.toBe(t);
  });

  it('o hash é o SHA-256 hexadecimal do token (64 caracteres)', () => {
    const t = gerarToken(SEGREDO, SALAO, RESERVA);
    expect(hashDoToken(t)).toBe(createHash('sha256').update(t).digest('hex'));
    expect(hashDoToken(t)).toHaveLength(64);
    expect(hashDoToken(t)).not.toContain(t);
  });

  it.each([undefined, null, 42, '', 'curto', 'a'.repeat(42), 'a'.repeat(44), `${'a'.repeat(42)}=`, `${'a'.repeat(42)}+`, `${'a'.repeat(42)}/`, `${'a'.repeat(42)} `, {}])(
    'recusa o formato inválido: %j',
    (v) => {
      expect(tokenPlausivel(v)).toBe(false);
    },
  );
});
