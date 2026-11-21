import { describe, expect, it } from 'vitest';

import { widgetHumano } from './widget';

describe('widgetHumano', () => {
  it('simulado por padrão: token documentado; sem controle de teste em produção', () => {
    expect(widgetHumano({ NODE_ENV: 'production' })).toEqual({
      modo: 'simulado',
      chaveDoSite: '',
      tokenSimulado: 'XXXX.DUMMY.TOKEN.XXXX',
      controleDeTeste: false,
    });
  });
  it('controle de teste só com a vitrine ou o dev', () => {
    expect(widgetHumano({ VITRINE_COMPONENTES: 'true' }).controleDeTeste).toBe(true);
    expect(widgetHumano({ NODE_ENV: 'development' }).controleDeTeste).toBe(true);
  });
});
