// Ponto de entrada do check-env (docker/entrypoint.sh). A lógica fica em src/server/check-env.ts.
import { executarCheckEnv } from '@/server/check-env';

process.exitCode = executarCheckEnv(process.env, console);
