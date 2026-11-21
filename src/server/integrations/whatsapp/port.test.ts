import { describe, expect, it } from 'vitest';

import {
  CODIGOS_ENTRADA_INVALIDA,
  E164_BR,
  type EnvioModelo,
  ErroEnvioPermanente,
  ErroEnvioTemporario,
  MODELOS_WHATSAPP,
  validarEnvioModelo,
} from './port';

const VALIDO: EnvioModelo = {
  destinatarioE164: '+5511987654321',
  modelo: 'confirmacao',
  parametros: { nome: 'Ana', horario: '10:00' },
  chaveIdempotencia: '6f1c2c0e-0000-4000-8000-000000000001:confirmacao:1',
};

describe('whatsapp/port', () => {
  it('declara os quatro modelos, iguais ao enum tipo_mensagem (CA-23)', () => {
    expect(MODELOS_WHATSAPP).toEqual(['confirmacao', 'remarcacao', 'cancelamento', 'convite_avaliacao']);
  });

  it.each(['+5511987654321', '+551133334444'])('E164_BR aceita %s', (numero) => {
    expect(E164_BR.test(numero)).toBe(true);
  });

  it.each(['+12025550123', '5511987654321', '+550987654321', '+55119876543210', '+55 11 98765-4321'])(
    'E164_BR rejeita %s',
    (numero) => {
      expect(E164_BR.test(numero)).toBe(false);
    },
  );

  it.each(MODELOS_WHATSAPP)('validarEnvioModelo aceita o modelo %s com entrada válida', (modelo) => {
    expect(validarEnvioModelo({ ...VALIDO, modelo })).toBeNull();
  });

  it.each([
    ['destinatário não brasileiro', { destinatarioE164: '+12025550123' }, CODIGOS_ENTRADA_INVALIDA.destinatario],
    ['destinatário ausente', { destinatarioE164: undefined }, CODIGOS_ENTRADA_INVALIDA.destinatario],
    ['modelo fora do v1', { modelo: 'lembrete' }, CODIGOS_ENTRADA_INVALIDA.modelo],
    ['chave vazia', { chaveIdempotencia: '' }, CODIGOS_ENTRADA_INVALIDA.chaveIdempotencia],
    ['chave só com espaços', { chaveIdempotencia: '  ' }, CODIGOS_ENTRADA_INVALIDA.chaveIdempotencia],
    ['chave ausente', { chaveIdempotencia: undefined }, CODIGOS_ENTRADA_INVALIDA.chaveIdempotencia],
  ])('validarEnvioModelo: %s → ErroEnvioPermanente', (_caso, mudanca, codigo) => {
    const erro = validarEnvioModelo({ ...VALIDO, ...mudanca } as unknown as EnvioModelo);
    expect(erro).toBeInstanceOf(ErroEnvioPermanente);
    expect(erro?.codigo).toBe(codigo);
  });

  it('os erros têm mensagem fixa, nome próprio e não ecoam o destinatário', () => {
    const permanente = validarEnvioModelo({ ...VALIDO, destinatarioE164: '+12025550123' });
    expect(permanente?.name).toBe('ErroEnvioPermanente');
    expect(permanente?.message).toBe('Falha permanente no envio da mensagem de WhatsApp.');
    expect(JSON.stringify(permanente)).not.toContain('2025550123');

    const temporario = new ErroEnvioTemporario('limite_de_taxa');
    expect(temporario).toBeInstanceOf(Error);
    expect(temporario.name).toBe('ErroEnvioTemporario');
    expect(temporario.codigo).toBe('limite_de_taxa');
    expect(temporario.message).toBe('Falha temporária no envio da mensagem de WhatsApp.');
  });
});
