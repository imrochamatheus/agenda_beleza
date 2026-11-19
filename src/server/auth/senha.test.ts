import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { HASH_FICTICIO, PARAMETROS_ARGON2, gerarHashSenha, verificarSenha } from './senha';

// CA-13 (RN-8, RN-23): hash argon2id com os parâmetros do desenho e verificação que nunca lança.
const PREFIXO = '$argon2id$v=19$m=19456,t=2,p=1$';

describe('CA-13: senha.ts', () => {
  it('CA-13: gera PHC argon2id com m=19456,t=2,p=1 e sal aleatório (dois hashes diferem)', async () => {
    expect(PARAMETROS_ARGON2).toEqual({ memoryCost: 19456, timeCost: 2, parallelism: 1 });
    expect(Object.isFrozen(PARAMETROS_ARGON2)).toBe(true);
    const a = await gerarHashSenha('segredo');
    const b = await gerarHashSenha('segredo');
    expect(a.startsWith(PREFIXO)).toBe(true);
    expect(b.startsWith(PREFIXO)).toBe(true);
    expect(a).not.toBe(b);
    expect(a).not.toContain('segredo');
  });

  it('CA-13: senha certa → true; errada → false; não apara a senha', async () => {
    const h = await gerarHashSenha('senha');
    expect(await verificarSenha(h, 'senha')).toBe(true);
    expect(await verificarSenha(h, 'Senha')).toBe(false);
    expect(await verificarSenha(h, ' senha')).toBe(false);
    expect(await verificarSenha(h, '')).toBe(false);
  });

  it('CA-13: hash malformado ou vazio → false, sem exceção (R-2)', async () => {
    await expect(verificarSenha('hash-de-teste-sem-uso', 'qualquer')).resolves.toBe(false);
    await expect(verificarSenha('', 'qualquer')).resolves.toBe(false);
    await expect(verificarSenha('$argon2id$v=19$m=19456,t=2,p=1$quebrado', 'x')).resolves.toBe(false);
  });

  it('CA-13: senha com acentos e emoji verifica de forma estável', async () => {
    const senha = 'señha çãé 🙂 ✂️';
    const h = await gerarHashSenha(senha);
    for (let i = 0; i < 3; i++) {
      expect(await verificarSenha(h, senha)).toBe(true);
    }
    expect(await verificarSenha(h, senha.normalize('NFD'))).toBe(false);
  });

  it('R-3: HASH_FICTICIO tem os mesmos parâmetros e não verifica as senhas dos testes', async () => {
    expect(HASH_FICTICIO.startsWith(PREFIXO)).toBe(true);
    for (const senha of ['Senha de teste 123', '', 'senha', 'hash-de-teste-sem-uso']) {
      expect(await verificarSenha(HASH_FICTICIO, senha)).toBe(false);
    }
  });

  it('RN-23: só senha.ts importa @node-rs/argon2 e não usa o const enum Algorithm', () => {
    const fonte = readFileSync(fileURLToPath(new URL('./senha.ts', import.meta.url)), 'utf8');
    expect(fonte).toMatch(/from '@node-rs\/argon2'/);
    expect(fonte).not.toMatch(/import[^;]*\bAlgorithm\b/);
    expect(fonte).not.toMatch(/algorithm\s*:/);
    const src = fileURLToPath(new URL('../../', import.meta.url));
    const importadores = (readdirSync(src, { recursive: true }) as string[])
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.startsWith('generated'))
      .filter((f) => readFileSync(join(src, f), 'utf8').includes('@node-rs/argon2'));
    expect(importadores.map((f) => f.split('\\').join('/'))).toEqual(['server/auth/senha.ts']);
  });
});
