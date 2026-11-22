import { describe, expect, it } from 'vitest';

import type { SituacaoOperacional } from '@/domain/assinatura';

import { ROTULOS_DAS_ACOES, precoPorMes, textoDoCancelamento, textosDoEstado } from './textos';

// D-042 web-design §5: texto exato por estado; datas no fuso do salão (CA-14) e nenhum literal de valor.

const DATA = new Date('2027-06-21T02:30:00Z'); // 20/06 23:30 em São Paulo, 21/06 em UTC
const SP = 'America/Sao_Paulo';

describe('textosDoEstado', () => {
  it('o valor vem do plano: R$ 79,00/mês (espaço sem quebra) e 30 dias de teste', () => {
    expect(precoPorMes()).toBe('R$ 79,00/mês');
    const t = textosDoEstado('sem_assinatura', {}, SP);
    expect(t).toEqual({
      frase: 'Você ainda não assinou.',
      apoio: 'Teste por 30 dias e depois R$ 79,00/mês.',
      linhas: [{ rotulo: 'Plano', valor: 'R$ 79,00/mês', destaque: false }],
    });
  });

  it.each<[SituacaoOperacional, Parameters<typeof textosDoEstado>[1], string, string | null, string[]]>([
    ['pendente', {}, 'Assinatura pendente de autorização.', 'Assinatura pendente de autorização no provedor. O agendamento fica indisponível até lá.', []],
    ['em_teste', { testeFimEm: DATA }, 'Período de teste até 20/06/2027', 'A primeira cobrança é nesse dia.', ['Primeira cobrança: 20/06/2027']],
    ['ativa', { periodoPagoAte: DATA }, 'Assinatura ativa.', 'Próxima cobrança em 20/06/2027.', ['Próxima cobrança: 20/06/2027']],
    ['em_carencia', { carenciaAte: DATA }, 'Pagamento não confirmado.', 'Seu acesso continua até 20/06/2027.', ['Acesso até: 20/06/2027']],
    ['suspensa', {}, 'Assinatura suspensa por falta de pagamento.', 'Painel somente leitura.', []],
    ['cancelada', { acessoAte: DATA }, 'Assinatura cancelada.', 'Você pode usar o painel até 20/06/2027.', ['Acesso até: 20/06/2027']],
    ['encerrada', {}, 'Assinatura encerrada.', 'Painel somente leitura.', []],
    ['manual', {}, 'Salão suspenso pela administração.', 'Entre em contato com o suporte.', []],
  ])('%s', (estado, datas, frase, apoio, extras) => {
    const t = textosDoEstado(estado, datas, SP);
    expect(t.frase).toBe(frase);
    expect(t.apoio).toBe(apoio);
    expect(t.linhas.slice(1).map((l) => `${l.rotulo}: ${l.valor}`)).toEqual(extras);
    expect(t.linhas[0].rotulo).toBe('Plano');
  });

  it('CA-14: o mesmo instante sai com o dia do fuso do salão, não do processo', () => {
    expect(textosDoEstado('em_teste', { testeFimEm: DATA }, 'UTC').frase).toBe('Período de teste até 21/06/2027');
    expect(textosDoEstado('em_teste', { testeFimEm: DATA }, SP).frase).toBe('Período de teste até 20/06/2027');
  });

  it('a data decisiva só é destacada em em_teste e ativa', () => {
    expect(textosDoEstado('em_teste', { testeFimEm: DATA }, SP).linhas[1].destaque).toBe(true);
    expect(textosDoEstado('ativa', { periodoPagoAte: DATA }, SP).linhas[1].destaque).toBe(true);
    expect(textosDoEstado('em_carencia', { carenciaAte: DATA }, SP).linhas[1].destaque).toBe(false);
    expect(textosDoEstado('cancelada', { acessoAte: DATA }, SP).linhas[1].destaque).toBe(false);
  });

  it('sem a data (defensivo) a frase não inventa uma e só o plano é listado', () => {
    expect(textosDoEstado('em_teste', {}, SP)).toMatchObject({ frase: 'Período de teste em andamento.' });
    expect(textosDoEstado('em_teste', {}, SP).linhas).toHaveLength(1);
    expect(textosDoEstado('ativa', {}, SP).apoio).toBeNull();
    expect(textosDoEstado('em_carencia', {}, SP).apoio).toBeNull();
    expect(textosDoEstado('cancelada', {}, SP).apoio).toBeNull();
  });
});

describe('textoDoCancelamento', () => {
  it('o aviso da etapa 2 por estado, com datas no fuso do salão', () => {
    expect(textoDoCancelamento('em_teste', { testeFimEm: DATA }, SP)).toBe('Se cancelar, você mantém o acesso até 20/06/2027 e não será cobrada.');
    expect(textoDoCancelamento('ativa', { periodoPagoAte: DATA }, SP)).toBe(
      'Se cancelar, você mantém o acesso até 20/06/2027 (período já pago). Não haverá nova cobrança.',
    );
    expect(textoDoCancelamento('pendente', {}, SP)).toBe('Se cancelar, a assinatura é encerrada agora.');
    for (const e of ['em_carencia', 'suspensa'] as const) {
      expect(textoDoCancelamento(e, {}, SP)).toBe('Se cancelar, a assinatura é encerrada agora e o painel fica somente leitura.');
    }
  });

  it('sem data usa texto genérico; estados sem cancelamento devolvem null', () => {
    expect(textoDoCancelamento('em_teste', {}, SP)).toContain('o fim do período de teste');
    expect(textoDoCancelamento('ativa', {}, SP)).toContain('o fim do período pago');
    for (const e of ['sem_assinatura', 'cancelada', 'encerrada', 'manual'] as const) expect(textoDoCancelamento(e, {}, SP)).toBeNull();
  });
});

describe('ROTULOS_DAS_ACOES', () => {
  it('rótulos e textos de carregamento', () => {
    expect(ROTULOS_DAS_ACOES.regularizar).toEqual({ texto: 'Regularizar pagamento', ocupado: 'Abrindo o provedor…' });
    expect(ROTULOS_DAS_ACOES.atualizar.texto).toBe('Atualizar meio de pagamento');
    expect(ROTULOS_DAS_ACOES.continuar.texto).toBe('Continuar assinatura');
    expect(ROTULOS_DAS_ACOES.assinar_novamente.ocupado).toBe('Abrindo o checkout…');
  });
});
