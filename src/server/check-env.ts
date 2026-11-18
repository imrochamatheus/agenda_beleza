import { type ErroDeAmbiente, validarEnv } from './env';

export interface SaidaCheckEnv {
  log(mensagem: string): void;
  error(mensagem: string): void;
}

/** Valida o ambiente e devolve o código de saída do processo. Nunca imprime valores. */
export function executarCheckEnv(
  fonte: Record<string, string | undefined>,
  saida: SaidaCheckEnv,
): 0 | 1 {
  try {
    validarEnv(fonte);
  } catch (erro) {
    // validarEnv só lança ErroDeAmbiente, cuja mensagem traz apenas nomes de variáveis.
    saida.error(`check-env: ${(erro as ErroDeAmbiente).message}`);
    return 1;
  }
  saida.log('check-env: ambiente válido');
  return 0;
}
