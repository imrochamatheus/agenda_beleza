import { type ErroDeAmbiente, type ModosAtivos, modosAtivos, validarEnv } from './env';

export interface SaidaCheckEnv {
  log(mensagem: string): void;
  error(mensagem: string): void;
}

/** `armazenamento=simulado, email=simulado, mp=simulado, turnstile=simulado, whatsapp=simulado` (só modos, nunca valores). */
export function descreverModos(modos: ModosAtivos): string {
  return [
    `armazenamento=${modos.armazenamento}`,
    `email=${modos.email}`,
    `mp=${modos.mercadoPago}`,
    `turnstile=${modos.turnstile}`,
    `whatsapp=${modos.whatsapp}`,
  ].join(', ');
}

/**
 * Valida o ambiente e devolve o código de saída do processo. Em caso de sucesso, registra numa
 * única linha o modo ativo dos cinco adaptadores (RN-14). Nunca imprime valores.
 */
export function executarCheckEnv(
  fonte: Record<string, string | undefined>,
  saida: SaidaCheckEnv,
): 0 | 1 {
  let modos: ModosAtivos;
  try {
    modos = modosAtivos(validarEnv(fonte));
  } catch (erro) {
    // validarEnv só lança ErroDeAmbiente, cuja mensagem traz apenas nomes de variáveis.
    saida.error(`check-env: ${(erro as ErroDeAmbiente).message}`);
    return 1;
  }
  saida.log(`check-env: ambiente válido (adaptadores: ${descreverModos(modos)})`);
  return 0;
}
