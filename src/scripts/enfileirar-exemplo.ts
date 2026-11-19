// Ponto de entrada do script manual (dist/scripts/enfileirar-exemplo.js). A lógica fica em
// src/server/queue/enfileirar-exemplo.ts.
import { executarEnfileirarExemplo } from '@/server/queue/enfileirar-exemplo';

process.exitCode = await executarEnfileirarExemplo(process.argv.slice(2), process.env, console);
