import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CAPACIDADES_OPERACIONAIS, decidirEstadoEfetivo, TABELA_CAPACIDADES } from '@/domain/assinatura';
import type { EstadoEfetivo, SituacaoOperacional } from '@/domain/assinatura';
import { criarTenantContext } from '@/server/tenant/context';

const { lerEstadoBruto } = vi.hoisted(() => ({ lerEstadoBruto: vi.fn() }));
vi.mock('@/server/repos', () => ({ repos: () => ({ assinaturas: { lerEstadoBruto } }) }));

import { decidirPolitica, politicaDeOperacao, politicaPorEstado } from './politica-operacao';

const AGORA = new Date('2026-11-20T12:00:00Z');
const FUTURO = new Date('2026-12-20T12:00:00Z');
const ctx = criarTenantContext({
  usuarioId: '5d2a9b1c-3e4f-4a5b-8c6d-7e8f9a0b1c2d',
  papel: 'gestor',
  salaoId: '0b0c5f6e-4a7d-4f0a-9a43-1f7f3c1e2d10',
  profissionalId: null,
});
const a = (estado: string, extra: { carenciaAte?: Date; acessoAte?: Date } = {}) => ({
  suspensoManualEm: null,
  assinatura: { estado, carenciaAte: extra.carenciaAte ?? null, acessoAte: extra.acessoAte ?? null },
});

const SITUACOES: [SituacaoOperacional, Parameters<typeof decidirEstadoEfetivo>[0]][] = [
  ['sem_assinatura', { suspensoManualEm: null, assinatura: null }],
  ['pendente', a('pendente')],
  ['em_teste', a('em_teste')],
  ['ativa', a('ativa')],
  ['em_carencia', a('em_carencia', { carenciaAte: FUTURO })],
  ['cancelada', a('cancelada', { acessoAte: FUTURO })],
  ['encerrada', a('cancelada', { acessoAte: AGORA })],
  ['suspensa', a('suspensa')],
  ['encerrada', a('encerrada')],
  ['manual', { ...a('ativa'), suspensoManualEm: AGORA }],
];

beforeEach(() => {
  lerEstadoBruto.mockReset();
});

describe('decidirPolitica: tabela única (CA-7)', () => {
  for (const [situacao, bruto] of SITUACOES) {
    it.each(CAPACIDADES_OPERACIONAIS)(`${situacao} (${JSON.stringify(bruto.assinatura?.estado ?? null)}) x %s`, (cap) => {
      const e = decidirEstadoEfetivo(bruto, AGORA);
      expect(e.estado).toBe(situacao);
      expect(decidirPolitica(e, cap).permitido).toBe(TABELA_CAPACIDADES[situacao][cap]);
    });
  }

  it('suspensa, encerrada e manual: configurar e agendar negados; cancelar, lgpd, leitura e assinatura permitidos', () => {
    for (const s of ['suspensa', 'encerrada', 'manual'] as const) {
      const e = decidirEstadoEfetivo(
        s === 'manual' ? { ...a('ativa'), suspensoManualEm: AGORA } : a(s),
        AGORA,
      );
      expect(CAPACIDADES_OPERACIONAIS.filter((c) => !decidirPolitica(e, c).permitido)).toEqual(['configurar', 'agendar']);
    }
  });

  it('capacidade inválida, ausente ou valor não booleano: negado', () => {
    const e = decidirEstadoEfetivo(a('ativa'), AGORA);
    for (const c of ['inexistente', '', '__proto__', 'toString', 'constructor']) {
      expect(decidirPolitica(e, c).permitido).toBe(false);
    }
    const quebrado = { ...e, capacidades: { ...e.capacidades, configurar: 'true' } } as unknown as EstadoEfetivo;
    expect(decidirPolitica(quebrado, 'configurar').permitido).toBe(false);
    const semCaps = { ...e, capacidades: undefined } as unknown as EstadoEfetivo;
    expect(decidirPolitica(semCaps, 'leitura').permitido).toBe(false);
    expect(decidirPolitica(undefined as unknown as EstadoEfetivo, 'leitura').permitido).toBe(false);
  });

  it('o motivo interno traz capacidade e estado', () => {
    const e = decidirEstadoEfetivo(a('suspensa'), AGORA);
    expect(decidirPolitica(e, 'agendar')).toEqual({ permitido: false, motivo: 'somente_leitura:agendar:suspensa' });
  });
});

describe('politicaPorEstado', () => {
  it('lê o estado com o agora recebido e aplica a tabela', async () => {
    lerEstadoBruto.mockResolvedValue(a('suspensa'));
    expect(await politicaPorEstado(ctx, 'configurar', AGORA)).toEqual({
      permitido: false,
      motivo: 'somente_leitura:configurar:suspensa',
    });
    expect(await politicaPorEstado(ctx, 'cancelar', AGORA)).toEqual({ permitido: true });
    expect(lerEstadoBruto).toHaveBeenCalledWith(ctx);
    expect(politicaDeOperacao).toBe(politicaPorEstado);
  });

  it('falha de leitura nega (falha fechada) e registra só o salaoId', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    lerEstadoBruto.mockImplementation(() => {
      throw new Error('conexão com senha=segredo');
    });
    expect(await politicaPorEstado(ctx, 'leitura', AGORA)).toEqual({ permitido: false, motivo: 'estado_ilegivel' });
    const log = String(aviso.mock.calls[0]?.[0]);
    expect(log).toContain('politica.estado_ilegivel');
    expect(log).toContain(ctx.salaoId);
    expect(log).not.toContain('segredo');
    aviso.mockRestore();
  });
});
