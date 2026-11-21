import { describe, expect, it } from 'vitest';

import { lerConsentimentoDoFormulario, valoresDoFormulario } from './formulario';
import { CAMPOS_CONSENTIMENTO } from './tipos';
import { validarConsentimentoDaReserva } from './validacao';

function formulario(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.set(k, v);
  return fd;
}

describe('CA-5: leitura do FormData', () => {
  it('lê pelos nomes fixos; ausente vira null', () => {
    const fd = formulario({ [CAMPOS_CONSENTIMENTO.mensagensReserva]: 'on' });
    expect(lerConsentimentoDoFormulario(fd)).toEqual({ mensagensReserva: 'on', conviteAvaliacao: null });
  });

  it('só a obrigatória → só mensagens_reserva; as duas → duas finalidades; só o convite → recusa', () => {
    const so = (campos: Record<string, string>) => validarConsentimentoDaReserva(lerConsentimentoDoFormulario(formulario(campos)));
    expect(so({ [CAMPOS_CONSENTIMENTO.mensagensReserva]: 'on' })).toEqual({ ok: true, finalidades: ['mensagens_reserva'] });
    expect(so({ [CAMPOS_CONSENTIMENTO.mensagensReserva]: 'on', [CAMPOS_CONSENTIMENTO.conviteAvaliacao]: 'on' })).toEqual({
      ok: true,
      finalidades: ['mensagens_reserva', 'convite_avaliacao'],
    });
    expect(so({ [CAMPOS_CONSENTIMENTO.conviteAvaliacao]: 'on' }).ok).toBe(false);
  });

  it('valoresDoFormulario reflete o que foi enviado', () => {
    expect(valoresDoFormulario(formulario({ [CAMPOS_CONSENTIMENTO.conviteAvaliacao]: 'on' }))).toEqual({
      mensagensReserva: false,
      conviteAvaliacao: true,
    });
    expect(valoresDoFormulario(formulario({ [CAMPOS_CONSENTIMENTO.mensagensReserva]: 'false' }))).toEqual({
      mensagensReserva: false,
      conviteAvaliacao: false,
    });
  });
});
