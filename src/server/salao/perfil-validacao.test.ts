import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { COMODIDADES, filtrarChaves, MEIOS_PAGAMENTO, MENSAGENS_PERFIL, UFS } from './perfil-tipos';
import type { EntradaPerfil, ErrosPerfil, PerfilSalao } from './perfil-tipos';
import { normalizarCep, normalizarDescricao, normalizarInstagram, perfilParaColunas, validarPerfil, valoresDoPerfil } from './perfil-validacao';

// D-020 T-3: CA-2 (todos os casos), CA-14 (vazio → null), CA-15 (listas) e as entradas inválidas da §6.

const M = MENSAGENS_PERFIL;

const ENDERECO = {
  logradouro: 'Av. Paulista',
  numero: '1000',
  complemento: 'Sala 2',
  bairro: 'Bela Vista',
  cidade: 'São Paulo',
  uf: 'SP',
  cep: '01310-100',
};

function ok(e: EntradaPerfil): PerfilSalao {
  const r = validarPerfil(e);
  if (!r.ok) throw new Error(`esperava válido: ${JSON.stringify(r.erros)}`);
  return r.perfil;
}

function erros(e: unknown): ErrosPerfil {
  const r = validarPerfil(e);
  if (r.ok) throw new Error('esperava inválido');
  return r.erros;
}

describe('validarPerfil: vazio e completo (RN-4, CA-14)', () => {
  it('objeto vazio → tudo null e listas vazias', () => {
    expect(ok({})).toEqual({
      descricao: null,
      endereco: null,
      telefoneE164: null,
      whatsappE164: null,
      instagram: null,
      meiosPagamento: [],
      comodidades: [],
    });
  });

  it('textos em branco (só espaços) → null, nunca ""', () => {
    const p = ok({ descricao: '   \r\n\t ', logradouro: '  ', numero: '', complemento: ' ', bairro: '', cidade: '', uf: ' ', cep: '', telefone: ' ', whatsapp: '', instagram: '  ', meiosPagamento: [], comodidades: [] });
    expect(p.descricao).toBeNull();
    expect(p.endereco).toBeNull();
    expect(p.telefoneE164).toBeNull();
    expect(p.instagram).toBeNull();
  });

  it('perfil completo normalizado', () => {
    expect(
      ok({
        descricao: '  Olá\r\nmundo\tbom  ',
        ...ENDERECO,
        logradouro: '  Av.   Paulista ',
        numero: 'S/N',
        uf: 'sp',
        telefone: '(11) 3456-7890',
        whatsapp: '+55 11 98765-4321',
        instagram: '@Meu.Salao',
        meiosPagamento: ['pix', 'dinheiro', 'pix'],
        comodidades: ['wifi'],
        salaoId: 'forjado',
      } as EntradaPerfil),
    ).toEqual({
      descricao: 'Olá\nmundo bom',
      endereco: { logradouro: 'Av. Paulista', numero: 's/n', complemento: 'Sala 2', bairro: 'Bela Vista', cidade: 'São Paulo', uf: 'SP', cep: '01310100' },
      telefoneE164: '+551134567890',
      whatsappE164: '+5511987654321',
      instagram: 'meu.salao',
      meiosPagamento: ['dinheiro', 'pix'],
      comodidades: ['wifi'],
    });
  });

  it('complemento é opcional', () => {
    expect(ok({ ...ENDERECO, complemento: '' }).endereco!.complemento).toBeNull();
  });
});

describe('descrição (RN-5)', () => {
  it('1.000 aceita, 1.001 recusa; \\r\\n conta como 1', () => {
    expect(ok({ descricao: 'a'.repeat(1000) }).descricao).toHaveLength(1000);
    expect(erros({ descricao: 'a'.repeat(1001) })).toEqual({ descricao: M.descricao });
    const comQuebras = `${'a'.repeat(499)}\r\n${'b'.repeat(500)}`; // 1.001 cru, 1.000 normalizada
    expect(comQuebras.length).toBe(1001);
    expect(ok({ descricao: comQuebras }).descricao).toHaveLength(1000);
    expect(ok({ descricao: 'a\rb' }).descricao).toBe('a\nb');
  });

  it('controle (exceto \\n e \\t) → descricaoCaracteres; HTML vira texto', () => {
    expect(erros({ descricao: 'a\u0000b' })).toEqual({ descricao: M.descricaoCaracteres });
    expect(erros({ descricao: 'a\u0007b' })).toEqual({ descricao: M.descricaoCaracteres });
    expect(ok({ descricao: '<script>alert(1)</script>' }).descricao).toBe('<script>alert(1)</script>');
  });

  it('tipos errados e texto enorme → descricao', () => {
    for (const v of [42, null, ['a'], 'x'.repeat(10000)]) expect(normalizarDescricao(v)).toEqual({ ok: false, erro: M.descricao });
  });
});

describe('endereço (RN-6)', () => {
  it.each(['XX', 'S', 'São Paulo'])('UF %s → uf', (uf) => {
    expect(erros({ ...ENDERECO, uf })).toEqual({ uf: M.uf });
  });

  it('UF sp aceita, gravada SP; todas as 27', () => {
    expect(ok({ ...ENDERECO, uf: ' sp ' }).endereco!.uf).toBe('SP');
    expect(UFS).toHaveLength(27);
    for (const uf of UFS) expect(ok({ ...ENDERECO, uf: uf.toLowerCase() }).endereco!.uf).toBe(uf);
  });

  it.each(['1234-567', '123456789', '01310 100', 'abcde-fgh', '00000-000', '00000000', '01310--100'])('CEP %s → cep', (cep) => {
    expect(erros({ ...ENDERECO, cep })).toEqual({ cep: M.cep });
  });

  it('CEP 01310-100 e 01310100 aceitos, gravados 01310100', () => {
    expect(ok({ ...ENDERECO, cep: '01310-100' }).endereco!.cep).toBe('01310100');
    expect(ok({ ...ENDERECO, cep: ' 01310100 ' }).endereco!.cep).toBe('01310100');
    expect(normalizarCep('01310100')).toBe('01310100');
    expect(normalizarCep('0131010')).toBeNull();
  });

  it('endereço incompleto (só cidade) → obrigatórios faltantes', () => {
    expect(erros({ cidade: 'São Paulo' })).toEqual({
      logradouro: M.enderecoObrigatorio,
      numero: M.enderecoObrigatorio,
      bairro: M.enderecoObrigatorio,
      uf: M.enderecoObrigatorio,
      cep: M.enderecoObrigatorio,
    });
  });

  it('só o complemento também exige o bloco', () => {
    expect(Object.keys(erros({ complemento: 'Casa' })).sort()).toEqual(['bairro', 'cep', 'cidade', 'logradouro', 'numero', 'uf']);
  });

  it('erro de formato prevalece sobre a obrigatoriedade no mesmo campo', () => {
    expect(erros({ cidade: 'São Paulo', cep: '123' }).cep).toBe(M.cep);
  });

  it('limites, quebras de linha e tipos nos campos de uma linha', () => {
    expect(erros({ ...ENDERECO, logradouro: 'a'.repeat(121) })).toEqual({ logradouro: M.logradouro });
    expect(ok({ ...ENDERECO, logradouro: 'a'.repeat(120) }).endereco!.logradouro).toHaveLength(120);
    expect(erros({ ...ENDERECO, numero: '12345678901' })).toEqual({ numero: M.numero });
    expect(erros({ ...ENDERECO, complemento: 'a'.repeat(61) })).toEqual({ complemento: M.complemento });
    expect(erros({ ...ENDERECO, bairro: 'a\nb' })).toEqual({ bairro: M.bairro });
    expect(erros({ ...ENDERECO, cidade: 42 })).toEqual({ cidade: M.cidade });
    expect(erros({ ...ENDERECO, logradouro: 'x'.repeat(10000) })).toEqual({ logradouro: M.logradouro });
    expect(erros({ ...ENDERECO, uf: ['SP'] })).toEqual({ uf: M.uf });
    expect(erros({ ...ENDERECO, cep: 1310100 })).toEqual({ cep: M.cep });
  });

  it('número aceita 123A e s/n em qualquer caixa', () => {
    expect(ok({ ...ENDERECO, numero: '123A' }).endereco!.numero).toBe('123A');
    expect(ok({ ...ENDERECO, numero: 's/N' }).endereco!.numero).toBe('s/n');
  });
});

describe('telefone e WhatsApp (RN-7)', () => {
  it.each(['+1 212 555 0100', '(00) 3456-7890', '0800 123 4567', '(11) 8765-432', '(11) 88765-4321', 'abc'])('%s → telefone', (t) => {
    expect(erros({ telefone: t })).toEqual({ telefone: M.telefone });
    expect(erros({ whatsapp: t })).toEqual({ whatsapp: M.telefone });
  });

  it('aceitos e gravados em E.164; podem ser o mesmo número', () => {
    expect(ok({ telefone: '(11) 3456-7890' }).telefoneE164).toBe('+551134567890');
    expect(ok({ telefone: '11987654321' }).telefoneE164).toBe('+5511987654321');
    expect(ok({ telefone: '+55 11 98765-4321', whatsapp: '11987654321' })).toMatchObject({
      telefoneE164: '+5511987654321',
      whatsappE164: '+5511987654321',
    });
    expect(ok({ whatsapp: '(11) 3456-7890' }).whatsappE164).toBe('+551134567890');
  });

  it('tipos errados → erro do campo', () => {
    expect(erros({ telefone: 11987654321, whatsapp: null })).toEqual({ telefone: M.telefone, whatsapp: M.telefone });
  });
});

describe('Instagram (RN-8)', () => {
  it.each(['insta gram', '.perfil', 'perfil.', 'pe..rfil', 'a'.repeat(31), 'https://facebook.com/perfil', 'instagram.com/p/abc', 'instagram.com/', 'instagram.com:8080/x', 'user@instagram.com', '@@x', 'perfil!', 'x'.repeat(201)])(
    '%s → instagram',
    (v) => {
      expect(erros({ instagram: v })).toEqual({ instagram: M.instagram });
    },
  );

  it.each([
    ['@Meu.Salao', 'meu.salao'],
    ['https://www.instagram.com/meu.salao/?igsh=x', 'meu.salao'],
    ['instagram.com/meu_salao', 'meu_salao'],
    ['http://instagram.com/meu.salao#topo', 'meu.salao'],
    ['meusalao', 'meusalao'],
    ['a'.repeat(30), 'a'.repeat(30)],
  ])('%s → %s', (v, esperado) => {
    expect(ok({ instagram: v }).instagram).toBe(esperado);
    expect(normalizarInstagram(v)).toBe(esperado);
  });

  it('tipo errado → instagram', () => {
    expect(erros({ instagram: { a: 1 } })).toEqual({ instagram: M.instagram });
  });
});

describe('listas (RN-9, CA-15)', () => {
  it('fora da lista → lista e nada é gravado', () => {
    expect(erros({ meiosPagamento: ['cheque'] })).toEqual({ meiosPagamento: M.lista });
    expect(erros({ comodidades: ['sauna'] })).toEqual({ comodidades: M.lista });
  });

  it('repetições ignoradas; ordem da lista', () => {
    expect(ok({ meiosPagamento: ['pix', 'dinheiro', 'pix'] }).meiosPagamento).toEqual(['dinheiro', 'pix']);
    expect(ok({ comodidades: ['animais', 'wifi'] }).comodidades).toEqual(['wifi', 'animais']);
  });

  it('tipos errados e listas enormes → lista', () => {
    expect(erros({ meiosPagamento: 'pix', comodidades: [1] })).toEqual({ meiosPagamento: M.lista, comodidades: M.lista });
    expect(erros({ meiosPagamento: Array.from({ length: 500 }, () => 'pix') })).toEqual({ meiosPagamento: M.lista });
    expect(erros({ comodidades: null })).toEqual({ comodidades: M.lista });
  });

  it('filtrarChaves descarta desconhecidas', () => {
    expect(filtrarChaves(MEIOS_PAGAMENTO, ['cheque', 'pix', 'dinheiro'])).toEqual(['dinheiro', 'pix']);
    expect(filtrarChaves(COMODIDADES, [])).toEqual([]);
    expect(MEIOS_PAGAMENTO).toHaveLength(6);
    expect(COMODIDADES).toHaveLength(7);
  });
});

describe('forma da entrada e vários erros (RN-10, §6)', () => {
  it.each([null, undefined, 'x', 42, ['a']])('%s → formulario', (e) => {
    expect(erros(e)).toEqual({ formulario: M.formulario });
  });

  it('vários campos inválidos: todos os erros juntos', () => {
    expect(Object.keys(erros({ descricao: 'a'.repeat(1001), cep: '1', uf: 'XX', telefone: 'x', instagram: '..', meiosPagamento: ['cheque'] })).sort()).toEqual(
      ['bairro', 'cep', 'cidade', 'descricao', 'instagram', 'logradouro', 'meiosPagamento', 'numero', 'telefone', 'uf'],
    );
  });

  it('nunca lança com entradas estranhas', () => {
    const lixo = [Symbol('x'), () => 1, 10n, new Date(), { toString: () => 'x' }];
    for (const v of lixo) {
      for (const campo of ['descricao', 'logradouro', 'uf', 'cep', 'telefone', 'instagram', 'meiosPagamento']) {
        expect(() => validarPerfil({ [campo]: v })).not.toThrow();
      }
    }
  });
});

describe('perfilParaColunas e valoresDoPerfil', () => {
  it('ida e volta com exibição formatada', () => {
    const p = ok({ ...ENDERECO, telefone: '11987654321', whatsapp: '(11) 3456-7890', instagram: 'x', descricao: 'd', meiosPagamento: ['pix'], comodidades: ['wifi'] });
    const colunas = perfilParaColunas(p);
    expect(colunas).toEqual({
      descricao: 'd',
      enderecoLogradouro: 'Av. Paulista',
      enderecoNumero: '1000',
      enderecoComplemento: 'Sala 2',
      enderecoBairro: 'Bela Vista',
      enderecoCidade: 'São Paulo',
      enderecoUf: 'SP',
      enderecoCep: '01310100',
      telefoneE164: '+5511987654321',
      whatsappE164: '+551134567890',
      instagram: 'x',
      meiosPagamento: ['pix'],
      comodidades: ['wifi'],
    });
    expect(valoresDoPerfil(colunas)).toEqual({
      descricao: 'd',
      logradouro: 'Av. Paulista',
      numero: '1000',
      complemento: 'Sala 2',
      bairro: 'Bela Vista',
      cidade: 'São Paulo',
      uf: 'SP',
      cep: '01310-100',
      telefone: '(11) 98765-4321',
      whatsapp: '(11) 3456-7890',
      instagram: 'x',
      meiosPagamento: ['pix'],
      comodidades: ['wifi'],
    });
  });

  it('perfil vazio → colunas null; chave desconhecida e valores fora do formato não quebram a tela', () => {
    const vazio = perfilParaColunas(ok({}));
    expect(Object.values(vazio).filter((v) => v !== null && !Array.isArray(v))).toEqual([]);
    const v = valoresDoPerfil({ ...vazio, meiosPagamento: ['cheque', 'pix'], telefoneE164: '123', enderecoCep: '1' });
    expect(v.meiosPagamento).toEqual(['pix']);
    expect(v.telefone).toBe('123');
    expect(v.cep).toBe('1');
    expect(v.whatsapp).toBe('');
  });
});

describe('perfil-tipos.ts é client-safe', () => {
  it('sem imports de runtime', () => {
    const texto = readFileSync(fileURLToPath(new URL('./perfil-tipos.ts', import.meta.url)), 'utf8');
    expect(texto).not.toMatch(/^\s*import\s+(?!type\b)/m);
  });
});
