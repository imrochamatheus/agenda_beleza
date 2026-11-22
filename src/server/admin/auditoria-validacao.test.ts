import { describe, expect, it } from 'vitest';

import { MENSAGENS_AUDITORIA } from './auditoria-tipos';
import { haFiltroNaAuditoria, hrefDaAuditoria, intervaloDoPeriodo, lerDataCivil, lerFiltrosAuditoria } from './auditoria-validacao';

const ID = '6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4';

describe('filtros da auditoria (D-045 CA-12)', () => {
  it('sem parâmetros', () => {
    const r = lerFiltrosAuditoria({});
    expect(r.filtros).toEqual({ salaoId: null, ator: null, acao: null, resultado: null, de: null, ate: null, pagina: 1 });
    expect(r.erros).toEqual({});
    expect(r.ignorados).toBe(false);
  });

  it('combinação válida; e-mail em minúsculas; datas nos dois formatos', () => {
    const r = lerFiltrosAuditoria({ salao: ID, ator: 'Admin@Plataforma.com.br', acao: 'mensagem.reenviar', resultado: 'sucesso', de: '2026-11-01', ate: '05/11/2026', pagina: '2' });
    expect(r.filtros).toEqual({ salaoId: ID, ator: 'admin@plataforma.com.br', acao: 'mensagem.reenviar', resultado: 'sucesso', de: '2026-11-01', ate: '2026-11-05', pagina: 2 });
    expect(r.erros).toEqual({});
  });

  it.each([[{ salao: 'x' }], [{ acao: 'drop.table' }], [{ acao: 'constructor' }], [{ resultado: 'talvez' }], [{ acao: ['a', 'b'] }]])(
    '%j é ignorado e avisa, sem lançar',
    (sp) => {
      const r = lerFiltrosAuditoria(sp);
      expect(r.ignorados).toBe(true);
      expect(r.filtros).toMatchObject({ salaoId: null, acao: null, resultado: null });
    },
  );

  it('data inválida → erro de campo e período daquele lado ignorado', () => {
    const r = lerFiltrosAuditoria({ de: '31/02/2026', ate: '2026-11-10' });
    expect(r.erros.de).toBe(MENSAGENS_AUDITORIA.dataInvalida);
    expect(r.filtros.de).toBeNull();
    expect(r.filtros.ate).toBe('2026-11-10');
    expect(r.ecoes.de).toBe('31/02/2026');
  });

  it('de maior que ate → erro e período inteiro ignorado', () => {
    const r = lerFiltrosAuditoria({ de: '2026-11-10', ate: '2026-11-01' });
    expect(r.erros.de).toBe(MENSAGENS_AUDITORIA.periodoInvertido);
    expect(r.filtros.de).toBeNull();
    expect(r.filtros.ate).toBeNull();
  });

  it('ator que não é e-mail → erro de campo, filtro ignorado; texto muito longo é cortado', () => {
    const r = lerFiltrosAuditoria({ ator: 'não é email' });
    expect(r.erros.ator).toBe(MENSAGENS_AUDITORIA.atorInvalido);
    expect(r.filtros.ator).toBeNull();
    expect(lerFiltrosAuditoria({ ator: 'a'.repeat(1000) }).ecoes.ator).toHaveLength(254);
  });

  it('lerDataCivil: formatos e datas inexistentes', () => {
    expect(lerDataCivil('2026-02-28')).toEqual({ ano: 2026, mes: 2, dia: 28 });
    expect(lerDataCivil('29/02/2028')).toEqual({ ano: 2028, mes: 2, dia: 29 });
    expect(lerDataCivil('29/02/2026')).toBeNull();
    expect(lerDataCivil('2026-13-01')).toBeNull();
    expect(lerDataCivil('1/1/2026')).toBeNull();
    expect(lerDataCivil('')).toBeNull();
  });

  it('hrefDaAuditoria preserva só filtros válidos', () => {
    const f = lerFiltrosAuditoria({ salao: ID, acao: 'salao.suspender', de: '2026-11-01', pagina: '3' }).filtros;
    expect(hrefDaAuditoria('/admin/auditoria', f, 3)).toBe(`/admin/auditoria?salao=${ID}&acao=salao.suspender&de=2026-11-01&pagina=3`);
    expect(hrefDaAuditoria('/admin/auditoria', lerFiltrosAuditoria({}).filtros, 1)).toBe('/admin/auditoria');
    expect(haFiltroNaAuditoria(f)).toBe(true);
    expect(haFiltroNaAuditoria(lerFiltrosAuditoria({}).filtros)).toBe(false);
  });
});

describe('intervalo do dia civil em America/Sao_Paulo (RN-12; independe do TZ do processo)', () => {
  it('dia civil → [00:00 local, 00:00 do dia seguinte) em UTC', () => {
    const r = intervaloDoPeriodo('2026-11-10', '2026-11-10');
    expect(r.de?.toISOString()).toBe('2026-11-10T03:00:00.000Z');
    expect(r.ate?.toISOString()).toBe('2026-11-11T03:00:00.000Z');
  });

  it('cada lado é independente; sem datas → nulos', () => {
    expect(intervaloDoPeriodo('2026-11-10', null)).toEqual({ de: new Date('2026-11-10T03:00:00.000Z'), ate: null });
    expect(intervaloDoPeriodo(null, '2026-11-10').ate?.toISOString()).toBe('2026-11-11T03:00:00.000Z');
    expect(intervaloDoPeriodo(null, null)).toEqual({ de: null, ate: null });
  });

  it('02:30 UTC do dia 11 está no dia civil 10 (virada de dia), e 03:00 UTC já é o dia 11', () => {
    const { de, ate } = intervaloDoPeriodo('2026-11-10', '2026-11-10');
    const dentro = (iso: string) => new Date(iso) >= de! && new Date(iso) < ate!;
    expect(dentro('2026-11-11T02:30:00Z')).toBe(true);
    expect(dentro('2026-11-11T03:00:00Z')).toBe(false);
    expect(dentro('2026-11-10T02:59:59.999Z')).toBe(false);
  });
});
