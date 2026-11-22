import { describe, expect, it } from 'vitest';

import { LIMITES_CADASTRO } from '@/server/auth/cadastro';
import { MENSAGENS_CONFIGURACOES } from '@/server/salao/tipos';

import { LIMITES_ADMIN_SALOES } from './saloes-tipos';
import { alteraSalao, diferencaDoSalao, lerFiltros, recusaDaExtensao, validarDias, validarEdicao, validarMotivo } from './saloes-validacao';
import type { AtualDoSalao } from './saloes-validacao';

const ATUAL: AtualDoSalao = {
  nome: 'Studio Aurora',
  fuso: 'America/Sao_Paulo',
  gradeMin: 15,
  antecedenciaMin: 120,
  janelaDias: 60,
  intervaloMin: 0,
  slug: 'aurora',
  gestor: { nome: 'Ana Gestora', email: 'ana@exemplo.com.br' },
};

const IGUAL = {
  nome: 'Studio Aurora',
  slug: 'aurora',
  fuso: 'America/Sao_Paulo',
  grade: '15',
  antecedencia: '2',
  janela: '60',
  intervalo: '0',
  gestorNome: 'Ana Gestora',
  gestorEmail: 'ana@exemplo.com.br',
};

describe('limites', () => {
  it('o nome do gestor tem o mesmo teto do cadastro', () => {
    expect(LIMITES_ADMIN_SALOES.gestorNome).toEqual(LIMITES_CADASTRO.nome);
  });
});

describe('lerFiltros', () => {
  it('padrões quando ausente ou inválido', () => {
    expect(lerFiltros({})).toMatchObject({ q: '', chave: '', estado: null, suspenso: 'todas', pagina: 1 });
    expect(lerFiltros({ estado: 'encerrada', suspenso: 'talvez', pagina: '0', q: ['a', 'b'] })).toMatchObject({
      q: '', estado: null, suspenso: 'todas', pagina: 1,
    });
  });
  it('lê busca (sem acento na chave), estado, suspensão e página', () => {
    expect(lerFiltros({ q: '  Ação   %_\\ ', estado: 'sem_assinatura', suspenso: 'sim', pagina: '3' })).toMatchObject({
      q: 'Ação %_\\', chave: 'acao %_\\', estado: 'sem_assinatura', suspenso: 'sim', pagina: 3,
    });
  });
});

describe('validarMotivo', () => {
  it('aceita e colapsa espaços', () => {
    expect(validarMotivo('  Pedido   do gestor  ')).toEqual({ ok: true, motivo: 'Pedido do gestor' });
  });
  it.each([undefined, 42, '', '    ', 'abcd', 'a'.repeat(281), 'linha\nquebrada ok'])('recusa %j', (v) => {
    const r = validarMotivo(v);
    expect(r.ok).toBe(false);
  });
  it('aceita exatamente 5 e 280', () => {
    expect(validarMotivo('abcde').ok).toBe(true);
    expect(validarMotivo('a'.repeat(280)).ok).toBe(true);
  });
  it('recusa e-mail e telefone óbvios', () => {
    expect(validarMotivo('falar com ana@exemplo.com.br')).toEqual({ ok: false, erro: 'Não escreva telefone nem e-mail no motivo.' });
    expect(validarMotivo('ligar (11) 98765-4321 depois')).toMatchObject({ ok: false });
    expect(validarMotivo('pedido número 12345 do gestor').ok).toBe(true);
  });
});

describe('validarDias', () => {
  it.each(['1', '5', '10', '90', ' 7 '])('aceita %j', (v) => {
    expect(validarDias(v)).toEqual({ ok: true, dias: Number(v.trim()) });
  });
  it.each(['1e1', '+5', '0', '-1', '', ' ', '91', '100', '5.0', '5,5', '1 0', '０５', 'abc', undefined, 5, null])('recusa %j', (v) => {
    expect(validarDias(v)).toEqual({ ok: false, erro: 'Informe um número inteiro de 1 a 90.' });
  });
});

describe('validarEdicao', () => {
  it('valores iguais: vazio, sem diferença', () => {
    const r = validarEdicao(IGUAL, ATUAL);
    expect(r.ok && r.vazio).toBe(true);
    expect(r.ok && alteraSalao(r.mudancas)).toBe(false);
  });

  it('e-mail em outra caixa e espaços não contam como mudança', () => {
    const r = validarEdicao({ ...IGUAL, gestorEmail: '  ANA@exemplo.com.br ', nome: ' Studio   Aurora ' }, ATUAL);
    expect(r.ok && r.vazio).toBe(true);
  });

  it('só os campos alterados entram na diferença, em snake_case e nas unidades do banco', () => {
    const r = validarEdicao({ ...IGUAL, grade: '30', antecedencia: '3', slug: ' Aurora-Nova ', gestorNome: 'Ana B.' }, ATUAL);
    if (!r.ok) throw new Error('esperava ok');
    expect(r.vazio).toBe(false);
    expect(r.mudancas.slug).toBe('aurora-nova');
    expect(r.mudancas.gestorEmail).toBeNull();
    expect(diferencaDoSalao(ATUAL, r.mudancas)).toEqual({
      antes: { grade_min: 15, antecedencia_min: 120, slug: 'aurora', gestor_nome: 'Ana Gestora' },
      depois: { grade_min: 30, antecedencia_min: 180, slug: 'aurora-nova', gestor_nome: 'Ana B.' },
    });
  });

  it('e-mail novo vai normalizado em minúsculas', () => {
    const r = validarEdicao({ ...IGUAL, gestorEmail: 'Nova@Exemplo.com.br' }, ATUAL);
    expect(r.ok && r.mudancas.gestorEmail).toBe('nova@exemplo.com.br');
    expect(r.ok && alteraSalao(r.mudancas)).toBe(false);
  });

  it('as mesmas recusas da E2.5, com as mesmas mensagens, todas juntas', () => {
    const r = validarEdicao({ ...IGUAL, grade: '7', antecedencia: '1440', janela: '30', fuso: 'Brasil/Leste', slug: 'admin', gestorEmail: 'x', gestorNome: '' }, ATUAL);
    expect(r).toMatchObject({ ok: false });
    if (r.ok) return;
    expect(r.erros.grade).toBe(MENSAGENS_CONFIGURACOES.grade);
    expect(r.erros.antecedencia).toBe(MENSAGENS_CONFIGURACOES.antecedencia);
    expect(r.erros.fuso).toBe(MENSAGENS_CONFIGURACOES.fuso);
    expect(r.erros.slug).toBe(MENSAGENS_CONFIGURACOES.slugReservado);
    expect(r.erros.gestorEmail).toBe('Informe um e-mail válido.');
    expect(r.erros.gestorNome).toBe('Informe o nome do gestor (de 2 a 100 caracteres).');
  });

  it('antecedência ≥ janela e slug de formato inválido', () => {
    const r = validarEdicao({ ...IGUAL, antecedencia: '48', janela: '2', slug: 'Ab_c!' }, ATUAL);
    expect(r).toMatchObject({ ok: false });
    if (r.ok) return;
    expect(r.erros.antecedencia).toBe(MENSAGENS_CONFIGURACOES.antecedenciaJanela);
    expect(r.erros.slug).toBe(MENSAGENS_CONFIGURACOES.slugFormato);
  });

  it('o fuso gravado hoje é aceito mesmo fora da lista canônica', () => {
    const r = validarEdicao({ ...IGUAL, fuso: 'Brazil/East' }, { ...ATUAL, fuso: 'Brazil/East' });
    expect(r.ok && r.vazio).toBe(true);
  });

  it('salão sem gestor: campos do gestor ignorados', () => {
    const r = validarEdicao({ ...IGUAL, gestorNome: '', gestorEmail: 'inválido' }, { ...ATUAL, gestor: null });
    expect(r.ok && r.vazio).toBe(true);
  });

  it('entrada que não é objeto ou sem campos é recusada, não lança', () => {
    expect(validarEdicao(null as never, ATUAL)).toMatchObject({ ok: false });
    expect(validarEdicao({}, ATUAL)).toMatchObject({ ok: false });
  });
});

describe('recusaDaExtensao', () => {
  const agora = new Date('2030-01-01T12:00:00Z');
  const ok = { estado: 'em_teste', temProvedor: true, testeFimEm: new Date('2030-01-20T12:00:00Z') };
  it('pode estender: null', () => {
    expect(recusaDaExtensao(ok, agora)).toBeNull();
    expect(recusaDaExtensao({ ...ok, testeFimEm: new Date(agora.getTime() + 5 * 60_000) }, agora)).toBeNull();
  });
  it('ordem das recusas', () => {
    expect(recusaDaExtensao({ ...ok, estado: null, temProvedor: false, testeFimEm: null }, agora)).toBe('sem_assinatura');
    expect(recusaDaExtensao({ ...ok, estado: 'ativa', temProvedor: false }, agora)).toBe('estado');
    expect(recusaDaExtensao({ ...ok, temProvedor: false, testeFimEm: null }, agora)).toBe('sem_provedor');
    expect(recusaDaExtensao({ ...ok, testeFimEm: null }, agora)).toBe('teste_encerrado');
    expect(recusaDaExtensao({ ...ok, testeFimEm: agora }, agora)).toBe('teste_encerrado');
    expect(recusaDaExtensao({ ...ok, testeFimEm: new Date(agora.getTime() + 5 * 60_000 - 1) }, agora)).toBe('teste_expirando');
  });
});
