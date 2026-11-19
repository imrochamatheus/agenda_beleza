import { describe, expect, it } from 'vitest';

import { lerOpcoesVitrine } from './opcoes';

describe('lerOpcoesVitrine (D-19)', () => {
  it('padrões sem parâmetros', () => {
    expect(lerOpcoesVitrine({})).toEqual({ layout: 'publico', papel: 'gestor' });
  });

  it.each(['publico', 'publico-salao', 'painel', 'admin'] as const)('aceita layout=%s', (layout) => {
    expect(lerOpcoesVitrine({ layout }).layout).toBe(layout);
  });

  it('aceita papel=profissional e caminho válido', () => {
    expect(lerOpcoesVitrine({ layout: 'painel', papel: 'profissional', caminho: '/painel/agenda/nova' })).toEqual({
      layout: 'painel',
      papel: 'profissional',
      caminho: '/painel/agenda/nova',
    });
  });

  it('desconhecidos e repetidos (array) caem no padrão, sem erro', () => {
    expect(lerOpcoesVitrine({ layout: 'x', papel: 'super_admin' })).toEqual({ layout: 'publico', papel: 'gestor' });
    expect(lerOpcoesVitrine({ layout: ['painel', 'admin'], papel: ['profissional'] })).toEqual({
      layout: 'publico',
      papel: 'gestor',
    });
    expect(lerOpcoesVitrine({ layout: 'toString', papel: '' })).toEqual({ layout: 'publico', papel: 'gestor' });
  });

  it.each(['painel', '/Painel', '/painel?x=1', '/painel/<script>', `/${'a'.repeat(121)}`, 'javascript:alert(1)'])(
    'caminho inválido %s é descartado',
    (caminho) => {
      expect(lerOpcoesVitrine({ caminho })).not.toHaveProperty('caminho');
    },
  );

  it('caminho com 120 caracteres depois da barra é aceito', () => {
    const caminho = `/${'a'.repeat(120)}`;
    expect(lerOpcoesVitrine({ caminho }).caminho).toBe(caminho);
  });
});
