import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as acoes from '@/server/bloqueios/bloqueios.acao';
import { listar } from '@/server/bloqueios/servico';
import { MENSAGENS_BLOQUEIO } from '@/server/bloqueios/tipos';
import type { ResultadoSalvarBloqueio } from '@/server/bloqueios/tipos';
import type { ResultadoAcao } from '@/server/tenant/define-acao';
import type { Credencial } from '@/server/tenant/sessao';

import { criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

import {
  AGORA,
  MANAUS,
  NAO_ENCONTRADO,
  anonimizarCliente,
  apagarBloqueios,
  comHorario,
  contarMensagens,
  credGestor,
  credProfissional,
  criarReservaEm,
  itemDe,
  ctxDoGestor,
  ctxDoProfissional,
  definirAtivo,
  definirFuso,
  diaInteiro,
  fotografiaReservas,
  inserirBloqueio,
  linhaBloqueio,
  linhasBloqueio,
} from './apoio';
import type { EntradaTeste } from './apoio';

// D-016 T-5: criar, editar e remover pela ação (defineAcao.executar com `agora` fixo), contra
// PostgreSQL real. CA-1, CA-3, CA-4, CA-5, CA-7..CA-12, CA-15..CA-18.

const M = MENSAGENS_BLOQUEIO;
const exec = { agora: AGORA };

let c: pg.Client;

beforeAll(async () => {
  c = await conectar();
});
afterAll(async () => {
  await c.end();
});
beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** Resultado `salvo` (falha o teste com o resultado inteiro se não for). */
function salvo(r: ResultadoAcao<ResultadoSalvarBloqueio>) {
  if (!r.ok || r.dados.resultado !== 'salvo') throw new Error(`esperava salvo: ${JSON.stringify(r)}`);
  return r.dados;
}
function invalido(r: ResultadoAcao<ResultadoSalvarBloqueio>) {
  if (!r.ok || r.dados.resultado !== 'invalido') throw new Error(`esperava invalido: ${JSON.stringify(r)}`);
  return r.dados.erros;
}

describe('criar', () => {
  let s: SalaoCompleto;
  let gestor: Credencial;
  let prof: Credencial;

  beforeAll(async () => {
    s = await criarSalaoCompleto();
    gestor = await credGestor(s);
    prof = await credProfissional(s);
  });

  it('CA-1: o profissional cria na própria agenda; a linha é dele e aparece na lista dele', async () => {
    const d = salvo(await acoes.criarBloqueio.executar(prof, comHorario('10/12/2026', '14:00', '10/12/2026', '16:00', { motivo: 'Dentista' }), exec));
    expect(await linhaBloqueio(c, d.bloqueio.id)).toEqual({
      id: d.bloqueio.id,
      profissional_id: s.profissional.profissionalId,
      inicio: '2026-12-10T17:00:00Z',
      fim: '2026-12-10T19:00:00Z',
      motivo: 'Dentista',
    });
    expect(d.bloqueio).toMatchObject({ periodo: '10/12/2026 14:00 a 10/12/2026 16:00', editavel: true, diaInteiro: false });
    const { itens } = await listar(ctxDoProfissional(s), AGORA);
    expect(itens.map((i) => i.id)).toContain(d.bloqueio.id);
    // O alvo explícito igual ao próprio id também vale.
    const d2 = salvo(
      await acoes.criarBloqueio.executar(prof, comHorario('11/12/2026', '14:00', '11/12/2026', '15:00', { alvo: s.profissional.profissionalId }), exec),
    );
    expect((await linhaBloqueio(c, d2.bloqueio.id))?.profissional_id).toBe(s.profissional.profissionalId);
  });

  it('CA-3: gestor cria bloqueio do salão de dia inteiro em 25/12/2026 → [03:00Z, 03:00Z do dia seguinte)', async () => {
    const d = salvo(await acoes.criarBloqueio.executar(gestor, diaInteiro('25/12/2026', '25/12/2026', { alvo: 'salao', motivo: 'Natal' }), exec));
    expect(await linhaBloqueio(c, d.bloqueio.id)).toEqual({
      id: d.bloqueio.id,
      profissional_id: null,
      inicio: '2026-12-25T03:00:00Z',
      fim: '2026-12-26T03:00:00Z',
      motivo: 'Natal',
    });
    expect(d.bloqueio).toMatchObject({ alvo: { tipo: 'salao' }, diaInteiro: true, periodo: '25/12/2026 (dia inteiro)' });
  });

  it('CA-5: 25/12 22:00 → 26/12 02:00 em São Paulo; 10:00–12:00 em Manaus', async () => {
    const d = salvo(
      await acoes.criarBloqueio.executar(
        gestor,
        comHorario('25/12/2026', '22:00', '26/12/2026', '02:00', { alvo: s.profissional.profissionalId }),
        exec,
      ),
    );
    expect(await linhaBloqueio(c, d.bloqueio.id)).toMatchObject({ inicio: '2026-12-26T01:00:00Z', fim: '2026-12-26T05:00:00Z' });
    expect(d.bloqueio.periodo).toBe('25/12/2026 22:00 a 26/12/2026 02:00');

    const m = await criarSalaoCompleto({ salao: { fuso: MANAUS } });
    const dm = salvo(
      await acoes.criarBloqueio.executar(
        await credGestor(m),
        comHorario('25/12/2026', '10:00', '25/12/2026', '12:00', { alvo: m.profissional.profissionalId }),
        exec,
      ),
    );
    expect(await linhaBloqueio(c, dm.bloqueio.id)).toMatchObject({ inicio: '2026-12-25T14:00:00Z', fim: '2026-12-25T16:00:00Z' });
  });

  it('CA-14: o gestor com perfil de profissional cria bloqueio para o próprio perfil', async () => {
    const d = salvo(
      await acoes.criarBloqueio.executar(gestor, comHorario('12/12/2026', '09:00', '12/12/2026', '10:00', { alvo: s.gestor.profissionalId }), exec),
    );
    expect((await linhaBloqueio(c, d.bloqueio.id))?.profissional_id).toBe(s.gestor.profissionalId);
  });

  it('gestor sem alvo (ausente, vazio) → erro de campo alvo, nada gravado', async () => {
    const antes = await linhasBloqueio(c, s.salaoId);
    for (const extra of [{}, { alvo: '' }, { alvo: '   ' }]) {
      expect(invalido(await acoes.criarBloqueio.executar(gestor, comHorario('12/12/2026', '09:00', '12/12/2026', '10:00', extra), exec))).toEqual({
        alvo: M.alvo,
      });
    }
    expect(await linhasBloqueio(c, s.salaoId)).toEqual(antes);
  });

  it('CA-7: erros de campo são recusados e nada é gravado', async () => {
    const antes = await linhasBloqueio(c, s.salaoId);
    const casos: [EntradaTeste, Record<string, string>][] = [
      [comHorario('12/12/2026', '10:00', '12/12/2026', '10:00'), { periodo: M.ordem }],
      [comHorario('12/12/2026', '10:00', '12/12/2026', '09:00'), { periodo: M.ordem }],
      [diaInteiro('13/12/2026', '12/12/2026'), { dataFim: M.ordemDias }],
      [comHorario('12/12/2026', '14:07', '12/12/2026', '15:00'), { horaInicio: M.granularidade }],
      [comHorario('12/12/2026', '9h', '12/12/2026', '25:00'), { horaInicio: M.hora, horaFim: M.hora }],
      [comHorario('12/12/2026', '14:60', '12/12/2026', '15:00'), { horaInicio: M.hora }],
      [comHorario('31/02/2027', '10:00', '', '11:00'), { dataInicio: M.dataInexistente, dataFim: M.data }],
      [{ modo: 'mensal', dataInicio: '12/12/2026', dataFim: '12/12/2026' }, { modo: M.modo }],
    ];
    for (const [entrada, esperado] of casos) {
      expect(invalido(await acoes.criarBloqueio.executar(gestor, { alvo: 'salao', ...entrada }, exec)), JSON.stringify(entrada)).toEqual(esperado);
    }
    expect(await linhasBloqueio(c, s.salaoId)).toEqual(antes);
  });

  it('CA-8: fim <= agora recusado; hoje, dia inteiro, com início no passado, aceito', async () => {
    const hoje = new Date('2026-12-14T13:30:00Z'); // 10:30 em São Paulo
    // Credencial própria para este relógio (a renovação da sessão usa o `agora` da execução).
    const g = await credGestor(s);
    expect(invalido(await acoes.criarBloqueio.executar(g, comHorario('14/12/2026', '08:00', '14/12/2026', '10:30', { alvo: 'salao' }), { agora: hoje }))).toEqual({
      periodo: M.passado,
    });
    const d = salvo(await acoes.criarBloqueio.executar(g, diaInteiro('14/12/2026', '14/12/2026', { alvo: 'salao' }), { agora: hoje }));
    expect(await linhaBloqueio(c, d.bloqueio.id)).toMatchObject({ inicio: '2026-12-14T03:00:00Z', fim: '2026-12-15T03:00:00Z' });
    // Editar para o passado também é recusado.
    expect(
      invalido(await acoes.editarBloqueio.executar(g, { id: d.bloqueio.id, ...diaInteiro('13/12/2026') }, { agora: hoje })),
    ).toEqual({ periodo: M.passado });
  });

  it('CA-9: 366 dias (e 366 datas) aceitos; um minuto (uma data) a mais e início além de 2 anos recusados', async () => {
    const alvo = { alvo: s.profissionalInativoId };
    salvo(await acoes.criarBloqueio.executar(gestor, comHorario('02/12/2026', '10:00', '03/12/2027', '10:00', alvo), exec));
    salvo(await acoes.criarBloqueio.executar(gestor, diaInteiro('02/12/2026', '02/12/2027', alvo), exec));
    expect(invalido(await acoes.criarBloqueio.executar(gestor, comHorario('02/12/2026', '10:00', '03/12/2027', '10:05', alvo), exec))).toEqual({
      periodo: M.duracao,
    });
    expect(invalido(await acoes.criarBloqueio.executar(gestor, diaInteiro('02/12/2026', '03/12/2027', alvo), exec))).toEqual({ periodo: M.duracao });
    expect(invalido(await acoes.criarBloqueio.executar(gestor, diaInteiro('01/12/2028', '01/12/2028', alvo), exec))).toEqual({
      periodo: M.antecedencia,
    });
  });

  it('CA-10: bloqueios sobrepostos (mesmo profissional e salão) são gravados e listados separadamente', async () => {
    const t = await criarSalaoCompleto();
    await apagarBloqueios(c, t.salaoId);
    const g = await credGestor(t);
    const ana = t.profissional.profissionalId;
    const ids = [
      salvo(await acoes.criarBloqueio.executar(g, comHorario('20/12/2026', '14:00', '20/12/2026', '16:00', { alvo: ana }), exec)).bloqueio.id,
      salvo(await acoes.criarBloqueio.executar(g, comHorario('20/12/2026', '15:00', '20/12/2026', '17:00', { alvo: ana }), exec)).bloqueio.id,
      salvo(await acoes.criarBloqueio.executar(g, diaInteiro('20/12/2026', '20/12/2026', { alvo: 'salao' }), exec)).bloqueio.id,
      // Duplicata idêntica também é aceita (RN-9).
      salvo(await acoes.criarBloqueio.executar(g, comHorario('20/12/2026', '14:00', '20/12/2026', '16:00', { alvo: ana }), exec)).bloqueio.id,
    ];
    expect(new Set(ids).size).toBe(4);
    const { itens } = await listar(ctxDoGestor(t), AGORA);
    expect(itens.map((i) => i.id).sort()).toEqual([...ids].sort());
    expect(itens[0]).toMatchObject({ alvo: { tipo: 'salao' }, periodo: '20/12/2026 (dia inteiro)' });
  });

  it('CA-16: motivo aparado; vazio → NULL; 201 caracteres recusado', async () => {
    const d1 = salvo(await acoes.criarBloqueio.executar(gestor, diaInteiro('21/12/2026', '21/12/2026', { alvo: 'salao', motivo: '  Feriado  ' }), exec));
    expect((await linhaBloqueio(c, d1.bloqueio.id))?.motivo).toBe('Feriado');
    const d2 = salvo(await acoes.criarBloqueio.executar(gestor, diaInteiro('21/12/2026', '21/12/2026', { alvo: 'salao', motivo: '' }), exec));
    expect((await linhaBloqueio(c, d2.bloqueio.id))?.motivo).toBeNull();
    expect(
      invalido(await acoes.criarBloqueio.executar(gestor, diaInteiro('21/12/2026', '21/12/2026', { alvo: 'salao', motivo: 'x'.repeat(201) }), exec)),
    ).toEqual({ motivo: M.motivo });
  });
});

describe('CA-4: aviso de reservas cobertas', () => {
  let s: SalaoCompleto;
  let gestor: Credencial;
  const r: Record<string, string> = {};

  beforeAll(async () => {
    s = await criarSalaoCompleto();
    gestor = await credGestor(s);
    const base = { salaoId: s.salaoId, clienteId: s.clientes.ativaId };
    const ana = s.profissional.profissionalId;
    const gp = s.gestor.profissionalId!;
    // Bloqueio de referência: 16/12/2026 14:00–18:00 local = [17:00Z, 21:00Z).
    r.coberta = await criarReservaEm(c, { ...base, profissionalId: ana, inicio: '2026-12-16T18:00Z', fim: '2026-12-16T19:00Z' });
    r.encosta = await criarReservaEm(c, { ...base, profissionalId: ana, inicio: '2026-12-16T16:00Z', fim: '2026-12-16T17:00Z' });
    r.cancelada = await criarReservaEm(c, { ...base, profissionalId: ana, inicio: '2026-12-16T19:00Z', fim: '2026-12-16T20:00Z', status: 'cancelado' });
    r.colega = await criarReservaEm(c, { salaoId: s.salaoId, clienteId: s.clientes.anonimizadaId, profissionalId: gp, inicio: '2026-12-16T18:00Z', fim: '2026-12-16T19:00Z' });
  });

  it('bloqueio do profissional: lista só a coberta dele; reservas e mensagens intactas', async () => {
    const antes = await fotografiaReservas(c, s.salaoId);
    const mensagens = await contarMensagens(c);
    const d = salvo(
      await acoes.criarBloqueio.executar(gestor, comHorario('16/12/2026', '14:00', '16/12/2026', '18:00', { alvo: s.profissional.profissionalId }), exec),
    );
    expect(d.aviso).toEqual({
      total: 1,
      reservas: [
        { id: r.coberta, itemId: await itemDe(c, r.coberta), profissionalNome: s.profissional.nome, inicioLocal: '16/12/2026 15:00', fimLocal: '16/12/2026 16:00', cliente: s.clientes.nomeAtiva },
      ],
    });
    expect(await fotografiaReservas(c, s.salaoId)).toEqual(antes);
    expect(await contarMensagens(c)).toBe(mensagens);
  });

  it('bloqueio do salão: lista as de todos os profissionais (cliente anonimizada como "cliente removida")', async () => {
    const antes = await fotografiaReservas(c, s.salaoId);
    const mensagens = await contarMensagens(c);
    const d = salvo(await acoes.criarBloqueio.executar(gestor, diaInteiro('16/12/2026', '16/12/2026', { alvo: 'salao' }), exec));
    expect(d.aviso.total).toBe(3);
    // Ordem por início e id do ITEM (D-050): a que encosta no bloqueio de profissional fica dentro do dia inteiro.
    const empate = await Promise.all([r.coberta, r.colega].map(async (id) => ({ id, item: await itemDe(c, id) })));
    empate.sort((x, y) => (x.item < y.item ? -1 : 1));
    expect(d.aviso.reservas.map((x) => x.id)).toEqual([r.encosta, ...empate.map((x) => x.id)]);
    expect(d.aviso.reservas.find((x) => x.id === r.colega)).toMatchObject({ cliente: 'cliente removida' });
    expect(d.aviso.reservas.map((x) => x.id)).not.toContain(r.cancelada);
    expect(await fotografiaReservas(c, s.salaoId)).toEqual(antes);
    expect(await contarMensagens(c)).toBe(mensagens);
  });

  it('a reserva da fábrica (dois itens) fica idêntica sob um bloqueio que a cobre; uma linha por item (D-050); status confirmado', async () => {
    const t = await criarSalaoCompleto({ reserva: { inicio: new Date('2026-12-17T17:00:00Z') } });
    await anonimizarCliente(c, t.clientes.ativaId);
    const antes = await fotografiaReservas(c, t.salaoId);
    const d = salvo(await acoes.criarBloqueio.executar(await credGestor(t), diaInteiro('17/12/2026', '17/12/2026', { alvo: 'salao' }), exec));
    expect(d.aviso.reservas).toEqual([
      expect.objectContaining({ id: t.reserva.id, itemId: t.reserva.itemIds[0], cliente: 'cliente removida', inicioLocal: '17/12/2026 14:00' }),
      expect.objectContaining({ id: t.reserva.id, itemId: t.reserva.itemIds[1], cliente: 'cliente removida', inicioLocal: '17/12/2026 15:00' }),
    ]);
    expect(await fotografiaReservas(c, t.salaoId)).toEqual(antes);
    const { rows } = await c.query<{ status: string }>('SELECT status::text FROM reserva WHERE id = $1', [t.reserva.id]);
    expect(rows[0].status).toBe('confirmado');
  });

  it('sem reserva coberta → aviso vazio', async () => {
    const d = salvo(await acoes.criarBloqueio.executar(gestor, diaInteiro('30/12/2026', '30/12/2026', { alvo: 'salao' }), exec));
    expect(d.aviso).toEqual({ total: 0, reservas: [] });
  });
});

describe('editar (CA-12)', () => {
  let s: SalaoCompleto;
  let gestor: Credencial;

  beforeAll(async () => {
    s = await criarSalaoCompleto();
    gestor = await credGestor(s);
  });

  it('mesmo id com novo período e motivo; profissional_id não muda; aviso pelo novo intervalo', async () => {
    const ana = s.profissional.profissionalId;
    const reserva = await criarReservaEm(c, { salaoId: s.salaoId, clienteId: s.clientes.ativaId, profissionalId: ana, inicio: '2026-12-18T18:00Z', fim: '2026-12-18T19:00Z' });
    const d = salvo(await acoes.criarBloqueio.executar(gestor, comHorario('18/12/2026', '09:00', '18/12/2026', '10:00', { alvo: ana, motivo: 'A' }), exec));
    expect(d.aviso.total).toBe(0);
    const e = salvo(
      await acoes.editarBloqueio.executar(gestor, { id: d.bloqueio.id, ...comHorario('18/12/2026', '14:00', '18/12/2026', '17:00', { motivo: 'B' }) }, exec),
    );
    expect(e.bloqueio.id).toBe(d.bloqueio.id);
    expect(await linhaBloqueio(c, d.bloqueio.id)).toEqual({
      id: d.bloqueio.id,
      profissional_id: ana,
      inicio: '2026-12-18T17:00:00Z',
      fim: '2026-12-18T20:00:00Z',
      motivo: 'B',
    });
    expect(e.aviso.reservas.map((x) => x.id)).toEqual([reserva]);
    // Para dia inteiro (e motivo vazio → NULL).
    const f = salvo(await acoes.editarBloqueio.executar(gestor, { id: d.bloqueio.id, ...diaInteiro('19/12/2026', '20/12/2026', { motivo: '' }) }, exec));
    expect(f.bloqueio).toMatchObject({ diaInteiro: true, periodo: '19/12/2026 a 20/12/2026', motivo: null });
  });

  it('profissionalId/alvo/salaoId na edição → recusado (formulario), dono intacto', async () => {
    const d = salvo(await acoes.criarBloqueio.executar(gestor, diaInteiro('22/12/2026', '22/12/2026', { alvo: s.profissional.profissionalId }), exec));
    const antes = await linhaBloqueio(c, d.bloqueio.id);
    for (const extra of [{ profissionalId: s.gestor.profissionalId }, { alvo: 'salao' }, { salaoId: s.salaoId }]) {
      expect(invalido(await acoes.editarBloqueio.executar(gestor, { id: d.bloqueio.id, ...diaInteiro('23/12/2026'), ...extra }, exec))).toEqual({
        formulario: M.formulario,
      });
    }
    expect(await linhaBloqueio(c, d.bloqueio.id)).toEqual(antes);
  });

  it('id ausente, não-texto, inexistente ou malformado → 404; validação vem antes', async () => {
    for (const id of [undefined, 7, '00000000-0000-4000-8000-000000000000', 'abc']) {
      expect(await acoes.editarBloqueio.executar(gestor, { id, ...diaInteiro('23/12/2026') } as never, exec)).toEqual(NAO_ENCONTRADO);
    }
    expect(invalido(await acoes.editarBloqueio.executar(gestor, { id: 'abc', ...diaInteiro('9/12/2026', '23/12/2026') }, exec))).toEqual({ dataInicio: M.data });
  });
});

describe('remover (CA-11)', () => {
  it('remove; segunda remoção → 404; bloqueio já encerrado também é removível', async () => {
    const s = await criarSalaoCompleto();
    const gestor = await credGestor(s);
    const d = salvo(await acoes.criarBloqueio.executar(gestor, diaInteiro('24/12/2026', '24/12/2026', { alvo: 'salao' }), exec));
    expect(await acoes.removerBloqueio.executar(gestor, { id: d.bloqueio.id }, exec)).toEqual({ ok: true, dados: { resultado: 'removido', id: d.bloqueio.id } });
    expect(await linhaBloqueio(c, d.bloqueio.id)).toBeUndefined();
    expect(await acoes.removerBloqueio.executar(gestor, { id: d.bloqueio.id }, exec)).toEqual(NAO_ENCONTRADO);

    const passado = await inserirBloqueio(c, { salaoId: s.salaoId, profissionalId: null, inicio: '2026-01-01T03:00Z', fim: '2026-01-02T03:00Z' });
    expect(await acoes.removerBloqueio.executar(gestor, { id: passado }, exec)).toMatchObject({ ok: true });
    expect(await linhaBloqueio(c, passado)).toBeUndefined();
    // O da fábrica (do profissional), pelo próprio profissional.
    expect(await acoes.removerBloqueio.executar(await credProfissional(s), { id: s.bloqueioId }, exec)).toMatchObject({ ok: true });
    expect(await linhaBloqueio(c, s.bloqueioId)).toBeUndefined();
  });

  it('entrada sem id, nula ou com id não-texto → 404', async () => {
    const s = await criarSalaoCompleto();
    const gestor = await credGestor(s);
    for (const e of [{}, null, { id: 3 }, 'x']) {
      expect(await acoes.removerBloqueio.executar(gestor, e as never, exec)).toEqual(NAO_ENCONTRADO);
    }
  });
});

describe('profissional inativo, fuso e lista (CA-15, CA-17, CA-18)', () => {
  it('CA-15: gestor cria, edita e remove bloqueio de inativo; a lista o marca; (des)ativar não altera bloqueios', async () => {
    const s = await criarSalaoCompleto();
    const gestor = await credGestor(s);
    const d = salvo(await acoes.criarBloqueio.executar(gestor, diaInteiro('26/12/2026', '26/12/2026', { alvo: s.profissionalInativoId }), exec));
    expect(d.bloqueio.alvo).toMatchObject({ tipo: 'profissional', id: s.profissionalInativoId, ativo: false });
    salvo(await acoes.editarBloqueio.executar(gestor, { id: d.bloqueio.id, ...diaInteiro('27/12/2026') }, exec));
    const { itens } = await listar(ctxDoGestor(s), AGORA);
    expect(itens.find((i) => i.id === d.bloqueio.id)?.alvo).toMatchObject({ ativo: false });

    const antes = await linhasBloqueio(c, s.salaoId);
    await definirAtivo(c, s.profissionalInativoId, true);
    await definirAtivo(c, s.profissionalInativoId, false);
    expect(await linhasBloqueio(c, s.salaoId)).toEqual(antes);
    expect(await acoes.removerBloqueio.executar(gestor, { id: d.bloqueio.id }, exec)).toMatchObject({ ok: true });
  });

  it('CA-17: trocar o fuso não recalcula; a lista passa a exibir no novo fuso', async () => {
    const s = await criarSalaoCompleto();
    const gestor = await credGestor(s);
    const d = salvo(
      await acoes.criarBloqueio.executar(gestor, comHorario('28/12/2026', '14:00', '28/12/2026', '16:00', { alvo: s.profissional.profissionalId }), exec),
    );
    const antes = await linhaBloqueio(c, d.bloqueio.id);
    await definirFuso(c, s.salaoId, MANAUS);
    expect(await linhaBloqueio(c, d.bloqueio.id)).toEqual(antes);
    const { itens, fuso } = await listar(ctxDoGestor(s), AGORA);
    expect(fuso).toBe(MANAUS);
    expect(itens.find((i) => i.id === d.bloqueio.id)?.periodo).toBe('28/12/2026 13:00 a 28/12/2026 15:00');
  });

  it('CA-18: só em andamento e futuros, por início', async () => {
    const s = await criarSalaoCompleto();
    await apagarBloqueios(c, s.salaoId);
    const encerrado = await inserirBloqueio(c, { salaoId: s.salaoId, profissionalId: null, inicio: '2026-11-01T03:00Z', fim: '2026-11-02T03:00Z' });
    const futuro = await inserirBloqueio(c, { salaoId: s.salaoId, profissionalId: null, inicio: '2026-12-20T03:00Z', fim: '2026-12-21T03:00Z' });
    const andamento = await inserirBloqueio(c, { salaoId: s.salaoId, profissionalId: s.profissional.profissionalId, inicio: '2026-12-01T10:00Z', fim: '2026-12-01T14:00Z' });
    const { itens } = await listar(ctxDoGestor(s), AGORA);
    expect(itens.map((i) => i.id)).toEqual([andamento, futuro]);
    expect(itens.map((i) => i.id)).not.toContain(encerrado);
  });
});
