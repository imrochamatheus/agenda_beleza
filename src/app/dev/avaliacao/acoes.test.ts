import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ESTADO_INICIAL_AVALIACAO } from '@/app/(publico)/[slug]/avaliar/[token]/estado';
import { MENSAGENS_AVALIACAO } from '@/server/avaliacoes/tipos';

import { demonstrarAvaliacaoAcao } from './acoes';

afterEach(() => {
  vi.unstubAllEnvs();
});

function fd(campos: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
}

describe('demonstrarAvaliacaoAcao (CA-16)', () => {
  it('desligada, devolve o estado anterior sem processar', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', 'false');
    expect(await demonstrarAvaliacaoAcao(ESTADO_INICIAL_AVALIACAO, fd({ nota: '5' }))).toBe(ESTADO_INICIAL_AVALIACAO);
  });

  it('ligada: valida só os campos e nada é gravado', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    const ruim = await demonstrarAvaliacaoAcao(ESTADO_INICIAL_AVALIACAO, fd({ nota: '7', comentario: 'x' }));
    expect(ruim).toMatchObject({ status: 'editando', erros: { nota: MENSAGENS_AVALIACAO.nota, aceite: MENSAGENS_AVALIACAO.aceite }, valores: { nota: '7', comentario: 'x', aceite: false } });
    const boa = await demonstrarAvaliacaoAcao(ESTADO_INICIAL_AVALIACAO, fd({ nota: '5', aceite_publicacao: 'on' }));
    expect(boa.status).toBe('enviada');
    expect(boa.mensagem).toContain('nada foi gravado');
    expect(readFileSync(new URL('./acoes.ts', import.meta.url), 'utf8')).not.toMatch(/server\/repos/);
  });
});
