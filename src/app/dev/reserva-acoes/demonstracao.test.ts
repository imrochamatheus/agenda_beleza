import { describe, expect, it } from 'vitest';

import { baseDaVista, demonstrarRemarcarItem, detalheDemo, idDaReservaDemo, lerVista, vistaDoId } from './demonstracao';

// D-030/D-050: a vitrine usa as funções puras do serviço; nada é gravado.
const agora = new Date('2026-11-20T15:00:00Z'); // sexta, 12:00 em São Paulo
const futura = idDaReservaDemo('futura');
const base = { reservaId: futura, itemId: 'item-escova', hora: '10:00' };

describe('vistas', () => {
  it('lista fechada com padrão futura; a vista viaja no id da reserva', () => {
    expect(lerVista('iniciada')).toBe('iniciada');
    expect(lerVista('x')).toBe('futura');
    expect(lerVista(undefined)).toBe('futura');
    expect(vistaDoId(idDaReservaDemo('profissional'))).toBe('profissional');
    expect(vistaDoId('outro')).toBe('futura');
    expect(baseDaVista('cancelada')).toBe('/dev/reserva-acoes?vista=cancelada');
  });
});

describe('detalheDemo', () => {
  it('futura: 3 itens (um cancelado), total dos não cancelados, cancelar todos para o gestor', () => {
    const d = detalheDemo('futura', agora);
    expect(d.itens.map((i) => [i.servicoNome, i.status])).toEqual([
      ['Escova', 'confirmado'],
      ['Hidratação', 'cancelado'],
      ['Manicure', 'confirmado'],
    ]);
    expect(d.itens[0].inicio.getTime()).toBeGreaterThan(agora.getTime());
    expect(d.total).toEqual({ centavos: 13000, servicos: 2, rotulo: 'reserva' });
    expect(d).toMatchObject({ status: 'confirmado', temItemCancelado: true, podeCancelarTodos: true, papel: 'gestor', data: { ano: 2026, mes: 11, dia: 27 } });
  });

  it('iniciada: a Escova já começou (pode marcar a situação); profissional: só o item dela; cancelada: tudo cancelado', () => {
    const i = detalheDemo('iniciada', agora);
    expect(i.itens[0].acoes).toMatchObject({ concluir: true, naoCompareceu: true, cancelar: true });
    const p = detalheDemo('profissional', agora);
    expect(p.itens.map((x) => x.servicoNome)).toEqual(['Escova']);
    expect(p).toMatchObject({ papel: 'profissional', podeCancelarTodos: false, total: { rotulo: 'seus_servicos', servicos: 1 } });
    const c = detalheDemo('cancelada', agora);
    expect(c).toMatchObject({ status: 'cancelado', total: { rotulo: 'cancelada', servicos: 3 } });
    expect(c.itens.every((x) => !x.acoes.cancelar && !x.acoes.remarcar)).toBe(true);
  });
});

describe('demonstrarRemarcarItem', () => {
  it('horário normal: atualizada, sem encaixe; fora da jornada pede confirmação e, confirmando, é encaixe', () => {
    expect(demonstrarRemarcarItem(base, agora)).toMatchObject({ resultado: 'atualizada', itemId: 'item-escova', encaixe: false });
    expect(demonstrarRemarcarItem({ ...base, hora: '19:00' }, agora)).toEqual({ resultado: 'encaixe_requer_confirmacao', motivos: ['fora_da_jornada'] });
    expect(demonstrarRemarcarItem({ ...base, hora: '19:00', confirmarEncaixe: 'on' }, agora)).toMatchObject({ resultado: 'atualizada', encaixe: true });
    expect(demonstrarRemarcarItem({ ...base, profissionalId: 'demo-bia', servicoId: 'demo-corte' }, agora).resultado).toBe('atualizada');
  });

  it('recusas e entradas inválidas', () => {
    expect(demonstrarRemarcarItem({ ...base, hora: '99:99' }, agora)).toMatchObject({ resultado: 'invalido', erros: { inicio: expect.any(String) } });
    expect(demonstrarRemarcarItem({ ...base, data: 'lixo' }, agora)).toMatchObject({ resultado: 'invalido' });
    expect(demonstrarRemarcarItem({ ...base, data: '2026-12-25' }, agora)).toEqual({ resultado: 'recusado', motivo: 'data_diferente' });
    expect(demonstrarRemarcarItem({ ...base, servicoId: 'x' }, agora)).toEqual({ resultado: 'servico_indisponivel' });
    expect(demonstrarRemarcarItem({ ...base, servicoId: 'demo-hidratacao' }, agora)).toEqual({ resultado: 'recusado', motivo: 'servico_repetido' });
    expect(demonstrarRemarcarItem({ ...base, profissionalId: 'outro' }, agora)).toEqual({ resultado: 'profissional_indisponivel' });
    // Item da Carla (inativa): manter o profissional atual é erro de campo (DEF-1); outra ativa resolve.
    expect(demonstrarRemarcarItem({ ...base, itemId: 'item-manicure' }, agora)).toEqual({ resultado: 'invalido', erros: { profissional: 'Escolha a profissional.' } });
    expect(demonstrarRemarcarItem({ ...base, itemId: 'item-manicure', profissionalId: 'demo-carla' }, agora)).toEqual({ resultado: 'profissional_indisponivel' });
    expect(demonstrarRemarcarItem({ ...base, itemId: 'item-hidratacao' }, agora)).toEqual({ resultado: 'recusado', motivo: 'transicao_invalida' });
    // Único item não cancelado (profissional só vê o dele, mas a vitrine confere os visíveis): outra data no passado.
    expect(demonstrarRemarcarItem({ ...base, reservaId: idDaReservaDemo('profissional'), data: '2026-11-19' }, agora)).toMatchObject({ resultado: 'invalido', erros: { inicio: expect.any(String) } });
  });
});
