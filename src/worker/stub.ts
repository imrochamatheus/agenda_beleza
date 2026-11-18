import { ErroDeAmbiente, validarEnv } from '@/server/env';

/** Stub do worker até a E0.7 (pg-boss). Não acessa o banco. */
export const INTERVALO_HEARTBEAT_MS = 30_000;

export interface DependenciasWorker {
  env: Record<string, string | undefined>;
  /** Uma linha JSON por evento. */
  log: (linha: string) => void;
  erro: (linha: string) => void;
  sinais: { once(evento: 'SIGTERM' | 'SIGINT', fn: () => void): unknown };
  sair: (codigo: number) => void;
  intervaloMs?: number;
}

export function iniciarWorker(deps: DependenciasWorker): { parar(): void } {
  try {
    validarEnv(deps.env);
  } catch (falha) {
    const variaveis = falha instanceof ErroDeAmbiente ? falha.variaveis : [];
    deps.erro(JSON.stringify({ evento: 'worker.ambiente_invalido', variaveis }));
    deps.sair(1);
    return { parar() {} };
  }

  const heartbeat = () =>
    deps.log(JSON.stringify({ evento: 'worker.heartbeat', em: new Date().toISOString() }));
  heartbeat();
  const intervalo = setInterval(heartbeat, deps.intervaloMs ?? INTERVALO_HEARTBEAT_MS);

  let parado = false;
  const parar = () => {
    parado = true;
    clearInterval(intervalo);
  };
  const aoReceber = (sinal: 'SIGTERM' | 'SIGINT') => () => {
    if (parado) return;
    parar();
    deps.log(JSON.stringify({ evento: 'worker.encerrando', sinal }));
    deps.sair(0);
  };
  deps.sinais.once('SIGTERM', aoReceber('SIGTERM'));
  deps.sinais.once('SIGINT', aoReceber('SIGINT'));

  return { parar };
}
