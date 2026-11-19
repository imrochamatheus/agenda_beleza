import { beforeAll, describe, expect, it } from 'vitest';

import { obterPrisma } from '@/server/repos/db';
import {
  listarProfissionaisPublicos,
  listarServicosPublicos,
  resolverSalaoPorSlug,
} from '@/server/repos/publico';
import { NaoEncontrado, respostaDeErro } from '@/server/tenant/erros';

import { criarDoisSaloes } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { slugNovo } from '../../support/sql';

// CA-12 (RN-3, RN-16): leituras públicas pelo slug. Só serviços e profissionais ATIVOS do salão, com
// campos públicos; slug inexistente → 404; slug histórico resolve o mesmo salão e informa o atual.

let a: SalaoCompleto;
let b: SalaoCompleto;

beforeAll(async () => {
  ({ a, b } = await criarDoisSaloes());
});

/** Valores que a página pública nunca expõe: e-mails, usuários, clientes e reservas. */
function privados(s: SalaoCompleto): string[] {
  return [
    s.gestor.email,
    s.gestor.usuarioId,
    s.profissional.email,
    s.profissional.usuarioId,
    s.clientes.ativaId,
    s.clientes.anonimizadaId,
    s.clientes.nomeAtiva,
    s.clientes.telefoneAtiva,
    s.reserva.id,
  ];
}

describe('CA-12: leituras públicas por slug', () => {
  it('CA-12: o slug atual de A resolve o PublicoContext de A', async () => {
    const r = await resolverSalaoPorSlug(a.slugAtual);
    expect(r.historico).toBe(false);
    expect(r.slugAtual).toBe(a.slugAtual);
    expect({ ...r.contexto }).toEqual({ tipo: 'publico', salaoId: a.salaoId, slugAtual: a.slugAtual });
  });

  it('CA-12: serviços públicos: só os ativos de A, com id, nome, preço e duração', async () => {
    const { contexto } = await resolverSalaoPorSlug(a.slugAtual);
    const servicos = await listarServicosPublicos(contexto);
    expect(new Set(servicos.map((x) => x.id))).toEqual(new Set(a.servicos.ativos));
    for (const x of servicos) {
      expect(Object.keys(x).sort()).toEqual(['duracaoMin', 'id', 'nome', 'precoCentavos']);
    }
    expect(servicos.map((x) => x.id)).not.toContain(a.servicos.inativoId);
    const json = JSON.stringify(servicos);
    for (const v of [...privados(a), ...b.servicos.ativos, b.salaoId]) {
      expect(json).not.toContain(v);
    }
  });

  it('CA-12: profissionais públicos: só os ativos de A, com id e nome (sem email nem usuario_id)', async () => {
    const { contexto } = await resolverSalaoPorSlug(a.slugAtual);
    const profissionais = await listarProfissionaisPublicos(contexto);
    expect(new Set(profissionais.map((p) => p.id))).toEqual(
      new Set([a.gestor.profissionalId, a.profissional.profissionalId]),
    );
    for (const p of profissionais) {
      expect(Object.keys(p).sort()).toEqual(['id', 'nome']);
    }
    expect(profissionais.map((p) => p.id)).not.toContain(a.profissionalInativoId);
    const json = JSON.stringify(profissionais);
    for (const v of [...privados(a), b.profissional.profissionalId, b.gestor.profissionalId as string]) {
      expect(json).not.toContain(v);
    }
  });

  it('CA-12: o slug de B lista só os de B (isolamento das leituras públicas)', async () => {
    const { contexto } = await resolverSalaoPorSlug(b.slugAtual);
    expect(new Set((await listarServicosPublicos(contexto)).map((x) => x.id))).toEqual(new Set(b.servicos.ativos));
    expect(new Set((await listarProfissionaisPublicos(contexto)).map((x) => x.id))).toEqual(
      new Set([b.gestor.profissionalId, b.profissional.profissionalId]),
    );
  });

  it('CA-12: slug histórico de A resolve o mesmo salão e informa o slug atual', async () => {
    const r = await resolverSalaoPorSlug(a.slugHistorico);
    expect(r.historico).toBe(true);
    expect(r.slugAtual).toBe(a.slugAtual);
    expect({ ...r.contexto }).toEqual({ tipo: 'publico', salaoId: a.salaoId, slugAtual: a.slugAtual });
  });

  it('CA-12: slug inexistente, com maiúsculas, com espaço ou vazio → NaoEncontrado/404', async () => {
    for (const slug of [slugNovo(), a.slugAtual.toUpperCase(), ` ${a.slugAtual}`, '']) {
      const e = await resolverSalaoPorSlug(slug).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(NaoEncontrado);
      expect(respostaDeErro(e as NaoEncontrado)).toEqual({ status: 404, corpo: { erro: 'nao_encontrado' } });
    }
  });

  it('CA-12: salão só com slug histórico (sem slug atual) → NaoEncontrado', async () => {
    const db = obterPrisma();
    const salao = await db.salao.create({ data: { nome: 'Salão sem slug atual' }, select: { id: true } });
    const slug = slugNovo();
    await db.salaoSlug.create({ data: { slug, salaoId: salao.id, atual: false } });
    await expect(resolverSalaoPorSlug(slug)).rejects.toBeInstanceOf(NaoEncontrado);
  });
});
