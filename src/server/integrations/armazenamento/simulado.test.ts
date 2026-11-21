import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { gerarChave } from './chave';
import { rodarContratoDaPorta } from './contrato';
import { ChaveInvalida, ErroDeArmazenamento } from './port';
import { criarArmazenamentoSimulado } from './simulado';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'arm-sim-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('armazenamento simulado: contrato da porta (CA-11)', () => {
  rodarContratoDaPorta(() => criarArmazenamentoSimulado({ diretorio: dir }));
});

describe('armazenamento simulado (RN-13, CA-9)', () => {
  it('chave inválida não toca o disco (nem cria o diretório)', async () => {
    const alvo = join(dir, 'nao-criar');
    const porta = criarArmazenamentoSimulado({ diretorio: alvo });
    await expect(porta.gravar('../x.webp', new Uint8Array([1]), 'image/webp')).rejects.toBeInstanceOf(ChaveInvalida);
    expect(existsSync(alvo)).toBe(false);
  });

  it('gravação atômica: não sobra temporário e o objeto está completo', async () => {
    const porta = criarArmazenamentoSimulado({ diretorio: dir });
    const chave = gerarChave();
    await porta.gravar(chave, new Uint8Array([1, 2, 3]), 'image/webp');
    expect(readdirSync(join(dir, 'fotos'))).toEqual([chave.slice('fotos/'.length)]);
  });

  it('urlPublica é null (usa a rota da app)', () => {
    expect(criarArmazenamentoSimulado({ diretorio: dir }).urlPublica(gerarChave())).toBeNull();
  });

  it('falha de E/S vira ErroDeArmazenamento e limpa o temporário', async () => {
    // "fotos" é um arquivo: mkdir recursivo falha.
    writeFileSync(join(dir, 'fotos'), 'x');
    const porta = criarArmazenamentoSimulado({ diretorio: dir });
    await expect(porta.gravar(gerarChave(), new Uint8Array([1]), 'image/webp')).rejects.toBeInstanceOf(ErroDeArmazenamento);
  });

  it('ler/remover com erro que não é ENOENT vira ErroDeArmazenamento', async () => {
    // a chave aponta para um diretório (EISDIR na leitura; EISDIR/EPERM na remoção sem recursive)
    const chave = gerarChave();
    mkdirSync(join(dir, chave), { recursive: true });
    const porta = criarArmazenamentoSimulado({ diretorio: dir });
    await expect(porta.ler(chave)).rejects.toBeInstanceOf(ErroDeArmazenamento);
    await expect(porta.remover(chave)).rejects.toBeInstanceOf(ErroDeArmazenamento);
  });
});
