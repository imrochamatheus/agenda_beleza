import { describe, expect, it } from 'vitest';

import { CODIGOS_AVISO, MENSAGENS_AVISO, MENSAGENS_PASSO } from './tipos';

// D-050 T-10: textos exatos do web-design (§5.3, §5.6, §5.7), montados a partir de nomes e horas já
// formatados pelo chamador.
describe('MENSAGENS_PASSO', () => {
  it('passo por serviço', () => {
    expect(MENSAGENS_PASSO.indicador(2, 3)).toBe('Serviço 2 de 3');
    expect(MENSAGENS_PASSO.semSelecao('Hidratação')).toBe('Escolha um horário para Hidratação.');
    expect(MENSAGENS_PASSO.horarioPerdido('10:00', 'Hidratação')).toBe('O horário das 10:00 de Hidratação não está mais disponível. Escolha outro.');
    expect(MENSAGENS_PASSO.vazioCalendarioTitulo('Hidratação')).toBe('Nenhum horário para Hidratação neste dia.');
    expect(MENSAGENS_PASSO.vazioCalendarioTexto).toBe('Escolha outro dia ou altere os serviços.');
    expect(MENSAGENS_PASSO.vazioConflitoTitulo('Hidratação')).toBe(
      'Os horários de Hidratação neste dia coincidem com os serviços que você já escolheu.',
    );
    expect(MENSAGENS_PASSO.vazioConflitoTexto).toBe('Altere o horário de outro serviço acima ou escolha outro dia.');
    expect(MENSAGENS_PASSO.profissionalSemHorario).toBe('Sem horários livres neste dia.');
    expect([MENSAGENS_PASSO.continuar, MENSAGENS_PASSO.continuarParaDados]).toEqual(['Continuar', 'Continuar para seus dados']);
  });

  it('reescolha', () => {
    expect(MENSAGENS_PASSO.reescolhaUm('10:00', 'Hidratação', 'Bia')).toBe(
      'O horário das 10:00 de Hidratação com Bia acabou de ser reservado. Escolha outro horário para este serviço. ' +
        'Os outros serviços e os seus dados continuam aqui.',
    );
    expect(MENSAGENS_PASSO.reescolhaUm('10:00', 'Hidratação', null)).toMatch(/^O horário das 10:00 de Hidratação acabou/);
    expect(MENSAGENS_PASSO.reescolhaVarios('Hidratação (10:00) e Manicure (15:00)')).toBe(
      'Os horários de Hidratação (10:00) e Manicure (15:00) acabaram de ser reservados. Escolha novos horários para eles. ' +
        'Os outros serviços e os seus dados continuam aqui.',
    );
    expect(MENSAGENS_PASSO.reescolhaTituloUm('Hidratação')).toBe('Escolha outro horário para Hidratação');
    expect(MENSAGENS_PASSO.reescolhaBloco('Hidratação')).toBe('Novo horário para Hidratação');
    expect(MENSAGENS_PASSO.reescolhaSemHorarioTitulo('Hidratação')).toBe('Não há mais horários para Hidratação neste dia.');
  });

  it('todo código de aviso tem texto', () => {
    for (const c of CODIGOS_AVISO) expect(MENSAGENS_AVISO[c]).toMatch(/\S/);
  });
});
