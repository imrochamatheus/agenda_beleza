import { afterEach, describe, expect, it, vi } from 'vitest';

import { chaveIp } from '@/server/protecao/chaves';
import { LOTE_LIMPEZA, limparJanelasExpiradas } from '@/server/protecao/limpeza';
import { limitarPorIp } from '@/server/protecao/limite';
import { incrementarJanela, removerExpiradas } from '@/server/repos/rate-limit';
import { obterPrisma } from '@/server/repos/db';

import { ipNovo } from '../../support/reserva-publica';
import { contadorDa, contadorDoIp } from './apoio';

// D-027 CA-11, CA-12 e os incrementos paralelos, contra o PostgreSQL real.

afterEach(() => {
  vi.unstubAllEnvs();
});

const db = () => obterPrisma();
const AGORA = new Date('2026-11-21T12:00:00Z');

describe('CA-11: API reutilizável por IP (E4.5 e E8.4)', () => {
  it('avaliacao e denuncia: a chamada K+1 é negada e os escopos não compartilham contador', async () => {
    vi.stubEnv('PROTECAO_LIMITE_IP_AVALIACAO', '3');
    vi.stubEnv('PROTECAO_LIMITE_IP_DENUNCIA', '2');
    const ip = ipNovo();
    const av = [];
    for (let i = 0; i < 4; i++) av.push((await limitarPorIp(ip, 'avaliacao', AGORA)).permitido);
    expect(av).toEqual([true, true, true, false]);
    const den = [];
    for (let i = 0; i < 3; i++) den.push((await limitarPorIp(ip, 'denuncia', AGORA)).permitido);
    expect(den).toEqual([true, true, false]);
    const negada = await limitarPorIp(ip, 'avaliacao', AGORA);
    expect(negada).toEqual({ permitido: false, reiniciaEm: new Date('2026-11-21T12:15:00Z') });
    expect(await contadorDoIp(ip, 'avaliacao')).toBe(5);
    expect(await contadorDoIp(ip, 'denuncia')).toBe(3);
    expect(await contadorDoIp(ip, 'reserva')).toBe(0);
  });

  it('em paralelo: exatamente K de N passam (incremento atômico, sem perda)', async () => {
    vi.stubEnv('PROTECAO_LIMITE_IP_DENUNCIA', '7');
    const ip = ipNovo();
    const rs = await Promise.all(Array.from({ length: 30 }, () => limitarPorIp(ip, 'denuncia', AGORA)));
    expect(rs.filter((r) => r.permitido)).toHaveLength(7);
    expect(await contadorDoIp(ip, 'denuncia')).toBe(30);
  });

  it('janela fixa: a janela seguinte recomeça', async () => {
    vi.stubEnv('PROTECAO_LIMITE_IP_DENUNCIA', '1');
    const ip = ipNovo();
    expect((await limitarPorIp(ip, 'denuncia', AGORA)).permitido).toBe(true);
    expect((await limitarPorIp(ip, 'denuncia', AGORA)).permitido).toBe(false);
    expect((await limitarPorIp(ip, 'denuncia', new Date(AGORA.getTime() + 15 * 60_000))).permitido).toBe(true);
  });

  it('janela configurável', async () => {
    vi.stubEnv('PROTECAO_JANELA_SEGUNDOS', '3600');
    vi.stubEnv('PROTECAO_LIMITE_IP_DENUNCIA', '1');
    const ip = ipNovo();
    expect((await limitarPorIp(ip, 'denuncia', AGORA)).permitido).toBe(true);
    const r = await limitarPorIp(ip, 'denuncia', new Date(AGORA.getTime() + 30 * 60_000));
    expect(r).toEqual({ permitido: false, reiniciaEm: new Date('2026-11-21T13:00:00Z') });
  });
});

async function inserir(chave: string, janela: Date, contador = 1) {
  await db().$executeRaw`INSERT INTO rate_limit_janela (chave, janela_inicio, contador) VALUES (${chave}, ${janela}::timestamptz, ${contador})`;
}

describe('CA-12: limpeza', () => {
  it('apaga as janelas expiradas, preserva as vigentes e reexecutar não altera nada', async () => {
    const velha = `pub:teste:${ipNovo()}:velha`;
    const quase = `pub:teste:${ipNovo()}:quase`;
    const vigente = `pub:teste:${ipNovo()}:vigente`;
    // Corte = agora - (900 s + 1 h) = 10:45.
    await inserir(velha, new Date('2026-11-21T10:44:59Z'));
    await inserir(quase, new Date('2026-11-21T10:45:00Z'));
    await inserir(vigente, new Date('2026-11-21T12:00:00Z'), 4);

    const primeira = await limparJanelasExpiradas(AGORA, { janelaSegundos: 900 });
    expect(primeira).toBeGreaterThanOrEqual(1);
    expect(await contadorDa(velha)).toBe(0);
    expect(await contadorDa(quase)).toBe(1);
    expect(await contadorDa(vigente)).toBe(4);
    expect(await limparJanelasExpiradas(AGORA, { janelaSegundos: 900 })).toBe(0);
    expect(await contadorDa(quase)).toBe(1);
  });

  it('mais de um lote: apaga tudo e conta cada linha uma vez, inclusive com duas limpezas em paralelo', async () => {
    const prefixo = `pub:lote:${ipNovo()}:`;
    const n = LOTE_LIMPEZA * 2 + 345;
    await db().$executeRaw`
      INSERT INTO rate_limit_janela (chave, janela_inicio, contador)
      SELECT ${prefixo}::text || g::text, '2026-01-01T00:00:00Z'::timestamptz, 1 FROM generate_series(1, ${n}::int) g`;
    const conta = async () =>
      Number((await db().$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM rate_limit_janela WHERE chave LIKE ${prefixo + '%'}`)[0].n);
    expect(await conta()).toBe(n);
    const [a, b] = await Promise.all([
      limparJanelasExpiradas(AGORA, { janelaSegundos: 900 }),
      limparJanelasExpiradas(AGORA, { janelaSegundos: 900 }),
    ]);
    expect(await conta()).toBe(0);
    // Linhas de outros testes (janelas de 2026-11-21 antigas) podem somar; as deste teste foram apagadas uma vez só.
    expect(a + b).toBeGreaterThanOrEqual(n);
    expect(await limparJanelasExpiradas(AGORA, { janelaSegundos: 900 })).toBe(0);
  });

  it('removerExpiradas valida o lote e respeita o corte (janela vigente nunca entra)', async () => {
    await expect(removerExpiradas(AGORA, 0)).rejects.toThrow(RangeError);
    const chave = `pub:teste:${ipNovo()}:atual`;
    await incrementarJanela(chave, new Date());
    expect(await removerExpiradas(new Date(Date.now() - 3_600_000), 1000)).toBeGreaterThanOrEqual(0);
    expect(await contadorDa(chave)).toBe(1);
  });
});

describe('chaves no banco (CA-9)', () => {
  it('a chave de IP gravada é a do hash', async () => {
    vi.stubEnv('PROTECAO_LIMITE_IP_AVALIACAO', '5');
    const ip = ipNovo();
    await limitarPorIp(ip, 'avaliacao', AGORA);
    expect(await contadorDa(chaveIp('avaliacao', ip))).toBe(1);
    const linhas = await db().$queryRaw<{ chave: string }[]>`SELECT chave FROM rate_limit_janela WHERE chave LIKE ${`%${ip}%`}`;
    expect(linhas).toEqual([]);
  });
});
