import { describe, expect, it } from 'vitest';

import { estadoInicial, hrefDaLista, idDoCampo, lerFormularioCliente } from './estado';

describe('estado do formulário de cliente', () => {
  it('lê só id, nome e telefone; ignora extras (salaoId) e arquivos; ausentes viram ""', () => {
    const fd = new FormData();
    fd.set('id', 'abc');
    fd.set('nome', 'Ana');
    fd.set('telefone', '11987654321');
    fd.set('salaoId', 'forjado');
    fd.set('arquivo', new Blob(['x']), 'x.txt');
    expect(lerFormularioCliente(fd)).toEqual({
      entrada: { id: 'abc', nome: 'Ana', telefone: '11987654321' },
      valores: { nome: 'Ana', telefone: '11987654321' },
    });
    const vazio = new FormData();
    vazio.set('nome', new Blob(['x']), 'n.txt');
    expect(lerFormularioCliente(vazio).entrada).toEqual({ id: '', nome: '', telefone: '' });
  });

  it('o eco dos valores é cortado; a entrada segue inteira para o servidor', () => {
    const fd = new FormData();
    fd.set('nome', 'n'.repeat(5000));
    const { entrada, valores } = lerFormularioCliente(fd);
    expect(entrada.nome).toHaveLength(5000);
    expect(valores.nome).toHaveLength(200);
  });

  it('estado inicial e id do campo', () => {
    expect(estadoInicial({ nome: 'A', telefone: 'B' })).toEqual({ mensagem: null, sucesso: null, erros: {}, existente: null, valores: { nome: 'A', telefone: 'B' } });
    expect(idDoCampo('nome')).toBe('cliente-nome');
    expect(idDoCampo('telefone')).toBe('cliente-telefone');
  });

  it('hrefDaLista só leva o que difere do padrão e codifica a busca', () => {
    expect(hrefDaLista('/painel/clientes', '', 1)).toBe('/painel/clientes');
    expect(hrefDaLista('/painel/clientes', 'ana', 1)).toBe('/painel/clientes?q=ana');
    expect(hrefDaLista('/painel/clientes', '', 3)).toBe('/painel/clientes?pagina=3');
    expect(hrefDaLista('/painel/clientes', 'a&b=c %', 2)).toBe('/painel/clientes?q=a%26b%3Dc+%25&pagina=2');
  });
});
