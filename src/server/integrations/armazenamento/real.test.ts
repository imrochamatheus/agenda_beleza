import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';

import type { ConfigS3 } from './ambiente';
import { gerarChave } from './chave';
import { ChaveInvalida, ErroDeArmazenamento } from './port';
import { criarArmazenamentoReal } from './real';

// D-021 T-2 / CA-11: cliente injetado, sem rede.

const CONFIG: ConfigS3 = {
  endpoint: 'https://s3.exemplo.test',
  regiao: 'auto',
  bucket: 'meu-bucket',
  accessKeyId: 'AKIA-X',
  secretAccessKey: 'segredo-xyz',
  urlPublica: null,
  pathStyle: true,
};

function cliente(resposta: (c: unknown) => unknown) {
  const comandos: unknown[] = [];
  return {
    comandos,
    send: async (c: unknown) => {
      comandos.push(c);
      return resposta(c);
    },
  };
}
const erro = (name: string, http: number) => Object.assign(new Error(name), { name, $metadata: { httpStatusCode: http } });

describe('criarArmazenamentoReal com cliente injetado (CA-11)', () => {
  it('PutObject: bucket, chave, ContentType image/webp, sem ACL', async () => {
    const c = cliente(() => ({}));
    const chave = gerarChave();
    await criarArmazenamentoReal(CONFIG, { cliente: c }).gravar(chave, new Uint8Array([1]), 'image/webp');
    const cmd = c.comandos[0];
    expect(cmd).toBeInstanceOf(PutObjectCommand);
    const entrada = (cmd as PutObjectCommand).input;
    expect(entrada).toMatchObject({ Bucket: 'meu-bucket', Key: chave, ContentType: 'image/webp' });
    expect(entrada).not.toHaveProperty('ACL');
  });

  it('GetObject devolve os bytes; NoSuchKey e 404 viram null; outras falhas lançam sem credenciais', async () => {
    const chave = gerarChave();
    const ok = cliente(() => ({ Body: { transformToByteArray: async () => new Uint8Array([7, 8]) } }));
    expect([...(await criarArmazenamentoReal(CONFIG, { cliente: ok }).ler(chave))!]).toEqual([7, 8]);
    expect(ok.comandos[0]).toBeInstanceOf(GetObjectCommand);
    expect((ok.comandos[0] as GetObjectCommand).input).toEqual({ Bucket: 'meu-bucket', Key: chave });

    for (const e of [erro('NoSuchKey', 404), erro('Outro', 404), erro('NotFound', 404)]) {
      const c = cliente(() => {
        throw e;
      });
      expect(await criarArmazenamentoReal(CONFIG, { cliente: c }).ler(chave)).toBeNull();
    }
    expect(await criarArmazenamentoReal(CONFIG, { cliente: cliente(() => ({})) }).ler(chave)).toBeNull();

    const rede = cliente(() => {
      throw erro('TimeoutError', 503);
    });
    const falha = await criarArmazenamentoReal(CONFIG, { cliente: rede }).ler(chave).catch((e) => e);
    expect(falha).toBeInstanceOf(ErroDeArmazenamento);
    expect(String(falha.message)).not.toContain('segredo-xyz');
    expect(String(falha.message)).toContain('503');
  });

  it('DeleteObject: ausente (404) não é erro; falha de rede vira ErroDeArmazenamento', async () => {
    const chave = gerarChave();
    const c = cliente(() => ({}));
    await criarArmazenamentoReal(CONFIG, { cliente: c }).remover(chave);
    expect(c.comandos[0]).toBeInstanceOf(DeleteObjectCommand);
    const nada = cliente(() => {
      throw erro('NoSuchKey', 404);
    });
    await expect(criarArmazenamentoReal(CONFIG, { cliente: nada }).remover(chave)).resolves.toBeUndefined();
    const rede = cliente(() => {
      throw new Error('ECONNRESET');
    });
    await expect(criarArmazenamentoReal(CONFIG, { cliente: rede }).remover(chave)).rejects.toBeInstanceOf(ErroDeArmazenamento);
    await expect(criarArmazenamentoReal(CONFIG, { cliente: rede }).gravar(chave, new Uint8Array([1]), 'image/webp')).rejects.toBeInstanceOf(
      ErroDeArmazenamento,
    );
  });

  it('chave inválida lança ChaveInvalida sem chamar o cliente', async () => {
    const c = cliente(() => ({}));
    const porta = criarArmazenamentoReal(CONFIG, { cliente: c });
    await expect(porta.gravar('../x', new Uint8Array([1]), 'image/webp')).rejects.toBeInstanceOf(ChaveInvalida);
    await expect(porta.ler('x')).rejects.toBeInstanceOf(ChaveInvalida);
    await expect(porta.remover('x')).rejects.toBeInstanceOf(ChaveInvalida);
    expect(c.comandos).toHaveLength(0);
  });

  it('urlPublica: null sem S3_URL_PUBLICA; com ela, base + / + chave', () => {
    const chave = gerarChave();
    expect(criarArmazenamentoReal(CONFIG, { cliente: cliente(() => ({})) }).urlPublica(chave)).toBeNull();
    const p = criarArmazenamentoReal({ ...CONFIG, urlPublica: 'https://cdn.exemplo.test' }, { cliente: cliente(() => ({})) });
    expect(p.urlPublica(chave)).toBe(`https://cdn.exemplo.test/${chave}`);
  });

  it('constrói o S3Client real por padrão (sem chamar a rede)', () => {
    expect(criarArmazenamentoReal(CONFIG).urlPublica('fotos/x')).toBeNull();
  });
});
