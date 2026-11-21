import { afterEach, describe, expect, it, vi } from 'vitest';

import { estadoInicial } from '@/app/painel/clientes/estado';
import { MENSAGENS_CLIENTE } from '@/server/clientes/tipos';

import { demonstrarEdicaoAcao } from './acoes';
import { CLIENTE_EXISTENTE_DEMONSTRACAO } from './demonstracao';

// D-022 T-6: a ação de demonstração só valida; desligada a vitrine, não processa nada.

afterEach(() => {
  vi.unstubAllEnvs();
});

const fd = (campos: Record<string, string>): FormData => {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
};
const ligar = () => vi.stubEnv('VITRINE_COMPONENTES', 'true');
const base = estadoInicial({ nome: 'Maria Souza', telefone: '(11) 98765-4321' });

describe('demonstrarEdicaoAcao', () => {
  it('vitrine desligada: devolve o estado anterior sem validar', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', 'false');
    expect(await demonstrarEdicaoAcao(base, fd({ nome: 'A', telefone: 'x' }))).toBe(base);
  });

  it('inválido: todos os erros juntos e os valores digitados', async () => {
    ligar();
    const r = await demonstrarEdicaoAcao(base, fd({ id: 'demo-detalhe', nome: 'A', telefone: 'abc' }));
    expect(r.erros).toEqual({ telefone: MENSAGENS_CLIENTE.telefone, nome: MENSAGENS_CLIENTE.nomeTamanho });
    expect(r.valores).toEqual({ nome: 'A', telefone: 'abc' });
    expect(r.sucesso).toBeNull();
  });

  it('telefone de outra cliente: recusado com a cliente existente', async () => {
    ligar();
    const r = await demonstrarEdicaoAcao(base, fd({ nome: 'Maria Souza', telefone: '(11) 90000-0002' }));
    expect(r.erros).toEqual({ telefone: MENSAGENS_CLIENTE.telefoneEmUso });
    expect(r.existente).toEqual(CLIENTE_EXISTENTE_DEMONSTRACAO);
  });

  it('mesmos valores: "nenhuma alteração"; valores novos: salvo e normalizado', async () => {
    ligar();
    expect((await demonstrarEdicaoAcao(base, fd({ nome: ' Maria  Souza', telefone: '11987654321' }))).sucesso).toBe(MENSAGENS_CLIENTE.semAlteracao);
    const r = await demonstrarEdicaoAcao(base, fd({ nome: 'Maria  Lima ', telefone: '21 91234-5678' }));
    expect(r).toMatchObject({ sucesso: MENSAGENS_CLIENTE.salva, valores: { nome: 'Maria Lima', telefone: '(21) 91234-5678' }, erros: {} });
  });
});
