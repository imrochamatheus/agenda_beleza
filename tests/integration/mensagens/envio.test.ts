import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { enfileirarMensagens } from '@/server/mensagens/enfileirar';
import { obterPrisma } from '@/server/repos/db';

import {
  anonimizarCliente,
  chamadasDaChave,
  checksumDeTabelas,
  criarCenarioMensagem,
  criarMensagem,
  lerMensagem,
  lerTentativas,
  mudarReserva,
  TABELAS_INTOCAVEIS,
} from '../../support/mensagens';
import type { CenarioMensagem } from '../../support/mensagens';

import { criarPipeline, esperarJob, esperarMensagem, limparFalhasForcadas, registrar, registrarEEnfileirar } from './apoio';
import type { Pipeline } from './apoio';

// D-024 T-7: o envio ponta a ponta com o worker pg-boss real e o WhatsApp simulado.
// CA-1, CA-2, CA-3, CA-5, CA-7, CA-13, CA-14, CA-15, CA-17, CA-20, CA-21, CA-27.

let p: Pipeline;
/** Tudo que identifica pessoas nos cenários, para a prova de log limpo (CA-21). */
const pessoais: string[] = [];
const guardar = (s: CenarioMensagem) => pessoais.push(s.telefone, s.clienteNome, s.salaoNome, s.profissionalNome, ...s.servicoNomes);

beforeAll(async () => {
  p = await criarPipeline();
}, 60_000);
afterAll(async () => {
  await p?.encerrar();
});
beforeEach(limparFalhasForcadas);
afterEach(limparFalhasForcadas);

describe('CA-1: confirmação enviada com os parâmetros no fuso do salão', () => {
  it('1 mensagem enviada, 1 tentativa sucesso, 1 chamada com a chave e os parâmetros certos (23:30 local)', async () => {
    // 2026-11-22T02:30Z = 21/11/2026 23:30 em São Paulo (o dia UTC é outro).
    const s = await criarCenarioMensagem({ inicio: new Date('2026-11-22T02:30:00Z'), servicos: ['Corte', 'Barba', 'Hidratação'] });
    guardar(s);
    const r = await registrarEEnfileirar(p, s, 'confirmacao');
    const m = await esperarMensagem(r.mensagemId, 'enviada');
    expect(m.provedorMensagemId).toMatch(/^wamid\.SIM\./);
    expect(m.enviadaEm).toBeInstanceOf(Date);
    expect(m.erroCodigo).toBeNull();
    expect(m.destinatarioE164).toBe(s.telefone);
    expect(m.parametros).toBeNull();
    const t = await lerTentativas(r.mensagemId);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ numero: 1, resultado: 'sucesso', erroCodigo: null });
    const chamadas = await chamadasDaChave(`${s.reservaId}:confirmacao:0`);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]).toMatchObject({ destinatario: s.telefone, modelo: 'confirmacao', resultado: 'sucesso' });
    expect(chamadas[0].parametros).toEqual({
      salao: s.salaoNome,
      servicos: 'Corte, Barba e Hidratação',
      profissional: s.profissionalNome,
      data: '21/11/2026',
      horario: '23:30',
    });
  });

  it('usa o fuso do salão no momento do envio (fuso diferente → dia e hora diferentes)', async () => {
    const s = await criarCenarioMensagem({ inicio: new Date('2026-11-22T02:30:00Z'), fuso: 'America/Manaus' });
    guardar(s);
    const r = await registrarEEnfileirar(p, s, 'confirmacao');
    await esperarMensagem(r.mensagemId, 'enviada');
    const [c] = await chamadasDaChave(r.chave);
    expect(c.parametros).toMatchObject({ data: '21/11/2026', horario: '22:30' });
  });

  it('cancelamento leva salao, servicos, data e horario (sem profissional)', async () => {
    const s = await criarCenarioMensagem({ status: 'cancelado', revisao: 0 });
    guardar(s);
    const r = await registrarEEnfileirar(p, s, 'cancelamento');
    await esperarMensagem(r.mensagemId, 'enviada');
    const [c] = await chamadasDaChave(r.chave);
    expect(Object.keys(c.parametros).sort()).toEqual(['data', 'horario', 'salao', 'servicos']);
  });
});

describe('CA-2: duas falhas temporárias e depois sucesso, com backoff', () => {
  it('3 tentativas (falha, falha, sucesso), intervalos mínimos crescentes e 3 chamadas', async () => {
    const s = await criarCenarioMensagem();
    guardar(s);
    await p.simulado.forcarFalhas(2, 'temporaria');
    const r = await registrarEEnfileirar(p, s, 'confirmacao');
    await esperarMensagem(r.mensagemId, 'enviada', 30_000);
    const t = await lerTentativas(r.mensagemId);
    expect(t.map((x) => [x.numero, x.resultado, x.erroCodigo])).toEqual([
      [1, 'falha', 'falha_forcada'],
      [2, 'falha', 'falha_forcada'],
      [3, 'sucesso', null],
    ]);
    expect(t[0].erroDetalhe).toBe('falha temporária');
    const d1 = t[1].iniciadaEm.getTime() - t[0].iniciadaEm.getTime();
    const d2 = t[2].iniciadaEm.getTime() - t[1].iniciadaEm.getTime();
    // Atraso de 1 s com backoff exponencial: a 2ª espera é de pelo menos o dobro da 1ª configurada.
    expect(d1).toBeGreaterThanOrEqual(900);
    expect(d2).toBeGreaterThanOrEqual(1900);
    const chamadas = await chamadasDaChave(r.chave);
    expect(chamadas.map((c) => c.resultado)).toEqual(['falha', 'falha', 'sucesso']);
    const job = await esperarJob(p, 'whatsapp-reserva', p.jobs.at(-1)!);
    expect(job.state).toBe('completed');
  }, 40_000);
});

describe('CA-17: falha permanente', () => {
  it('1 tentativa, falhou na hora, sem retry do pg-boss e o job completed', async () => {
    const s = await criarCenarioMensagem();
    guardar(s);
    await p.simulado.forcarFalhas(1, 'permanente');
    const r = await registrarEEnfileirar(p, s, 'confirmacao');
    const m = await esperarMensagem(r.mensagemId, 'falhou');
    expect(m.erroCodigo).toBe('falha_forcada');
    const t = await lerTentativas(r.mensagemId);
    expect(t.map((x) => [x.resultado, x.erroDetalhe])).toEqual([['falha', 'falha permanente']]);
    const job = await esperarJob(p, 'whatsapp-reserva', p.jobs.at(-1)!);
    expect(job.state).toBe('completed');
    expect(job.retryCount).toBe(0);
    expect(await chamadasDaChave(r.chave)).toHaveLength(1);
  });
});

describe('CA-5: duas remarcações distintas', () => {
  it('revisões 1 e 2, ambas enviadas, com chaves diferentes', async () => {
    const s = await criarCenarioMensagem({ revisao: 1 });
    guardar(s);
    const r1 = await registrarEEnfileirar(p, s, 'remarcacao');
    await esperarMensagem(r1.mensagemId, 'enviada');
    await mudarReserva(s.reservaId, { revisao: 2 });
    const r2 = await registrarEEnfileirar(p, s, 'remarcacao');
    await esperarMensagem(r2.mensagemId, 'enviada');
    expect(r1.mensagemId).not.toBe(r2.mensagemId);
    expect([r1.chave, r2.chave]).toEqual([`${s.reservaId}:remarcacao:1`, `${s.reservaId}:remarcacao:2`]);
    expect(await chamadasDaChave(r1.chave)).toHaveLength(1);
    expect(await chamadasDaChave(r2.chave)).toHaveLength(1);
  });
});

describe('CA-13: cliente anonimizada entre o registro e o envio', () => {
  it.each([
    ['confirmacao', { revisao: 0, status: 'confirmado' as const }],
    ['remarcacao', { revisao: 1, status: 'confirmado' as const }],
    ['cancelamento', { revisao: 0, status: 'cancelado' as const }],
    ['convite_avaliacao', { revisao: 0, status: 'concluido' as const, consentimentoConvite: true }],
  ] as const)('%s pendente → cancelada_anonimizacao, sem chamada e sem tentativa de sucesso', async (tipo, opcoes) => {
    const s = await criarCenarioMensagem(opcoes);
    guardar(s);
    const r = await registrar(s, tipo);
    expect(r.estado).toBe('pendente');
    await anonimizarCliente(s.clienteId);
    await enfileirarMensagens([r], { enfileirar: p.enfileirar });
    const m = await esperarMensagem(r.mensagemId, 'cancelada_anonimizacao');
    expect(m).toMatchObject({ destinatarioE164: null, parametros: null });
    expect((await lerTentativas(r.mensagemId)).filter((t) => t.resultado === 'sucesso')).toEqual([]);
    expect(await chamadasDaChave(r.chave)).toEqual([]);
  });
});

describe('CA-14: consentimento que deixa de existir antes do envio', () => {
  it('linha de consentimento apagada → nao_enviada/sem_consentimento no envio, sem chamada', async () => {
    const s = await criarCenarioMensagem();
    guardar(s);
    const r = await registrar(s, 'confirmacao');
    await obterPrisma().consentimento.deleteMany({ where: { clienteId: s.clienteId } });
    await enfileirarMensagens([r], { enfileirar: p.enfileirar });
    const m = await esperarMensagem(r.mensagemId, 'nao_enviada');
    expect(m).toMatchObject({ erroCodigo: 'sem_consentimento', destinatarioE164: null });
    expect(await lerTentativas(r.mensagemId)).toEqual([]);
    expect(await chamadasDaChave(r.chave)).toEqual([]);
  });
});

describe('CA-15 e CA-7: mensagem obsoleta termina sem enviar', () => {
  it('confirmacao rev 0 com a reserva remarcada; remarcacao com a reserva cancelada; convite com a reserva ainda confirmada', async () => {
    const a = await criarCenarioMensagem();
    const b = await criarCenarioMensagem({ revisao: 1 });
    const c = await criarCenarioMensagem({ consentimentoConvite: true });
    guardar(a);
    guardar(b);
    guardar(c);
    const ra = await registrar(a, 'confirmacao');
    const rb = await registrar(b, 'remarcacao');
    const rc = await registrar(c, 'convite_avaliacao');
    await mudarReserva(a.reservaId, { revisao: 1 });
    await mudarReserva(b.reservaId, { status: 'cancelado' });
    await enfileirarMensagens([ra, rb, rc], { enfileirar: p.enfileirar });
    for (const r of [ra, rb, rc]) {
      const m = await esperarMensagem(r.mensagemId, 'substituida');
      expect(m.erroCodigo).toBe('obsoleta');
      expect(await chamadasDaChave(r.chave)).toEqual([]);
      expect(await lerTentativas(r.mensagemId)).toEqual([]);
    }
  });

  it('CA-7: a revisão 1 já estava na fila quando a 2 foi registrada: o job dela termina sem chamar o adaptador', async () => {
    const s = await criarCenarioMensagem({ revisao: 1 });
    guardar(s);
    await p.parar();
    const r1 = await registrar(s, 'remarcacao');
    await enfileirarMensagens([r1], { enfileirar: p.enfileirar });
    const jobDaRev1 = p.jobs.at(-1)!;
    await mudarReserva(s.reservaId, { revisao: 2 });
    const r2 = await registrar(s, 'remarcacao');
    expect((await lerMensagem(r1.mensagemId)).estado).toBe('substituida');
    await enfileirarMensagens([r2], { enfileirar: p.enfileirar });
    await p.iniciar();
    await esperarMensagem(r2.mensagemId, 'enviada');
    expect((await esperarJob(p, 'whatsapp-reserva', jobDaRev1)).state).toBe('completed');
    expect(await chamadasDaChave(r1.chave)).toEqual([]);
    expect(await chamadasDaChave(r2.chave)).toHaveLength(1);
    expect((await lerMensagem(r1.mensagemId)).estado).toBe('substituida');
  }, 40_000);
});

describe('CA-20: salão suspenso', () => {
  it('o cancelamento da equipe é enviado normalmente', async () => {
    const s = await criarCenarioMensagem({ status: 'cancelado' });
    guardar(s);
    await obterPrisma().salao.update({ where: { id: s.salaoId }, data: { suspensoManualEm: new Date() } });
    const r = await registrarEEnfileirar(p, s, 'cancelamento');
    await esperarMensagem(r.mensagemId, 'enviada');
    expect(await chamadasDaChave(r.chave)).toHaveLength(1);
  });
});

describe('CA-27: o pipeline só escreve em mensagem e mensagem_tentativa', () => {
  it('reserva, itens, cliente, consentimento e salão ficam idênticos com mensagens enviada, substituida e falhou', async () => {
    const s = await criarCenarioMensagem({ revisao: 1 });
    const f = await criarCenarioMensagem();
    guardar(s);
    guardar(f);
    const antesS = await checksumDeTabelas(TABELAS_INTOCAVEIS, s.salaoId);
    const antesF = await checksumDeTabelas(TABELAS_INTOCAVEIS, f.salaoId);
    const ok = await registrarEEnfileirar(p, s, 'remarcacao');
    const obsoleta = await criarMensagem({ salaoId: s.salaoId, reservaId: s.reservaId, tipo: 'confirmacao', revisao: 0, destinatarioE164: s.telefone });
    await enfileirarMensagens(
      [{ criada: true, mensagemId: obsoleta, tipo: 'confirmacao', revisao: 0, estado: 'pendente', chave: `${s.reservaId}:confirmacao:0`, precisaEnfileirar: true }],
      { enfileirar: p.enfileirar },
    );
    await p.simulado.forcarFalhas(1, 'permanente');
    const falha = await registrarEEnfileirar(p, f, 'confirmacao');
    await esperarMensagem(ok.mensagemId, ['enviada', 'falhou']);
    await esperarMensagem(obsoleta, 'substituida');
    await esperarMensagem(falha.mensagemId, ['falhou', 'enviada']);
    expect(await checksumDeTabelas(TABELAS_INTOCAVEIS, s.salaoId)).toEqual(antesS);
    expect(await checksumDeTabelas(TABELAS_INTOCAVEIS, f.salaoId)).toEqual(antesF);
  });
});

describe('CA-21: nenhum log com dado pessoal', () => {
  it('as linhas do worker e do console só têm os campos permitidos e nenhum telefone, nome ou parâmetro', async () => {
    const linhas = p.logs();
    expect(linhas.length).toBeGreaterThan(0);
    const texto = linhas.join('\n');
    for (const dado of pessoais) {
      expect(texto, `log contém "${dado}"`).not.toContain(dado);
    }
    const eventos = linhas.map((l) => JSON.parse(l) as Record<string, unknown>).filter((e) => String(e.evento).startsWith('mensagem.'));
    expect(eventos.length).toBeGreaterThan(0);
    const permitidos = new Set(['evento', 'em', 'mensagemId', 'tipo', 'revisao', 'tentativa', 'estado', 'erroCodigo']);
    for (const e of eventos) {
      expect(Object.keys(e).filter((k) => !permitidos.has(k)), JSON.stringify(e)).toEqual([]);
    }
  });
});

describe('CA-3: esgotadas as tentativas, a mensagem falha e a reserva fica idêntica', () => {
  it('LIMIT=2: 3 tentativas, falhou, erro_codigo, job completed e checksums iguais', async () => {
    await p.encerrar();
    p = await criarPipeline({ env: { QUEUE_RETRY_LIMIT: '2', QUEUE_RETRY_BACKOFF: 'false' } });
    const s = await criarCenarioMensagem();
    guardar(s);
    const antes = await checksumDeTabelas(TABELAS_INTOCAVEIS, s.salaoId);
    await p.simulado.forcarFalhas(5, 'temporaria');
    const r = await registrarEEnfileirar(p, s, 'confirmacao');
    const m = await esperarMensagem(r.mensagemId, 'falhou', 30_000);
    expect(m).toMatchObject({ erroCodigo: 'falha_forcada' });
    const t = await lerTentativas(r.mensagemId);
    expect(t.map((x) => [x.numero, x.resultado])).toEqual([[1, 'falha'], [2, 'falha'], [3, 'falha']]);
    const job = await esperarJob(p, 'whatsapp-reserva', p.jobs.at(-1)!);
    expect(job.state).toBe('completed');
    expect(job.retryCount).toBe(2);
    expect(await chamadasDaChave(r.chave)).toHaveLength(3);
    expect(await checksumDeTabelas(TABELAS_INTOCAVEIS, s.salaoId)).toEqual(antes);
    // sobram falhas forçadas no simulado: limpas pelo afterEach
  }, 40_000);
});
