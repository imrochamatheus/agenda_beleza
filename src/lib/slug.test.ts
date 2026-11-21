import { describe, expect, it } from 'vitest';

import { ROTAS, SEGMENTOS_RESERVADOS } from '@/config/navegacao';
import { MENSAGENS_CONFIGURACOES } from '@/server/salao/tipos';
import { validarNovoSlug } from '@/server/salao/validacao';

import { FORMATO_SLUG, SLUG_BASE_MAX, SLUG_FALLBACK, escolherSlugLivre, slugBase } from './slug';

// D-011 T-1: CA-8 (slug base), CA-7 (reservados = colisão) e CA-2 (sufixos) na parte pura.

describe('CA-8: slugBase', () => {
  it.each([
    ['Studio Bela', 'studio-bela'],
    ['Espaço Ágata & Cia.', 'espaco-agata-cia'],
    ["  D'Ávila  Beauty ", 'd-avila-beauty'],
    ['SALÃO--Ç', 'salao-c'],
    ['!!! ★★★', 'salao'],
    ['ßø', 'salao'],
    ['', 'salao'],
    ['---', 'salao'],
    ['Studio Bela 2', 'studio-bela-2'],
    ['Beleza 💅 Pura', 'beleza-pura'],
    ['Linha\nNova\tTab\u0000', 'linha-nova-tab'],
    ['ÀÉÎÕÜ ñ', 'aeiou-n'],
  ])('%j → %s', (nome, esperado) => {
    expect(slugBase(nome)).toBe(esperado);
  });

  it('o fallback é "salao"', () => {
    expect(SLUG_FALLBACK).toBe('salao');
  });

  it('nome de 80 caracteres → no máximo 50, cortado no último hífen, sem hífen final', () => {
    const nome = 'Salão de Beleza Espaço Encantado da Família Oliveira e Amigas Reunidas Sempre!!!';
    expect(nome).toHaveLength(80);
    const s = slugBase(nome);
    expect(s.length).toBeLessThanOrEqual(SLUG_BASE_MAX);
    expect(s).toBe('salao-de-beleza-espaco-encantado-da-familia');
    expect(s).toMatch(FORMATO_SLUG);
  });

  it('palavra única maior que 50 → cortada exatamente em 50', () => {
    expect(slugBase('a'.repeat(80))).toBe('a'.repeat(50));
  });

  it('o 51º caractere é hífen → corte exato em 50 (fronteira de palavra)', () => {
    const nome = `${'a'.repeat(20)} ${'b'.repeat(29)} ccc`; // 20 + 1 + 29 = 50; o 51º é o espaço
    expect(slugBase(nome)).toBe(`${'a'.repeat(20)}-${'b'.repeat(29)}`);
  });

  it('toda saída casa o formato do CHECK, inclusive para entradas difíceis', () => {
    const entradas = [
      '🙂🙂',
      '-a-',
      ' - - ',
      'a'.repeat(49) + '-b',
      'x'.repeat(10_000),
      `${'ab-'.repeat(40)}`,
      '\u0000\u0001',
      'Ça & Ço',
      '123',
      'Ø Ł Đ',
      '<b>x</b>',
    ];
    for (const e of entradas) {
      const s = slugBase(e);
      expect(s, e.slice(0, 20)).toMatch(FORMATO_SLUG);
      expect(s.length).toBeLessThanOrEqual(SLUG_BASE_MAX);
    }
  });

  it('FORMATO_SLUG é o padrão do CHECK salao_slug_formato_chk', () => {
    expect(FORMATO_SLUG.source).toBe('^[a-z0-9]+(-[a-z0-9]+)*$');
  });
});

describe('CA-2 (lógica): escolherSlugLivre', () => {
  it('base livre → base', () => {
    expect(escolherSlugLivre('studio-bela', new Set())).toBe('studio-bela');
  });

  it('base ocupada → base-2; base e base-2 → base-3', () => {
    expect(escolherSlugLivre('studio-bela', new Set(['studio-bela']))).toBe('studio-bela-2');
    expect(escolherSlugLivre('studio-bela', new Set(['studio-bela', 'studio-bela-2']))).toBe('studio-bela-3');
  });

  it('lacuna: base e base-3 ocupados → base-2', () => {
    expect(escolherSlugLivre('x', new Set(['x', 'x-3']))).toBe('x-2');
  });

  it('base terminada em número não tem tratamento especial', () => {
    expect(escolherSlugLivre('studio-bela-2', new Set(['studio-bela-2']))).toBe('studio-bela-2-2');
  });

  it('base fora do formato lança', () => {
    for (const ruim of ['', 'Studio', 'a--b', '-a', 'a_b']) {
      expect(() => escolherSlugLivre(ruim, new Set()), ruim).toThrow('slug base fora do formato');
    }
  });

  it('reservados informados explicitamente são tratados como colisão', () => {
    expect(escolherSlugLivre('loja', new Set(), new Set(['loja', 'loja-2']))).toBe('loja-3');
  });
});

describe('CA-7 (unidade): segmentos reservados são colisão', () => {
  const noFormato = [...SEGMENTOS_RESERVADOS].filter((s) => FORMATO_SLUG.test(s));

  it('o conjunto de reservados tem itens no formato de slug', () => {
    expect(noFormato).toEqual(expect.arrayContaining(['painel', 'admin', 'entrar', 'api', 'cadastro', 'confirmar-email']));
  });

  it.each(noFormato)('%s → %s-2 com nada ocupado', (item) => {
    expect(escolherSlugLivre(item, new Set())).toBe(`${item}-2`);
  });

  it('nenhuma escolha devolve um item do conjunto', () => {
    for (const item of noFormato) {
      for (const ocupados of [new Set<string>(), new Set([`${item}-2`])]) {
        expect(SEGMENTOS_RESERVADOS.has(escolherSlugLivre(item, ocupados))).toBe(false);
      }
    }
  });

  it('nomes que viram rotas: Painel, Admin, Entrar, API, Cadastro, Confirmar Email', () => {
    const nomes = ['Painel', 'Admin', 'Entrar', 'API', 'Cadastro', 'Confirmar Email'];
    expect(nomes.map((n) => escolherSlugLivre(slugBase(n), new Set()))).toEqual([
      'painel-2',
      'admin-2',
      'entrar-2',
      'api-2',
      'cadastro-2',
      'confirmar-email-2',
    ]);
  });

  it('"Confirmar E-mail" gera confirmar-e-mail pela RN-8 (o hífen do nome é preservado) e não é reservado', () => {
    expect(slugBase('Confirmar E-mail')).toBe('confirmar-e-mail');
    expect(escolherSlugLivre('confirmar-e-mail', new Set())).toBe('confirmar-e-mail');
  });

  it('slug.ts não copia a lista de reservados', async () => {
    const { readFileSync } = await import('node:fs');
    const fonte = readFileSync(new URL('./slug.ts', import.meta.url), 'utf8');
    for (const item of ['painel', 'admin', 'entrar', 'cadastro']) {
      expect(fonte).not.toContain(`'${item}'`);
    }
  });
});

describe('CA-20 (D-023): termos e privacidade são segmentos reservados', () => {
  it.each(['termos', 'privacidade'])('%s é reservado, pulado por escolherSlugLivre e recusado por validarNovoSlug', (segmento) => {
    expect(SEGMENTOS_RESERVADOS.has(segmento)).toBe(true);
    expect(escolherSlugLivre(segmento, new Set())).toBe(`${segmento}-2`);
    expect(validarNovoSlug(segmento)).toBe(MENSAGENS_CONFIGURACOES.slugReservado);
  });

  it('ROTAS.termos e ROTAS.privacidade continuam derivando do conjunto', () => {
    expect(ROTAS.termos).toBe('/termos');
    expect(ROTAS.privacidade).toBe('/privacidade');
    expect(SEGMENTOS_RESERVADOS.has(ROTAS.termos.slice(1))).toBe(true);
    expect(SEGMENTOS_RESERVADOS.has(ROTAS.privacidade.slice(1))).toBe(true);
  });
});
