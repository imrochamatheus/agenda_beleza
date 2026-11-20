import { afterEach, describe, expect, it, vi } from 'vitest';

import { estadoRegrasInicial, estadoSlugInicial } from '@/app/painel/configuracoes/estado';
import { MENSAGENS_CONFIGURACOES as M } from '@/server/salao/tipos';

import { demonstrarRegrasAcao, demonstrarSlugAcao } from './acoes';
import { SLUG_ANTERIOR_DEMONSTRACAO, SLUG_ATUAL_DEMONSTRACAO, SLUG_EM_USO_DEMONSTRACAO } from './demonstracao';

// D-017 T-9: as ações de demonstração só validam; desligada a vitrine, não processam nada.

afterEach(() => {
  vi.unstubAllEnvs();
});

function formulario(campos: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
}
const regras = (extra: Record<string, string> = {}) =>
  formulario({ nome: 'Studio Exemplo', fuso: 'America/Sao_Paulo', grade: '15', antecedencia: '2', janela: '60', intervalo: '0', ...extra });
const ligar = () => vi.stubEnv('VITRINE_COMPONENTES', 'true');

describe('vitrine desligada', () => {
  it('as duas ações devolvem o estado anterior sem validar', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', 'false');
    const anterior = estadoRegrasInicial();
    expect(await demonstrarRegrasAcao(anterior, regras({ grade: '7' }))).toBe(anterior);
    const slug = estadoSlugInicial();
    expect(await demonstrarSlugAcao(slug, formulario({ slug: 'painel' }))).toBe(slug);
  });
});

describe('demonstrarRegrasAcao', () => {
  it('inválido → erros com os valores digitados', async () => {
    ligar();
    expect(await demonstrarRegrasAcao(estadoRegrasInicial(), regras({ grade: '7', antecedencia: '99' }))).toEqual({
      mensagem: null,
      sucesso: null,
      erros: { grade: M.grade, antecedencia: M.antecedencia },
      valores: { nome: 'Studio Exemplo', fuso: 'America/Sao_Paulo', grade: '7', antecedencia: '99', janela: '60', intervalo: '0' },
    });
  });

  it('válido → sucesso com os valores normalizados', async () => {
    ligar();
    expect(await demonstrarRegrasAcao(estadoRegrasInicial(), regras({ nome: '  Studio   Novo ', grade: '30', antecedencia: '05', fuso: 'America/Manaus' }))).toEqual({
      mensagem: null,
      sucesso: M.regrasSalvas,
      erros: {},
      valores: { nome: 'Studio Novo', fuso: 'America/Manaus', grade: '30', antecedencia: '5', janela: '60', intervalo: '0' },
    });
  });
});

describe('demonstrarSlugAcao', () => {
  it.each([
    [SLUG_ATUAL_DEMONSTRACAO, { sucesso: M.slugSemEfeito, erros: {}, valor: '' }],
    [` ${SLUG_ATUAL_DEMONSTRACAO.toUpperCase()} `, { sucesso: M.slugSemEfeito, erros: {}, valor: '' }],
    [SLUG_ANTERIOR_DEMONSTRACAO, { sucesso: M.slugTrocado, erros: {}, valor: '' }],
    ['bela-studio', { sucesso: M.slugTrocado, erros: {}, valor: '' }],
    ['painel', { sucesso: null, erros: { slug: M.slugReservado }, valor: 'painel' }],
    [SLUG_EM_USO_DEMONSTRACAO, { sucesso: null, erros: { slug: M.slugEmUso }, valor: SLUG_EM_USO_DEMONSTRACAO }],
    ['bela studio', { sucesso: null, erros: { slug: M.slugFormato }, valor: 'bela studio' }],
    ['x'.repeat(300), { sucesso: null, erros: { slug: M.slugFormato }, valor: 'x'.repeat(200) }],
  ])('%s', async (slug, esperado) => {
    ligar();
    expect(await demonstrarSlugAcao(estadoSlugInicial(), formulario({ slug }))).toEqual({ mensagem: null, ...esperado });
  });
});
