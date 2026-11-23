import { describe, expect, it } from 'vitest';

import { SEGMENTOS_RESERVADOS } from '@/config/navegacao';

import {
  camposOcultos,
  chaveDeData,
  hrefAlterarItem,
  hrefAlterarServicos,
  hrefFiltro,
  hrefOutroDia,
  hrefSeguirSem,
  lerAviso,
  lerData,
  lerHorario,
  lerItem,
  lerItens,
  lerPasso,
  lerSelecao,
  lerServicoIds,
  lerUuid,
  montarHref,
  slugPlausivel,
  valorDoItem,
  valoresDosItens,
} from './passos';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const ANA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BIA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const HOJE = { ano: 2026, mes: 11, dia: 20 };
const CTX = { hoje: HOJE, janelaDias: 60 };
const H9 = '2026-12-01T12:00:00.000Z';
const H10 = '2026-12-01T13:00:00.000Z';
const H15 = '2026-12-01T18:00:00.000Z';
const item = (p: string, h: string) => `${p}_${h}`;

describe('slugPlausivel (CA-3, RN-2)', () => {
  it('aceita slugs válidos e recusa maiúsculas, caracteres especiais, longos e não texto', () => {
    expect(slugPlausivel('studio-bela')).toBe(true);
    expect(slugPlausivel('Studio')).toBe(false);
    expect(slugPlausivel('a_b')).toBe(false);
    expect(slugPlausivel('favicon.ico')).toBe(false);
    expect(slugPlausivel('a'.repeat(51))).toBe(false);
    expect(slugPlausivel('a'.repeat(50))).toBe(true);
    expect(slugPlausivel('-a')).toBe(false);
    expect(slugPlausivel('')).toBe(false);
    expect(slugPlausivel(undefined)).toBe(false);
  });

  it('nenhum segmento reservado é plausível (não consulta o banco)', () => {
    for (const reservado of SEGMENTOS_RESERVADOS) expect(slugPlausivel(reservado), reservado).toBe(false);
  });
});

describe('leitores de parâmetros', () => {
  it('lerServicoIds: 1 a 10, sem repetição, ordem e caixa', () => {
    expect(lerServicoIds([B, A.toUpperCase()])).toEqual([B, A]);
    expect(lerServicoIds(A)).toEqual([A]);
    expect(lerServicoIds(undefined)).toBeNull();
    expect(lerServicoIds([])).toBeNull();
    expect(lerServicoIds([A, A])).toBeNull();
    expect(lerServicoIds([A, 'x'])).toBeNull();
    const onze = Array.from({ length: 11 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    expect(lerServicoIds(onze)).toBeNull();
    expect(lerServicoIds(onze.slice(0, 10))).toHaveLength(10);
  });

  it('lerUuid: um UUID, minúsculo; repetido ou malformado → null', () => {
    expect(lerUuid(ANA.toUpperCase())).toBe(ANA);
    expect(lerUuid([ANA, BIA])).toBeNull();
    expect(lerUuid('qualquer')).toBeNull();
    expect(lerUuid(undefined)).toBeNull();
  });

  it('lerData: só datas reais', () => {
    expect(lerData('2026-12-01')).toEqual({ ano: 2026, mes: 12, dia: 1 });
    expect(lerData('2026-02-30')).toBeNull();
    expect(lerData('2026-1-1')).toBeNull();
    expect(lerData(undefined)).toBeNull();
    expect(chaveDeData({ ano: 2026, mes: 1, dia: 5 })).toBe('2026-01-05');
  });

  it('lerHorario: só ISO UTC canônico com segundos zero', () => {
    expect(lerHorario(H9)?.getTime()).toBe(Date.UTC(2026, 11, 1, 12));
    expect(lerHorario('2026-12-01T12:00:30.000Z')).toBeNull();
    expect(lerHorario('2026-12-01T12:00:00Z')).toBeNull();
    expect(lerHorario('2026-13-01T12:00:00.000Z')).toBeNull();
    expect(lerHorario('2026-12-01T09:00:00-03:00')).toBeNull();
    expect(lerHorario(undefined)).toBeNull();
  });

  it('lerAviso: só códigos fechados (sem_profissional saiu)', () => {
    expect(lerAviso('horario_indisponivel')).toBe('horario_indisponivel');
    expect(lerAviso('sem_selecao')).toBe('sem_selecao');
    expect(lerAviso('sem_profissional')).toBeNull();
    expect(lerAviso('<script>')).toBeNull();
    expect(lerAviso(undefined)).toBeNull();
  });

  it('lerItem: `<uuid>_<iso>` único; caixa normalizada; o resto é null', () => {
    expect(lerItem(item(ANA.toUpperCase(), H9))).toEqual({ profissionalId: ANA, inicio: new Date(H9) });
    expect(valorDoItem(ANA, new Date(H9))).toBe(item(ANA, H9));
    expect(valorDoItem(ANA.toUpperCase(), H9)).toBe(item(ANA, H9));
    for (const ruim of [H9, `${ANA}-${H9}`, `x_${H9}`, `${ANA}_2026-12-01T12:00:00Z`, `${ANA}_`, '', `${ANA}_${H9}_x`]) {
      expect(lerItem(ruim), ruim).toBeNull();
    }
    expect(lerItem([item(ANA, H9), item(ANA, H9)])).toBeNull();
    expect(lerItem(undefined)).toBeNull();
    expect(lerItens({ h0: item(ANA, H9), h2: 'lixo', h3: item(BIA, H10) }, 3)).toEqual([
      { profissionalId: ANA, inicio: new Date(H9) },
      null,
      null,
    ]);
    expect(valoresDosItens([{ profissionalId: ANA, inicio: new Date(H9) }, null])).toEqual([item(ANA, H9), null]);
  });
});

describe('lerPasso: parâmetro inválido volta ao passo válido mais avançado (CA-8)', () => {
  it('sem parâmetros, serviços inválidos, repetidos ou 11+: servicos sem marcados', () => {
    expect(lerPasso({}, CTX)).toEqual({ passo: 'servicos', marcados: [], aviso: null });
    expect(lerPasso({ s: 'x', data: '2026-12-01', h0: item(ANA, H9) }, CTX).passo).toBe('servicos');
    expect(lerPasso({ s: [A, A] }, CTX).passo).toBe('servicos');
    const onze = Array.from({ length: 11 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    expect(lerPasso({ s: onze, data: '2026-12-01' }, CTX).passo).toBe('servicos');
    expect(lerPasso({ aviso: 'servico_indisponivel' }, CTX)).toMatchObject({ aviso: 'servico_indisponivel' });
  });

  it('alterar=servicos: passo de serviços com os marcados', () => {
    expect(lerPasso({ s: [A, B], data: '2026-12-01', alterar: 'servicos' }, CTX)).toEqual({ passo: 'servicos', marcados: [A, B], aviso: null });
  });

  it('data ausente, inválida ou fora da janela: data (com `de` ajustado)', () => {
    expect(lerPasso({ s: A }, CTX)).toEqual({ passo: 'data', s: [A], de: HOJE, aviso: null });
    expect(lerPasso({ s: A, data: '2026-02-30' }, CTX).passo).toBe('data');
    expect(lerPasso({ s: A, data: '2026-11-19' }, CTX).passo).toBe('data');
    expect(lerPasso({ s: A, data: '2027-01-19' }, CTX).passo).toBe('servico');
    expect(lerPasso({ s: A, data: '2027-01-20' }, CTX).passo).toBe('data');
    expect(lerPasso({ s: A, de: '2026-01-01' }, CTX)).toMatchObject({ de: HOJE });
    expect(lerPasso({ s: A, de: '2030-01-01' }, CTX)).toMatchObject({ de: { ano: 2027, mes: 1, dia: 19 } });
    expect(lerPasso({ s: A, de: '2026-12-05' }, CTX)).toMatchObject({ de: { ano: 2026, mes: 12, dia: 5 } });
  });

  it('o primeiro h ausente ou inválido define o serviço; os itens válidos seguintes são preservados', () => {
    const base = { s: [A, B, C], data: '2026-12-01' };
    expect(lerPasso(base, CTX)).toMatchObject({ passo: 'servico', indice: 0, itens: [null, null, null], alterando: false, preSelecionado: null });
    const p = lerPasso({ ...base, h0: item(ANA, H9), h1: 'lixo', h2: item(BIA, H15) }, CTX);
    expect(p).toMatchObject({ passo: 'servico', indice: 1, filtro: null, aviso: null });
    if (p.passo !== 'servico') throw new Error('passo inesperado');
    expect(p.itens).toEqual([{ profissionalId: ANA, inicio: new Date(H9) }, null, { profissionalId: BIA, inicio: new Date(H15) }]);
    // h fora do intervalo de s é ignorado; h repetido é inválido.
    expect(lerPasso({ ...base, h0: item(ANA, H9), h1: item(BIA, H10), h2: [item(BIA, H15), item(ANA, H15)], h3: item(ANA, H9) }, CTX)).toMatchObject({ passo: 'servico', indice: 2 });
  });

  it('todos os itens válidos: dados', () => {
    const p = lerPasso({ s: [A, B], data: '2026-12-01', h0: item(ANA, H9), h1: item(BIA, H10), aviso: 'sem_selecao', f: ANA }, CTX);
    expect(p).toEqual({
      passo: 'dados',
      s: [A, B],
      data: { ano: 2026, mes: 12, dia: 1 },
      itens: [{ profissionalId: ANA, inicio: new Date(H9) }, { profissionalId: BIA, inicio: new Date(H10) }],
    });
  });

  it('alterar=k (CA-9): passo k com o item atual pré-selecionado e os demais preservados', () => {
    const p = lerPasso({ s: [A, B], data: '2026-12-01', h0: item(ANA, H9), h1: item(BIA, H10), alterar: '0', f: BIA.toUpperCase() }, CTX);
    expect(p).toMatchObject({ passo: 'servico', indice: 0, alterando: true, preSelecionado: { profissionalId: ANA, inicio: new Date(H9) }, filtro: BIA });
    if (p.passo === 'servico') expect(p.itens[1]).toEqual({ profissionalId: BIA, inicio: new Date(H10) });
    // Índice fora de s, com zero à esquerda ou texto: ignorado.
    for (const alterar of ['2', '00', '-1', 'x', ['0', '1']]) {
      expect(lerPasso({ s: [A, B], data: '2026-12-01', h0: item(ANA, H9), h1: item(BIA, H10), alterar }, CTX).passo, String(alterar)).toBe('dados');
    }
  });

  it('enviado=k sem h<k>: aviso sem_selecao só se o passo continua o mesmo', () => {
    const base = { s: [A, B], data: '2026-12-01', h0: item(ANA, H9) };
    expect(lerPasso({ ...base, enviado: '1' }, CTX)).toMatchObject({ passo: 'servico', indice: 1, aviso: 'sem_selecao' });
    expect(lerPasso({ ...base, enviado: '0' }, CTX)).toMatchObject({ passo: 'servico', indice: 1, aviso: null });
    expect(lerPasso({ ...base, enviado: '1', aviso: 'horario_indisponivel' }, CTX)).toMatchObject({ aviso: 'horario_indisponivel' });
    expect(lerPasso({ ...base, h1: item(BIA, H10), enviado: '1' }, CTX).passo).toBe('dados');
  });
});

describe('lerSelecao (POST de dados)', () => {
  it('exige s, data e todos os h', () => {
    expect(lerSelecao({ s: [A, B], data: '2026-12-01', h0: item(ANA, H9), h1: item(BIA, H10) })).toEqual({
      s: [A, B],
      data: '2026-12-01',
      itens: [{ profissionalId: ANA, inicio: new Date(H9) }, { profissionalId: BIA, inicio: new Date(H10) }],
    });
    expect(lerSelecao({ s: [A, B], data: '2026-12-01', h0: item(ANA, H9) })).toBeNull();
    expect(lerSelecao({ s: [A], data: 'x', h0: item(ANA, H9) })).toBeNull();
    expect(lerSelecao({ data: '2026-12-01', h0: item(ANA, H9) })).toBeNull();
  });
});

describe('montarHref e links do fluxo', () => {
  const q = { s: [A, B, C], data: '2026-12-01', h: [item(ANA, H9), null, item(BIA, H15)] };
  const cod = (v: string) => encodeURIComponent(v);

  it('repete s, h por índice (omitindo nulos), codifica e omite o que não veio', () => {
    expect(montarHref('/x', {})).toBe('/x');
    expect(montarHref('/x', { ...q, de: '2026-11-30', f: ANA, alterar: 2, enviado: 1, aviso: 'sem_selecao' })).toBe(
      `/x?s=${A}&s=${B}&s=${C}&data=2026-12-01&de=2026-11-30&h0=${cod(item(ANA, H9))}&h2=${cod(item(BIA, H15))}` +
        `&f=${ANA}&alterar=2&enviado=1&aviso=sem_selecao`,
    );
    expect(montarHref('/x', { aviso: 'horario_indisponivel' })).toBe('/x?aviso=horario_indisponivel');
  });

  it('o href ida e volta reproduz o mesmo passo (lerPasso ∘ montarHref)', () => {
    const url = new URL(montarHref('http://l/x', { ...q, alterar: 0 }));
    const params: Record<string, string | string[]> = {};
    for (const k of new Set(url.searchParams.keys())) {
      const v = url.searchParams.getAll(k);
      params[k] = v.length === 1 ? v[0] : v;
    }
    expect(lerPasso(params, CTX)).toMatchObject({ passo: 'servico', indice: 0, alterando: true, preSelecionado: { profissionalId: ANA } });
  });

  it('campos ocultos do passo k: s, data, h dos outros e enviado; sem índice: todos os h', () => {
    expect(camposOcultos(q, 2)).toEqual([
      { name: 's', value: A },
      { name: 's', value: B },
      { name: 's', value: C },
      { name: 'data', value: '2026-12-01' },
      { name: 'h0', value: item(ANA, H9) },
      { name: 'enviado', value: '2' },
    ]);
    expect(camposOcultos(q).map((c) => c.name)).toEqual(['s', 's', 's', 'data', 'h0', 'h2']);
  });

  it('Alterar, filtro, outro dia, alterar serviços e seguir sem', () => {
    expect(hrefAlterarItem('/x', q, 0)).toBe(montarHref('/x', { ...q, alterar: 0 }));
    expect(hrefFiltro('/x', q, BIA)).toBe(montarHref('/x', { ...q, f: BIA }));
    expect(hrefFiltro('/x', q, null)).toBe(montarHref('/x', q));
    expect(hrefFiltro('/x', q, BIA, 0)).toBe(montarHref('/x', { ...q, f: BIA, alterar: 0 }));
    expect(hrefOutroDia('/x', q)).toBe(`/x?s=${A}&s=${B}&s=${C}&de=2026-12-01`);
    expect(hrefOutroDia('/x', { s: [A] })).toBe(`/x?s=${A}`);
    expect(hrefAlterarServicos('/x', q)).toBe(`/x?s=${A}&s=${B}&s=${C}&alterar=servicos`);
    // Tira o serviço e o item dele, reindexando os demais.
    expect(hrefSeguirSem('/x', q, 1)).toBe(montarHref('/x', { s: [A, C], data: '2026-12-01', h: [item(ANA, H9), item(BIA, H15)] }));
    expect(hrefSeguirSem('/x', { s: [A], data: '2026-12-01', h: [null] }, 0)).toBe('/x');
  });
});
