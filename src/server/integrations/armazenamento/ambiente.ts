// Exigências de ambiente do armazenamento (D-021 §3.1; RN-19). Sem imports: este módulo entra no
// bundle do check-env.

export const SELETOR = 'STORAGE_ADAPTER';

/** Variáveis do armazenamento, declaradas no .env.example. S3_* só no modo real; ARMAZENAMENTO_DIR só no simulado. */
export const CHAVES = [
  'ARMAZENAMENTO_DIR',
  'S3_ENDPOINT',
  'S3_REGIAO',
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_URL_PUBLICA',
  'S3_FORCE_PATH_STYLE',
] as const;

export const DIRETORIO_PADRAO = '.armazenamento';

export type ConfigS3 = {
  endpoint: string;
  regiao: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  urlPublica: string | null;
  pathStyle: boolean;
};

const OBRIGATORIAS = ['S3_ENDPOINT', 'S3_REGIAO', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const;

function analisarUrl(v: string): URL | null {
  try {
    return new URL(v);
  } catch {
    return null;
  }
}

/** `fonte` já vem com string vazia convertida em ausente. Nunca devolve valores nos erros. */
export function lerConfigReal(
  fonte: Record<string, string | undefined>,
): { ok: true; config: ConfigS3 } | { ok: false; variaveis: string[] } {
  const ruins = new Set<string>(OBRIGATORIAS.filter((c) => fonte[c] === undefined || fonte[c]!.trim() === ''));

  const endpoint = fonte.S3_ENDPOINT === undefined ? null : analisarUrl(fonte.S3_ENDPOINT);
  if (fonte.S3_ENDPOINT !== undefined && (endpoint === null || (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:'))) {
    ruins.add('S3_ENDPOINT');
  }

  let urlPublica: string | null = null;
  if (fonte.S3_URL_PUBLICA !== undefined) {
    const u = analisarUrl(fonte.S3_URL_PUBLICA);
    const local = u !== null && u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
    if (u === null || (u.protocol !== 'https:' && !local)) {
      ruins.add('S3_URL_PUBLICA');
    } else {
      urlPublica = fonte.S3_URL_PUBLICA.replace(/\/+$/u, '');
    }
  }

  const estilo = fonte.S3_FORCE_PATH_STYLE;
  if (estilo !== undefined && estilo !== 'true' && estilo !== 'false') {
    ruins.add('S3_FORCE_PATH_STYLE');
  }

  if (ruins.size > 0) return { ok: false, variaveis: [...ruins].sort() };
  return {
    ok: true,
    config: {
      endpoint: fonte.S3_ENDPOINT!,
      regiao: fonte.S3_REGIAO!,
      bucket: fonte.S3_BUCKET!,
      accessKeyId: fonte.S3_ACCESS_KEY_ID!,
      secretAccessKey: fonte.S3_SECRET_ACCESS_KEY!,
      urlPublica,
      pathStyle: estilo !== 'false',
    },
  };
}
