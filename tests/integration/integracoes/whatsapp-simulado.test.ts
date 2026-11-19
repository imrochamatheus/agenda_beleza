import { randomUUID } from 'node:crypto';

import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CODIGOS_ENTRADA_INVALIDA,
  ErroEnvioPermanente,
  ErroEnvioTemporario,
} from '@/server/integrations/whatsapp/port';
import type { EnvioModelo } from '@/server/integrations/whatsapp/port';
import { criarWhatsAppSimulado } from '@/server/integrations/whatsapp/simulado';
import { criarPrisma } from '@/server/repos/db';
import { repoSimWhatsApp } from '@/server/repos/sim-whatsapp';
import { emTransacao } from '@/server/repos/transacao';

import { urlDoWorker } from '../../support/db';
import { conectar, telefoneNovo } from '../../support/sql';

// CA-20 (RN-11, RN-19): WhatsApp simulado contra o PostgreSQL real. Toda chamada é registrada,
// inclusive as que falham; falhas forçadas são uma fila FIFO consumida entre clientes de banco.
// A chave de cada teste é única: as asserções contam só as chamadas do próprio teste.

const wa = criarWhatsAppSimulado();

let c: pg.Client;

beforeAll(async () => {
  c = await conectar();
});
afterAll(async () => {
  await c.end();
});

function envio(sobrescritas: Partial<EnvioModelo> = {}): EnvioModelo {
  return {
    destinatarioE164: telefoneNovo(),
    modelo: 'confirmacao',
    parametros: { nome: 'Ana', salao: 'Studio Terra', data: '20/11/2026', hora: '14:00' },
    chaveIdempotencia: `${randomUUID()}:confirmacao:1`,
    ...sobrescritas,
  };
}

async function falhasPendentes(): Promise<number> {
  const r = await c.query<{ n: number }>('SELECT count(*)::int AS n FROM sim_whatsapp_falha_forcada');
  return r.rows[0].n;
}

/** Envia e devolve 'sucesso' ou o nome da classe do erro. */
async function resultadoDe(e: EnvioModelo): Promise<string> {
  try {
    await wa.enviarModelo(e);
    return 'sucesso';
  } catch (erro) {
    return (erro as Error).name;
  }
}

describe('CA-20: WhatsApp simulado', () => {
  it('CA-20: envio de confirmação → provedorMensagemId e 1 chamada com sucesso, destinatário, modelo, parâmetros e chave', async () => {
    const e = envio();
    const r = await wa.enviarModelo(e);
    expect(r.provedorMensagemId).toMatch(/^wamid\.SIM\.[0-9a-f-]{36}$/);

    const chamadas = await wa.listarChamadas({ chaveIdempotencia: e.chaveIdempotencia });
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]).toMatchObject({
      destinatario: e.destinatarioE164,
      modelo: 'confirmacao',
      parametros: e.parametros,
      chaveIdempotencia: e.chaveIdempotencia,
      resultado: 'sucesso',
      tipoFalha: null,
      provedorMensagemId: r.provedorMensagemId,
    });
    expect(chamadas[0].criadoEm).toBeInstanceOf(Date);

    // Conferência por SQL direto (independente do repositório).
    const bruta = await c.query(
      `SELECT destinatario, modelo, parametros, resultado::text AS resultado, tipo_falha::text AS tipo_falha,
              provedor_mensagem_id FROM sim_whatsapp_chamada WHERE chave_idempotencia = $1`,
      [e.chaveIdempotencia],
    );
    expect(bruta.rows).toEqual([
      {
        destinatario: e.destinatarioE164,
        modelo: 'confirmacao',
        parametros: e.parametros,
        resultado: 'sucesso',
        tipo_falha: null,
        provedor_mensagem_id: r.provedorMensagemId,
      },
    ]);
  });

  it('CA-20: "próximas 2 falham, temporário" e 3 envios → 2 ErroEnvioTemporario, 1 sucesso, 3 chamadas registradas', async () => {
    const e = envio({ modelo: 'remarcacao', chaveIdempotencia: `${randomUUID()}:remarcacao:2` });
    await wa.forcarFalhas(2, 'temporaria');

    const r1 = wa.enviarModelo(e);
    await expect(r1).rejects.toBeInstanceOf(ErroEnvioTemporario);
    await expect(r1).rejects.toMatchObject({ codigo: 'falha_forcada' });
    await expect(wa.enviarModelo(e)).rejects.toBeInstanceOf(ErroEnvioTemporario);
    const ok = await wa.enviarModelo(e);

    const chamadas = await wa.listarChamadas({ chaveIdempotencia: e.chaveIdempotencia });
    expect(chamadas.map((x) => [x.resultado, x.tipoFalha, x.provedorMensagemId])).toEqual([
      ['falha', 'temporaria', null],
      ['falha', 'temporaria', null],
      ['sucesso', null, ok.provedorMensagemId],
    ]);
    expect(chamadas.filter((x) => x.resultado === 'sucesso')).toHaveLength(1);
    expect(await falhasPendentes()).toBe(0);
  });

  it('CA-20: "próxima falha, permanente" → ErroEnvioPermanente, registrada como falha permanente', async () => {
    const e = envio({ modelo: 'cancelamento', chaveIdempotencia: `${randomUUID()}:cancelamento:1` });
    await wa.forcarFalhas(1, 'permanente');
    const p = wa.enviarModelo(e);
    await expect(p).rejects.toBeInstanceOf(ErroEnvioPermanente);
    await expect(p).rejects.toMatchObject({ codigo: 'falha_forcada' });
    const chamadas = await wa.listarChamadas({ chaveIdempotencia: e.chaveIdempotencia });
    expect(chamadas.map((x) => [x.resultado, x.tipoFalha])).toEqual([['falha', 'permanente']]);
  });

  it('RN-19: falhas forçadas são consumidas em ordem FIFO (2 temporárias e depois 1 permanente)', async () => {
    await wa.forcarFalhas(2, 'temporaria');
    await wa.forcarFalhas(1, 'permanente');
    const e = envio();
    const resultados: string[] = [];
    for (let i = 0; i < 4; i++) resultados.push(await resultadoDe(e));
    expect(resultados).toEqual(['ErroEnvioTemporario', 'ErroEnvioTemporario', 'ErroEnvioPermanente', 'sucesso']);
  });

  it('CA-20: destinatário +12025550123 (não brasileiro) → ErroEnvioPermanente, registrada como falha, sem consumir falha forçada', async () => {
    await wa.forcarFalhas(1, 'temporaria');
    const e = envio({ destinatarioE164: '+12025550123' });
    const p = wa.enviarModelo(e);
    await expect(p).rejects.toBeInstanceOf(ErroEnvioPermanente);
    await expect(p).rejects.toMatchObject({ codigo: CODIGOS_ENTRADA_INVALIDA.destinatario });

    const chamadas = await wa.listarChamadas({ chaveIdempotencia: e.chaveIdempotencia });
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]).toMatchObject({
      destinatario: '+12025550123',
      resultado: 'falha',
      tipoFalha: 'permanente',
      provedorMensagemId: null,
    });
    // A falha forçada continua pendente e é consumida pelo próximo envio válido.
    expect(await falhasPendentes()).toBe(1);
    await expect(wa.enviarModelo(envio())).rejects.toBeInstanceOf(ErroEnvioTemporario);
    expect(await falhasPendentes()).toBe(0);
  });

  it('RN-19: modelo fora da lista e chave vazia também são registrados como falha permanente', async () => {
    const modelo = envio({ modelo: 'lembrete' as EnvioModelo['modelo'] });
    await expect(wa.enviarModelo(modelo)).rejects.toMatchObject({ codigo: CODIGOS_ENTRADA_INVALIDA.modelo });
    expect((await wa.listarChamadas({ chaveIdempotencia: modelo.chaveIdempotencia })).map((x) => [x.modelo, x.resultado, x.tipoFalha])).toEqual([
      ['lembrete', 'falha', 'permanente'],
    ]);

    const destinatario = telefoneNovo();
    await expect(wa.enviarModelo(envio({ destinatarioE164: destinatario, chaveIdempotencia: '  ' }))).rejects.toMatchObject({
      codigo: CODIGOS_ENTRADA_INVALIDA.chaveIdempotencia,
    });
    const r = await c.query(
      "SELECT chave_idempotencia, resultado::text AS resultado FROM sim_whatsapp_chamada WHERE destinatario = $1",
      [destinatario],
    );
    expect(r.rows).toEqual([{ chave_idempotencia: '  ', resultado: 'falha' }]);
  });

  it('RN-19: entrada malformada em runtime (campos ausentes) é registrada como falha, sem erro de banco', async () => {
    const malformada = { modelo: 'confirmacao' } as unknown as EnvioModelo;
    await expect(wa.enviarModelo(malformada)).rejects.toMatchObject({ codigo: CODIGOS_ENTRADA_INVALIDA.destinatario });
    const r = await c.query(
      "SELECT destinatario, parametros, chave_idempotencia FROM sim_whatsapp_chamada WHERE destinatario = '' AND chave_idempotencia = ''",
    );
    expect(r.rows).toEqual([{ destinatario: '', parametros: {}, chave_idempotencia: '' }]);
  });

  it('RN-19: o simulado não deduplica — a mesma chave enviada 2 vezes gera 2 chamadas', async () => {
    const e = envio();
    const a = await wa.enviarModelo(e);
    const b = await wa.enviarModelo(e);
    expect(a.provedorMensagemId).not.toBe(b.provedorMensagemId);
    expect(await wa.listarChamadas({ chaveIdempotencia: e.chaveIdempotencia })).toHaveLength(2);
  });

  it('RN-19: listarChamadas sem filtro inclui as chamadas de todas as chaves, na ordem de registro', async () => {
    const e1 = envio();
    const e2 = envio();
    await wa.enviarModelo(e1);
    await wa.enviarModelo(e2);
    const todas = await wa.listarChamadas();
    const chaves = todas.map((x) => x.chaveIdempotencia);
    expect(chaves.indexOf(e1.chaveIdempotencia)).toBeGreaterThanOrEqual(0);
    expect(chaves.indexOf(e2.chaveIdempotencia)).toBeGreaterThan(chaves.indexOf(e1.chaveIdempotencia));
    expect(await wa.listarChamadas({ chaveIdempotencia: 'inexistente' })).toEqual([]);
  });

  it('RN-19: forcarFalhas recusa n que não é inteiro ≥ 1 e tipo desconhecido, sem gravar', async () => {
    const antes = await falhasPendentes();
    for (const n of [0, -1, 1.5, Number.NaN]) {
      await expect(wa.forcarFalhas(n, 'temporaria')).rejects.toBeInstanceOf(RangeError);
    }
    await expect(wa.forcarFalhas(1, 'outra' as 'temporaria')).rejects.toBeInstanceOf(RangeError);
    expect(await falhasPendentes()).toBe(antes);
    await wa.forcarFalhas(3, 'permanente');
    expect(await falhasPendentes()).toBe(antes + 3);
    // Limpa a fila para os testes seguintes deste arquivo.
    for (let i = 0; i < 3; i++) await resultadoDe(envio());
    expect(await falhasPendentes()).toBe(antes);
  });

  it('CA-20: a falha forçada configurada por um cliente de banco é consumida por uma instância sobre outro', async () => {
    const outroCliente = criarPrisma(urlDoWorker(), { max: 2 });
    try {
      const outro = criarWhatsAppSimulado({ repo: repoSimWhatsApp(outroCliente) });
      await wa.forcarFalhas(1, 'temporaria');
      const e = envio();
      await expect(outro.enviarModelo(e)).rejects.toBeInstanceOf(ErroEnvioTemporario);
      // A chamada registrada pelo outro cliente é vista pela aplicação, e vice-versa.
      expect((await wa.listarChamadas({ chaveIdempotencia: e.chaveIdempotencia })).map((x) => x.resultado)).toEqual(['falha']);
      await wa.enviarModelo(e);
      expect((await outro.listarChamadas({ chaveIdempotencia: e.chaveIdempotencia })).map((x) => x.resultado)).toEqual([
        'falha',
        'sucesso',
      ]);
    } finally {
      await outroCliente.$disconnect();
    }
  });

  it('RN-15: registra fora da transação de quem chama (o rollback do chamador não apaga a chamada)', async () => {
    const e = envio();
    const erro = new Error('falha proposital do chamador');
    await expect(
      emTransacao(async () => {
        await wa.enviarModelo(e);
        throw erro;
      }),
    ).rejects.toBe(erro);
    expect(await wa.listarChamadas({ chaveIdempotencia: e.chaveIdempotencia })).toHaveLength(1);
  });
});
