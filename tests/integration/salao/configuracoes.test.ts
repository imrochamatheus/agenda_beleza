import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { criarSalaoComGestor } from '@/server/repos/cadastro';
import { listar as listarBloqueios } from '@/server/bloqueios/servico';
import * as acoes from '@/server/salao/configuracoes.acao';
import { obter, salvarRegras, trocarSlug } from '@/server/salao/configuracoes';
import { MENSAGENS_CONFIGURACOES as M } from '@/server/salao/tipos';
import { criarTenantContext } from '@/server/tenant/context';
import { metadadosDaAcao } from '@/server/tenant/define-acao';
import { AcessoNegado } from '@/server/tenant/erros';

import { criarSuperAdmin } from '../../support/auth';
import { criarDoisSaloes, criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar, emailNovo } from '../../support/sql';

import {
  ACESSO_NEGADO,
  MANAUS,
  NAO_AUTENTICADO,
  SP,
  credGestor,
  credProfissional,
  ctxDoGestor,
  ctxDoProfissional,
  fotografiaAgenda,
  linhaSalao,
  regras,
  slugsDe,
} from './apoio';

// D-017 T-5: serviço e ações de dados e regras do salão, pela ação (acao.executar) contra PostgreSQL
// real com dois salões. CA-3..CA-7, CA-14..CA-18.

let c: pg.Client;
let a: SalaoCompleto;
let b: SalaoCompleto;

beforeAll(async () => {
  c = await conectar();
  ({ a, b } = await criarDoisSaloes());
});
beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterAll(async () => {
  await c.end();
});

const salvo = (valores: Record<string, string>) => ({ ok: true, dados: { resultado: 'salvo', valores } });
const invalido = (erros: Record<string, string>) => ({ ok: true, dados: { resultado: 'invalido', erros } });

describe('CA-3: fuso', () => {
  it('inválidos são recusados no campo fuso sem gravar; America/Manaus é gravado e lido', async () => {
    const s = await criarSalaoCompleto();
    const cred = await credGestor(s);
    const antes = await linhaSalao(c, s.salaoId);
    for (const fuso of ['America/Inexistente', '+03:00', 'UTC', 'Brazil/East', 'america/sao_paulo', ' America/Sao_Paulo', '']) {
      expect(await acoes.salvarConfiguracoes.executar(cred, regras({ fuso })), fuso).toEqual(invalido({ fuso: M.fuso }));
    }
    expect(await linhaSalao(c, s.salaoId)).toEqual(antes);

    const r = await acoes.salvarConfiguracoes.executar(cred, regras({ fuso: MANAUS }));
    expect(r).toMatchObject({ ok: true, dados: { resultado: 'salvo', valores: { fuso: MANAUS } } });
    expect((await linhaSalao(c, s.salaoId)).fuso).toBe(MANAUS);
    expect((await obter(ctxDoGestor(s))).valores.fuso).toBe(MANAUS);
  });

  it('fuso gravado fora da lista (alias) é aceito sem mudança e aparece como opção "atual"', async () => {
    const s = await criarSalaoCompleto({ salao: { fuso: 'Brazil/East' } });
    const cfg = await obter(ctxDoGestor(s));
    expect(cfg.fusos.atualForaDaLista).toEqual({ valor: 'Brazil/East', rotulo: 'Brazil/East (atual)' });
    expect(await acoes.salvarConfiguracoes.executar(await credGestor(s), regras({ fuso: 'Brazil/East', nome: 'Alias' }))).toMatchObject({
      ok: true,
      dados: { resultado: 'salvo' },
    });
    expect((await linhaSalao(c, s.salaoId)).nome).toBe('Alias');
    // Mas outro alias, que não é o gravado, é recusado.
    expect(await acoes.salvarConfiguracoes.executar(await credGestor(s), regras({ fuso: 'US/Eastern' }))).toEqual(invalido({ fuso: M.fuso }));
  });
});

describe('CA-4, CA-5, CA-6: regras', () => {
  it('grade 7 (e outros) recusada; 30 persistida e lida', async () => {
    const s = await criarSalaoCompleto();
    const cred = await credGestor(s);
    for (const grade of ['7', '0', '25', '120', '15.0', 'abc', '']) {
      expect(await acoes.salvarConfiguracoes.executar(cred, regras({ grade })), grade).toEqual(invalido({ grade: M.grade }));
    }
    expect(await acoes.salvarConfiguracoes.executar(cred, regras({ grade: '30' }))).toMatchObject({ ok: true, dados: { valores: { grade: '30' } } });
    expect((await linhaSalao(c, s.salaoId)).grade_min).toBe(30);
    expect((await obter(ctxDoGestor(s))).valores.grade).toBe('30');
  });

  it('amostra de limites: um recusado e um aceito por campo; antecedência gravada em minutos', async () => {
    const s = await criarSalaoCompleto();
    const cred = await credGestor(s);
    expect(await acoes.salvarConfiguracoes.executar(cred, regras({ antecedencia: '73' }))).toEqual(invalido({ antecedencia: M.antecedencia }));
    expect(await acoes.salvarConfiguracoes.executar(cred, regras({ janela: '366' }))).toEqual(invalido({ janela: M.janela }));
    expect(await acoes.salvarConfiguracoes.executar(cred, regras({ intervalo: '121' }))).toEqual(invalido({ intervalo: M.intervalo }));
    expect(await acoes.salvarConfiguracoes.executar(cred, regras({ antecedencia: '72', janela: '365', intervalo: '120' }))).toEqual(
      salvo({ nome: 'Studio Bela', fuso: SP, grade: '15', antecedencia: '72', janela: '365', intervalo: '120' }),
    );
    expect(await linhaSalao(c, s.salaoId)).toMatchObject({ antecedencia_min: 4320, janela_dias: 365, intervalo_min: 120 });
    expect(await acoes.salvarConfiguracoes.executar(cred, regras({ antecedencia: '0', janela: '1', intervalo: '0' }))).toMatchObject({ ok: true });
    expect(await linhaSalao(c, s.salaoId)).toMatchObject({ antecedencia_min: 0, janela_dias: 1, intervalo_min: 0 });
  });

  it('dois campos inválidos → os dois erros e nenhum dos seis campos gravado (nem atualizado_em)', async () => {
    const s = await criarSalaoCompleto();
    const antes = await linhaSalao(c, s.salaoId);
    const r = await acoes.salvarConfiguracoes.executar(await credGestor(s), regras({ nome: 'Outro nome', fuso: MANAUS, grade: '7', janela: '0' }));
    expect(r).toEqual(invalido({ grade: M.grade, janela: M.janela }));
    expect(await linhaSalao(c, s.salaoId)).toEqual(antes);
  });

  it('CA-6: janela 2 → antecedência 48 recusada, 47 aceita', async () => {
    const s = await criarSalaoCompleto();
    const cred = await credGestor(s);
    expect(await acoes.salvarConfiguracoes.executar(cred, regras({ janela: '2', antecedencia: '48' }))).toEqual(
      invalido({ antecedencia: M.antecedenciaJanela }),
    );
    expect(await acoes.salvarConfiguracoes.executar(cred, regras({ janela: '2', antecedencia: '47' }))).toMatchObject({ ok: true });
    expect(await linhaSalao(c, s.salaoId)).toMatchObject({ antecedencia_min: 47 * 60, janela_dias: 2 });
  });

  it('entrada que não é objeto → todos os campos com erro, nada gravado', async () => {
    const s = await criarSalaoCompleto();
    const antes = await linhaSalao(c, s.salaoId);
    for (const e of [null, 'x', 3, ['a']]) {
      const r = await salvarRegras(ctxDoGestor(s), e);
      expect(r.resultado).toBe('invalido');
      expect(Object.keys((r as { erros: object }).erros).sort()).toEqual(['antecedencia', 'fuso', 'grade', 'intervalo', 'janela', 'nome']);
    }
    expect(await linhaSalao(c, s.salaoId)).toEqual(antes);
  });
});

describe('CA-7: nome', () => {
  it('nome aparado e colapsado; slug não muda; inválidos recusados', async () => {
    const s = await criarSalaoCompleto();
    const cred = await credGestor(s);
    const slugsAntes = await slugsDe(c, s.salaoId);
    expect(await acoes.salvarConfiguracoes.executar(cred, regras({ nome: '  Studio   Bela Nova ' }))).toMatchObject({
      ok: true,
      dados: { valores: { nome: 'Studio Bela Nova' } },
    });
    expect((await linhaSalao(c, s.salaoId)).nome).toBe('Studio Bela Nova');
    expect(await slugsDe(c, s.salaoId)).toEqual(slugsAntes);
    for (const nome of ['A', 'a'.repeat(81), 'Studio\u0001Bela']) {
      expect(await acoes.salvarConfiguracoes.executar(cred, regras({ nome }))).toEqual(invalido({ nome: M.nome }));
    }
    expect((await linhaSalao(c, s.salaoId)).nome).toBe('Studio Bela Nova');
  });
});

describe('CA-14, CA-18: permissões e registro', () => {
  it('profissional → AcessoNegado nas duas ações, nada muda (em A nem em B); serviço também nega', async () => {
    const antes = await linhaSalao(c, a.salaoId);
    const bAntes = await linhaSalao(c, b.salaoId);
    const slugsAntes = await slugsDe(c, a.salaoId);
    const cred = await credProfissional(a);
    expect(await acoes.salvarConfiguracoes.executar(cred, regras({ nome: 'Invasão' }))).toEqual(ACESSO_NEGADO);
    expect(await acoes.trocarSlugDoSalao.executar(cred, { slug: 'invasao-prof' })).toEqual(ACESSO_NEGADO);
    await expect(obter(ctxDoProfissional(a))).rejects.toBeInstanceOf(AcessoNegado);
    await expect(salvarRegras(ctxDoProfissional(a), regras())).rejects.toBeInstanceOf(AcessoNegado);
    await expect(trocarSlug(ctxDoProfissional(a), { slug: 'x-y-z' })).rejects.toBeInstanceOf(AcessoNegado);
    expect(await linhaSalao(c, a.salaoId)).toEqual(antes);
    expect(await slugsDe(c, a.salaoId)).toEqual(slugsAntes);
    expect(await linhaSalao(c, b.salaoId)).toEqual(bAntes);
  });

  it('gestor com e sem perfil de profissional têm acesso', async () => {
    const semPerfil = await criarSalaoCompleto({ gestor: { comPerfil: false } });
    expect(a.gestor.profissionalId).not.toBeNull();
    for (const s of [a, semPerfil]) {
      expect(await acoes.salvarConfiguracoes.executar(await credGestor(s), regras({ nome: s.nome }))).toMatchObject({ ok: true, dados: { resultado: 'salvo' } });
    }
  });

  it('super admin → 403; sem credencial → 401; nada gravado', async () => {
    const admin = await criarSuperAdmin({ totpVerificado: true });
    const antes = await linhaSalao(c, a.salaoId);
    expect(await acoes.salvarConfiguracoes.executar(admin.credencial, regras())).toEqual(ACESSO_NEGADO);
    expect(await acoes.trocarSlugDoSalao.executar(admin.credencial, { slug: 'admin-tenta' })).toEqual(ACESSO_NEGADO);
    expect(await acoes.salvarConfiguracoes.executar(null, regras())).toEqual(NAO_AUTENTICADO);
    expect(await acoes.trocarSlugDoSalao.executar(null, { slug: 'anonimo-tenta' })).toEqual(NAO_AUTENTICADO);
    expect(await linhaSalao(c, a.salaoId)).toEqual(antes);
  });

  it('CA-18: as duas ações declaram papeis [gestor] e capacidade configurar', () => {
    expect(Object.keys(acoes).sort()).toEqual(['salvarConfiguracoes', 'trocarSlugDoSalao']);
    for (const acao of [acoes.salvarConfiguracoes, acoes.trocarSlugDoSalao]) {
      expect(metadadosDaAcao(acao)).toEqual({ papeis: ['gestor'], capacidade: 'configurar' });
    }
  });
});

describe('CA-15: isolamento entre salões', () => {
  it('gestor de A com salaoId de B forjado → só A muda; B (linha e slugs) intacto; obter de A só com dados de A', async () => {
    const t = await criarDoisSaloes();
    const bAntes = await linhaSalao(c, t.b.salaoId);
    const bSlugs = await slugsDe(c, t.b.salaoId);
    const r = await acoes.salvarConfiguracoes.executar(
      await credGestor(t.a),
      regras({ nome: 'Aurora Nova', fuso: MANAUS, grade: '60', salaoId: t.b.salaoId, salao_id: t.b.salaoId, id: t.b.salaoId }),
    );
    expect(r).toMatchObject({ ok: true, dados: { resultado: 'salvo' } });
    expect(await linhaSalao(c, t.a.salaoId)).toMatchObject({ nome: 'Aurora Nova', fuso: MANAUS, grade_min: 60 });
    expect(await linhaSalao(c, t.b.salaoId)).toEqual(bAntes);
    expect(await slugsDe(c, t.b.salaoId)).toEqual(bSlugs);

    const cfg = await obter(ctxDoGestor(t.a));
    expect(cfg.valores.nome).toBe('Aurora Nova');
    expect(cfg.slug.atual).toBe(t.a.slugAtual);
    expect(cfg.slug.anteriores).toEqual([t.a.slugHistorico]);
    expect(JSON.stringify(cfg)).not.toContain(t.b.slugAtual);
    expect(JSON.stringify(cfg)).not.toContain('Bromélia');
  });
});

describe('CA-16: troca de fuso e grade não altera jornada, bloqueio nem reserva', () => {
  it('fotografias idênticas; a lista de bloqueios passa a exibir 13:00–15:00 em Manaus', async () => {
    const s = await criarSalaoCompleto();
    // Jornada 09:00–12:00 (hora de parede), bloqueio de 14:00–16:00 em São Paulo (17:00Z–19:00Z).
    await c.query('DELETE FROM jornada WHERE salao_id = $1', [s.salaoId]);
    await c.query('INSERT INTO jornada (salao_id, profissional_id, dia_semana, inicio_min, fim_min) VALUES ($1, $2, 4, 540, 720)', [
      s.salaoId,
      s.profissional.profissionalId,
    ]);
    await c.query('DELETE FROM bloqueio WHERE salao_id = $1', [s.salaoId]);
    await c.query(`INSERT INTO bloqueio (salao_id, profissional_id, inicio, fim) VALUES ($1, NULL, '2099-12-10T17:00:00Z', '2099-12-10T19:00:00Z')`, [
      s.salaoId,
    ]);
    const ctx = ctxDoGestor(s);
    const agora = new Date('2099-12-01T12:00:00Z');
    expect((await listarBloqueios(ctx, agora)).itens.map((i) => i.periodo)).toEqual(['10/12/2099 14:00 a 10/12/2099 16:00']);
    const antes = await fotografiaAgenda(c, s.salaoId);
    expect(antes.jornada.length).toBeGreaterThan(0);
    expect(antes.reserva.length).toBeGreaterThan(0);
    expect(antes.reserva_item.length).toBeGreaterThan(0);

    expect(await acoes.salvarConfiguracoes.executar(await credGestor(s), regras({ fuso: MANAUS, grade: '30' }))).toMatchObject({ ok: true });

    expect(await fotografiaAgenda(c, s.salaoId)).toEqual(antes);
    expect((await listarBloqueios(ctx, agora)).itens.map((i) => i.periodo)).toEqual(['10/12/2099 13:00 a 10/12/2099 15:00']);
  });
});

describe('CA-17: salão recém-criado pelo cadastro mostra os padrões', () => {
  it('fuso America/Sao_Paulo, grade 15, antecedência 2, janela 60, intervalo 0', async () => {
    const r = await criarSalaoComGestor({
      nomeSalao: 'Studio Recém Criado',
      slugBase: 'studio-recem-criado',
      nomeGestor: 'Gestora Nova',
      email: emailNovo(),
      senhaHash: 'hash-ficticio',
      tokenHash: `t-${emailNovo()}`,
      expiraEm: new Date(Date.now() + 3_600_000),
      agora: new Date(),
    });
    if (!r.ok) throw new Error('cadastro falhou');
    const ctx = criarTenantContext({ usuarioId: r.usuarioId, papel: 'gestor', salaoId: r.salaoId, profissionalId: null });
    const cfg = await obter(ctx);
    expect(cfg.valores).toEqual({ nome: 'Studio Recém Criado', fuso: SP, grade: '15', antecedencia: '2', janela: '60', intervalo: '0' });
    expect(cfg.slug).toEqual({ atual: r.slug, anteriores: [] });
    expect(cfg.fusos.atualForaDaLista).toBeNull();
    expect(cfg.fusos.brasil[0].valor).toBe(SP);
  });
});

describe('logs', () => {
  it('salao.configuracoes_salvas só com o salaoId (nenhum valor de campo)', async () => {
    const s = await criarSalaoCompleto();
    const espiao = vi.spyOn(console, 'info').mockImplementation(() => {});
    await acoes.salvarConfiguracoes.executar(await credGestor(s), regras({ nome: 'Nome Secreto' }));
    const linhas = espiao.mock.calls.map((x) => String(x[0]));
    expect(linhas).toContain(JSON.stringify({ evento: 'salao.configuracoes_salvas', salaoId: s.salaoId }));
    expect(linhas.join('\n')).not.toContain('Nome Secreto');
  });
});
