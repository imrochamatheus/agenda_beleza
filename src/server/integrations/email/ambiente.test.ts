import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CHAVES, lerConfigReal, PORTA_PADRAO, PORTA_PADRAO_SEGURA, SELETOR } from './ambiente';

const MINIMO = { SMTP_HOST: 'smtp.exemplo.com', EMAIL_FROM: 'nao-responda@exemplo.com' };

function variaveisDe(fonte: Record<string, string | undefined>): string[] {
  const r = lerConfigReal(fonte);
  if (r.ok) throw new Error('lerConfigReal deveria ter falhado');
  return r.variaveis;
}

function configDe(fonte: Record<string, string | undefined>) {
  const r = lerConfigReal(fonte);
  if (!r.ok) throw new Error(`lerConfigReal falhou: ${r.variaveis.join(', ')}`);
  return r.config;
}

describe('email/ambiente (RN-13, D-10 com ajuste)', () => {
  it('declara o seletor e as seis variáveis da RN-8', () => {
    expect(SELETOR).toBe('EMAIL_ADAPTER');
    expect(CHAVES).toEqual(['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_SECURE', 'EMAIL_FROM']);
  });

  it('só importa zod (entra no bundle do check-env)', () => {
    const fonte = readFileSync(fileURLToPath(new URL('./ambiente.ts', import.meta.url)), 'utf8');
    const imports = [...fonte.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
    expect(imports).toEqual(['zod']);
  });

  it('com o mínimo: porta 587, sem TLS implícito, sem autenticação', () => {
    expect(configDe(MINIMO)).toEqual({
      host: 'smtp.exemplo.com',
      porta: PORTA_PADRAO,
      seguro: false,
      autenticacao: null,
      remetente: 'nao-responda@exemplo.com',
    });
    expect(PORTA_PADRAO).toBe(587);
  });

  it('D-10 (ajuste): SMTP_SECURE=true sem SMTP_PORT usa 465', () => {
    const config = configDe({ ...MINIMO, SMTP_SECURE: 'true' });
    expect(config.seguro).toBe(true);
    expect(config.porta).toBe(PORTA_PADRAO_SEGURA);
    expect(PORTA_PADRAO_SEGURA).toBe(465);
  });

  it('SMTP_SECURE=false explícito usa 587', () => {
    expect(configDe({ ...MINIMO, SMTP_SECURE: 'false' })).toMatchObject({ seguro: false, porta: 587 });
  });

  it('a porta explícita prevalece sobre o padrão, com e sem TLS implícito', () => {
    expect(configDe({ ...MINIMO, SMTP_PORT: '2525' }).porta).toBe(2525);
    expect(configDe({ ...MINIMO, SMTP_PORT: '587', SMTP_SECURE: 'true' }).porta).toBe(587);
  });

  it.each(['1', '65535'])('aceita SMTP_PORT=%s (limites)', (porta) => {
    expect(configDe({ ...MINIMO, SMTP_PORT: porta }).porta).toBe(Number(porta));
  });

  it.each(['abc', '70000', '0', '65536', '-1', '25.5', ' 25', '1e3', '0x19'])(
    'CA-8: SMTP_PORT=%j nomeia SMTP_PORT',
    (porta) => {
      expect(variaveisDe({ ...MINIMO, SMTP_PORT: porta })).toEqual(['SMTP_PORT']);
    },
  );

  it.each(['talvez', 'TRUE', '1', 'sim'])('CA-8: SMTP_SECURE=%j nomeia SMTP_SECURE', (valor) => {
    expect(variaveisDe({ ...MINIMO, SMTP_SECURE: valor })).toEqual(['SMTP_SECURE']);
  });

  it('CA-2/CA-8: sem SMTP_HOST e sem EMAIL_FROM nomeia as duas, ordenadas', () => {
    expect(variaveisDe({})).toEqual(['EMAIL_FROM', 'SMTP_HOST']);
  });

  it('usuário e senha juntos viram autenticação', () => {
    expect(configDe({ ...MINIMO, SMTP_USER: 'usuario', SMTP_PASSWORD: 'senha' }).autenticacao).toEqual({
      usuario: 'usuario',
      senha: 'senha',
    });
  });

  it('CA-8: SMTP_USER sem SMTP_PASSWORD nomeia SMTP_PASSWORD (e o inverso nomeia SMTP_USER)', () => {
    expect(variaveisDe({ ...MINIMO, SMTP_USER: 'usuario' })).toEqual(['SMTP_PASSWORD']);
    expect(variaveisDe({ ...MINIMO, SMTP_PASSWORD: 'senha' })).toEqual(['SMTP_USER']);
  });

  it.each([
    'nao-responda@exemplo.com',
    'Agenda Beleza <nao-responda@exemplo.com>',
    '"Agenda Beleza" <nao-responda@exemplo.com>',
    '<nao-responda@exemplo.com>',
  ])('aceita EMAIL_FROM=%j', (remetente) => {
    expect(configDe({ ...MINIMO, EMAIL_FROM: remetente }).remetente).toBe(remetente);
  });

  it.each([
    'nao-email',
    'remetente-invalido@',
    'Agenda <nao-email>',
    'Agenda <a@exemplo.com',
    'Agenda <a@exemplo.com> extra',
    'a@exemplo.com\r\nBcc: x@exemplo.com',
    'Agenda\n<a@exemplo.com>',
    'a@exemplo.com, b@exemplo.com',
  ])('CA-8: EMAIL_FROM=%j nomeia EMAIL_FROM', (remetente) => {
    expect(variaveisDe({ ...MINIMO, EMAIL_FROM: remetente })).toEqual(['EMAIL_FROM']);
  });

  it('lista todas as variáveis inválidas de uma vez, ordenadas, sem valores', () => {
    const r = lerConfigReal({ SMTP_PORT: 'porta-secreta', SMTP_SECURE: 'x', SMTP_USER: 'usuario-secreto' });
    expect(r).toEqual({
      ok: false,
      variaveis: ['EMAIL_FROM', 'SMTP_HOST', 'SMTP_PASSWORD', 'SMTP_PORT', 'SMTP_SECURE'],
    });
    expect(JSON.stringify(r)).not.toMatch(/secret/);
  });
});
