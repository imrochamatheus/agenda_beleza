import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { lerPerfilPublico, resolverSalaoPorSlug } from '@/server/repos/publico';
import * as acoesFuncionamento from '@/server/salao/funcionamento.acao';
import { lerFuncionamento } from '@/server/salao/funcionamento-leitura';
import * as acoesPerfil from '@/server/salao/perfil.acao';
import { contextoDeSistema, criarAdminContext, criarPublicoContext } from '@/server/tenant/context';
import { NaoEncontrado } from '@/server/tenant/erros';

import { criarDoisSaloes } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

import { UUID_INEXISTENTE, credGestor, ctxDoGestor, ctxDoProfissional, funcionamento, perfilCompleto } from './apoio-perfil';

// D-020 T-6: leituras para outras demandas. CA-16 (projeção pública exata, suspenso) e CA-17 (leitura do
// funcionamento sem papel: tenant, sistema e público; só o salão do contexto; 7 dias canônicos).

let c: pg.Client;
let s1: SalaoCompleto;
let s2: SalaoCompleto;

beforeAll(async () => {
  c = await conectar();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  ({ a: s1, b: s2 } = await criarDoisSaloes());
  await acoesPerfil.salvarPerfilDoSalao.executar(await credGestor(s1), perfilCompleto());
  await acoesFuncionamento.salvarFuncionamentoDoSalao.executar(
    await credGestor(s1),
    funcionamento('informar', { 1: [['13:00', '18:00'], ['09:00', '12:00']], 6: [['08:00', '12:00']] }),
  );
});
beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterAll(async () => {
  await c.end();
});

describe('CA-16: projeção pública', () => {
  it('exatamente as chaves da RN-18, sem suspensão, regras, ids, e-mails nem atualizado_em', async () => {
    const p = await lerPerfilPublico((await resolverSalaoPorSlug(s1.slugAtual)).contexto);
    expect(Object.keys(p).sort()).toEqual(
      ['comodidades', 'descricao', 'endereco', 'funcionamento', 'instagram', 'meiosPagamento', 'nome', 'telefoneE164', 'whatsappE164'].sort(),
    );
    const texto = JSON.stringify(p);
    for (const proibido of [s1.gestor.email, s1.gestor.usuarioId, s1.salaoId, 'suspenso', 'grade', 'antecedencia', 'atualizado', 'fuso']) {
      expect(texto).not.toContain(proibido);
    }
    expect(p.funcionamento![1].intervalos).toEqual([
      { inicioMin: 540, fimMin: 720 },
      { inicioMin: 780, fimMin: 1080 },
    ]);
  });

  it('com suspenso_manual_em preenchido, o perfil continua sendo devolvido', async () => {
    await c.query('UPDATE salao SET suspenso_manual_em = now() WHERE id = $1', [s1.salaoId]);
    try {
      const p = await lerPerfilPublico((await resolverSalaoPorSlug(s1.slugAtual)).contexto);
      expect(p.instagram).toBe('meu.salao');
      expect(p.funcionamento).not.toBeNull();
    } finally {
      await c.query('UPDATE salao SET suspenso_manual_em = NULL WHERE id = $1', [s1.salaoId]);
    }
  });
});

describe('CA-17: leitura do funcionamento sem papel', () => {
  it('tenant (gestor e profissional), sistema e público dão o mesmo resultado de S1; S2 não informado', async () => {
    const contextos = [ctxDoGestor(s1), ctxDoProfissional(s1), contextoDeSistema(s1.salaoId, 'e3.1'), criarPublicoContext(s1.salaoId, s1.slugAtual)];
    const resultados = await Promise.all(contextos.map((ctx) => lerFuncionamento(ctx)));
    for (const r of resultados) expect(r).toEqual(resultados[0]);
    const f = resultados[0];
    if (!f.definido) throw new Error('esperava informado');
    expect(f.semana.map((d) => d.diaSemana)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(f.semana[1]).toEqual({
      diaSemana: 1,
      intervalos: [
        { inicioMin: 540, fimMin: 720 },
        { inicioMin: 780, fimMin: 1080 },
      ],
      pausas: [{ inicioMin: 720, fimMin: 780 }],
    });
    expect(f.semana[6].intervalos).toEqual([{ inicioMin: 480, fimMin: 720 }]);
    expect(f.semana[0]).toEqual({ diaSemana: 0, intervalos: [], pausas: [] });

    for (const ctx of [ctxDoGestor(s2), contextoDeSistema(s2.salaoId, 'e3.1'), criarPublicoContext(s2.salaoId, s2.slugAtual)]) {
      expect(await lerFuncionamento(ctx)).toEqual({ definido: false });
    }
  });

  it('AdminContext e objetos forjados → Error; salão inexistente → NaoEncontrado', async () => {
    await expect(lerFuncionamento(criarAdminContext(s1.gestor.usuarioId) as never)).rejects.toThrow(Error);
    await expect(lerFuncionamento({ tipo: 'tenant', salaoId: 'nao-uuid' } as never)).rejects.toThrow(Error);
    await expect(lerFuncionamento({ tipo: 'publico', salaoId: 'nao-uuid' } as never)).rejects.toThrow(Error);
    await expect(lerFuncionamento({ tipo: 'outro', salaoId: s1.salaoId } as never)).rejects.toThrow(Error);
    await expect(lerFuncionamento(contextoDeSistema(UUID_INEXISTENTE, 't'))).rejects.toBeInstanceOf(NaoEncontrado);
    await expect(lerFuncionamento(criarPublicoContext(UUID_INEXISTENTE, 'x'))).rejects.toBeInstanceOf(NaoEncontrado);
  });
});
