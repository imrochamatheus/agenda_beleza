// Porta de armazenamento de objetos (D-021 §3.1; RN-13). Não importa provedor, Prisma nem process.env.

export type TipoObjeto = 'image/webp';

export interface PortaArmazenamento {
  gravar(chave: string, bytes: Uint8Array, tipo: TipoObjeto): Promise<void>;
  /** null = objeto inexistente (NoSuchKey / ENOENT). Outras falhas lançam. */
  ler(chave: string): Promise<Uint8Array | null>;
  /** Remover o que não existe não é erro. */
  remover(chave: string): Promise<void>;
  /** URL pública do bucket/CDN, ou null (usa-se a rota da app). */
  urlPublica(chave: string): string | null;
}

/** Falha tratável pelo serviço (rede, disco, 5xx). Sem credenciais na mensagem. */
export class ErroDeArmazenamento extends Error {
  constructor(mensagem: string, opcoes?: { cause?: unknown }) {
    super(mensagem, opcoes);
    this.name = 'ErroDeArmazenamento';
  }
}

/** Chave fora do formato (bug de chamada). */
export class ChaveInvalida extends Error {
  constructor() {
    super('Chave de armazenamento fora do formato.');
    this.name = 'ChaveInvalida';
  }
}
