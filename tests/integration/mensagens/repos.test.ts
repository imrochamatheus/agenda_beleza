import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { conferirVigencia, decidirElegibilidade } from '@/server/mensagens/elegibilidade';
import { repos } from '@/server/repos';
import { criarRepoMensagemSistema } from '@/server/repos/mensagem-sistema';
import type { ContextoDeEnvio, DecisaoDeEnvio } from '@/server/repos/tipos';
import { emTransacao } from '@/server/repos/transacao';
import { contextoDeSistema } from '@/server/tenant/context';

import {
  anonimizarCliente,
  criarCenarioMensagem,
  criarMensagem,
  lerMensagem,
  lerTentativas,
  mudarReserva,
} from '../../support/mensagens';
import { conectar } from '../../support/sql';

import { itensDa } from './apoio';

// D-024 T-3: repositórios de mensagem (tenant e sistema) contra o PostgreSQL real.

const AGORA = new Date('2026-11-21T12:00:00Z');
const ctxDe = (salaoId: string) => contextoDeSistema(salaoId, 'teste');
const sistema = criarRepoMensagemSistema();
const sempreEnviar = (): DecisaoDeEnvio => ({ acao: 'enviar' });

let c: pg.Client;
beforeAll(async () => {
  c = await conectar();
});
afterAll(async () => {
  await c.end();
});

describe('contextoDeRegistro', () => {
  it('lê revisão, status, cliente e consentimentos por finalidade', async () => {
    const s = await criarCenarioMensagem({ revisao: 2, consentimentoConvite: true });
    const r = await repos().mensagens.contextoDeRegistro(ctxDe(s.salaoId), s.reservaId);
    expect(r).toEqual({
      reservaRevisao: 2,
      reservaStatus: 'confirmado',
      clienteAnonimizada: false,
      telefone: s.telefone,
      consentimentoMensagens: true,
      consentimentoConvite: true,
    });
  });

  it('sem consentimento e cliente anonimizada', async () => {
    const s = await criarCenarioMensagem({ consentimentoMensagens: false, anonimizada: true });
    const r = await repos().mensagens.contextoDeRegistro(ctxDe(s.salaoId), s.reservaId);
    expect(r).toMatchObject({ clienteAnonimizada: true, telefone: null, consentimentoMensagens: false, consentimentoConvite: false });
  });

  it('reserva de outro salão e id malformado → NaoEncontrado', async () => {
    const a = await criarCenarioMensagem();
    const b = await criarCenarioMensagem();
    await expect(repos().mensagens.contextoDeRegistro(ctxDe(b.salaoId), a.reservaId)).rejects.toMatchObject({ name: 'NaoEncontrado' });
    await expect(repos().mensagens.contextoDeRegistro(ctxDe(a.salaoId), 'nao-uuid')).rejects.toMatchObject({ name: 'NaoEncontrado' });
  });
});

describe('inserir', () => {
  it('cria uma vez; a repetição devolve a existente sem 23505', async () => {
    const s = await criarCenarioMensagem();
    const nova = { reservaId: s.reservaId, tipo: 'confirmacao' as const, revisao: 0, estado: 'pendente' as const, erroCodigo: null, destinatarioE164: s.telefone };
    const um = await repos().mensagens.inserir(ctxDe(s.salaoId), nova, AGORA);
    const dois = await repos().mensagens.inserir(ctxDe(s.salaoId), nova, AGORA);
    expect(um.criada).toBe(true);
    expect(dois.criada).toBe(false);
    expect(dois.mensagem.id).toBe(um.mensagem.id);
    const m = await lerMensagem(um.mensagem.id);
    expect(m).toMatchObject({ estado: 'pendente', destinatarioE164: s.telefone, criadoEm: AGORA, atualizadoEm: AGORA });
  });

  it('chave de outro salão → NaoEncontrado e nada gravado', async () => {
    const a = await criarCenarioMensagem();
    const b = await criarCenarioMensagem();
    const nova = { reservaId: a.reservaId, tipo: 'confirmacao' as const, revisao: 0, estado: 'pendente' as const, erroCodigo: null, destinatarioE164: a.telefone };
    await repos().mensagens.inserir(ctxDe(a.salaoId), nova, AGORA);
    await expect(repos().mensagens.inserir(ctxDe(b.salaoId), nova, AGORA)).rejects.toMatchObject({ name: 'NaoEncontrado' });
    const r = await c.query('SELECT count(*)::int AS n FROM mensagem WHERE reserva_id = $1', [a.reservaId]);
    expect(r.rows[0].n).toBe(1);
  });
});

describe('inserir com item (D-050 A-4)', () => {
  it('grava e devolve reservaItemId; a repetição devolve a existente com o mesmo item', async () => {
    const s = await criarCenarioMensagem({ revisao: 1 });
    const [x] = await itensDa(s.reservaId);
    const nova = { reservaId: s.reservaId, reservaItemId: x.id, tipo: 'remarcacao' as const, revisao: 1, estado: 'pendente' as const, erroCodigo: null, destinatarioE164: s.telefone };
    const um = await repos().mensagens.inserir(ctxDe(s.salaoId), nova, AGORA);
    const dois = await repos().mensagens.inserir(ctxDe(s.salaoId), { ...nova, reservaItemId: null }, AGORA);
    expect(um).toMatchObject({ criada: true, mensagem: { reservaItemId: x.id, tipo: 'remarcacao', revisao: 1 } });
    expect(dois).toMatchObject({ criada: false, mensagem: { id: um.mensagem.id, reservaItemId: x.id } });
  });

  it('CHECK mensagem_item_tipo_chk: confirmação com item é recusada pelo banco', async () => {
    const s = await criarCenarioMensagem();
    const [x] = await itensDa(s.reservaId);
    const nova = { reservaId: s.reservaId, reservaItemId: x.id, tipo: 'confirmacao' as const, revisao: 0, estado: 'pendente' as const, erroCodigo: null, destinatarioE164: null };
    await expect(repos().mensagens.inserir(ctxDe(s.salaoId), nova, AGORA)).rejects.toThrow(/mensagem_item_tipo_chk/);
  });
});

describe('reenviar', () => {
  const rodar = (salaoId: string, id: string) =>
    emTransacao((r) => r.mensagens.reenviar(ctxDe(salaoId), id, AGORA, conferirVigencia));

  it('falhou e vigente → pendente, erro limpo, tentativas preservadas', async () => {
    const s = await criarCenarioMensagem();
    const id = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, estado: 'falhou', erroCodigo: 'resultado_incerto', tentativas: [{ resultado: 'falha' }] });
    expect(await rodar(s.salaoId, id)).toEqual({ resultado: 'reenfileirada', mensagemId: id, reservaId: s.reservaId, tipo: 'confirmacao', revisao: 0 });
    expect(await lerMensagem(id)).toMatchObject({ estado: 'pendente', erroCodigo: null, atualizadoEm: AGORA });
    expect(await lerTentativas(id)).toHaveLength(1);
  });

  it.each(['enviada', 'nao_enviada', 'substituida', 'pendente', 'enviando', 'cancelada_anonimizacao'] as const)('%s → recusada/nao_falhou', async (estado) => {
    const s = await criarCenarioMensagem();
    const id = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, estado });
    expect(await rodar(s.salaoId, id)).toEqual({ resultado: 'recusada', motivo: 'nao_falhou' });
    expect((await lerMensagem(id)).estado).toBe(estado);
  });

  it('confirmação falhou de reserva remarcada continua vigente (D-050 R-4)', async () => {
    const s = await criarCenarioMensagem({ revisao: 2 });
    const id = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, estado: 'falhou', revisao: 0 });
    expect(await rodar(s.salaoId, id)).toMatchObject({ resultado: 'reenfileirada' });
  });

  it('não vigente (remarcação sem item na revisão; confirmação de reserva cancelada) → obsoleta e continua falhou', async () => {
    const s = await criarCenarioMensagem({ revisao: 2 });
    const rem = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, tipo: 'remarcacao', estado: 'falhou', revisao: 1 });
    expect(await rodar(s.salaoId, rem)).toEqual({ resultado: 'recusada', motivo: 'obsoleta' });
    expect((await lerMensagem(rem)).estado).toBe('falhou');
    const id = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, estado: 'falhou', revisao: 0 });
    await mudarReserva(s.reservaId, { status: 'cancelado' });
    expect(await rodar(s.salaoId, id)).toEqual({ resultado: 'recusada', motivo: 'obsoleta' });
    expect((await lerMensagem(id)).estado).toBe('falhou');
  });

  it('cliente anonimizada → a linha vira cancelada_anonimizacao com campos pessoais nulos', async () => {
    const s = await criarCenarioMensagem();
    const id = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, estado: 'falhou', destinatarioE164: s.telefone });
    await anonimizarCliente(s.clienteId);
    expect(await rodar(s.salaoId, id)).toEqual({ resultado: 'recusada', motivo: 'cliente_anonimizada' });
    expect(await lerMensagem(id)).toMatchObject({ estado: 'cancelada_anonimizacao', destinatarioE164: null, parametros: null });
  });

  it('outro salão e id malformado → NaoEncontrado', async () => {
    const a = await criarCenarioMensagem();
    const b = await criarCenarioMensagem();
    const id = await criarMensagem({ salaoId: a.salaoId, reservaId: a.reservaId, estado: 'falhou' });
    await expect(rodar(b.salaoId, id)).rejects.toMatchObject({ name: 'NaoEncontrado' });
    await expect(rodar(a.salaoId, 'x')).rejects.toMatchObject({ name: 'NaoEncontrado' });
    expect((await lerMensagem(id)).estado).toBe('falhou');
  });
});

describe('listarDaReserva', () => {
  it('só os campos da RN-23, ordenados por criado_em, com tentativas', async () => {
    const s = await criarCenarioMensagem();
    const t0 = new Date('2026-11-21T10:00:00Z');
    const t1 = new Date('2026-11-21T11:00:00Z');
    const segunda = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, tipo: 'remarcacao', revisao: 1, atualizadoEm: t1, destinatarioE164: s.telefone, provedorMensagemId: 'wamid.X' });
    const primeira = await criarMensagem({
      salaoId: s.salaoId, reservaId: s.reservaId, atualizadoEm: t0, estado: 'enviada', enviadaEm: t0, provedorMensagemId: 'wamid.Y',
      tentativas: [{ resultado: 'falha', erroCodigo: 'x', iniciadaEm: t0 }, { resultado: 'sucesso', iniciadaEm: t1 }],
    });
    const lista = await repos().mensagens.listarDaReserva(ctxDe(s.salaoId), s.reservaId);
    expect(lista.map((m) => m.id)).toEqual([primeira, segunda]);
    expect(lista[0]).toEqual({ id: primeira, reservaItemId: null, tipo: 'confirmacao', revisao: 0, estado: 'enviada', enviadaEm: t0, erroCodigo: null, tentativas: 2, ultimaTentativaEm: t1 });
    expect(lista[1]).toMatchObject({ tentativas: 0, ultimaTentativaEm: null });
    expect(Object.keys(lista[0]).sort()).toEqual(['enviadaEm', 'erroCodigo', 'estado', 'id', 'reservaItemId', 'revisao', 'tentativas', 'tipo', 'ultimaTentativaEm']);
  });

  it('reserva de outro salão → NaoEncontrado', async () => {
    const a = await criarCenarioMensagem();
    const b = await criarCenarioMensagem();
    await expect(repos().mensagens.listarDaReserva(ctxDe(b.salaoId), a.reservaId)).rejects.toMatchObject({ name: 'NaoEncontrado' });
  });
});

describe('sistema.localizar', () => {
  it('devolve salão e estado; inexistente e malformado → null', async () => {
    const s = await criarCenarioMensagem();
    const id = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, estado: 'falhou' });
    expect(await sistema.localizar(id)).toEqual({ salaoId: s.salaoId, estado: 'falhou' });
    expect(await sistema.localizar('00000000-0000-4000-8000-000000000000')).toBeNull();
    expect(await sistema.localizar('nao-uuid')).toBeNull();
  });
});

describe('sistema.iniciarEnvio', () => {
  it('reivindica pendente, lê o contexto, abre a tentativa 1 e grava o destinatário', async () => {
    const s = await criarCenarioMensagem({ revisao: 0 });
    const id = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId });
    let visto: ContextoDeEnvio | undefined;
    const r = await sistema.iniciarEnvio(s.salaoId, id, AGORA, (ctx) => {
      visto = ctx;
      return { acao: 'enviar' };
    });
    expect(r).toMatchObject({ resultado: 'enviar', numero: 1, destinatarioE164: s.telefone, tipo: 'confirmacao', revisao: 0, reservaId: s.reservaId });
    const meia = 30 * 60_000;
    expect(visto).toEqual({
      tipo: 'confirmacao', mensagemRevisao: 0, reservaId: s.reservaId,
      reserva: { revisao: 0, status: 'confirmado' },
      // D-050: itens por (inicio, id) com os nomes atuais de serviço e profissional.
      itens: s.servicoNomes.map((servicoNome, i) => ({
        inicio: new Date(s.inicio.getTime() + i * meia),
        fim: new Date(s.inicio.getTime() + (i + 1) * meia),
        status: 'confirmado',
        revisao: 0,
        servicoNome,
        profissionalNome: s.profissionalNome,
      })),
      salaoNome: s.salaoNome, fuso: s.fuso,
      clienteAnonimizada: false, telefone: s.telefone, consentimentoMensagens: true, consentimentoConvite: false,
    });
    expect(await lerMensagem(id)).toMatchObject({ estado: 'enviando', destinatarioE164: s.telefone, atualizadoEm: AGORA });
    const t = await lerTentativas(id);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ numero: 1, iniciadaEm: AGORA, resultado: null, finalizadaEm: null });
  });

  it('dois executores na mesma mensagem: uma vitória, uma tentativa', async () => {
    const s = await criarCenarioMensagem();
    const id = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId });
    const rs = await Promise.all(Array.from({ length: 6 }, () => sistema.iniciarEnvio(s.salaoId, id, AGORA, sempreEnviar)));
    expect(rs.filter((r) => r.resultado === 'enviar')).toHaveLength(1);
    expect(rs.filter((r) => r.resultado === 'nao_reivindicada')).toHaveLength(5);
    expect(await lerTentativas(id)).toHaveLength(1);
  });

  it('numeração continua depois de tentativas anteriores', async () => {
    const s = await criarCenarioMensagem();
    const id = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, tentativas: [{ resultado: 'falha' }, { resultado: 'falha' }] });
    const r = await sistema.iniciarEnvio(s.salaoId, id, AGORA, sempreEnviar);
    expect(r).toMatchObject({ resultado: 'enviar', numero: 3 });
  });

  it.each(['enviando', 'enviada', 'falhou', 'nao_enviada', 'substituida', 'cancelada_anonimizacao'] as const)('%s não é reivindicada', async (estado) => {
    const s = await criarCenarioMensagem();
    const id = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, estado });
    expect(await sistema.iniciarEnvio(s.salaoId, id, AGORA, sempreEnviar)).toEqual({ resultado: 'nao_reivindicada' });
    expect((await lerMensagem(id)).estado).toBe(estado);
    expect(await lerTentativas(id)).toHaveLength(0);
  });

  it('decisão terminal fecha a linha na mesma transação, sem tentativa e sem dado pessoal', async () => {
    const s = await criarCenarioMensagem();
    const id = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, destinatarioE164: s.telefone });
    await anonimizarCliente(s.clienteId);
    const r = await sistema.iniciarEnvio(s.salaoId, id, AGORA, (ctx) => {
      return decidirElegibilidade({ tipo: ctx.tipo, clienteAnonimizada: ctx.clienteAnonimizada, telefone: ctx.telefone, consentimentoMensagens: ctx.consentimentoMensagens, consentimentoConvite: ctx.consentimentoConvite });
    });
    expect(r).toEqual({ resultado: 'terminal', estado: 'cancelada_anonimizacao', erroCodigo: null, tipo: 'confirmacao', revisao: 0 });
    expect(await lerMensagem(id)).toMatchObject({ estado: 'cancelada_anonimizacao', destinatarioE164: null, parametros: null });
    expect(await lerTentativas(id)).toHaveLength(0);
  });

  it('salão errado não reivindica', async () => {
    const a = await criarCenarioMensagem();
    const b = await criarCenarioMensagem();
    const id = await criarMensagem({ salaoId: a.salaoId, reservaId: a.reservaId });
    expect(await sistema.iniciarEnvio(b.salaoId, id, AGORA, sempreEnviar)).toEqual({ resultado: 'nao_reivindicada' });
    expect((await lerMensagem(id)).estado).toBe('pendente');
  });

  it('erro no decisor desfaz a reivindicação', async () => {
    const s = await criarCenarioMensagem();
    const id = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId });
    await expect(sistema.iniciarEnvio(s.salaoId, id, AGORA, () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect((await lerMensagem(id)).estado).toBe('pendente');
    expect(await lerTentativas(id)).toHaveLength(0);
  });

  it('serviço e profissional inativos mantêm o nome; reserva cancelada aparece no contexto', async () => {
    const s = await criarCenarioMensagem({ status: 'cancelado', revisao: 3 });
    await c.query('UPDATE profissional SET ativo = false WHERE id = $1', [s.profissionalId]);
    await c.query('UPDATE servico SET ativo = false WHERE id = $1', [s.servicoIds[0]]);
    const id = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, tipo: 'cancelamento', revisao: 3 });
    let visto: ContextoDeEnvio | undefined;
    await sistema.iniciarEnvio(s.salaoId, id, AGORA, (ctx) => {
      visto = ctx;
      return { acao: 'terminal', estado: 'substituida', erroCodigo: 'obsoleta' };
    });
    expect(visto).toMatchObject({ reserva: { status: 'cancelado', revisao: 3 }, mensagemRevisao: 3 });
    expect(visto?.itens.map((i) => [i.servicoNome, i.profissionalNome, i.status, i.revisao])).toEqual(
      s.servicoNomes.map((n) => [n, s.profissionalNome, 'cancelado', 3]),
    );
    expect(await lerMensagem(id)).toMatchObject({ estado: 'substituida', erroCodigo: 'obsoleta' });
  });
});

describe('sistema.concluirEnvio', () => {
  async function emEnvio(opcoes: { estado?: 'enviando' | 'falhou'; erroCodigo?: string } = {}) {
    const s = await criarCenarioMensagem();
    const id = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, estado: opcoes.estado ?? 'enviando', erroCodigo: opcoes.erroCodigo ?? null, tentativas: [{ resultado: null }] });
    const [t] = await lerTentativas(id);
    return { s, id, tentativaId: t.id };
  }

  it('sucesso: enviada, provedor, enviada_em e tentativa sucesso', async () => {
    const { s, id, tentativaId } = await emEnvio();
    expect(await sistema.concluirEnvio(s.salaoId, id, tentativaId, { resultado: 'sucesso', provedorMensagemId: 'wamid.1' }, AGORA)).toBe(true);
    expect(await lerMensagem(id)).toMatchObject({ estado: 'enviada', provedorMensagemId: 'wamid.1', enviadaEm: AGORA, erroCodigo: null, atualizadoEm: AGORA });
    expect((await lerTentativas(id))[0]).toMatchObject({ resultado: 'sucesso', finalizadaEm: AGORA });
  });

  it.each(['pendente', 'falhou'] as const)('falha com estado final %s', async (estadoFinal) => {
    const { s, id, tentativaId } = await emEnvio();
    expect(await sistema.concluirEnvio(s.salaoId, id, tentativaId, { resultado: 'falha', estadoFinal, erroCodigo: 'falha_forcada', erroDetalhe: 'falha temporária' }, AGORA)).toBe(true);
    expect(await lerMensagem(id)).toMatchObject({ estado: estadoFinal, erroCodigo: 'falha_forcada', atualizadoEm: AGORA });
    expect((await lerTentativas(id))[0]).toMatchObject({ resultado: 'falha', erroCodigo: 'falha_forcada', erroDetalhe: 'falha temporária', finalizadaEm: AGORA });
  });

  it('A-11: sucesso tardio corrige falhou/resultado_incerto para enviada e a tentativa para sucesso', async () => {
    const { s, id, tentativaId } = await emEnvio({ estado: 'falhou', erroCodigo: 'resultado_incerto' });
    await c.query("UPDATE mensagem_tentativa SET resultado = 'falha', erro_codigo = 'resultado_incerto' WHERE id = $1", [tentativaId]);
    expect(await sistema.concluirEnvio(s.salaoId, id, tentativaId, { resultado: 'sucesso', provedorMensagemId: 'wamid.2' }, AGORA)).toBe(true);
    expect(await lerMensagem(id)).toMatchObject({ estado: 'enviada', erroCodigo: null });
    expect((await lerTentativas(id))[0]).toMatchObject({ resultado: 'sucesso', erroCodigo: null });
  });

  it('fora dos estados que aceitam o fechamento nada é escrito', async () => {
    const { s, id, tentativaId } = await emEnvio({ estado: 'falhou', erroCodigo: 'outro' });
    expect(await sistema.concluirEnvio(s.salaoId, id, tentativaId, { resultado: 'sucesso', provedorMensagemId: 'x' }, AGORA)).toBe(false);
    expect(await sistema.concluirEnvio(s.salaoId, id, tentativaId, { resultado: 'falha', estadoFinal: 'falhou', erroCodigo: 'y', erroDetalhe: 'z' }, AGORA)).toBe(false);
    expect(await lerMensagem(id)).toMatchObject({ estado: 'falhou', erroCodigo: 'outro' });
    expect((await lerTentativas(id))[0].resultado).toBeNull();
  });
});

describe('sistema.listarPendentesAntigas', () => {
  it('só pendentes anteriores ao corte, mais antigas primeiro, com limite', async () => {
    const s = await criarCenarioMensagem();
    const velha = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, tipo: 'confirmacao', atualizadoEm: new Date('2026-11-21T09:00:00Z') });
    const velha2 = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, tipo: 'remarcacao', revisao: 1, atualizadoEm: new Date('2026-11-21T09:30:00Z') });
    const nova = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, tipo: 'remarcacao', revisao: 2, atualizadoEm: new Date('2026-11-21T11:59:00Z') });
    const enviando = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, tipo: 'cancelamento', revisao: 0, estado: 'enviando', atualizadoEm: new Date('2026-11-21T08:00:00Z') });
    const corte = new Date('2026-11-21T11:58:00Z');
    const todas = (await sistema.listarPendentesAntigas(corte, 1000)).filter((m) => m.salaoId === s.salaoId);
    expect(todas.map((m) => m.id)).toEqual([velha, velha2]);
    expect(todas[0]).toEqual({ id: velha, salaoId: s.salaoId, reservaId: s.reservaId, tipo: 'confirmacao', revisao: 0 });
    expect(todas.map((m) => m.id)).not.toContain(nova);
    expect(todas.map((m) => m.id)).not.toContain(enviando);
    expect((await sistema.listarPendentesAntigas(corte, 1)).length).toBe(1);
  });
});

describe('sistema.expirarEnviandoPresas', () => {
  it('fecha as presas como falhou/resultado_incerto e a tentativa aberta; não toca as dentro do prazo', async () => {
    const s = await criarCenarioMensagem();
    const presa = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, estado: 'enviando', atualizadoEm: new Date('2026-11-21T11:00:00Z'), tentativas: [{ resultado: 'falha' }, { resultado: null }] });
    const recente = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, tipo: 'remarcacao', revisao: 1, estado: 'enviando', atualizadoEm: new Date('2026-11-21T11:59:00Z'), tentativas: [{ resultado: null }] });
    const n = await sistema.expirarEnviandoPresas(new Date('2026-11-21T11:55:00Z'), 1000, AGORA);
    expect(n).toBeGreaterThanOrEqual(1);
    expect(await lerMensagem(presa)).toMatchObject({ estado: 'falhou', erroCodigo: 'resultado_incerto', atualizadoEm: AGORA });
    const t = await lerTentativas(presa);
    expect(t[1]).toMatchObject({ resultado: 'falha', erroCodigo: 'resultado_incerto', finalizadaEm: AGORA });
    expect(t[0].erroCodigo).toBeNull();
    expect((await lerMensagem(recente)).estado).toBe('enviando');
    expect((await lerTentativas(recente))[0].resultado).toBeNull();
  });

  it('SKIP LOCKED: linha travada por outro executor não faz esperar nem é fechada', async () => {
    const s = await criarCenarioMensagem();
    const id = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, estado: 'enviando', atualizadoEm: new Date('2026-11-21T11:00:00Z'), tentativas: [{ resultado: null }] });
    const outro = await conectar();
    try {
      await outro.query('BEGIN');
      await outro.query('SELECT 1 FROM mensagem WHERE id = $1 FOR UPDATE', [id]);
      const antes = Date.now();
      await sistema.expirarEnviandoPresas(new Date('2026-11-21T11:55:00Z'), 1000, AGORA);
      expect(Date.now() - antes).toBeLessThan(3000);
      await outro.query('COMMIT');
    } finally {
      await outro.end();
    }
    expect((await lerMensagem(id)).estado).toBe('enviando');
  });
});

describe('mudarReserva (fábrica)', () => {
  it('a reserva vigente muda de revisão', async () => {
    const s = await criarCenarioMensagem();
    await mudarReserva(s.reservaId, { revisao: 4 });
    expect((await repos().mensagens.contextoDeRegistro(ctxDe(s.salaoId), s.reservaId)).reservaRevisao).toBe(4);
  });
});
