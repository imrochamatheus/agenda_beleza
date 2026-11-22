import { describe, expect, it } from 'vitest';

import { CHAVES_MENSAGEM_ADMIN, codigoDoReenvio, lerCodigoDeReenvio, MENSAGENS_REENVIO, CODIGOS_REENVIO } from './mensagens-tipos';
import { destinatarioMascarado, paraDTO } from './mensagens';

const base = {
  id: 'i',
  salaoId: 's',
  salaoNome: 'Studio',
  tipo: 'confirmacao',
  revisao: 0,
  estado: 'falhou',
  erroCodigo: 'resultado_incerto',
  destinatarioE164: '+5571987651234',
  clienteAnonimizada: false,
  criadaEm: new Date('2026-11-21T12:00:00Z'),
  atualizadaEm: new Date('2026-11-21T12:05:00Z'),
  enviadaEm: null,
};

describe('DTO da fila (D-045 RN-2, RN-9, CA-5, CA-8)', () => {
  it('máscara aplicada; o DTO não tem E.164, nem chaves proibidas, e tem exatamente as chaves declaradas', () => {
    const dto = paraDTO(base);
    expect(dto.paraMascarado).toBe('+55 (71) 9****-1234');
    expect(Object.keys(dto).sort()).toEqual([...CHAVES_MENSAGEM_ADMIN].sort());
    const json = JSON.stringify(dto);
    expect(json).not.toContain('5571987651234');
    expect(json).not.toContain('987651234');
    for (const proibida of ['parametros', 'provedor', 'erro_detalhe', 'erroDetalhe', 'chave', 'destinatario', 'clienteNome', 'nome_cliente', 'link']) {
      expect(Object.keys(dto).filter((k) => k.toLowerCase().includes(proibida.toLowerCase()))).toEqual([]);
    }
  });

  it('cliente anonimizada: "Cliente removida" e nenhum dígito, mesmo que o E.164 venha', () => {
    expect(destinatarioMascarado({ clienteAnonimizada: true, destinatarioE164: '+5571987651234' })).toBe('Cliente removida');
    expect(paraDTO({ ...base, clienteAnonimizada: true }).paraMascarado).not.toMatch(/\d/);
  });

  it('destinatário nulo ou inválido → "—"', () => {
    expect(destinatarioMascarado({ clienteAnonimizada: false, destinatarioE164: null })).toBe('—');
    expect(destinatarioMascarado({ clienteAnonimizada: false, destinatarioE164: 'lixo' })).toBe('—');
  });

  it('erro_codigo fora do formato fechado não aparece', () => {
    expect(paraDTO({ ...base, erroCodigo: 'Falha para +5571987651234' }).erroCodigo).toBeNull();
    expect(paraDTO(base).erroCodigo).toBe('resultado_incerto');
  });
});

describe('códigos do PRG do reenvio (D-045 CA-14)', () => {
  it('resultado → código fechado, e cada código tem texto', () => {
    expect(codigoDoReenvio({ resultado: 'reenfileirada', mensagemId: 'x', filaIndisponivel: false })).toBe('ok');
    expect(codigoDoReenvio({ resultado: 'reenfileirada', mensagemId: 'x', filaIndisponivel: true })).toBe('ok_fila');
    expect(codigoDoReenvio({ resultado: 'recusada', motivo: 'nao_falhou' })).toBe('recusada');
    expect(codigoDoReenvio({ resultado: 'recusada', motivo: 'obsoleta' })).toBe('obsoleta');
    expect(codigoDoReenvio({ resultado: 'recusada', motivo: 'cliente_anonimizada' })).toBe('anonimizada');
    for (const c of CODIGOS_REENVIO) expect(MENSAGENS_REENVIO[c].texto.length).toBeGreaterThan(10);
  });

  it('código fora da lista → null', () => {
    expect(lerCodigoDeReenvio('ok')).toBe('ok');
    expect(lerCodigoDeReenvio('<script>')).toBeNull();
    expect(lerCodigoDeReenvio('toString')).toBeNull();
    expect(lerCodigoDeReenvio(undefined)).toBeNull();
  });
});
