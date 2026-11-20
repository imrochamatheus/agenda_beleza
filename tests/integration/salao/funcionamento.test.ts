import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { criarSalaoComGestor } from '@/server/repos/cadastro';
import { lerPerfilPublico, resolverSalaoPorSlug } from '@/server/repos/publico';
import * as acoesConfig from '@/server/salao/configuracoes.acao';
import * as acoes from '@/server/salao/funcionamento.acao';
import { obterFuncionamento, salvarFuncionamento } from '@/server/salao/funcionamento';
import { lerFuncionamento } from '@/server/salao/funcionamento-leitura';
import { MENSAGENS_FUNCIONAMENTO as M } from '@/server/salao/funcionamento-tipos';
import { criarTenantContext } from '@/server/tenant/context';
import { metadadosDaAcao } from '@/server/tenant/define-acao';
import { AcessoNegado, NaoEncontrado } from '@/server/tenant/erros';

import { criarSuperAdmin } from '../../support/auth';
import { criarDoisSaloes, criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar, emailNovo } from '../../support/sql';
import { criarReservaEm, inserirBloqueio } from '../bloqueios/apoio';

import { regras } from './apoio';
import {
  ACESSO_NEGADO,
  NAO_AUTENTICADO,
  SEG_A_SAB,
  UUID_INEXISTENTE,
  credGestor,
  credProfissional,
  ctxDoGestor,
  ctxDoProfissional,
  fotografiaOutrosDados,
  funcionamento,
  funcionamentoDe,
  linhaSalao,
  semanaDe,
  versaoSalao,
} from './apoio-perfil';

// D-020 T-6: funcionamento pela ação (acao.executar) contra PostgreSQL real com dois salões.
// CA-1, CA-3, CA-4 (sequencial), CA-6..CA-11, CA-13 e logs.

let c: pg.Client;
let a: SalaoCompleto;

beforeAll(async () => {
  c = await conectar();
  ({ a } = await criarDoisSaloes());
});
beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterAll(async () => {
  await c.end();
});

const salvar = async (s: SalaoCompleto, e: Record<string, unknown>) => acoes.salvarFuncionamentoDoSalao.executar(await credGestor(s), e);
const invalido = (erros: Record<string, unknown>) => ({ ok: true, dados: { resultado: 'invalido', erros } });

describe('CA-1: permissões e isolamento', () => {
  it('profissional → AcessoNegado sem escrita; super admin 403; sem credencial 401', async () => {
    const antes = await linhaSalao(c, a.salaoId);
    expect(await acoes.salvarFuncionamentoDoSalao.executar(await credProfissional(a), funcionamento('informar', SEG_A_SAB))).toEqual(ACESSO_NEGADO);
    const admin = await criarSuperAdmin({ totpVerificado: true });
    expect(await acoes.salvarFuncionamentoDoSalao.executar(admin.credencial, funcionamento('informar'))).toEqual(ACESSO_NEGADO);
    expect(await acoes.salvarFuncionamentoDoSalao.executar(null, funcionamento('informar'))).toEqual(NAO_AUTENTICADO);
    expect(await linhaSalao(c, a.salaoId)).toEqual(antes);
    expect(await funcionamentoDe(c, a.salaoId)).toEqual([]);
    await expect(salvarFuncionamento(ctxDoProfissional(a), funcionamento('informar'))).rejects.toBeInstanceOf(AcessoNegado);
    await expect(obterFuncionamento(ctxDoProfissional(a))).rejects.toBeInstanceOf(AcessoNegado);
  });

  it('gestor de S2 com salaoId de S1 forjado → só S2 muda; S1 idêntico', async () => {
    const { a: s1, b: s2 } = await criarDoisSaloes();
    await salvar(s1, funcionamento('informar', { 2: [['10:00', '12:00']] }));
    const s1Antes = await linhaSalao(c, s1.salaoId);
    const f1 = await funcionamentoDe(c, s1.salaoId);
    expect(await salvar(s2, funcionamento('informar', SEG_A_SAB, { salaoId: s1.salaoId }))).toMatchObject({ ok: true, dados: { resultado: 'salvo' } });
    expect(await linhaSalao(c, s1.salaoId)).toEqual(s1Antes);
    expect(await funcionamentoDe(c, s1.salaoId)).toEqual(f1);
    expect(await semanaDe(c, s2.salaoId)).toHaveLength(6);
  });

  it('contexto de salão inexistente → NaoEncontrado', async () => {
    const fantasma = criarTenantContext({ usuarioId: a.gestor.usuarioId, papel: 'gestor', salaoId: UUID_INEXISTENTE, profissionalId: null });
    await expect(salvarFuncionamento(fantasma, funcionamento('informar'))).rejects.toBeInstanceOf(NaoEncontrado);
    await expect(salvarFuncionamento(fantasma, funcionamento('nao_informar'))).rejects.toBeInstanceOf(NaoEncontrado);
    await expect(obterFuncionamento(fantasma)).rejects.toBeInstanceOf(NaoEncontrado);
  });
});

describe('CA-3: recusas no dia/intervalo; contíguos unidos; 24:00', () => {
  it('cada caso inválido é recusado e nada muda (linhas e estado)', async () => {
    const s = await criarSalaoCompleto();
    await salvar(s, funcionamento('informar', { 5: [['08:00', '12:00']] }));
    const antes = await linhaSalao(c, s.salaoId);
    const linhasAntes = await funcionamentoDe(c, s.salaoId);
    const sete: [string, string][] = [8, 10, 12, 14, 16, 18, 20].map((h) => [`${h}:00`, `${h}:30`]);
    const casos: [Record<string, unknown>, Record<string, unknown>][] = [
      [funcionamento('informar', { 1: [['09:00', '12:00'], ['11:00', '14:00']] }), { dias: { 1: { intervalos: { 0: { intervalo: M.sobreposicao }, 1: { intervalo: M.sobreposicao } } } } }],
      [funcionamento('informar', { 1: [['09:07', '12:00']] }), { dias: { 1: { intervalos: { 0: { inicio: M.granularidade } } } } }],
      [funcionamento('informar', { 1: [['22:00', '02:00']] }), { dias: { 1: { intervalos: { 0: { intervalo: M.ordem } } } } }],
      [funcionamento('informar', { 1: [['10:00', '10:00']] }), { dias: { 1: { intervalos: { 0: { intervalo: M.ordem } } } } }],
      [funcionamento('informar', { 1: [['24:00', '24:00']] }), { dias: { 1: { intervalos: { 0: { inicio: M.inicio24 } } } } }],
      [funcionamento('informar', { 1: sete }), { dias: { 1: { dia: M.limite } } }],
      [funcionamento(undefined, SEG_A_SAB), { modo: M.modo }],
    ];
    for (const [entrada, erros] of casos) {
      expect(await salvar(s, entrada)).toEqual(invalido(erros));
    }
    expect(await linhaSalao(c, s.salaoId)).toEqual(antes);
    expect(await funcionamentoDe(c, s.salaoId)).toEqual(linhasAntes);
  });

  it('terça 09:00–12:00 + 12:00–13:00 → uma linha (2, 540, 780); 22:00–24:00 → (1320, 1440), exibido 22:00–24:00', async () => {
    const s = await criarSalaoCompleto();
    const r = await salvar(s, funcionamento('informar', { 2: [['09:00', '12:00'], ['12:00', '13:00']], 5: [['22:00', '24:00']] }));
    expect(r).toMatchObject({ ok: true, dados: { resultado: 'salvo', alterado: true } });
    expect(await semanaDe(c, s.salaoId)).toEqual([
      [2, 540, 780],
      [5, 1320, 1440],
    ]);
    const f = await obterFuncionamento(ctxDoGestor(s));
    if (!f.definido) throw new Error('esperava informado');
    expect(f.semana[5].intervalos).toEqual([{ inicioMin: 1320, fimMin: 1440 }]);
  });
});

describe('CA-4 (sequencial): mesma semana não escreve nada', () => {
  it('ids, xmin e atualizado_em iguais; alterado false', async () => {
    const s = await criarSalaoCompleto();
    await salvar(s, funcionamento('informar', SEG_A_SAB));
    const ids = await funcionamentoDe(c, s.salaoId);
    const versao = await versaoSalao(c, s.salaoId);
    const r = await salvar(s, funcionamento('informar', SEG_A_SAB));
    expect(r).toMatchObject({ ok: true, dados: { resultado: 'salvo', alterado: false } });
    expect(await funcionamentoDe(c, s.salaoId)).toEqual(ids);
    expect(await versaoSalao(c, s.salaoId)).toEqual(versao);
  });
});

describe('CA-6/CA-7/CA-8', () => {
  it('CA-6: salão da fábrica e do cadastro (D-011) não informado; leituras { definido: false } e null', async () => {
    const r = await criarSalaoComGestor({
      nomeSalao: 'Studio Funcionamento Novo',
      slugBase: 'studio-funcionamento-novo',
      nomeGestor: 'Gestora Nova',
      email: emailNovo(),
      senhaHash: 'hash-ficticio',
      tokenHash: `t-${emailNovo()}`,
      expiraEm: new Date(Date.now() + 3_600_000),
      agora: new Date(),
    });
    if (!r.ok) throw new Error('cadastro falhou');
    const ctxCadastro = criarTenantContext({ usuarioId: r.usuarioId, papel: 'gestor', salaoId: r.salaoId, profissionalId: null });
    const s = await criarSalaoCompleto();
    for (const [ctx, salaoId, slug] of [
      [ctxCadastro, r.salaoId, r.slug],
      [ctxDoGestor(s), s.salaoId, s.slugAtual],
    ] as const) {
      expect((await versaoSalao(c, salaoId)).funcionamento_definido).toBe(false);
      expect(await funcionamentoDe(c, salaoId)).toEqual([]);
      expect(await obterFuncionamento(ctx)).toEqual({ definido: false });
      expect(await lerFuncionamento(ctx)).toEqual({ definido: false });
      expect((await lerPerfilPublico((await resolverSalaoPorSlug(slug)).contexto)).funcionamento).toBeNull();
    }
  });

  it('CA-7: informar com todos os dias vazios → definido true, sem linhas, 7 dias fechados', async () => {
    const s = await criarSalaoCompleto();
    const r = await salvar(s, funcionamento('informar'));
    expect(r).toMatchObject({ ok: true, dados: { resultado: 'salvo', alterado: true, funcionamento: { definido: true } } });
    expect((await versaoSalao(c, s.salaoId)).funcionamento_definido).toBe(true);
    expect(await funcionamentoDe(c, s.salaoId)).toEqual([]);
    const f = await lerFuncionamento(ctxDoGestor(s));
    if (!f.definido) throw new Error('esperava informado');
    expect(f.semana).toHaveLength(7);
    expect(f.semana.every((d) => d.intervalos.length === 0)).toBe(true);
  });

  it('CA-8: não informar (com linhas inválidas digitadas) remove tudo; de novo não escreve nada', async () => {
    const s = await criarSalaoCompleto();
    await salvar(s, funcionamento('informar', SEG_A_SAB));
    const r = await salvar(s, funcionamento('nao_informar', { 1: [['22:00', '02:00']], 3: [['x', '']] }));
    expect(r).toEqual({ ok: true, dados: { resultado: 'salvo', funcionamento: { definido: false }, alterado: true } });
    expect(await funcionamentoDe(c, s.salaoId)).toEqual([]);
    expect((await versaoSalao(c, s.salaoId)).funcionamento_definido).toBe(false);
    expect(await lerFuncionamento(ctxDoGestor(s))).toEqual({ definido: false });
    const versao = await versaoSalao(c, s.salaoId);
    expect(await salvar(s, funcionamento('nao_informar'))).toMatchObject({ ok: true, dados: { alterado: false } });
    expect(await versaoSalao(c, s.salaoId)).toEqual(versao);
  });
});

describe('CA-9: diferença por dia', () => {
  it('seg–sáb → só quarta 10:00–16:00; um dia inválido não altera nenhum; ids preservados', async () => {
    const s = await criarSalaoCompleto();
    await salvar(s, funcionamento('informar', SEG_A_SAB));
    const antes = await funcionamentoDe(c, s.salaoId);
    expect(await salvar(s, funcionamento('informar', { ...SEG_A_SAB, 2: [['09:00', '17:00']], 4: [['09:07', '18:00']] }))).toMatchObject({
      ok: true,
      dados: { resultado: 'invalido' },
    });
    expect(await funcionamentoDe(c, s.salaoId)).toEqual(antes);

    await salvar(s, funcionamento('informar', { ...SEG_A_SAB, 2: [['09:00', '17:00']] }));
    const depois = await funcionamentoDe(c, s.salaoId);
    expect(depois.filter((l) => l.dia_semana !== 2)).toEqual(antes.filter((l) => l.dia_semana !== 2));
    expect(depois.find((l) => l.dia_semana === 2)).toMatchObject({ inicio_min: 540, fim_min: 1020 });

    await salvar(s, funcionamento('informar', { 3: [['10:00', '16:00']] }));
    expect(await semanaDe(c, s.salaoId)).toEqual([[3, 600, 960]]);
  });
});

describe('CA-10: reservas, jornada, bloqueios e mensagens intactos', () => {
  it('fechar a quinta não toca a reserva de quinta 15:00–16:00, a jornada nem o bloqueio; nenhuma mensagem nova', async () => {
    const s = await criarSalaoCompleto();
    const profissionalId = s.profissional.profissionalId;
    const quinta = new Date('2099-12-10T18:00:00Z'); // 15:00 em São Paulo
    expect(quinta.getUTCDay()).toBe(4);
    await criarReservaEm(c, { salaoId: s.salaoId, profissionalId, clienteId: s.clientes.ativaId, inicio: quinta, fim: new Date(quinta.getTime() + 3_600_000) });
    await c.query('DELETE FROM jornada WHERE profissional_id = $1 AND dia_semana = 4', [profissionalId]);
    await c.query('INSERT INTO jornada (salao_id, profissional_id, dia_semana, inicio_min, fim_min) VALUES ($1, $2, 4, 540, 1080)', [s.salaoId, profissionalId]);
    await inserirBloqueio(c, { salaoId: s.salaoId, profissionalId: null, inicio: '2099-12-25T03:00:00Z', fim: '2099-12-26T03:00:00Z' });
    await salvar(s, funcionamento('informar', SEG_A_SAB));
    const antes = await fotografiaOutrosDados(c, s.salaoId);
    const semQuinta = { ...SEG_A_SAB };
    delete semQuinta[4];
    expect(await salvar(s, funcionamento('informar', semQuinta))).toMatchObject({ ok: true, dados: { resultado: 'salvo', alterado: true } });
    expect(await fotografiaOutrosDados(c, s.salaoId)).toEqual(antes);
    expect((await semanaDe(c, s.salaoId)).some(([d]) => d === 4)).toBe(false);
  });
});

describe('CA-11: hora de parede, independente do fuso', () => {
  it('Manaus 09:00–12:00 → 540; trocar o fuso para São Paulo (D-017) não altera as linhas', async () => {
    const s = await criarSalaoCompleto({ salao: { fuso: 'America/Manaus' } });
    await salvar(s, funcionamento('informar', { 1: [['09:00', '12:00']] }));
    const linhas = await funcionamentoDe(c, s.salaoId);
    expect(linhas.map((l) => [l.inicio_min, l.fim_min])).toEqual([[540, 720]]);
    expect(await acoesConfig.salvarConfiguracoes.executar(await credGestor(s), regras({ nome: s.nome, fuso: 'America/Sao_Paulo' }))).toMatchObject({
      ok: true,
      dados: { resultado: 'salvo' },
    });
    expect((await linhaSalao(c, s.salaoId)).fuso).toBe('America/Sao_Paulo');
    expect(await funcionamentoDe(c, s.salaoId)).toEqual(linhas);
  });
});

describe('CA-13 e logs', () => {
  it('a ação declara papeis [gestor] e capacidade configurar; gestor sem perfil de profissional grava', async () => {
    expect(Object.keys(acoes)).toEqual(['salvarFuncionamentoDoSalao']);
    expect(metadadosDaAcao(acoes.salvarFuncionamentoDoSalao)).toEqual({ papeis: ['gestor'], capacidade: 'configurar' });
    const semPerfil = await criarSalaoCompleto({ gestor: { comPerfil: false } });
    expect(await salvar(semPerfil, funcionamento('informar', SEG_A_SAB))).toMatchObject({ ok: true, dados: { resultado: 'salvo' } });
  });

  it('salao.funcionamento_salvo só com ids e contagens', async () => {
    const s = await criarSalaoCompleto();
    const espiao = vi.spyOn(console, 'info').mockImplementation(() => {});
    await salvar(s, funcionamento('informar', { 1: [['09:00', '12:00']] }));
    const linhas = espiao.mock.calls.map((x) => String(x[0]));
    expect(linhas).toContain(
      JSON.stringify({ evento: 'salao.funcionamento_salvo', salaoId: s.salaoId, definido: true, removidos: 0, inseridos: 1, mudouEstado: true }),
    );
  });

  it('entrada que não é objeto → formulario', async () => {
    expect(await salvar(a, 'x' as never)).toEqual(invalido({ formulario: M.formulario }));
  });
});
