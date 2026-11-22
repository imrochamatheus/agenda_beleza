import { describe, expect, it } from 'vitest';

import { haFiltroNaFila, hrefDaFila, lerFiltrosMensagens } from './mensagens-validacao';

const ID = '6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4';

describe('filtros da fila de mensagens (D-045 CA-9)', () => {
  it('sem parâmetros: nada filtrado, nada ignorado', () => {
    expect(lerFiltrosMensagens({})).toEqual({ filtros: { estado: null, tipo: null, salaoId: null, pagina: 1 }, ignorados: false });
  });

  it('valores válidos combinados; UUID em maiúsculas vira minúsculo', () => {
    const r = lerFiltrosMensagens({ estado: 'falhou', tipo: 'remarcacao', salao: ID.toUpperCase(), pagina: '3' });
    expect(r).toEqual({ filtros: { estado: 'falhou', tipo: 'remarcacao', salaoId: ID, pagina: 3 }, ignorados: false });
  });

  it('"Todas" (vazio) não é inválido', () => {
    expect(lerFiltrosMensagens({ estado: '', tipo: '', salao: '' }).ignorados).toBe(false);
  });

  it.each([
    [{ estado: 'xyz' }],
    [{ estado: 'toString' }],
    [{ tipo: 'aniversario' }],
    [{ salao: 'nao-e-uuid' }],
    [{ salao: "' OR 1=1 --" }],
    [{ estado: ['falhou', 'enviada'] }],
  ])('%j é ignorado, marca o aviso e não lança', (sp) => {
    const r = lerFiltrosMensagens(sp);
    expect(r.ignorados).toBe(true);
    expect(r.filtros).toMatchObject({ estado: null, tipo: null, salaoId: null });
  });

  it('página: inválida → 1; acima de 500 → 500', () => {
    expect(lerFiltrosMensagens({ pagina: 'abc' }).filtros.pagina).toBe(1);
    expect(lerFiltrosMensagens({ pagina: '9000' }).filtros.pagina).toBe(500);
  });

  it('hrefDaFila preserva filtros e página; sem nada → base', () => {
    expect(hrefDaFila('/admin/mensagens', { estado: null, tipo: null, salaoId: null }, 1)).toBe('/admin/mensagens');
    expect(hrefDaFila('/admin/mensagens', { estado: 'falhou', tipo: 'cancelamento', salaoId: ID }, 2, { reenvio: 'ok' })).toBe(
      `/admin/mensagens?estado=falhou&salao=${ID}&tipo=cancelamento&pagina=2&reenvio=ok`,
    );
  });

  it('haFiltroNaFila', () => {
    expect(haFiltroNaFila({ estado: null, tipo: null, salaoId: null })).toBe(false);
    expect(haFiltroNaFila({ estado: 'falhou', tipo: null, salaoId: null })).toBe(true);
  });
});
