// Armazenamento real compatível com S3 (D-021 §3.1; RN-13). Só PutObject, GetObject e DeleteObject:
// nunca lista o bucket. Não validado contra provedor real (testes de contrato com cliente injetado
// e servidor S3 falso local).
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import type { ConfigS3 } from './ambiente';
import { ehChaveValida } from './chave';
import { ChaveInvalida, ErroDeArmazenamento, type PortaArmazenamento } from './port';

/** O que o adaptador usa do S3Client (injetável nos testes). */
export type ClienteS3 = { send(comando: unknown): Promise<unknown> };

const CACHE = 'public, max-age=31536000, immutable';

function status(e: unknown): number | undefined {
  return (e as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode;
}
const nome = (e: unknown) => (e as { name?: string } | null)?.name;
const naoExiste = (e: unknown) => nome(e) === 'NoSuchKey' || nome(e) === 'NotFound' || status(e) === 404;

export function criarArmazenamentoReal(config: ConfigS3, opcoes: { cliente?: ClienteS3 } = {}): PortaArmazenamento {
  const cliente: ClienteS3 =
    opcoes.cliente ??
    new S3Client({
      endpoint: config.endpoint,
      region: config.regiao,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      forcePathStyle: config.pathStyle,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });

  const validar = (chave: string) => {
    if (!ehChaveValida(chave)) throw new ChaveInvalida();
  };
  const falha = (acao: string, cause: unknown) =>
    new ErroDeArmazenamento(`Falha ao ${acao} no armazenamento S3${status(cause) ? ` (HTTP ${status(cause)})` : ''}.`, { cause });

  return {
    async gravar(chave, bytes, tipo) {
      validar(chave);
      try {
        await cliente.send(new PutObjectCommand({ Bucket: config.bucket, Key: chave, Body: bytes, ContentType: tipo, CacheControl: CACHE }));
      } catch (e) {
        throw falha('gravar', e);
      }
    },
    async ler(chave) {
      validar(chave);
      try {
        const r = (await cliente.send(new GetObjectCommand({ Bucket: config.bucket, Key: chave }))) as {
          Body?: { transformToByteArray(): Promise<Uint8Array> };
        };
        if (!r.Body) return null;
        return await r.Body.transformToByteArray();
      } catch (e) {
        if (naoExiste(e)) return null;
        throw falha('ler', e);
      }
    },
    async remover(chave) {
      validar(chave);
      try {
        await cliente.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: chave }));
      } catch (e) {
        if (naoExiste(e)) return;
        throw falha('remover', e);
      }
    },
    urlPublica(chave) {
      return config.urlPublica === null ? null : `${config.urlPublica}/${chave}`;
    },
  };
}
