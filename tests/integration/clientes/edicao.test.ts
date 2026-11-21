import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as acoes from '@/server/clientes/clientes.acao';
import { obter } from '@/server/clientes/servico';
import { MENSAGENS_CLIENTE } from '@/server/clientes/tipos';
import type { EntradaEditarCliente } from '@/server/clientes/tipos';
import { metadadosDaAcao } from '@/server/tenant/define-acao';

import { criarDoisSaloes, criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { conectar } from '../../support/sql';

import {
  ACESSO_NEGADO,
  NAO_AUTENTICADO,
  NAO_ENCONTRADO,
  UUID_INEXISTENTE,
  anonimizarPorSql,
  contarClientes,
  credGestor,
  credProfissional,
  ctxDoGestor,
  fotografiaReservas,
  inserirCliente,
  linhaCliente,
} from './apoio';

// D-022 T-5: edição de nome e telefone pela ação (acao.executar) contra PostgreSQL real.
// CA-2 (edição), CA-5, CA-7, CA-10, CA-11, CA-15, CA-16, RN-12, RN-13.

let c: pg.Client;
let a: SalaoCompleto;
let b: SalaoCompleto;

beforeAll(async () => {
  c = await conectar();
  ({ a, b } = await criarDoisSaloes());
});
beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterAll(async () => {
  await c.end();
});

const editar = async (s: SalaoCompleto, entrada: Record<string, unknown>) => acoes.editarCliente.executar(await credGestor(s), entrada as EntradaEditarCliente);

describe('CA-10: edita nome e telefone preservando reservas, itens e mensagens', () => {
  it('muda a cliente; id, reserva, reserva_item e mensagem idênticos; o detalhe mostra o novo nome', async () => {
    const s = await criarSalaoCompleto({ cliente: { nome: 'Nome Antigo', telefoneE164: '+5511933330001' } });
    await c.query(
      `INSERT INTO mensagem (salao_id, reserva_id, tipo, revisao, estado, destinatario_e164)
       VALUES ($1, $2, 'confirmacao', 0, 'enviada', '+5511933330001')`,
      [s.salaoId, s.reserva.id],
    );
    const antes = await fotografiaReservas(c, s.salaoId);
    expect(antes.mensagem).toHaveLength(1);
    const r = await editar(s, { id: s.clientes.ativaId, nome: '  Nome   Novo ', telefone: '(21) 98888-7777' });
    expect(r).toEqual({
      ok: true,
      dados: {
        resultado: 'ok',
        alterada: true,
        cliente: {
          id: s.clientes.ativaId,
          nome: 'Nome Novo',
          telefone: '+5521988887777',
          telefoneFormatado: '(21) 98888-7777',
          anonimizada: false,
        },
      },
    });
    expect(await fotografiaReservas(c, s.salaoId)).toEqual(antes);
    const linha = await linhaCliente(c, s.clientes.ativaId);
    expect(linha).toMatchObject({ nome: 'Nome Novo', telefone_e164: '+5521988887777' });
    const d = await obter(ctxDoGestor(s), s.clientes.ativaId);
    expect(d.cliente.nome).toBe('Nome Novo');
    expect(d.historico).toHaveLength(1);
  });

  it('só o nome muda (telefone igual em outra máscara): alterada=true', async () => {
    const s = await criarSalaoCompleto({ cliente: { nome: 'Rosa', telefoneE164: '+5511933330002' } });
    const r = await editar(s, { id: s.clientes.ativaId, nome: 'Rosa Maria', telefone: '11 93333-0002' });
    expect(r).toMatchObject({ ok: true, dados: { resultado: 'ok', alterada: true, cliente: { nome: 'Rosa Maria', telefone: '+5511933330002' } } });
  });

  it('RN-12: valores idênticos (também em outra máscara) → sucesso sem escrever nada, nem atualizado_em', async () => {
    const s = await criarSalaoCompleto({ cliente: { nome: 'Igual', telefoneE164: '+5511933330003' } });
    const antes = await linhaCliente(c, s.clientes.ativaId);
    for (const tel of ['+5511933330003', '(11) 93333-0003', '5511933330003']) {
      const r = await editar(s, { id: s.clientes.ativaId, nome: ' Igual ', telefone: tel });
      expect(r).toMatchObject({ ok: true, dados: { resultado: 'ok', alterada: false } });
    }
    expect(await linhaCliente(c, s.clientes.ativaId)).toEqual(antes);
  });

  it('entradas inválidas: todos os erros juntos, nada gravado', async () => {
    const s = await criarSalaoCompleto({ cliente: { nome: 'Intacta', telefoneE164: '+5511933330004' } });
    const antes = await linhaCliente(c, s.clientes.ativaId);
    expect(await editar(s, { id: s.clientes.ativaId, nome: 'A', telefone: 'abc' })).toEqual({
      ok: true,
      dados: { resultado: 'invalido', erros: { telefone: MENSAGENS_CLIENTE.telefone, nome: MENSAGENS_CLIENTE.nomeTamanho } },
    });
    for (const telefone of ['+1 415 555 0100', '(20) 98765-4321', '0800 123 4567', '(11) 8765-432', 7, null]) {
      expect(await editar(s, { id: s.clientes.ativaId, nome: 'Intacta', telefone }), String(telefone)).toMatchObject({
        ok: true,
        dados: { resultado: 'invalido', erros: { telefone: MENSAGENS_CLIENTE.telefone } },
      });
    }
    expect(await editar(s, { id: s.clientes.ativaId, nome: '', telefone: '11933330004' })).toMatchObject({
      dados: { resultado: 'invalido', erros: { nome: MENSAGENS_CLIENTE.nomeObrigatorio } },
    });
    expect(await linhaCliente(c, s.clientes.ativaId)).toEqual(antes);
  });
});

describe('CA-11: telefone já existente', () => {
  it('em qualquer máscara → recusado/telefone_em_uso com a cliente existente; X inalterada', async () => {
    const s = await criarSalaoCompleto({ cliente: { nome: 'Xavier', telefoneE164: '+5511944440001' } });
    const yId = await inserirCliente(c, s.salaoId, 'Yara', '+5511944440002');
    const antes = await linhaCliente(c, s.clientes.ativaId);
    for (const tel of ['+5511944440002', '(11) 94444-0002', '5511944440002', '11944440002']) {
      expect(await editar(s, { id: s.clientes.ativaId, nome: 'Xavier', telefone: tel }), tel).toEqual({
        ok: true,
        dados: { resultado: 'recusado', motivo: 'telefone_em_uso', existente: { id: yId, nome: 'Yara' } },
      });
    }
    expect(await linhaCliente(c, s.clientes.ativaId)).toEqual(antes);
  });

  it('o mesmo número em outro salão é aceito; o de uma cliente depois anonimizada fica livre', async () => {
    const s = await criarSalaoCompleto({ cliente: { nome: 'Wanda', telefoneE164: '+5511944440010' } });
    await inserirCliente(c, b.salaoId, 'Outro Salão', '+5511944440011');
    expect(await editar(s, { id: s.clientes.ativaId, nome: 'Wanda', telefone: '+5511944440011' })).toMatchObject({
      dados: { resultado: 'ok', alterada: true },
    });
    const zId = await inserirCliente(c, s.salaoId, 'Zilda', '+5511944440012');
    await anonimizarPorSql(c, zId);
    expect(await editar(s, { id: s.clientes.ativaId, nome: 'Wanda', telefone: '+5511944440012' })).toMatchObject({
      dados: { resultado: 'ok', alterada: true, cliente: { telefone: '+5511944440012' } },
    });
  });
});

describe('CA-5, CA-7, CA-15: acesso e escopo', () => {
  it('anonimizada, de outro salão, inexistente e id malformado → 404 sem escrita', async () => {
    const antesAnon = await linhaCliente(c, a.clientes.anonimizadaId);
    const antesB = await linhaCliente(c, b.clientes.ativaId);
    const cred = await credGestor(a);
    for (const id of [a.clientes.anonimizadaId, b.clientes.ativaId, UUID_INEXISTENTE, 'nao-uuid', '', undefined, 7]) {
      expect(await acoes.editarCliente.executar(cred, { id, nome: 'Fulana', telefone: '11987654321' }), String(id)).toEqual(NAO_ENCONTRADO);
    }
    expect(await linhaCliente(c, a.clientes.anonimizadaId)).toEqual(antesAnon);
    expect(await linhaCliente(c, b.clientes.ativaId)).toEqual(antesB);
  });

  it('profissional → 403 sem escrita; sem sessão → 401', async () => {
    const antes = await linhaCliente(c, a.clientes.ativaId);
    const cred = await credProfissional(a);
    expect(await acoes.editarCliente.executar(cred, { id: a.clientes.ativaId, nome: 'Invasor', telefone: '11987654321' })).toEqual(ACESSO_NEGADO);
    expect(await linhaCliente(c, a.clientes.ativaId)).toEqual(antes);
    expect(await acoes.editarCliente.executar({ token: 'x'.repeat(40) } as never, { id: a.clientes.ativaId, nome: 'N', telefone: '1' })).toEqual(NAO_AUTENTICADO);
  });

  it('salaoId forjado na entrada: só o salão da sessão é afetado', async () => {
    const s = await criarSalaoCompleto({ cliente: { nome: 'Cida', telefoneE164: '+5511944440020' } });
    const antesB = await linhaCliente(c, b.clientes.ativaId);
    const r = await editar(s, { id: s.clientes.ativaId, nome: 'Cida Silva', telefone: '+5511944440020', salaoId: b.salaoId });
    expect(r).toMatchObject({ dados: { resultado: 'ok', alterada: true } });
    // forjado + id de B: 404, B intacta
    expect(await editar(s, { id: b.clientes.ativaId, nome: 'Roubo', telefone: '11944440021', salaoId: b.salaoId })).toEqual(NAO_ENCONTRADO);
    expect(await linhaCliente(c, b.clientes.ativaId)).toEqual(antesB);
    expect(await contarClientes(c, s.salaoId, '+5511944440021')).toBe(0);
  });
});

describe('CA-16: registro da ação', () => {
  it('todos os exports são defineAcao de gestor (editar: configurar; anonimizar, D-031: lgpd)', () => {
    const exportadas = Object.entries(acoes);
    expect(exportadas.map(([n]) => n)).toEqual(['editarCliente', 'anonimizarCliente']);
    const capacidade = { editarCliente: 'configurar', anonimizarCliente: 'lgpd' } as const;
    for (const [nome, acao] of exportadas) {
      expect(metadadosDaAcao(acao)).toEqual({ papeis: ['gestor'], capacidade: capacidade[nome as keyof typeof capacidade] });
    }
  });
});
