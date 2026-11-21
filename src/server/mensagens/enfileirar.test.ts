import { describe, expect, it, vi } from 'vitest';

import { ErroFilaIndisponivel } from '@/server/queue/erros';

import { enfileirarMensagens } from './enfileirar';
import type { ResultadoRegistro } from './tipos';

const reg = (o: Partial<ResultadoRegistro> = {}): ResultadoRegistro => ({
  criada: true, mensagemId: '6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4', tipo: 'confirmacao', revisao: 0, estado: 'pendente',
  chave: 'r:confirmacao:0', precisaEnfileirar: true, ...o,
});

describe('enfileirarMensagens (RN-3; CA-8)', () => {
  it('enfileira só as que precisam, com payload {mensagemId} e a chave', async () => {
    const enfileirar = vi.fn(async () => ({ criado: true as const, id: 'j' }));
    await enfileirarMensagens(
      [reg(), reg({ mensagemId: '11111111-1111-4111-8111-111111111111', precisaEnfileirar: false, estado: 'nao_enviada' }), reg({ criada: false, precisaEnfileirar: false })],
      { enfileirar },
    );
    expect(enfileirar).toHaveBeenCalledTimes(1);
    expect(enfileirar).toHaveBeenCalledWith('whatsapp-reserva', { mensagemId: '6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4' }, { chave: 'r:confirmacao:0' });
  });

  it('lista vazia não faz nada', async () => {
    const enfileirar = vi.fn();
    await enfileirarMensagens([], { enfileirar });
    expect(enfileirar).not.toHaveBeenCalled();
  });

  it('fila indisponível nunca lança: registra só IDs e segue para a próxima', async () => {
    const linhas: string[] = [];
    const enfileirar = vi
      .fn()
      .mockRejectedValueOnce(new ErroFilaIndisponivel('whatsapp-reserva', new Error('postgres://u:senha@host/db')))
      .mockResolvedValueOnce({ criado: true, id: 'j' });
    await expect(
      enfileirarMensagens([reg(), reg({ mensagemId: '22222222-2222-4222-8222-222222222222', revisao: 1 })], { enfileirar, log: (l) => linhas.push(l) }),
    ).resolves.toBeUndefined();
    expect(enfileirar).toHaveBeenCalledTimes(2);
    expect(linhas).toHaveLength(1);
    expect(JSON.parse(linhas[0])).toMatchObject({ evento: 'mensagem.fila_indisponivel', mensagemId: '6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4', tipo: 'confirmacao', revisao: 0 });
    expect(linhas[0]).not.toContain('senha');
  });

  it('erro que não é da fila também não lança', async () => {
    const linhas: string[] = [];
    await enfileirarMensagens([reg()], { enfileirar: vi.fn().mockRejectedValue(new Error('qualquer')), log: (l) => linhas.push(l) });
    expect(linhas).toHaveLength(1);
  });

  it('chave em uso não é erro nem gera log', async () => {
    const linhas: string[] = [];
    await enfileirarMensagens([reg()], { enfileirar: vi.fn().mockResolvedValue({ criado: false, motivo: 'chave_em_uso' }), log: (l) => linhas.push(l) });
    expect(linhas).toEqual([]);
  });

  it('o log padrão usa console.error', async () => {
    const espiao = vi.spyOn(console, 'error').mockImplementation(() => {});
    await enfileirarMensagens([reg()], { enfileirar: vi.fn().mockRejectedValue(new Error('x')) });
    expect(espiao).toHaveBeenCalledOnce();
    espiao.mockRestore();
  });
});
