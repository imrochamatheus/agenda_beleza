import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { AVISO_PROVISORIO, DOCUMENTOS } from './termos-documentos';
import { FINALIDADES, TEXTOS_CONSENTIMENTO, VERSAO_TERMOS, VIGENCIA_TERMOS } from './termos';

/**
 * Guarda por versão (D-023 A-6, CA-17). Para mudar QUALQUER texto de src/config/termos.ts ou
 * termos-documentos.ts: 1) altere VERSAO_TERMOS; 2) rode este teste, copie o hash calculado da
 * mensagem de falha e acrescente uma nova entrada abaixo. Não altere a entrada de versões antigas.
 */
const HASHES_POR_VERSAO: Record<string, string> = {
  '2026-11-21-provisorio': 'cc355434d3fdeaf007111c69e513cb766c7d45d4bf5b04f13394e20cbce97a0a',
};

function canonico(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonico);
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, canonico((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}

function hashDosTextos(): string {
  const json = JSON.stringify(canonico({ TEXTOS_CONSENTIMENTO, DOCUMENTOS, AVISO_PROVISORIO }));
  return createHash('sha256').update(json).digest('hex');
}

describe('versão dos termos (CA-17)', () => {
  it('VERSAO_TERMOS segue o formato e VIGENCIA_TERMOS é uma data de calendário', () => {
    expect(VERSAO_TERMOS).toMatch(/^[a-z0-9._-]{1,40}$/);
    expect(VIGENCIA_TERMOS).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('o mapa de hashes tem a versão vigente, chaves válidas e hashes SHA-256 hex', () => {
    expect(Object.keys(HASHES_POR_VERSAO)).toContain(VERSAO_TERMOS);
    for (const [versao, hash] of Object.entries(HASHES_POR_VERSAO)) {
      expect(versao).toMatch(/^[a-z0-9._-]{1,40}$/);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('o hash dos textos bate com o registrado para a versão vigente', () => {
    expect(
      hashDosTextos(),
      `Os textos mudaram sem nova versão. Mude VERSAO_TERMOS e registre o hash ${hashDosTextos()} em HASHES_POR_VERSAO.`,
    ).toBe(HASHES_POR_VERSAO[VERSAO_TERMOS]);
  });

  it('o hash muda quando um texto muda (sanidade do canônico)', () => {
    const antes = hashDosTextos();
    const original = TEXTOS_CONSENTIMENTO.mensagens_reserva;
    (TEXTOS_CONSENTIMENTO as Record<string, unknown>).mensagens_reserva = [...original, ' x'];
    try {
      expect(hashDosTextos()).not.toBe(antes);
    } finally {
      (TEXTOS_CONSENTIMENTO as Record<string, unknown>).mensagens_reserva = original;
    }
    expect(hashDosTextos()).toBe(antes);
  });
});

describe('textos das finalidades', () => {
  it('há um texto não vazio por finalidade', () => {
    expect(Object.keys(TEXTOS_CONSENTIMENTO).sort()).toEqual([...FINALIDADES].sort());
    for (const f of FINALIDADES) expect(TEXTOS_CONSENTIMENTO[f].length).toBeGreaterThan(0);
  });

  it('mensagens_reserva cita Termos, Privacidade e as mensagens da reserva (RN-2)', () => {
    const partes = TEXTOS_CONSENTIMENTO.mensagens_reserva;
    const links = partes.filter((p) => typeof p !== 'string').map((p) => (p as { link: string }).link);
    expect(links).toEqual(['termos', 'privacidade']);
    const texto = partes.map((p) => (typeof p === 'string' ? p : p.texto)).join('');
    for (const termo of ['WhatsApp', 'confirmação', 'remarcação', 'cancelamento']) expect(texto).toContain(termo);
  });
});

describe('CA-4: nenhuma cópia literal da versão fora do config', () => {
  const RAIZ = fileURLToPath(new URL('../', import.meta.url));
  function listar(pasta: string): string[] {
    return readdirSync(pasta, { withFileTypes: true }).flatMap((e) => {
      const caminho = join(pasta, e.name);
      if (e.isDirectory()) return e.name === 'generated' ? [] : listar(caminho);
      return /\.(ts|tsx|css)$/.test(e.name) ? [caminho] : [];
    });
  }

  it('só src/config/termos.ts e os testes contêm o literal', () => {
    const com = listar(RAIZ)
      .map((c) => relative(RAIZ, c).split(sep).join('/'))
      .filter((r) => !/\.test\.(ts|tsx)$/.test(r))
      .filter((r) => readFileSync(join(RAIZ, r), 'utf8').includes(VERSAO_TERMOS));
    expect(com).toEqual(['config/termos.ts']);
  });
});
