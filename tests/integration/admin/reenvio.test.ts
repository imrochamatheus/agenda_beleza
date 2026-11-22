import type pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { reenviarMensagemAdmin } from '@/server/admin/mensagens';
import { reenviarMensagemAcao } from '@/server/admin/mensagens.acao';
import { obterPrisma } from '@/server/repos/db';
import { NaoEncontrado } from '@/server/tenant/erros';
import type { CredenciaisAdmin } from '@/server/tenant/define-acao-admin';

import { adminDeTeste } from '../../support/admin-saloes';
import type { AdminDeTeste } from '../../support/admin-saloes';
import { contarAuditoria, linhasDeAuditoria } from '../../support/auditoria';
import { credencialDoGestor, credencialDoProfissional, criarSuperAdmin } from '../../support/auth';
import {
  anonimizarCliente,
  chamadasDaChave,
  criarCenarioMensagem,
  criarMensagem,
  lerMensagem,
  lerTentativas,
  mudarReserva,
} from '../../support/mensagens';
import { criarSalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';
import { criarPipeline, esperarMensagem, limparFalhasForcadas } from '../mensagens/apoio';
import type { Pipeline } from '../mensagens/apoio';

// D-045 CA-2, CA-3, CA-6 (ação), RN-5..RN-8: reenvio manual pelo super admin, com worker pg-boss real e
// WhatsApp simulado. A auditoria é gravada na MESMA transação que a volta a `pendente`.
let p: Pipeline;
let c: pg.Client;
let adm: AdminDeTeste;
beforeAll(async () => {
  p = await criarPipeline();
  c = await conectar();
  adm = await adminDeTeste();
}, 60_000);
afterAll(async () => {
  await p?.encerrar();
  await c?.end();
});
afterEach(limparFalhasForcadas);

const reenviar = (id: string) => reenviarMensagemAdmin(adm.ctx, id, new Date(), { enfileirar: p.enfileirar });
const auditoriaDe = (id: string) => linhasDeAuditoria(c, `acao = 'mensagem.reenviar' AND entidade_id = $1`, [id]);

async function falhou(o: Parameters<typeof criarCenarioMensagem>[0] = {}) {
  const s = await criarCenarioMensagem(o);
  const id = await criarMensagem({
    salaoId: s.salaoId,
    reservaId: s.reservaId,
    estado: 'falhou',
    erroCodigo: 'resultado_incerto',
    destinatarioE164: s.telefone,
    tentativas: [{ resultado: 'falha', erroCodigo: 'resultado_incerto' }],
  });
  return { s, id };
}

describe('CA-2: falhou → reenviada → enviada, auditada', () => {
  it('worker processa: enviada, UMA chamada ao adaptador, 1 auditoria com salão, antes e depois', async () => {
    const { s, id } = await falhou();
    const chave = `${s.reservaId}:confirmacao:0`;
    const r = await reenviar(id);
    expect(r).toEqual({ resultado: 'reenfileirada', mensagemId: id, filaIndisponivel: false });
    await esperarMensagem(id, 'enviada');
    expect(await chamadasDaChave(chave)).toHaveLength(1);
    expect((await lerTentativas(id)).map((t) => [t.numero, t.resultado])).toEqual([[1, 'falha'], [2, 'sucesso']]);

    const aud = await auditoriaDe(id);
    expect(aud).toHaveLength(1);
    expect(aud[0]).toMatchObject({
      ator_id: adm.usuarioId,
      acao: 'mensagem.reenviar',
      entidade: 'mensagem',
      entidade_id: id,
      salao_id: s.salaoId,
      resultado: 'sucesso',
      antes: { estado: 'falhou' },
      depois: { estado: 'pendente', tipo: 'confirmacao', revisao: 0 },
    });
    const texto = JSON.stringify(aud[0].depois) + JSON.stringify(aud[0].antes);
    expect(texto).not.toContain(s.telefone);
  }, 40_000);

  it('falha forçada na auditoria desfaz a volta a pendente: continua falhou, sem job e sem linha', async () => {
    const { id } = await falhou();
    const jobs = p.jobs.length;
    await expect(
      reenviarMensagemAdmin(adm.ctx, id, new Date(), {
        enfileirar: p.enfileirar,
        auditar: async () => {
          throw new Error('auditoria indisponível');
        },
      }),
    ).rejects.toThrow('auditoria indisponível');
    const m = await lerMensagem(id);
    expect(m.estado).toBe('falhou');
    expect(m.erroCodigo).toBe('resultado_incerto');
    expect(p.jobs.length).toBe(jobs);
    expect(await auditoriaDe(id)).toHaveLength(0);
  });

  it('fila fora: a linha fica pendente, a auditoria existe e o resultado avisa (reconciliação recupera)', async () => {
    const { id } = await falhou();
    const linhas: string[] = [];
    const r = await reenviarMensagemAdmin(adm.ctx, id, new Date(), {
      enfileirar: async () => {
        throw new Error('fila fora');
      },
      log: (l) => linhas.push(l),
    });
    expect(r).toEqual({ resultado: 'reenfileirada', mensagemId: id, filaIndisponivel: true });
    expect((await lerMensagem(id)).estado).toBe('pendente');
    expect(await auditoriaDe(id)).toHaveLength(1);
    expect(JSON.parse(linhas[0])).toMatchObject({ evento: 'mensagem.fila_indisponivel', mensagemId: id });
  });

  it('salão suspenso manualmente: o reenvio vale (RN-8)', async () => {
    const { s, id } = await falhou();
    await obterPrisma().salao.update({ where: { id: s.salaoId }, data: { suspensoManualEm: new Date() } });
    expect((await reenviar(id)).resultado).toBe('reenfileirada');
    await esperarMensagem(id, 'enviada');
  }, 40_000);
});

describe('CA-3: o que nunca é reenviado', () => {
  it.each(['enviada', 'nao_enviada', 'substituida', 'pendente', 'enviando', 'cancelada_anonimizacao'] as const)(
    '%s → recusada/nao_falhou: estado igual, sem job, sem chamada, sem auditoria',
    async (estado) => {
      const s = await criarCenarioMensagem();
      const id = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, estado });
      const jobs = p.jobs.length;
      const aud = await contarAuditoria(c);
      expect(await reenviar(id)).toEqual({ resultado: 'recusada', motivo: 'nao_falhou' });
      expect((await lerMensagem(id)).estado).toBe(estado);
      expect(p.jobs.length).toBe(jobs);
      expect(await chamadasDaChave(`${s.reservaId}:confirmacao:0`)).toEqual([]);
      expect(await contarAuditoria(c)).toBe(aud);
    },
  );

  it('POST direto (a ação) em mensagem enviada: ok:true com recusada, sem mudar nada', async () => {
    const s = await criarCenarioMensagem();
    const id = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, estado: 'enviada' });
    const aud = await contarAuditoria(c);
    const r = await reenviarMensagemAcao.executar(adm.cred, { mensagemId: id });
    expect(r).toEqual({ ok: true, dados: { resultado: 'recusada', motivo: 'nao_falhou' } });
    expect((await lerMensagem(id)).estado).toBe('enviada');
    expect(await contarAuditoria(c)).toBe(aud);
  });

  it('revisão superada → recusada/obsoleta: continua falhou e NÃO audita', async () => {
    const s = await criarCenarioMensagem({ revisao: 0 });
    const id = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, estado: 'falhou' });
    await mudarReserva(s.reservaId, { revisao: 1 });
    expect(await reenviar(id)).toEqual({ resultado: 'recusada', motivo: 'obsoleta' });
    expect((await lerMensagem(id)).estado).toBe('falhou');
    expect(await auditoriaDe(id)).toHaveLength(0);
  });

  it('cliente anonimizada: a linha vira cancelada_anonimizacao e a mudança é auditada (RN-7)', async () => {
    const s = await criarCenarioMensagem();
    const id = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, estado: 'falhou', destinatarioE164: s.telefone });
    await anonimizarCliente(s.clienteId);
    const jobs = p.jobs.length;
    expect(await reenviar(id)).toEqual({ resultado: 'recusada', motivo: 'cliente_anonimizada' });
    expect((await lerMensagem(id)).estado).toBe('cancelada_anonimizacao');
    expect(p.jobs.length).toBe(jobs);
    const aud = await auditoriaDe(id);
    expect(aud).toHaveLength(1);
    expect(aud[0]).toMatchObject({ salao_id: s.salaoId, antes: { estado: 'falhou' }, depois: { estado: 'cancelada_anonimizacao' } });
  });
});

describe('RN-5: id de mensagem', () => {
  it('malformado e inexistente são NaoEncontrado, iguais, sem tocar nada', async () => {
    const aud = await contarAuditoria(c);
    for (const id of ['abc', '', "' OR 1=1", '00000000-0000-4000-8000-000000000000', 42, null]) {
      await expect(reenviarMensagemAdmin(adm.ctx, id, new Date())).rejects.toBeInstanceOf(NaoEncontrado);
    }
    expect(await contarAuditoria(c)).toBe(aud);
  });

  it('o salão do contexto vem da linha: com duas mensagens, a auditoria aponta o salão de cada uma', async () => {
    const a = await falhou();
    const b = await falhou();
    await reenviar(b.id);
    expect((await auditoriaDe(b.id))[0].salao_id).toBe(b.s.salaoId);
    expect(await auditoriaDe(a.id)).toHaveLength(0);
    expect((await lerMensagem(a.id)).estado).toBe('falhou');
  });
});

describe('CA-6: sessões na ação (401/403)', () => {
  it('sem sessão 401; gestor, profissional e admin sem TOTP 403; a mensagem não é tocada', async () => {
    const { id } = await falhou();
    const s = await criarSalaoCompleto();
    const semTotp = (await criarSuperAdmin({ totpVerificado: false })).credencial;
    const gestor = await credencialDoGestor(s);
    const prof = await credencialDoProfissional(s);
    const aud = await contarAuditoria(c);
    const nao: CredenciaisAdmin[] = [
      { admin: null, salao: null },
      { admin: { token: 'desconhecido' }, salao: null },
    ];
    for (const cred of nao) expect(await reenviarMensagemAcao.executar(cred, { mensagemId: id })).toEqual({ ok: false, erro: 'nao_autenticado', status: 401 });
    const negado: CredenciaisAdmin[] = [{ admin: null, salao: gestor }, { admin: null, salao: prof }, { admin: gestor, salao: gestor }, { admin: semTotp, salao: null }];
    for (const cred of negado) expect(await reenviarMensagemAcao.executar(cred, { mensagemId: id })).toEqual({ ok: false, erro: 'acesso_negado', status: 403 });
    expect((await lerMensagem(id)).estado).toBe('falhou');
    expect(await contarAuditoria(c)).toBe(aud);
  });

  it('id malformado na ação → 404 (não_encontrado), não 500', async () => {
    expect(await reenviarMensagemAcao.executar(adm.cred, { mensagemId: 'xx' })).toEqual({ ok: false, erro: 'nao_encontrado', status: 404 });
  });
});
