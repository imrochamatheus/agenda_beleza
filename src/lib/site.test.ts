import { describe, expect, it } from 'vitest';

import { siteConfig } from './site';

describe('siteConfig', () => {
  it('define a marca, o idioma pt-BR e uma descrição', () => {
    expect(siteConfig.name).toBe('Agenda Beleza');
    expect(siteConfig.locale).toBe('pt-BR');
    expect(siteConfig.description).toBe('Agendamento online para salões de beleza.');
  });

  it('roda no ambiente node no projeto unit (CA-10)', () => {
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');
  });
});
