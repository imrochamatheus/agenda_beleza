import { randomUUID } from 'node:crypto';

import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { estenderTeste } from '@/server/admin/saloes';
import { MENSAGENS_ADMIN_SALOES } from '@/server/admin/saloes-tipos';
import { criarMercadoPagoReal } from '@/server/integrations/mercadopago/real';
import { encerrarPrisma, obterPrisma } from '@/server/repos/db';
import { NaoEncontrado } from '@/server/tenant/erros';

import { espiar, nuncaChamada } from '../assinatura/apoio-cancelar';
import { DEPS, DIA_MS, adminDeTeste, assinaturaNoBanco, mp, salaoComAssinatura, salaoEmTeste } from '../../support/admin-saloes';
import type { AdminDeTeste } from '../../support/admin-saloes';
import { linhasDeAuditoria } from '../../support/auditoria';
import { conectar } from '../../support/sql';

// D-044 CA-4 a CA-7: estender o teste gratuito (provedor FORA da transação, comparação otimista, falha auditada).
let c: pg.Client;
let adm: AdminDeTeste;

beforeAll(async () => {
  c = await conectar();
  adm = await adminDeTeste();
});
afterAll(async () => {
  await c.end();
  await encerrarPrisma();
});

const auditoriaDo = (salaoId: string) => linhasDeAuditoria(c, `salao_id = $1 AND acao = 'salao.estender_teste'`, [salaoId]);
const iso = (d: Date) => d.toISOString();
const confirmar = (salaoId: string, dias: unknown, esperado: Date | null, deps = DEPS) =>
  estenderTeste(adm.ctx, { salaoId, dias, testeFimEmEsperado: esperado === null ? undefined : iso(esperado), etapa: 'confirmar' }, new Date(), deps);

describe('CA-4: estender com sucesso', () => {
  it('grava D+N, o simulado recebe a nova data e a auditoria guarda D e D+N', async () => {
    const s = await salaoEmTeste();
    const D = s.fim!;
    const r = await confirmar(s.salaoId, '10', D);
    expect(r).toEqual({ resultado: 'estendido', de: iso(D), para: iso(new Date(D.getTime() + 10 * DIA_MS)), dias: 10 });
    const a = await assinaturaNoBanco(s.assinaturaId);
    expect(a.testeFimEm).toEqual(new Date(D.getTime() + 10 * DIA_MS));
    expect(a.estado).toBe('em_teste');
    const adiamentos = await mp.listarAdiamentos(s.simId!);
    expect(adiamentos).toHaveLength(1);
    expect(adiamentos[0].novaData).toEqual(new Date(D.getTime() + 10 * DIA_MS));
    const aud = await auditoriaDo(s.salaoId);
    expect(aud).toHaveLength(1);
    expect(aud[0]).toMatchObject({
      resultado: 'sucesso', entidade: 'assinatura', entidade_id: s.assinaturaId, ator_id: adm.usuarioId,
      antes: { teste_fim_em: iso(D) }, depois: { teste_fim_em: iso(new Date(D.getTime() + 10 * DIA_MS)), dias: 10 },
    });
    expect(await obterPrisma().assinaturaTransicao.count({ where: { assinaturaId: s.assinaturaId } })).toBe(0);
  });

  it('a etapa previa mostra D → D+N sem chamar o provedor, sem gravar e sem auditar', async () => {
    const s = await salaoEmTeste();
    const espiao = espiar();
    const r = await estenderTeste(adm.ctx, { salaoId: s.salaoId, dias: ' 7 ', etapa: 'previa' }, new Date(), { ...DEPS, mp: espiao });
    expect(r).toEqual({ resultado: 'previa', de: iso(s.fim!), para: iso(new Date(s.fim!.getTime() + 7 * DIA_MS)), dias: 7 });
    expect(espiao.chamadas).toEqual([]);
    expect((await assinaturaNoBanco(s.assinaturaId)).testeFimEm).toEqual(s.fim);
    expect(await auditoriaDo(s.salaoId)).toHaveLength(0);
  });

  it('repetir o MESMO envio depois do sucesso dá mudou, sem chamar o provedor e sem nova auditoria', async () => {
    const s = await salaoEmTeste();
    const D = s.fim!;
    expect((await confirmar(s.salaoId, '5', D)).resultado).toBe('estendido');
    const espiao = espiar();
    const r = await confirmar(s.salaoId, '5', D, { ...DEPS, mp: espiao });
    expect(r).toEqual({ resultado: 'mudou', novoFim: iso(new Date(D.getTime() + 5 * DIA_MS)) });
    expect(espiao.chamadas).toEqual([]);
    expect(await auditoriaDo(s.salaoId)).toHaveLength(1);
  });

  it('salão suspenso manualmente também pode ter o teste estendido', async () => {
    const s = await salaoEmTeste();
    await obterPrisma().salao.update({ where: { id: s.salaoId }, data: { suspensoManualEm: new Date() } });
    expect((await confirmar(s.salaoId, '1', s.fim)).resultado).toBe('estendido');
  });

  it('o limite de 90 dias passa; atravessar o horário de verão é aritmética de 24 h em UTC', async () => {
    const s = await salaoEmTeste({ fim: new Date(Date.now() + 40 * DIA_MS) });
    const r = await confirmar(s.salaoId, '90', s.fim);
    expect(r).toMatchObject({ resultado: 'estendido', dias: 90 });
    expect((await assinaturaNoBanco(s.assinaturaId)).testeFimEm!.getTime() - s.fim!.getTime()).toBe(90 * DIA_MS);
  });
});

describe('CA-5: recusas com motivo próprio, sem chamar o provedor', () => {
  const casos: [string, () => Promise<{ salaoId: string }>, string][] = [
    ['ativa', () => salaoEmTeste({ estado: 'ativa', fim: null }), 'estado'],
    ['pendente', () => salaoEmTeste({ estado: 'pendente', fim: null }), 'estado'],
    ['em_carencia', () => salaoEmTeste({ estado: 'em_carencia', fim: null }), 'estado'],
    ['suspensa', () => salaoEmTeste({ estado: 'suspensa', fim: null }), 'estado'],
    ['cancelada', () => salaoEmTeste({ estado: 'cancelada', fim: null }), 'estado'],
    ['sem assinatura', () => salaoComAssinatura(null), 'sem_assinatura'],
    ['só encerrada', () => salaoComAssinatura('encerrada'), 'sem_assinatura'],
    ['sem vínculo com o provedor', () => salaoEmTeste({ semVinculo: true }), 'sem_provedor'],
    ['teste já terminou', () => salaoEmTeste({ fim: new Date(Date.now() - 60_000) }), 'teste_encerrado'],
    ['teste sem data de fim', () => salaoEmTeste({ fim: null }), 'teste_encerrado'],
    ['termina em menos de 5 minutos', () => salaoEmTeste({ fim: new Date(Date.now() + 4 * 60_000) }), 'teste_expirando'],
  ];
  it.each(casos)('%s', async (_nome, criar, motivo) => {
    const s = await criar();
    const antes = (await obterPrisma().assinatura.findMany({ where: { salaoId: s.salaoId } })).map((a) => ({ ...a }));
    for (const etapa of ['previa', 'confirmar']) {
      const r = await estenderTeste(adm.ctx, { salaoId: s.salaoId, dias: '10', testeFimEmEsperado: new Date().toISOString(), etapa }, new Date(), { ...DEPS, mp: nuncaChamada });
      expect(r).toEqual({ resultado: 'recusado', motivo });
    }
    expect(await obterPrisma().assinatura.findMany({ where: { salaoId: s.salaoId } })).toEqual(antes);
    expect(await auditoriaDo(s.salaoId)).toHaveLength(0);
  });

  it('exatamente 5 minutos de folga ainda pode estender', async () => {
    const agora = new Date();
    const s = await salaoEmTeste({ fim: new Date(agora.getTime() + 5 * 60_000 + 1000) });
    const r = await estenderTeste(adm.ctx, { salaoId: s.salaoId, dias: '1', testeFimEmEsperado: iso(s.fim!), etapa: 'confirmar' }, agora, DEPS);
    expect(r.resultado).toBe('estendido');
  });
});

describe('CA-6: N inválido é erro de campo sem chamar o provedor', () => {
  it.each(['1e1', '+5', '0', '-1', '', ' ', '91', '5.0', '5,5', '1 0', 'abc', undefined, null, 5, '००५'])('recusa %j', async (dias) => {
    const s = await salaoEmTeste();
    for (const etapa of ['previa', 'confirmar']) {
      const r = await estenderTeste(adm.ctx, { salaoId: s.salaoId, dias, testeFimEmEsperado: iso(s.fim!), etapa }, new Date(), { ...DEPS, mp: nuncaChamada });
      expect(r).toEqual({ resultado: 'invalido', erros: { dias: MENSAGENS_ADMIN_SALOES.dias } });
    }
    expect((await assinaturaNoBanco(s.assinaturaId)).testeFimEm).toEqual(s.fim);
    expect(await auditoriaDo(s.salaoId)).toHaveLength(0);
  });

  it('confirmar sem o D esperado ou com data ilegível é inválido, sem chamar o provedor', async () => {
    const s = await salaoEmTeste();
    for (const esperado of [undefined, '', 'ontem', 12345, null]) {
      const r = await estenderTeste(adm.ctx, { salaoId: s.salaoId, dias: '3', testeFimEmEsperado: esperado, etapa: 'confirmar' }, new Date(), { ...DEPS, mp: nuncaChamada });
      expect(r.resultado).toBe('invalido');
    }
  });
});

describe('CA-7: o provedor falha', () => {
  it('erro forçado do simulado: nada muda, resposta explícita e a auditoria de falha persiste', async () => {
    const s = await salaoEmTeste();
    await mp.forcarErro('adiarProximaCobranca');
    const r = await confirmar(s.salaoId, '10', s.fim);
    expect(r).toEqual({ resultado: 'provedor_falhou' });
    expect((await assinaturaNoBanco(s.assinaturaId)).testeFimEm).toEqual(s.fim);
    expect(await mp.listarAdiamentos(s.simId!)).toHaveLength(0);
    const aud = await auditoriaDo(s.salaoId);
    expect(aud).toHaveLength(1);
    expect(aud[0]).toMatchObject({ resultado: 'falha', entidade: 'assinatura', entidade_id: s.assinaturaId, ator_id: adm.usuarioId });
    expect(aud[0].depois).toMatchObject({ teste_fim_em_lido: iso(s.fim!), dias: 10, codigo: expect.any(String) });
    // Só o código: nunca a mensagem do provedor.
    expect(JSON.stringify(aud[0].depois)).not.toMatch(/forçad|forcad|Error/i);
    // Depois da falha, tentar de novo funciona.
    expect((await confirmar(s.salaoId, '10', s.fim)).resultado).toBe('estendido');
  });

  it('adaptador real (NaoImplementado até a E6.6): nada muda e a falha é auditada com o código', async () => {
    const s = await salaoEmTeste();
    const r = await confirmar(s.salaoId, '10', s.fim, { ...DEPS, mp: criarMercadoPagoReal() });
    expect(r).toEqual({ resultado: 'provedor_falhou' });
    expect((await assinaturaNoBanco(s.assinaturaId)).testeFimEm).toEqual(s.fim);
    const aud = await auditoriaDo(s.salaoId);
    expect(aud).toHaveLength(1);
    expect(aud[0]).toMatchObject({ resultado: 'falha', depois: { codigo: 'nao_implementado', dias: 10 } });
  });
});

describe('corrida depois do provedor', () => {
  it('o estado local mudou (ex.: job prazo ou webhook): nada é gravado, divergência auditada como falha', async () => {
    const s = await salaoEmTeste();
    const r = await confirmar(s.salaoId, '10', s.fim, {
      ...DEPS,
      aposProvedor: async () => {
        await obterPrisma().assinatura.update({ where: { id: s.assinaturaId }, data: { estado: 'em_carencia' } });
      },
    });
    expect(r).toEqual({ resultado: 'divergencia' });
    const a = await assinaturaNoBanco(s.assinaturaId);
    expect(a).toMatchObject({ estado: 'em_carencia', testeFimEm: s.fim });
    expect(await mp.listarAdiamentos(s.simId!)).toHaveLength(1);
    const aud = await auditoriaDo(s.salaoId);
    expect(aud).toHaveLength(1);
    expect(aud[0]).toMatchObject({ resultado: 'falha', depois: { motivo: 'estado_mudou' } });
  });

  it('outra extensão ganhou: mudou com o fim novo, uma só extensão gravada', async () => {
    const s = await salaoEmTeste();
    const outro = new Date(s.fim!.getTime() + 3 * DIA_MS);
    const r = await confirmar(s.salaoId, '10', s.fim, {
      ...DEPS,
      aposProvedor: async () => {
        await obterPrisma().assinatura.update({ where: { id: s.assinaturaId }, data: { testeFimEm: outro } });
      },
    });
    expect(r).toEqual({ resultado: 'mudou', novoFim: iso(outro) });
    expect((await assinaturaNoBanco(s.assinaturaId)).testeFimEm).toEqual(outro);
    const aud = await auditoriaDo(s.salaoId);
    expect(aud).toHaveLength(1);
    expect(aud[0].resultado).toBe('falha');
  });
});

describe('CA-10/CA-13: escopo', () => {
  it('salão inexistente ou id malformado: NaoEncontrado, mesmo com N inválido', async () => {
    for (const salaoId of ['x', '', undefined, 7, randomUUID()]) {
      await expect(estenderTeste(adm.ctx, { salaoId, dias: '1', etapa: 'previa' }, new Date(), { ...DEPS, mp: nuncaChamada })).rejects.toBeInstanceOf(NaoEncontrado);
      await expect(estenderTeste(adm.ctx, { salaoId, dias: 'x', etapa: 'confirmar' }, new Date(), { ...DEPS, mp: nuncaChamada })).rejects.toBeInstanceOf(NaoEncontrado);
    }
  });

  it('estender um salão não toca a assinatura de outro', async () => {
    const a = await salaoEmTeste();
    const b = await salaoEmTeste();
    await confirmar(a.salaoId, '2', a.fim);
    expect((await assinaturaNoBanco(b.assinaturaId)).testeFimEm).toEqual(b.fim);
    expect(await mp.listarAdiamentos(b.simId!)).toHaveLength(0);
    expect(await auditoriaDo(b.salaoId)).toHaveLength(0);
  });
});
