import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { reservarPelaPagina } from '@/server/reserva-publica/servico';
import type { EntradaReservaPublica } from '@/server/reserva-publica/tipos';
import { normalizarTelefoneBr } from '@/lib/telefone';
import { MENSAGENS_PROTECAO } from '@/server/protecao/tipos';
import { obterPrisma } from '@/server/repos/db';

import { contarLinhas } from '../../support/reservas';
import { AGORA, DIA, criarCenarioReserva, definirAssinatura, enfileirar, entradaPublica, ipNovo, sp } from '../../support/reserva-publica';
import { telefoneNovo } from '../../support/sql';
import { contadorDoIp, contadorDoNumero } from './apoio';

// D-027: CA-1..CA-5, CA-9, CA-10, CA-16, CA-17 e a idempotência, contra o PostgreSQL real e com os
// limites padrão (IP reserva 10, número 5, futuras 3, janela de 15 min). D-050 (CA-15/CA-16): pelo fluxo
// público com itens; o caso de 3 itens por reserva está em `futuras.test.ts`.

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterAll(() => {
  vi.restoreAllMocks();
});

const db = () => obterPrisma();
const reservar = (e: EntradaReservaPublica, agora: Date = AGORA) => reservarPelaPagina(e, agora, { enfileirar });
const hora = (h: number) => sp(DIA, `${String(h).padStart(2, '0')}:00`).toISOString();
const E164 = (t: string) => normalizarTelefoneBr(t)!;

/** Muda o status da reserva E dos seus itens (derivados coerentes, D-050 RN-21). */
async function mudarStatus(reservaId: string, status: 'cancelado' | 'concluido' | 'nao_compareceu') {
  await db().reservaItem.updateMany({ where: { reservaId }, data: { status } });
  await db().reserva.update({ where: { id: reservaId }, data: { status, ...(status === 'cancelado' && { canceladaEm: AGORA }) } });
}

/** Janela de 15 min k posições à frente de AGORA: contadores de IP e de número reiniciam. */
const em = (k: number) => new Date(AGORA.getTime() + k * 15 * 60_000);

async function tresFuturas(c: Awaited<ReturnType<typeof criarCenarioReserva>>, telefone: string) {
  for (const h of [10, 11, 12]) {
    const r = await reservar(entradaPublica(c, { telefone, inicio: hora(h) }));
    expect(r.resultado).toBe('confirmada');
  }
}

describe('limite de futuras (CA-1, CA-2, CA-16)', () => {
  it('CA-1: a 4ª reserva do mesmo número é recusada sem revelar nada e sem escrita', async () => {
    const c = await criarCenarioReserva();
    const telefone = telefoneNovo();
    await tresFuturas(c, telefone);
    const antes = await contarLinhas(c.s.salaoId);
    const cliente = await db().cliente.findFirstOrThrow({ where: { salaoId: c.s.salaoId } });

    const r = await reservar(entradaPublica(c, { telefone, nome: 'Outro Nome', inicio: hora(13) }));
    expect(r).toEqual({ resultado: 'recusado', mensagem: MENSAGENS_PROTECAO.futuras });
    // CA-16: a transação inteira foi desfeita, inclusive o upsert que trocaria o nome.
    expect(await contarLinhas(c.s.salaoId)).toEqual(antes);
    expect((await db().cliente.findUniqueOrThrow({ where: { id: cliente.id } })).nome).toBe(cliente.nome);
  });

  it('CA-2: cancelada, concluída, não compareceu, passada e de outro salão não contam', async () => {
    const c = await criarCenarioReserva();
    const outro = await criarCenarioReserva();
    const telefone = telefoneNovo();
    await tresFuturas(c, telefone);
    // O mesmo número no salão B tem a sua própria contagem.
    expect((await reservar(entradaPublica(outro, { telefone, inicio: hora(10) }))).resultado).toBe('confirmada');

    const reservas = await db().reserva.findMany({ where: { salaoId: c.s.salaoId }, orderBy: { inicio: 'asc' } });
    await mudarStatus(reservas[0].id, 'cancelado');
    // 2 futuras: a 4ª passa a caber.
    expect((await reservar(entradaPublica(c, { telefone, inicio: hora(13) }), em(1))).resultado).toBe('confirmada');
    // De novo 3 (11, 12, 13): recusa; marcar uma como concluída / não compareceu libera.
    expect((await reservar(entradaPublica(c, { telefone, inicio: hora(14) }), em(2))).resultado).toBe('recusado');
    await mudarStatus(reservas[1].id, 'concluido');
    expect((await reservar(entradaPublica(c, { telefone, inicio: hora(14) }), em(3))).resultado).toBe('confirmada');
    await mudarStatus(reservas[2].id, 'nao_compareceu');
    expect((await reservar(entradaPublica(c, { telefone, inicio: hora(15) }), em(4))).resultado).toBe('confirmada');
  });

  it('CA-2: reserva passada (inicio <= agora) não conta', async () => {
    const c = await criarCenarioReserva();
    const telefone = telefoneNovo();
    await tresFuturas(c, telefone);
    // Mais tarde que a 1ª reserva (10:00 local): 2 futuras restam, então cabe mais uma.
    const depoisDaPrimeira = new Date(sp(DIA, '10:30').getTime());
    const r = await reservar(entradaPublica(c, { telefone, inicio: hora(13) }), depoisDaPrimeira);
    expect(r.resultado).toBe('confirmada');
  });

  it('cliente anonimizada não conta (telefone nulo): o mesmo número vira cliente nova', async () => {
    const c = await criarCenarioReserva();
    const telefone = telefoneNovo();
    await tresFuturas(c, telefone);
    await db().cliente.updateMany({ where: { salaoId: c.s.salaoId }, data: { nome: null, telefoneE164: null, anonimizadaEm: AGORA } });
    expect((await reservar(entradaPublica(c, { telefone, inicio: hora(13) }))).resultado).toBe('confirmada');
  });
});

describe('limite por IP (CA-3, CA-5, CA-10, CA-9)', () => {
  it('CA-3: do mesmo IP, 10 passam pelo limite e a 11ª é limitada, sem escrita', async () => {
    const c = await criarCenarioReserva();
    const ip = ipNovo();
    const antes = await contarLinhas(c.s.salaoId);
    for (let i = 0; i < 10; i++) {
      // Sem token: o IP conta e a verificação humana recusa (nenhuma escrita).
      const r = await reservar(entradaPublica(c, { ip, tokenHumano: null }));
      expect(r).toEqual({ resultado: 'recusado', mensagem: MENSAGENS_PROTECAO.humano });
    }
    expect(await reservar(entradaPublica(c, { ip }))).toEqual({ resultado: 'limitado', mensagem: MENSAGENS_PROTECAO.limitado });
    expect(await contarLinhas(c.s.salaoId)).toEqual(antes);
    expect(await contadorDoIp(ip)).toBe(11);
  });

  it('um IP limitado não afeta outro IP, e a janela seguinte reinicia', async () => {
    const c = await criarCenarioReserva();
    const ip = ipNovo();
    for (let i = 0; i < 11; i++) await reservar(entradaPublica(c, { ip, tokenHumano: null }));
    expect((await reservar(entradaPublica(c, { ip }))).resultado).toBe('limitado');
    expect((await reservar(entradaPublica(c, { ip: ipNovo() }))).resultado).toBe('confirmada');
    const daqui15min = new Date(AGORA.getTime() + 15 * 60_000);
    expect((await reservar(entradaPublica(c, { ip, inicio: hora(11) }), daqui15min)).resultado).toBe('confirmada');
  });

  it('CA-5/CA-10: token inválido ou ausente não cria cliente nem reserva; o documentado segue', async () => {
    const c = await criarCenarioReserva();
    const antes = await contarLinhas(c.s.salaoId);
    for (const tokenHumano of ['TOKEN.INVALIDO', null, '']) {
      expect(await reservar(entradaPublica(c, { tokenHumano }))).toEqual({
        resultado: 'recusado',
        mensagem: MENSAGENS_PROTECAO.humano,
      });
    }
    expect(await contarLinhas(c.s.salaoId)).toEqual(antes);
    expect((await reservar(entradaPublica(c))).resultado).toBe('confirmada');
  });

  it('falha do verificador (porta indisponível) recusa: falha fechada', async () => {
    const c = await criarCenarioReserva();
    const antes = await contarLinhas(c.s.salaoId);
    const r = await reservarPelaPagina(entradaPublica(c), AGORA, { enfileirar }, { verificarHumano: async () => false });
    expect(r.resultado).toBe('recusado');
    expect(await contarLinhas(c.s.salaoId)).toEqual(antes);
  });

  it('CA-9: nenhuma linha de rate_limit_janela traz IP ou telefone em claro', async () => {
    const c = await criarCenarioReserva();
    const ip = '198.51.100.77';
    const telefone = '(11) 91234-5678';
    await reservar(entradaPublica(c, { ip, telefone }));
    const linhas = await db().$queryRaw<{ chave: string }[]>`SELECT chave FROM rate_limit_janela WHERE chave LIKE 'pub:%'`;
    expect(linhas.length).toBeGreaterThanOrEqual(2);
    for (const { chave } of linhas) {
      expect(chave).toMatch(/^pub:(reserva|disponibilidade|avaliacao|denuncia):(ip|tel):[0-9a-f]{64}$/);
      expect(chave).not.toContain(ip);
      expect(chave).not.toContain('91234');
      expect(chave).not.toContain('5511');
    }
  });
});

describe('limite por número (CA-4)', () => {
  it('de IPs distintos, a 6ª tentativa do mesmo número é limitada; outro salão e outro número não', async () => {
    const c = await criarCenarioReserva();
    const outro = await criarCenarioReserva();
    const telefone = telefoneNovo();
    await tresFuturas(c, telefone); // 3 tentativas (IPs diferentes)
    for (const h of [13, 14]) expect((await reservar(entradaPublica(c, { telefone, inicio: hora(h) }))).resultado).toBe('recusado');
    const antes = await contarLinhas(c.s.salaoId);
    expect(await reservar(entradaPublica(c, { telefone, inicio: hora(15) }))).toEqual({
      resultado: 'limitado',
      mensagem: MENSAGENS_PROTECAO.limitado,
    });
    expect(await contarLinhas(c.s.salaoId)).toEqual(antes);
    expect(await contadorDoNumero(c.s.salaoId, E164(telefone))).toBe(6);

    expect((await reservar(entradaPublica(outro, { telefone, inicio: hora(10) }))).resultado).toBe('confirmada');
    expect((await reservar(entradaPublica(c, { telefone: telefoneNovo(), inicio: hora(16) }))).resultado).toBe('confirmada');
  });

  it('telefone inválido: erro de validação, sem contador de número', async () => {
    const c = await criarCenarioReserva();
    const ip = ipNovo();
    const r = await reservar(entradaPublica(c, { ip, telefone: '123' }));
    expect(r.resultado).toBe('invalido');
    expect(await contadorDoIp(ip)).toBe(1);
  });
});

describe('ordem e idempotência (CA-17, §7)', () => {
  it('CA-17: salão suspenso responde indisponível antes de consumir qualquer cota', async () => {
    const c = await criarCenarioReserva();
    await definirAssinatura(c.s.salaoId, 'suspensa');
    const ip = ipNovo();
    const telefone = telefoneNovo();
    expect(await reservar(entradaPublica(c, { ip, telefone }))).toEqual({ resultado: 'indisponivel' });
    expect(await contadorDoIp(ip)).toBe(0);
    expect(await contadorDoNumero(c.s.salaoId, E164(telefone))).toBe(0);
  });

  it('a repetição da mesma requisição é repetida, nunca limitada por futuras nem consome o número', async () => {
    const c = await criarCenarioReserva();
    const telefone = telefoneNovo();
    const primeira = entradaPublica(c, { telefone, inicio: hora(10) });
    expect((await reservar(primeira)).resultado).toBe('confirmada');
    await reservar(entradaPublica(c, { telefone, inicio: hora(11) }));
    await reservar(entradaPublica(c, { telefone, inicio: hora(12) })); // 3 futuras; número em 3
    const antes = await contadorDoNumero(c.s.salaoId, E164(telefone));
    for (let i = 0; i < 4; i++) {
      const r = await reservar({ ...primeira, ip: ipNovo() });
      expect(r).toMatchObject({ resultado: 'confirmada', repetida: true });
    }
    expect(await contadorDoNumero(c.s.salaoId, E164(telefone))).toBe(antes);
    expect(await db().reserva.count({ where: { salaoId: c.s.salaoId } })).toBe(3);
  });

  it('chave nova mas inválida não passa como repetida', async () => {
    const c = await criarCenarioReserva();
    const r = await reservar(entradaPublica(c, { chaveRequisicao: 'nao-e-uuid' }));
    expect(r.resultado).toBe('invalido');
  });

  it('a limitação por IP vem antes de qualquer consulta ao banco de reservas (chave aleatória)', async () => {
    const c = await criarCenarioReserva();
    const ip = ipNovo();
    for (let i = 0; i < 10; i++) await reservar(entradaPublica(c, { ip, tokenHumano: null, chaveRequisicao: randomUUID() }));
    expect((await reservar(entradaPublica(c, { ip }))).resultado).toBe('limitado');
  });
});
