import { hash, verify } from '@node-rs/argon2';

// Hash de senha (D-010 RN-23, D-4). Único arquivo do código que conhece o algoritmo: E1.1, E1.3,
// E1.4, E1.5 e o seed só usam este módulo. O algoritmo é o padrão do @node-rs/argon2 (argon2id);
// o `const enum Algorithm` não é importado (isolatedModules). A senha nunca é aparada nem normalizada.

/** Parâmetros OWASP mínimos (D-4): 19 MiB, 2 iterações, paralelismo 1. */
export const PARAMETROS_ARGON2 = Object.freeze({ memoryCost: 19456, timeCost: 2, parallelism: 1 });

/**
 * Hash PHC fixo de um valor aleatório descartado, com os MESMOS parâmetros (R-3). Verificado quando o
 * e-mail não existe, para que o custo da tentativa não revele a existência da conta (RN-8).
 */
export const HASH_FICTICIO =
  '$argon2id$v=19$m=19456,t=2,p=1$0UZKoF5rD3i9TXhM/EtCSA$CrNmgKqvXabUq0hMcIgCiWC2YtFAM8ChyZi7QzZBC5U';

export type VerificadorSenha = (hash: string, senha: string) => Promise<boolean>;

/** Hash argon2id no formato PHC (`$argon2id$v=19$m=19456,t=2,p=1$…`), com sal aleatório. */
export async function gerarHashSenha(senha: string): Promise<string> {
  return hash(senha, PARAMETROS_ARGON2);
}

/** Verdadeiro só se a senha confere. Hash malformado ou vazio → false, nunca lança (RN-8, R-2). */
export async function verificarSenha(hashSalvo: string, senha: string): Promise<boolean> {
  try {
    return await verify(hashSalvo, senha);
  } catch {
    return false;
  }
}
