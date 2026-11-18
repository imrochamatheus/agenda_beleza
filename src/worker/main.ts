// Ponto de entrada do worker (dist/worker/main.js). A lógica fica em ./stub.
import { iniciarWorker } from './stub';

iniciarWorker({ env: process.env, log: console.log, erro: console.error, sinais: process, sair: (c) => process.exit(c) });
