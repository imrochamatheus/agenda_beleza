import { describe, expect, it } from 'vitest';

import { errosDeSobreposicao, lerData, lerHora, MENSAGENS_FORMULARIO_EQUIPE, validarFormularioDaEquipe } from './reserva-equipe';
import type { EntradaReservaEquipe } from './tipos';

// D-029 RN-5: leitura estrita de data e hora do formulário (sem banco, sem relógio).
describe('lerData', () => {
  it('aceita AAAA-MM-DD válido, com espaços nas pontas', () => {
    expect(lerData('2026-12-01')).toEqual({ ano: 2026, mes: 12, dia: 1 });
    expect(lerData(' 2028-02-29 ')).toEqual({ ano: 2028, mes: 2, dia: 29 });
  });
  it.each(['2026-02-30', '2026-13-01', '01/12/2026', '2026-1-1', '', '2026-12-01T10:00', 20261201, null, undefined, {}])(
    'recusa %j',
    (v) => expect(lerData(v)).toBeNull(),
  );
});

describe('lerHora', () => {
  it('converte HH:MM e H:MM em minutos do dia', () => {
    expect(lerHora('00:00')).toBe(0);
    expect(lerHora('9:05')).toBe(545);
    expect(lerHora(' 23:59 ')).toBe(1439);
  });
  it.each(['24:00', '12:60', '12', '12:5', 'ab:cd', '', 1200, null, undefined])('recusa %j', (v) => expect(lerHora(v)).toBeNull());
});

// D-050 §3.11 / web-design §5.8: validação pura do formulário de N linhas e o texto da sobreposição.
const S1 = '00000000-0000-4000-8000-0000000000a1';
const S2 = '00000000-0000-4000-8000-0000000000a2';
const P1 = '00000000-0000-4000-8000-0000000000b1';
const valido = (sobre: Partial<EntradaReservaEquipe> = {}): EntradaReservaEquipe => ({
  data: '2026-12-01',
  itens: [
    { servicoId: S1, profissionalId: P1, hora: '9:00' },
    { servicoId: S2.toUpperCase(), profissionalId: P1.toUpperCase(), hora: ' 10:30 ' },
  ],
  nome: 'Maria Souza',
  telefone: '(11) 91234-5678',
  aceites: {},
  confirmarEncaixe: undefined,
  chaveRequisicao: null,
  ...sobre,
});

describe('validarFormularioDaEquipe', () => {
  it('válido: data, ids em minúsculas e minutos de cada linha', () => {
    expect(validarFormularioDaEquipe(valido())).toEqual({
      ok: true,
      data: { ano: 2026, mes: 12, dia: 1 },
      itens: [
        { servicoId: S1, profissionalId: P1, minutos: 540 },
        { servicoId: S2, profissionalId: P1, minutos: 630 },
      ],
    });
  });

  it('erros por linha (índice 0-based), serviço repetido cita a linha 1-based, data e cliente juntos', () => {
    const r = validarFormularioDaEquipe(
      valido({
        data: '2026-02-30',
        nome: '',
        itens: [
          { servicoId: S1, profissionalId: P1, hora: '09:00' },
          { servicoId: S1.toUpperCase(), profissionalId: '', hora: '9h' },
          { servicoId: '', profissionalId: P1, hora: '' },
        ],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erros.data).toBe(MENSAGENS_FORMULARIO_EQUIPE.data);
    expect(r.erros.nome).toBeTruthy();
    expect(r.erros.porItem).toEqual({
      1: { servico: 'Este serviço já está no Serviço 1.', profissional: 'Escolha o profissional.', inicio: 'Informe a hora no formato HH:MM.' },
      2: { servico: 'Escolha o serviço.', inicio: 'Informe a hora no formato HH:MM.' },
    });
  });

  it.each([undefined, null, 'x', [], Array.from({ length: 11 }, () => ({}))])('quantidade fora de 1..10 (%j): erro em itens', (itens) => {
    const r = validarFormularioDaEquipe(valido({ itens: itens as EntradaReservaEquipe['itens'] }));
    expect(r.ok === false && r.erros.itens).toBe(MENSAGENS_FORMULARIO_EQUIPE.quantidade);
  });

  it('entrada vazia (varredura de política) não lança', () => {
    expect(validarFormularioDaEquipe({} as EntradaReservaEquipe).ok).toBe(false);
  });
});

describe('errosDeSobreposicao', () => {
  it('erro na hora do item de maior índice, citando nome e faixa local do outro', () => {
    const pedidos = [
      { servicoId: S1, profissionalId: P1, inicio: new Date('2026-12-01T12:00:00Z') },
      { servicoId: S2, profissionalId: P1, inicio: new Date('2026-12-01T12:30:00Z') },
    ];
    const servicos = new Map([[S1, { nome: 'Escova', duracaoMin: 60 }]]);
    expect(errosDeSobreposicao(pedidos, { 1: 0 }, servicos, 'America/Sao_Paulo')).toEqual({
      porItem: { 1: { inicio: 'Este horário se sobrepõe ao Serviço 1 (Escova, 09:00–10:00).' } },
    });
    // Serviço desconhecido: texto genérico e faixa de duração zero (nunca lança).
    expect(errosDeSobreposicao(pedidos, { 0: 1 }, servicos, 'UTC').porItem?.[0].inicio).toBe('Este horário se sobrepõe ao Serviço 2 (serviço, 12:30–12:30).');
  });
});
