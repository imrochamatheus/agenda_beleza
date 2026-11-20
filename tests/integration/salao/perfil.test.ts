import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { lerPerfilPublico, resolverSalaoPorSlug } from '@/server/repos/publico';
import * as acoes from '@/server/salao/perfil.acao';
import { obterPerfil, salvarPerfil } from '@/server/salao/perfil';
import { MENSAGENS_PERFIL as M } from '@/server/salao/perfil-tipos';
import { criarTenantContext } from '@/server/tenant/context';
import { metadadosDaAcao } from '@/server/tenant/define-acao';
import { AcessoNegado, NaoEncontrado } from '@/server/tenant/erros';

import { criarSuperAdmin } from '../../support/auth';
import { criarDoisSaloes, criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

import {
  ACESSO_NEGADO,
  NAO_AUTENTICADO,
  UUID_INEXISTENTE,
  credGestor,
  credProfissional,
  ctxDoGestor,
  ctxDoProfissional,
  linhaSalao,
  perfilCompleto,
} from './apoio-perfil';

// D-020 T-6: perfil público pela ação (acao.executar) contra PostgreSQL real com dois salões.
// CA-1, CA-2 (amostra e vários erros), CA-13, CA-14, CA-15 e logs sem dados pessoais (R-9).

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

const invalido = (erros: Record<string, string>) => ({ ok: true, dados: { resultado: 'invalido', erros } });

const NORMALIZADO = {
  descricao: 'Salão aconchegante.\nAtendemos com hora marcada.',
  endereco_logradouro: 'Av. Paulista',
  endereco_numero: 's/n',
  endereco_complemento: 'Sala 2',
  endereco_bairro: 'Bela Vista',
  endereco_cidade: 'São Paulo',
  endereco_uf: 'SP',
  endereco_cep: '01310100',
  telefone_e164: '+551134567890',
  whatsapp_e164: '+5511987654321',
  instagram: 'meu.salao',
  meios_pagamento: ['dinheiro', 'pix'],
  comodidades: ['wifi', 'acessibilidade'],
};

describe('CA-1: gravação, leitura pública e isolamento', () => {
  it('gestor de S1 grava o perfil normalizado; leitura pública de S1 o devolve; S2 continua vazio', async () => {
    const { a: s1, b: s2 } = await criarDoisSaloes();
    const s2Antes = await linhaSalao(c, s2.salaoId);
    const r = await acoes.salvarPerfilDoSalao.executar(await credGestor(s1), perfilCompleto());
    expect(r).toEqual({
      ok: true,
      dados: {
        resultado: 'salvo',
        valores: {
          descricao: NORMALIZADO.descricao,
          logradouro: 'Av. Paulista',
          numero: 's/n',
          complemento: 'Sala 2',
          bairro: 'Bela Vista',
          cidade: 'São Paulo',
          uf: 'SP',
          cep: '01310-100',
          telefone: '(11) 3456-7890',
          whatsapp: '(11) 98765-4321',
          instagram: 'meu.salao',
          meiosPagamento: ['dinheiro', 'pix'],
          comodidades: ['wifi', 'acessibilidade'],
        },
      },
    });
    expect(await linhaSalao(c, s1.salaoId)).toMatchObject(NORMALIZADO);
    const p1 = await lerPerfilPublico((await resolverSalaoPorSlug(s1.slugAtual)).contexto);
    expect(p1).toMatchObject({ descricao: NORMALIZADO.descricao, instagram: 'meu.salao', telefoneE164: '+551134567890', meiosPagamento: ['dinheiro', 'pix'] });
    expect(p1.endereco).toMatchObject({ cep: '01310100', uf: 'SP' });
    const p2 = await lerPerfilPublico((await resolverSalaoPorSlug(s2.slugAtual)).contexto);
    expect([p2.descricao, p2.endereco, p2.meiosPagamento]).toEqual([null, null, []]);
    expect(await linhaSalao(c, s2.salaoId)).toEqual(s2Antes);
  });

  it('profissional → AcessoNegado sem escrita; super admin 403; sem credencial 401', async () => {
    const antes = await linhaSalao(c, a.salaoId);
    expect(await acoes.salvarPerfilDoSalao.executar(await credProfissional(a), perfilCompleto())).toEqual(ACESSO_NEGADO);
    const admin = await criarSuperAdmin({ totpVerificado: true });
    expect(await acoes.salvarPerfilDoSalao.executar(admin.credencial, perfilCompleto())).toEqual(ACESSO_NEGADO);
    expect(await acoes.salvarPerfilDoSalao.executar(null, perfilCompleto())).toEqual(NAO_AUTENTICADO);
    expect(await linhaSalao(c, a.salaoId)).toEqual(antes);
    await expect(salvarPerfil(ctxDoProfissional(a), perfilCompleto())).rejects.toBeInstanceOf(AcessoNegado);
    await expect(obterPerfil(ctxDoProfissional(a))).rejects.toBeInstanceOf(AcessoNegado);
  });

  it('gestor de S2 com salaoId de S1 forjado → só S2 muda; S1 (linha e funcionamento) idêntico', async () => {
    const { a: s1, b: s2 } = await criarDoisSaloes();
    await c.query('UPDATE salao SET funcionamento_definido = true WHERE id = $1', [s1.salaoId]);
    await c.query('INSERT INTO salao_funcionamento (salao_id, dia_semana, inicio_min, fim_min) VALUES ($1, 1, 540, 600)', [s1.salaoId]);
    const s1Antes = await linhaSalao(c, s1.salaoId);
    const { rows: f1 } = await c.query('SELECT to_jsonb(f) j FROM salao_funcionamento f WHERE salao_id = $1', [s1.salaoId]);
    expect(await acoes.salvarPerfilDoSalao.executar(await credGestor(s2), perfilCompleto({ salaoId: s1.salaoId }))).toMatchObject({
      ok: true,
      dados: { resultado: 'salvo' },
    });
    expect(await linhaSalao(c, s1.salaoId)).toEqual(s1Antes);
    expect((await c.query('SELECT to_jsonb(f) j FROM salao_funcionamento f WHERE salao_id = $1', [s1.salaoId])).rows).toEqual(f1);
    expect((await linhaSalao(c, s2.salaoId)).instagram).toBe('meu.salao');
  });

  it('contexto de salão inexistente → NaoEncontrado', async () => {
    const fantasma = criarTenantContext({ usuarioId: a.gestor.usuarioId, papel: 'gestor', salaoId: UUID_INEXISTENTE, profissionalId: null });
    await expect(salvarPerfil(fantasma, perfilCompleto())).rejects.toBeInstanceOf(NaoEncontrado);
    await expect(obterPerfil(fantasma)).rejects.toBeInstanceOf(NaoEncontrado);
  });
});

describe('CA-2: recusas (amostra por campo) e vários erros juntos', () => {
  it.each([
    ['descricao', { descricao: 'a'.repeat(1001) }, { descricao: M.descricao }],
    ['uf', { uf: 'XX' }, { uf: M.uf }],
    ['cep', { cep: '00000-000' }, { cep: M.cep }],
    ['endereço incompleto', { logradouro: '', numero: '', bairro: '', uf: '', cep: '', complemento: '' }, {
      logradouro: M.enderecoObrigatorio,
      numero: M.enderecoObrigatorio,
      bairro: M.enderecoObrigatorio,
      uf: M.enderecoObrigatorio,
      cep: M.enderecoObrigatorio,
    }],
    ['meio de pagamento', { meiosPagamento: ['cheque'] }, { meiosPagamento: M.lista }],
    ['comodidade', { comodidades: ['sauna'] }, { comodidades: M.lista }],
    ['instagram', { instagram: 'instagram.com/p/abc' }, { instagram: M.instagram }],
    ['telefone', { telefone: '0800 123 4567' }, { telefone: M.telefone }],
    ['whatsapp', { whatsapp: '+1 212 555 0100' }, { whatsapp: M.telefone }],
  ])('%s → invalido, nada gravado', async (_n, sobrescritas, erros) => {
    const s = await criarSalaoCompleto();
    const antes = await linhaSalao(c, s.salaoId);
    expect(await acoes.salvarPerfilDoSalao.executar(await credGestor(s), perfilCompleto(sobrescritas))).toEqual(invalido(erros));
    expect(await linhaSalao(c, s.salaoId)).toEqual(antes);
  });

  it('aceitos: 1.000 caracteres, sp → SP, 01310100, @Meu.Salao, 11987654321', async () => {
    const s = await criarSalaoCompleto();
    const r = await acoes.salvarPerfilDoSalao.executar(
      await credGestor(s),
      perfilCompleto({ descricao: 'a'.repeat(1000), cep: '01310100', instagram: '@Meu.Salao', telefone: '11987654321' }),
    );
    expect(r).toMatchObject({ ok: true, dados: { resultado: 'salvo' } });
    expect(await linhaSalao(c, s.salaoId)).toMatchObject({ endereco_uf: 'SP', endereco_cep: '01310100', instagram: 'meu.salao', telefone_e164: '+5511987654321' });
    expect(((await linhaSalao(c, s.salaoId)).descricao as string).length).toBe(1000);
  });

  it('vários campos inválidos → todos os erros juntos, nada gravado', async () => {
    const s = await criarSalaoCompleto();
    const antes = await linhaSalao(c, s.salaoId);
    const r = await acoes.salvarPerfilDoSalao.executar(
      await credGestor(s),
      perfilCompleto({ uf: 'São Paulo', cep: '1234-567', instagram: 'pe..rfil', telefone: '(11) 88765-4321', comodidades: ['sauna'] }),
    );
    expect(r).toEqual(invalido({ uf: M.uf, cep: M.cep, instagram: M.instagram, telefone: M.telefone, comodidades: M.lista }));
    expect(await linhaSalao(c, s.salaoId)).toEqual(antes);
  });

  it('entrada que não é objeto → formulario', async () => {
    expect(await acoes.salvarPerfilDoSalao.executar(await credGestor(a), 'x' as never)).toEqual(invalido({ formulario: M.formulario }));
  });
});

describe('CA-14 e CA-15', () => {
  it('apagar tudo → NULL e listas vazias; só espaços → NULL; nome/fuso/regras intactos', async () => {
    const s = await criarSalaoCompleto();
    const cred = await credGestor(s);
    await acoes.salvarPerfilDoSalao.executar(cred, perfilCompleto());
    const antes = await linhaSalao(c, s.salaoId);
    const vazio = { descricao: '   ', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '', cep: '', telefone: '', whatsapp: '', instagram: '', meiosPagamento: [], comodidades: [] };
    expect(await acoes.salvarPerfilDoSalao.executar(cred, vazio)).toMatchObject({ ok: true, dados: { resultado: 'salvo' } });
    const l = await linhaSalao(c, s.salaoId);
    for (const coluna of Object.keys(NORMALIZADO)) {
      expect(l[coluna], coluna).toEqual(coluna === 'meios_pagamento' || coluna === 'comodidades' ? [] : null);
    }
    for (const coluna of ['nome', 'fuso', 'grade_min', 'antecedencia_min', 'janela_dias', 'intervalo_min', 'funcionamento_definido']) {
      expect(l[coluna], coluna).toEqual(antes[coluna]);
    }
    expect((await lerPerfilPublico((await resolverSalaoPorSlug(s.slugAtual)).contexto)).endereco).toBeNull();
  });

  it('[pix, dinheiro, pix] → {dinheiro,pix}; chave gravada direto (cheque) é ignorada na leitura e removida na próxima gravação', async () => {
    const s = await criarSalaoCompleto();
    const cred = await credGestor(s);
    await acoes.salvarPerfilDoSalao.executar(cred, { meiosPagamento: ['pix', 'dinheiro', 'pix'] });
    const { rows } = await c.query<{ m: string }>('SELECT meios_pagamento::text AS m FROM salao WHERE id = $1', [s.salaoId]);
    expect(rows[0].m).toBe('{dinheiro,pix}');
    await c.query(`UPDATE salao SET meios_pagamento = array_append(meios_pagamento, 'cheque') WHERE id = $1`, [s.salaoId]);
    expect((await obterPerfil(ctxDoGestor(s))).valores.meiosPagamento).toEqual(['dinheiro', 'pix']);
    expect((await lerPerfilPublico((await resolverSalaoPorSlug(s.slugAtual)).contexto)).meiosPagamento).toEqual(['dinheiro', 'pix']);
    const { valores } = await obterPerfil(ctxDoGestor(s));
    await acoes.salvarPerfilDoSalao.executar(cred, valores);
    expect((await linhaSalao(c, s.salaoId)).meios_pagamento).toEqual(['dinheiro', 'pix']);
  });

  it('obterPerfil devolve os valores formatados para o formulário', async () => {
    const s = await criarSalaoCompleto();
    await acoes.salvarPerfilDoSalao.executar(await credGestor(s), perfilCompleto());
    expect((await obterPerfil(ctxDoGestor(s))).valores).toMatchObject({ cep: '01310-100', telefone: '(11) 3456-7890', whatsapp: '(11) 98765-4321', uf: 'SP' });
  });
});

describe('CA-13: ações e permissões', () => {
  it('a ação declara papeis [gestor] e capacidade configurar', () => {
    expect(Object.keys(acoes)).toEqual(['salvarPerfilDoSalao']);
    expect(metadadosDaAcao(acoes.salvarPerfilDoSalao)).toEqual({ papeis: ['gestor'], capacidade: 'configurar' });
  });

  it('gestor com e sem perfil de profissional pode gravar', async () => {
    const semPerfil = await criarSalaoCompleto({ gestor: { comPerfil: false } });
    for (const s of [a, semPerfil]) {
      expect(await acoes.salvarPerfilDoSalao.executar(await credGestor(s), perfilCompleto())).toMatchObject({ ok: true, dados: { resultado: 'salvo' } });
    }
  });
});

describe('logs (R-9)', () => {
  it('salao.perfil_salvo só com o salaoId; telefone, CEP e descrição nunca aparecem', async () => {
    const s = await criarSalaoCompleto();
    const espiao = vi.spyOn(console, 'info').mockImplementation(() => {});
    await acoes.salvarPerfilDoSalao.executar(await credGestor(s), perfilCompleto());
    const linhas = espiao.mock.calls.map((x) => String(x[0]));
    expect(linhas).toContain(JSON.stringify({ evento: 'salao.perfil_salvo', salaoId: s.salaoId }));
    const tudo = linhas.join('\n');
    for (const sensivel of ['3456', '98765', '01310', 'aconchegante', 'Paulista']) expect(tudo).not.toContain(sensivel);
  });
});
