import { describe, expect, it } from 'vitest';

import { classes, descritoPor, idsDoCampo } from './campo';

describe('campo', () => {
  it('idsDoCampo deriva os ids da ajuda e do erro', () => {
    expect(idsDoCampo('email')).toEqual({ controle: 'email', ajuda: 'email-ajuda', erro: 'email-erro' });
  });

  it('descritoPor lista ajuda e erro nessa ordem, mais o extra', () => {
    const ids = idsDoCampo('c');
    expect(descritoPor(ids, true, true)).toBe('c-ajuda c-erro');
    expect(descritoPor(ids, true, false)).toBe('c-ajuda');
    expect(descritoPor(ids, false, true)).toBe('c-erro');
    expect(descritoPor(ids, false, false)).toBeUndefined();
    expect(descritoPor(ids, false, true, 'outro')).toBe('c-erro outro');
    expect(descritoPor(ids, false, false, '')).toBeUndefined();
  });

  it('classes ignora valores vazios', () => {
    expect(classes('a', false, undefined, null, '', 'b')).toBe('a b');
    expect(classes()).toBe('');
  });
});
