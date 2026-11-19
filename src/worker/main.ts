// Ponto de entrada do worker (dist/worker/main.js). A lógica fica em ./iniciar.
import { iniciarWorker } from './iniciar';

iniciarWorker({ env: process.env, log: console.log, erro: console.error, sinais: process, sair: (c) => process.exit(c) });
