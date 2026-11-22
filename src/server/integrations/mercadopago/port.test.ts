import { describe, expect, it } from 'vitest';

import {
  ErroMercadoPago,
  ErroProvedor,
  OPERACOES_MP,
  OperacaoInvalidaNoProvedor,
  RecursoNaoEncontradoNoProvedor,
  validarCriacaoAssinatura,
} from './port';

const VALIDA = {
  salaoId: '6f1c2c0e-1b2a-4c3d-8e4f-5a6b7c8d9e0f',
  emailPagador: 'gestora@exemplo.com',
  urlRetorno: 'http://localhost:3000/assinatura/retorno',
};

describe('mercadopago/port', () => {
  it('declara as seis operações da porta (além de validarWebhook)', () => {
    expect(OPERACOES_MP).toEqual([
      'criarAssinatura',
      'consultarAssinatura',
      'consultarPagamento',
      'cancelarAssinatura',
      'adiarProximaCobranca',
      'urlAtualizarMeioPagamento',
    ]);
  });

  it.each([
    [RecursoNaoEncontradoNoProvedor, 'nao_encontrado', 'RecursoNaoEncontradoNoProvedor'],
    [OperacaoInvalidaNoProvedor, 'operacao_invalida', 'OperacaoInvalidaNoProvedor'],
    [ErroProvedor, 'falha_provedor', 'ErroProvedor'],
  ] as const)('%o: subclasse de ErroMercadoPago com código %s', (Classe, codigo, nome) => {
    const erro = new Classe();
    expect(erro).toBeInstanceOf(ErroMercadoPago);
    expect(erro).toBeInstanceOf(Error);
    expect(erro.codigo).toBe(codigo);
    expect(erro.name).toBe(nome);
    expect(erro.message).not.toBe('');
    expect(new Classe('mensagem própria').message).toBe('mensagem própria');
  });

  describe('validarCriacaoAssinatura', () => {
    it('aceita entrada válida (http e https)', () => {
      expect(validarCriacaoAssinatura(VALIDA)).toBeNull();
      expect(
        validarCriacaoAssinatura({ ...VALIDA, urlRetorno: 'https://agenda.exemplo.com/retorno' }),
      ).toBeNull();
    });

    it.each([
      ['salaoId que não é UUID', { salaoId: 'salao-1' }, 'salaoId'],
      ['e-mail inválido', { emailPagador: 'nao-email' }, 'emailPagador'],
      ['URL relativa', { urlRetorno: '/retorno' }, 'urlRetorno'],
      ['URL com outro protocolo', { urlRetorno: 'javascript:alert(1)' }, 'urlRetorno'],
    ])('%s → OperacaoInvalidaNoProvedor nomeando o campo, sem o valor', (_caso, mudanca, campo) => {
      const erro = validarCriacaoAssinatura({ ...VALIDA, ...mudanca });
      expect(erro).toBeInstanceOf(OperacaoInvalidaNoProvedor);
      expect(erro?.message).toContain(campo);
      for (const valor of Object.values(mudanca)) expect(erro?.message).not.toContain(valor);
    });

    it('nomeia todos os campos inválidos, ordenados', () => {
      const erro = validarCriacaoAssinatura({ salaoId: 'x', emailPagador: 'y', urlRetorno: 'z' });
      expect(erro?.message).toContain('(emailPagador, salaoId, urlRetorno)');
    });
  });
});

describe('ProvedorNaoSuportaAdiamento (D-046)', () => {
  it('é um ErroMercadoPago com o código adiamento_nao_suportado', async () => {
    const { ProvedorNaoSuportaAdiamento } = await import('./port');
    const e = new ProvedorNaoSuportaAdiamento();
    expect(e).toBeInstanceOf(ErroMercadoPago);
    expect(e.codigo).toBe('adiamento_nao_suportado');
    expect(e.name).toBe('ProvedorNaoSuportaAdiamento');
  });
});
