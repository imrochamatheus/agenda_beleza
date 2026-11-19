import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { TIMEOUT_ENCERRAMENTO_MS } from '@/worker/iniciar';

// CA-14 (RN-4, RN-15): o stop_grace_period do serviço worker no compose é 30s e maior que o prazo de
// encerramento gracioso do worker (25 s): o Docker só manda SIGKILL depois que o worker teve tempo de
// concluir os jobs em andamento.

const compose = readFileSync(fileURLToPath(new URL('../../../docker-compose.yml', import.meta.url)), 'utf8');

/** Linhas do bloco de um serviço (indentação de 2 espaços em `services:`). */
function blocoDoServico(nome: string): string[] {
  const linhas = compose.split('\n');
  const inicio = linhas.findIndex((l) => l === `  ${nome}:`);
  if (inicio < 0) throw new Error(`serviço ${nome} não encontrado no docker-compose.yml`);
  const bloco: string[] = [];
  for (const linha of linhas.slice(inicio + 1)) {
    if (/^ {0,2}\S/.test(linha)) break;
    bloco.push(linha);
  }
  return bloco;
}

function segundos(valor: string): number {
  const m = /^(\d+)(ms|s|m)$/.exec(valor);
  if (!m) throw new Error(`duração não suportada: ${valor}`);
  const n = Number(m[1]);
  return m[2] === 'ms' ? n / 1000 : m[2] === 'm' ? n * 60 : n;
}

describe('compose: stop_grace_period do worker (CA-14)', () => {
  it('é 30s e maior que TIMEOUT_ENCERRAMENTO_MS (25 s)', () => {
    const linha = blocoDoServico('worker').find((l) => /^\s{4}stop_grace_period:/.test(l));
    expect(linha, 'stop_grace_period no serviço worker').toBeDefined();
    const valor = linha!.split(':')[1].trim();
    expect(valor).toBe('30s');
    expect(TIMEOUT_ENCERRAMENTO_MS).toBe(25_000);
    expect(segundos(valor) * 1000).toBeGreaterThan(TIMEOUT_ENCERRAMENTO_MS);
  });

  it('o worker roda com init (tini repassa o SIGTERM)', () => {
    expect(blocoDoServico('worker')).toContain('    init: true');
  });
});
