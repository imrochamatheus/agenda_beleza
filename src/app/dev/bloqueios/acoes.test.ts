import { afterEach, describe, expect, it, vi } from 'vitest';

import { estadoInicial, VALORES_VAZIOS } from '@/app/painel/bloqueios/estado';
import { MENSAGENS_BLOQUEIO } from '@/server/bloqueios/tipos';

import { demonstrarCriacaoAcao, demonstrarEdicaoAcao, demonstrarRemocaoAcao } from './acoes';

// D-016 T-9 (R-12): as ações de demonstração só validam; desligada a vitrine, não processam nada.

const M = MENSAGENS_BLOQUEIO;

afterEach(() => {
  vi.unstubAllEnvs();
});

function formulario(campos: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
}
/** dd/mm/aaaa de daqui a `dias` dias (UTC, longe o bastante para não depender do fuso). */
function data(dias: number): string {
  const d = new Date(Date.now() + dias * 86_400_000);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

const desligar = () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('VITRINE_COMPONENTES', 'false');
};

describe('demonstrarCriacaoAcao / demonstrarEdicaoAcao', () => {
  it('vitrine desligada → estado inicial, sem validar', async () => {
    desligar();
    const fd = formulario({ modo: 'horario', dataInicio: 'x' });
    expect(await demonstrarCriacaoAcao(estadoInicial(), fd)).toEqual(estadoInicial());
    const anterior = estadoInicial({ ...VALORES_VAZIOS, motivo: 'm' });
    expect(await demonstrarEdicaoAcao(anterior, fd)).toEqual(anterior);
  });

  it('ligada, inválido → erros e valores preservados', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    const r = await demonstrarCriacaoAcao(estadoInicial(), formulario({ alvo: 'salao', modo: 'horario', dataInicio: data(3), horaInicio: '14:07', dataFim: data(3), horaFim: '16:00' }));
    expect(r).toMatchObject({ mensagem: null, erros: { horaInicio: M.granularidade }, salvo: null, valores: { horaInicio: '14:07', alvo: 'salao' } });
  });

  it('ligada, gestor sem alvo (período válido) → erro de alvo', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    const r = await demonstrarCriacaoAcao(estadoInicial(), formulario({ alvo: '', modo: 'dia_inteiro', dataInicio: data(3), dataFim: data(3) }));
    expect(r.erros).toEqual({ alvo: M.alvo });
  });

  it('ligada, válido → salvo com o período formatado e o aviso de exemplo; criação limpa os campos', async () => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    const r = await demonstrarCriacaoAcao(estadoInicial(), formulario({ alvo: 'salao', modo: 'dia_inteiro', dataInicio: data(3), dataFim: data(3) }));
    expect(r.erros).toEqual({});
    expect(r.valores).toEqual(VALORES_VAZIOS);
    expect(r.salvo?.periodo).toBe(`${data(3)} (dia inteiro)`);
    expect(r.salvo?.aviso.total).toBe(2);
    expect(r.salvo?.aviso.reservas.map((x) => x.cliente)).toEqual(['Joana Exemplo', 'cliente removida']);
    // Profissional (sem alvo no formulário) e edição (mantém os valores).
    const p = await demonstrarCriacaoAcao(estadoInicial(), formulario({ modo: 'horario', dataInicio: data(4), horaInicio: '14:00', dataFim: data(4), horaFim: '16:00' }));
    expect(p.salvo?.periodo).toBe(`${data(4)} 14:00 a ${data(4)} 16:00`);
    const e = await demonstrarEdicaoAcao(estadoInicial(), formulario({ id: 'x', modo: 'horario', dataInicio: data(4), horaInicio: '14:00', dataFim: data(4), horaFim: '16:00', motivo: 'M' }));
    expect(e.valores).toMatchObject({ dataInicio: data(4), motivo: 'M' });
    expect(e.salvo).not.toBeNull();
  });
});

describe('demonstrarRemocaoAcao', () => {
  it('desligada → não redireciona', async () => {
    desligar();
    await expect(demonstrarRemocaoAcao('gestor')).resolves.toBeUndefined();
  });

  it.each([
    ['gestor', 'gestor'],
    ['profissional', 'profissional'],
    ['desconhecido', 'gestor'],
  ])('ligada, modo %s → PRG ?remocao=ok&modo=%s', async (modo, esperado) => {
    vi.stubEnv('VITRINE_COMPONENTES', 'true');
    await expect(demonstrarRemocaoAcao(modo)).rejects.toMatchObject({ digest: expect.stringContaining(`/dev/bloqueios?remocao=ok&modo=${esperado}`) });
  });
});
