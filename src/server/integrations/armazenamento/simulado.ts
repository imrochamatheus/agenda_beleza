// Armazenamento simulado em disco (D-021 §3.1; RN-13). Valida a chave ANTES de qualquer acesso a disco.
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

import { ehChaveValida } from './chave';
import { ChaveInvalida, ErroDeArmazenamento, type PortaArmazenamento } from './port';

function caminhoDe(raiz: string, chave: string): string {
  if (!ehChaveValida(chave)) throw new ChaveInvalida();
  const base = resolve(raiz);
  const alvo = resolve(join(base, chave));
  if (!alvo.startsWith(base + sep)) throw new ChaveInvalida();
  return alvo;
}

const ausente = (e: unknown) => (e as NodeJS.ErrnoException | null)?.code === 'ENOENT';

export function criarArmazenamentoSimulado({ diretorio }: { diretorio: string }): PortaArmazenamento {
  return {
    async gravar(chave, bytes) {
      const alvo = caminhoDe(diretorio, chave);
      const temporario = `${alvo}.tmp-${randomBytes(6).toString('hex')}`;
      try {
        await mkdir(dirname(alvo), { recursive: true });
        await writeFile(temporario, bytes);
        await rename(temporario, alvo);
      } catch (e) {
        await rm(temporario, { force: true }).catch(() => undefined);
        throw new ErroDeArmazenamento('Falha ao gravar no armazenamento simulado.', { cause: e });
      }
    },
    async ler(chave) {
      const alvo = caminhoDe(diretorio, chave);
      try {
        return new Uint8Array(await readFile(alvo));
      } catch (e) {
        if (ausente(e)) return null;
        throw new ErroDeArmazenamento('Falha ao ler do armazenamento simulado.', { cause: e });
      }
    },
    async remover(chave) {
      const alvo = caminhoDe(diretorio, chave);
      try {
        await rm(alvo, { force: true });
      } catch (e) {
        throw new ErroDeArmazenamento('Falha ao remover do armazenamento simulado.', { cause: e });
      }
    },
    urlPublica() {
      return null;
    },
  };
}
