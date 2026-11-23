import { describe, expect, it } from 'vitest';

import type { EntradaReservaEquipe } from '@/server/reservas/tipos';

import { ANA_DEMO, BIA_DEMO, CARLA_DEMO, demonstrarReservaManual, SERVICOS_DEMO } from './demonstracao';

// D-029 / D-050: a demonstração usa as mesmas funções puras do serviço (validação do formulário, checagem entre
// itens, detecção de encaixe por item e o texto de sobreposição).
const AGORA = new Date('2026-11-20T12:00:00Z');
const [ESCOVA, HIDRATACAO, MANICURE] = SERVICOS_DEMO;
const linha = (servicoId: string, profissionalId: string, hora: string) => ({ servicoId, profissionalId, hora });
const entrada = (sobre: Partial<EntradaReservaEquipe> = {}): EntradaReservaEquipe => ({
  data: '2026-12-01', // terça
  itens: [linha(ESCOVA.id, ANA_DEMO.id, '09:00'), linha(HIDRATACAO.id, BIA_DEMO.id, '10:00'), linha(MANICURE.id, CARLA_DEMO.id, '15:00')],
  nome: 'Maria Souza',
  telefone: '(11) 91234-5678',
  aceites: { mensagensReserva: 'on' },
  confirmarEncaixe: undefined,
  chaveRequisicao: null,
  ...sobre,
});
const motivos = (r: ReturnType<typeof demonstrarReservaManual>) => (r.resultado === 'encaixe_requer_confirmacao' ? r.motivos : null);

describe('demonstrarReservaManual', () => {
  it('três serviços em horário normal: criada, itens por início, sem encaixe; mensagem pendente só com aceite', () => {
    const r = demonstrarReservaManual(entrada({ itens: [linha(MANICURE.id, CARLA_DEMO.id, '15:00'), linha(ESCOVA.id, ANA_DEMO.id, '09:00')] }), AGORA);
    expect(r.resultado).toBe('criada');
    if (r.resultado !== 'criada') return;
    expect(r.reserva.itens.map((i) => [i.servicoId, i.ordem, i.encaixe])).toEqual([[ESCOVA.id, 1, false], [MANICURE.id, 0, false]]);
    expect(r.reserva.inicio.toISOString()).toBe('2026-12-01T12:00:00.000Z');
    expect(r.reserva.fim.toISOString()).toBe('2026-12-01T18:40:00.000Z');
    expect(r.confirmacao.estado).toBe('pendente');
    const s = demonstrarReservaManual(entrada({ aceites: null }), AGORA);
    expect(s.resultado === 'criada' && s.confirmacao.estado).toBe('nao_enviada');
  });

  it('encaixe por item: fora da jornada (Bia 19:00) e bloqueio (Carla 13:00); confirmando, flag só nesses', () => {
    const itens = [linha(ESCOVA.id, ANA_DEMO.id, '09:00'), linha(HIDRATACAO.id, BIA_DEMO.id, '19:00'), linha(MANICURE.id, CARLA_DEMO.id, '13:00')];
    expect(motivos(demonstrarReservaManual(entrada({ itens }), AGORA))).toEqual([
      { indice: 1, motivos: ['fora_da_jornada'] },
      { indice: 2, motivos: ['bloqueado'] },
    ]);
    const c = demonstrarReservaManual(entrada({ itens, confirmarEncaixe: 'on' }), AGORA);
    expect(c.resultado === 'criada' && c.reserva.itens.map((i) => i.encaixe)).toEqual([false, true, true]);
    expect(motivos(demonstrarReservaManual(entrada({ data: '2026-12-05', itens: [itens[0]] }), AGORA))).toEqual([
      { indice: 0, motivos: ['fora_do_funcionamento'] },
    ]);
  });

  it('sobreposição entre itens vira erro na hora do item posterior, com nome e faixa', () => {
    const r = demonstrarReservaManual(entrada({ itens: [linha(ESCOVA.id, ANA_DEMO.id, '09:00'), linha(HIDRATACAO.id, BIA_DEMO.id, '09:30')] }), AGORA);
    expect(r).toEqual({ resultado: 'invalido', erros: { porItem: { 1: { inicio: 'Este horário se sobrepõe ao Serviço 1 (Escova, 09:00–10:00).' } } } });
  });

  it('passado, serviço e profissional desconhecidos e campos inválidos', () => {
    expect(demonstrarReservaManual(entrada({ data: '2026-11-20', itens: [linha(ESCOVA.id, ANA_DEMO.id, '08:00')] }), AGORA)).toMatchObject({
      resultado: 'invalido',
      erros: { porItem: { 0: { inicio: expect.any(String) } } },
    });
    expect(demonstrarReservaManual(entrada({ itens: [linha('00000000-0000-4000-8000-0000000000ff', ANA_DEMO.id, '09:00')] }), AGORA).resultado).toBe(
      'servico_indisponivel',
    );
    expect(demonstrarReservaManual(entrada({ itens: [linha(ESCOVA.id, 'x', '09:00')] }), AGORA)).toEqual({ resultado: 'profissional_indisponivel', itens: [0] });
    const r = demonstrarReservaManual(entrada({ data: 'x', nome: '', telefone: '1', itens: [linha('', '', '')] }), AGORA);
    expect(r.resultado === 'invalido' && Object.keys(r.erros).sort()).toEqual(['data', 'nome', 'porItem', 'telefone']);
  });
});
