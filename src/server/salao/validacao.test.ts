import { describe, expect, it } from 'vitest';

import { SEGMENTOS_RESERVADOS } from '@/config/navegacao';
import { FORMATO_SLUG } from '@/lib/slug';
import { LIMITES_CADASTRO, MENSAGENS_CADASTRO } from '@/server/auth/cadastro';

import { GRADES_PERMITIDAS, LIMITES_SALAO, MENSAGENS_CONFIGURACOES as M } from './tipos';
import { normalizarSlug, validarNovoSlug, validarRegras, valoresDoSalao } from './validacao';

// D-017 T-4: validação pura (CA-3..CA-9 em unidade; D-17, D-21, D-22).

const SP = 'America/Sao_Paulo';
const base = { nome: 'Studio Bela', fuso: SP, grade: '15', antecedencia: '2', janela: '60', intervalo: '0' };
const opcoes = { fusoAtual: SP };
const erroDe = (e: Record<string, unknown>, fusoAtual: string | null = SP) => {
  const r = validarRegras(e, { fusoAtual });
  return r.ok ? null : r.erros;
};

describe('validarRegras: caso válido', () => {
  it('padrões → regras nas unidades do banco (antecedência × 60)', () => {
    expect(validarRegras(base, opcoes)).toEqual({
      ok: true,
      regras: { nome: 'Studio Bela', fuso: SP, gradeMin: 15, antecedenciaMin: 120, janelaDias: 60, intervaloMin: 0 },
    });
  });

  it('chaves extras (salaoId) são ignoradas; números aparados e com zeros à esquerda', () => {
    const r = validarRegras({ ...base, salaoId: 'outro', grade: ' 030 ', janela: '\t7\n' } as never, opcoes);
    expect(r).toEqual({ ok: true, regras: expect.objectContaining({ gradeMin: 30, janelaDias: 7 }) });
    expect(JSON.stringify(r)).not.toContain('outro');
  });
});

describe('CA-3: fuso', () => {
  it('recusa inexistente, offsets, UTC, aliases, caixa, espaço e vazio', () => {
    for (const fuso of ['America/Inexistente', '+03:00', 'UTC', 'Brazil/East', 'america/sao_paulo', ' America/Sao_Paulo', '', null, 3]) {
      expect(erroDe({ ...base, fuso }, 'America/Manaus'), String(fuso)).toEqual({ fuso: M.fuso });
    }
  });

  it('aceita America/Manaus e Pacific/Chatham', () => {
    for (const fuso of ['America/Manaus', 'Pacific/Chatham']) {
      expect(validarRegras({ ...base, fuso }, opcoes)).toMatchObject({ ok: true, regras: { fuso } });
    }
  });

  it('exceção: o fuso gravado hoje é aceito mesmo fora da lista (Brazil/East só se for o atual)', () => {
    expect(validarRegras({ ...base, fuso: 'Brazil/East' }, { fusoAtual: 'Brazil/East' })).toMatchObject({ ok: true, regras: { fuso: 'Brazil/East' } });
    expect(erroDe({ ...base, fuso: 'Brazil/East' }, SP)).toEqual({ fuso: M.fuso });
    expect(erroDe({ ...base, fuso: 'Brazil/East' }, null)).toEqual({ fuso: M.fuso });
    expect(erroDe({ ...base, fuso: '' }, '')).toEqual({ fuso: M.fuso });
  });
});

describe('CA-4: grade', () => {
  it('recusa fora da lista e formatos inválidos', () => {
    for (const grade of ['7', '0', '25', '120', '15.0', 'abc', '', ' ', '-15', '+15', 15, null, ['15']]) {
      expect(erroDe({ ...base, grade }), String(grade)).toEqual({ grade: M.grade });
    }
  });

  it('aceita todas as da lista (30 → 30)', () => {
    for (const g of GRADES_PERMITIDAS) {
      expect(validarRegras({ ...base, grade: String(g) }, opcoes)).toMatchObject({ ok: true, regras: { gradeMin: g } });
    }
  });
});

describe('CA-5: limites', () => {
  it('antecedência: recusados e aceitos (0 → 0 min; 72 → 4320 min)', () => {
    for (const antecedencia of ['-1', '73', '2,5', '2.5', '+2', '', '1e2', '12345', 2]) {
      expect(erroDe({ ...base, antecedencia }), String(antecedencia)).toEqual({ antecedencia: M.antecedencia });
    }
    expect(validarRegras({ ...base, antecedencia: '0' }, opcoes)).toMatchObject({ ok: true, regras: { antecedenciaMin: 0 } });
    expect(validarRegras({ ...base, antecedencia: '72' }, opcoes)).toMatchObject({ ok: true, regras: { antecedenciaMin: 4320 } });
  });

  it('janela: 0, 366 e 1e2 recusados; 1 e 365 aceitos', () => {
    for (const janela of ['0', '366', '1e2']) {
      expect(erroDe({ ...base, janela, antecedencia: '0' }), janela).toEqual({ janela: M.janela });
    }
    for (const janela of ['1', '365']) {
      expect(validarRegras({ ...base, janela, antecedencia: '0' }, opcoes)).toMatchObject({ ok: true, regras: { janelaDias: Number(janela) } });
    }
  });

  it('intervalo: -1, 121 e 5.5 recusados; 0 e 120 aceitos', () => {
    for (const intervalo of ['-1', '121', '5.5']) {
      expect(erroDe({ ...base, intervalo }), intervalo).toEqual({ intervalo: M.intervalo });
    }
    for (const intervalo of ['0', '120']) {
      expect(validarRegras({ ...base, intervalo }, opcoes)).toMatchObject({ ok: true, regras: { intervaloMin: Number(intervalo) } });
    }
  });

  it('dois campos inválidos → os dois erros juntos', () => {
    expect(erroDe({ ...base, grade: '7', intervalo: '121' })).toEqual({ grade: M.grade, intervalo: M.intervalo });
  });

  it('tipos errados, ausentes e textos enormes → erro por campo, sem lançar', () => {
    const enorme = 'x'.repeat(10_000);
    expect(erroDe({})).toEqual({ nome: M.nome, fuso: M.fuso, grade: M.grade, antecedencia: M.antecedencia, janela: M.janela, intervalo: M.intervalo });
    expect(Object.keys(erroDe({ nome: enorme, fuso: enorme, grade: enorme, antecedencia: enorme, janela: enorme, intervalo: enorme }) ?? {})).toHaveLength(6);
    expect(Object.keys(validarRegras(null as never, opcoes).ok ? {} : (validarRegras(null as never, opcoes) as { erros: object }).erros)).toHaveLength(6);
    expect(erroDe({ ...base, nome: 42 })).toEqual({ nome: M.nome });
  });
});

describe('CA-6: coerência antecedência < janela × 24', () => {
  it('janela 2: 48 recusada no campo antecedência; 47 aceita', () => {
    expect(erroDe({ ...base, janela: '2', antecedencia: '48' })).toEqual({ antecedencia: M.antecedenciaJanela });
    expect(validarRegras({ ...base, janela: '2', antecedencia: '47' }, opcoes)).toMatchObject({ ok: true, regras: { antecedenciaMin: 47 * 60 } });
  });

  it('só avaliada com os dois válidos: janela inválida não gera erro de coerência', () => {
    expect(erroDe({ ...base, janela: '0', antecedencia: '72' })).toEqual({ janela: M.janela });
    expect(erroDe({ ...base, janela: '1', antecedencia: '73' })).toEqual({ antecedencia: M.antecedencia });
  });
});

describe('CA-7: nome', () => {
  it('apara e colapsa espaços', () => {
    expect(validarRegras({ ...base, nome: '  Studio   Bela Nova ' }, opcoes)).toMatchObject({ ok: true, regras: { nome: 'Studio Bela Nova' } });
  });

  it('1 caractere, 81 caracteres ou controle → recusado; 2 e 80 aceitos', () => {
    for (const nome of ['A', 'a'.repeat(81), 'Studio\u0007Bela', 'Studio\nBela', '']) {
      expect(erroDe({ ...base, nome }), JSON.stringify(nome)).toEqual({ nome: M.nome });
    }
    for (const nome of ['AB', 'a'.repeat(80)]) {
      expect(validarRegras({ ...base, nome }, opcoes).ok).toBe(true);
    }
  });

  it('mesmas regras e mensagem do cadastro (D-14)', () => {
    expect(LIMITES_SALAO.nome).toEqual(LIMITES_CADASTRO.nomeSalao);
    expect(M.nome).toBe(MENSAGENS_CADASTRO.nomeSalao);
  });
});

describe('CA-8: normalizarSlug + validarNovoSlug', () => {
  const resultado = (v: unknown) => {
    const n = normalizarSlug(v);
    return n === null ? M.slugFormato : (validarNovoSlug(n) ?? n);
  };

  it('"  Bela-Studio " → bela-studio', () => {
    expect(normalizarSlug('  Bela-Studio ')).toBe('bela-studio');
    expect(resultado('  Bela-Studio ')).toBe('bela-studio');
  });

  it('recusados com a mensagem de formato', () => {
    for (const v of ['bela studio', 'bela_studio', '-bela', 'bela-', 'bela--studio', 'estúdio', 'ab', 'a'.repeat(61), '', '   ']) {
      expect(resultado(v), v).toBe(M.slugFormato);
    }
  });

  it('aceitos: abc, 123 e 60 caracteres', () => {
    for (const v of ['abc', '123', 'a'.repeat(60)]) {
      expect(resultado(v)).toBe(v);
    }
  });

  it('não-string ou acima de slugMaxCaracteres → null (10 000 caracteres sem lançar)', () => {
    for (const v of [null, undefined, 3, ['abc'], { slug: 'abc' }, 'a'.repeat(LIMITES_SALAO.slugMaxCaracteres + 1), 'a'.repeat(10_000)]) {
      expect(normalizarSlug(v)).toBeNull();
    }
    expect(normalizarSlug('a'.repeat(LIMITES_SALAO.slugMaxCaracteres))).toBe('a'.repeat(LIMITES_SALAO.slugMaxCaracteres));
  });
});

describe('CA-9: reservados', () => {
  it('todo SEGMENTOS_RESERVADOS que casa FORMATO_SLUG → mensagem de reservado (sem lista copiada)', () => {
    const candidatos = [...SEGMENTOS_RESERVADOS].filter((s) => FORMATO_SLUG.test(s));
    expect(candidatos.length).toBeGreaterThanOrEqual(2);
    expect(candidatos).toEqual(expect.arrayContaining(['painel', 'admin']));
    for (const s of candidatos) {
      expect(validarNovoSlug(s), s).toBe(M.slugReservado);
    }
  });

  it('variações são aceitas (painel-2); reservado curto recebe reservado antes do tamanho (D-21)', () => {
    expect(validarNovoSlug('painel-2')).toBeNull();
    expect(validarNovoSlug('xy', new Set(['xy']))).toBe(M.slugReservado);
    expect(validarNovoSlug('xy', new Set())).toBe(M.slugFormato);
    expect(validarNovoSlug('_next')).toBe(M.slugFormato);
  });
});

describe('valoresDoSalao', () => {
  it('120 min → "2" h; demais em texto', () => {
    expect(valoresDoSalao({ nome: 'N', fuso: SP, gradeMin: 15, antecedenciaMin: 120, janelaDias: 60, intervaloMin: 0 })).toEqual({
      nome: 'N',
      fuso: SP,
      grade: '15',
      antecedencia: '2',
      janela: '60',
      intervalo: '0',
    });
  });

  it('valor que não é múltiplo de 60 aparece com casas decimais e reprova ao salvar', () => {
    const v = valoresDoSalao({ nome: 'Nome', fuso: SP, gradeMin: 15, antecedenciaMin: 90, janelaDias: 60, intervaloMin: 0 });
    expect(v.antecedencia).toBe('1.5');
    expect(erroDe(v)).toEqual({ antecedencia: M.antecedencia });
  });
});
