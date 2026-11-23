import { describe, expect, it } from 'vitest';

import type { ItemDoDetalhe } from '@/server/agenda/tipos';

import {
  etiquetasDoItem,
  horaLocal,
  horaLocalDoFim,
  idDoItem,
  mostrarNotaDeCancelados,
  nomeDoProfissional,
  paradasDaReserva,
  quantidadeDeServicos,
  textoDaData,
  textoDoTotal,
} from './roteiro';

// D-050 web-design §5.10: textos puros do roteiro do detalhe (no fuso do salão, nunca no do processo).
const SP = 'America/Sao_Paulo';

const item = (p: Partial<ItemDoDetalhe> = {}): ItemDoDetalhe => ({
  id: 'i1',
  servicoId: 's1',
  servicoNome: 'Escova',
  profissionalId: 'p1',
  profissionalNome: 'Ana',
  profissionalAtivo: true,
  inicio: new Date('2026-11-26T12:00:00Z'),
  fim: new Date('2026-11-26T13:00:00Z'),
  status: 'confirmado',
  encaixe: false,
  precoCentavos: 9000,
  duracaoMin: 60,
  acoes: { remarcar: true, cancelar: true, concluir: false, naoCompareceu: false },
  ...p,
});

describe('horas e datas', () => {
  it('hora local no fuso do salão; fim na meia-noite seguinte é 24:00', () => {
    expect(horaLocal(new Date('2026-11-26T12:00:00Z'), SP)).toBe('09:00');
    expect(horaLocal(new Date('2026-11-26T12:00:00Z'), 'America/Manaus')).toBe('08:00');
    expect(horaLocalDoFim(new Date('2026-11-26T12:00:00Z'), new Date('2026-11-26T13:00:00Z'), SP)).toBe('10:00');
    expect(horaLocalDoFim(new Date('2026-11-27T02:00:00Z'), new Date('2026-11-27T03:00:00Z'), SP)).toBe('24:00');
  });

  it('data por extenso com dia da semana', () => {
    expect(textoDaData({ ano: 2026, mes: 11, dia: 26 })).toBe('Quinta-feira, 26/11/2026');
    expect(textoDaData({ ano: 2026, mes: 11, dia: 29 })).toBe('Domingo, 29/11/2026');
  });

  it('plural por regra', () => {
    expect(quantidadeDeServicos(1)).toBe('1 serviço');
    expect(quantidadeDeServicos(2)).toBe('2 serviços');
  });
});

describe('paradas', () => {
  it('estado por item: cancelada riscada, destaque no item aberto, escolhida nos demais; etiquetas no masculino', () => {
    const itens = [item(), item({ id: 'i2', status: 'cancelado', servicoNome: 'Hidratação' }), item({ id: 'i3', encaixe: true, profissionalAtivo: false, profissionalNome: 'Carla' })];
    const p = paradasDaReserva({ itens, fuso: SP }, 'i3');
    expect(p.map((x) => x.estado)).toEqual(['escolhida', 'cancelada', 'destaque']);
    expect(p[0]).toMatchObject({ chave: 'i1', id: idDoItem('i1'), hora: '09:00', fim: '10:00', servico: 'Escova', profissional: 'Ana' });
    expect(p[0].detalhe).toMatch(/^1 h · R\$\s*90,00$/);
    expect(p[2].profissional).toBe('Carla (inativo)');
    expect(p[2].etiquetas).toEqual([
      { texto: 'Confirmado', variante: 'confirmado' },
      { texto: 'Encaixe', variante: 'encaixe' },
    ]);
    expect(etiquetasDoItem({ status: 'nao_compareceu', encaixe: false })).toEqual([{ texto: 'Não compareceu', variante: 'nao_compareceu' }]);
    expect(nomeDoProfissional({ profissionalNome: 'Bia', profissionalAtivo: true })).toBe('Bia');
  });
});

describe('total', () => {
  it('rótulo por papel/estado e a nota só com cancelado numa reserva não toda cancelada', () => {
    expect(textoDoTotal({ centavos: 13000, servicos: 2, rotulo: 'reserva' })).toMatchObject({ rotulo: 'Total', servicos: '2 serviços' });
    expect(textoDoTotal({ centavos: 4000, servicos: 1, rotulo: 'seus_servicos' }).rotulo).toBe('Total dos seus serviços');
    expect(textoDoTotal({ centavos: 4000, servicos: 1, rotulo: 'cancelada' }).rotulo).toBe('Total (cancelada)');
    expect(textoDoTotal({ centavos: 13000, servicos: 2, rotulo: 'reserva' }).valor).toMatch(/^R\$\s*130,00$/);
    expect(mostrarNotaDeCancelados({ temItemCancelado: true, total: { centavos: 1, servicos: 1, rotulo: 'reserva' } })).toBe(true);
    expect(mostrarNotaDeCancelados({ temItemCancelado: true, total: { centavos: 1, servicos: 1, rotulo: 'cancelada' } })).toBe(false);
    expect(mostrarNotaDeCancelados({ temItemCancelado: false, total: { centavos: 1, servicos: 1, rotulo: 'reserva' } })).toBe(false);
  });
});
