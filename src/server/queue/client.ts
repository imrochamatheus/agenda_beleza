import { PgBoss } from 'pg-boss';

import { type Env, validarEnv } from '@/server/env';

import { opcoesPgBoss, politicaDeRetry } from './config';
import { descreverErroSeguro, ErroFilaIndisponivel, ErroPayloadInvalido } from './erros';
import { CONTRATOS, type NomeFila, type PayloadDe, validarPayload } from './filas';

// Cliente de fila da app (D-008 §3.5, RN-11, RN-12).
// - Sem efeito no import: não lê o ambiente nem conecta (CA-15). A conexão é preguiçosa, no 1º uso.
// - Conexão própria (pool de 2), modo sem migração: só o worker instala o schema `pgboss` (D-6).
// - Use SOMENTE depois do commit da transação de negócio: o cliente não aceita transação nem cliente
//   Prisma, então não participa dela. Se falhar, a reserva já está salva e a reconciliação reenfileira.

export type ResultadoEnfileirar = { criado: true; id: string } | { criado: false; motivo: 'chave_em_uso' };
/** `chave` vira a `singletonKey` do pg-boss (filas `exclusive`: no máximo um job ativo por chave). */
export type OpcoesEnfileirar = { chave?: string };

export interface ClienteFila {
  /**
   * Use SOMENTE depois do commit da transação de negócio: o cliente tem conexão própria e não
   * participa de transação (RN-11). Valida o payload antes de qualquer I/O. Não tenta de novo:
   * falha de infraestrutura vira ErroFilaIndisponivel (RN-12).
   */
  enfileirar<F extends NomeFila>(
    fila: F,
    payload: PayloadDe<F>,
    opcoes?: OpcoesEnfileirar,
  ): Promise<ResultadoEnfileirar>;
  /** Fecha o pool (idempotente). */
  encerrar(): Promise<void>;
}

/** Construtor do pg-boss (injetável só nos testes unitários sem I/O). */
export type CriarPgBoss = (opcoes: ConstructorParameters<typeof PgBoss>[0]) => PgBoss;

const criarPadrao: CriarPgBoss = (opcoes) => new PgBoss(opcoes);

/** Não lê o ambiente nem conecta: o 1º enfileirar valida `fonte` (padrão process.env) e inicia o pg-boss. */
export function criarClienteFila(
  fonte: Record<string, string | undefined> = process.env,
  criar: CriarPgBoss = criarPadrao,
): ClienteFila {
  let env: Env | null = null;
  let iniciando: Promise<PgBoss> | null = null;

  const ambiente = (): Env => (env ??= validarEnv(fonte));

  const obterBoss = (fila: string): Promise<PgBoss> => {
    if (iniciando) return iniciando;
    const { DATABASE_URL } = ambiente();
    const boss = criar(opcoesPgBoss(DATABASE_URL, 'app'));
    // R-11: sem ouvinte, um `error` do pg-boss derrubaria o processo (inclusive o Next).
    const registrar = (evento: string) => (e: unknown) =>
      console.error(JSON.stringify({ evento, em: new Date().toISOString(), ...descreverErroSeguro(e, DATABASE_URL) }));
    boss.on('error', registrar('fila.erro'));
    const tentativa = boss.start().catch(async (falha: unknown) => {
      // A próxima chamada tenta de novo; o pool desta tentativa é fechado sem propagar erro.
      iniciando = null;
      await boss.stop({ graceful: false, close: true }).catch(() => undefined);
      throw new ErroFilaIndisponivel(fila, falha);
    });
    iniciando = tentativa;
    return tentativa;
  };

  return {
    async enfileirar(fila, payload, opcoes = {}) {
      // 1. Nenhum I/O antes de validar o payload e a chave (CA-10).
      const dados = validarPayload(fila, payload);
      if (CONTRATOS[fila].chave === 'obrigatoria' && !opcoes.chave) {
        throw new ErroPayloadInvalido(fila, ['(chave)']);
      }
      // 2. Um ErroDeAmbiente sobe sem embrulho: é falha de configuração, não da fila.
      const politica = politicaDeRetry(ambiente());
      const boss = await obterBoss(fila);
      let id: string | null;
      try {
        id = await boss.send(fila, dados, { ...politica, singletonKey: opcoes.chave });
      } catch (falha) {
        throw new ErroFilaIndisponivel(fila, falha);
      }
      return id === null ? { criado: false, motivo: 'chave_em_uso' } : { criado: true, id };
    },

    async encerrar() {
      const atual = iniciando;
      iniciando = null;
      if (!atual) return;
      const boss = await atual.catch(() => null);
      await boss?.stop({ graceful: false, close: true });
    },
  };
}

let padrao: ClienteFila | null = null;

/** Atalho da instância padrão do processo (criada no 1º uso, sobre process.env). Só depois do commit. */
export function enfileirar<F extends NomeFila>(
  fila: F,
  payload: PayloadDe<F>,
  opcoes?: OpcoesEnfileirar,
): Promise<ResultadoEnfileirar> {
  padrao ??= criarClienteFila();
  return padrao.enfileirar(fila, payload, opcoes);
}

/** Fecha a instância padrão do processo, se existir (idempotente). */
export async function encerrarFila(): Promise<void> {
  const atual = padrao;
  padrao = null;
  await atual?.encerrar();
}
