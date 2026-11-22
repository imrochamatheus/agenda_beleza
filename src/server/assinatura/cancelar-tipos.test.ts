import { describe, expect, it } from 'vitest';

import { ESTADOS_VISTOS, MENSAGENS_CANCELAR, lerEstadoVisto, mensagemDeCancelar } from './cancelar-tipos';
import { MENSAGENS_REGULARIZAR, mensagemDeRegularizar } from './regularizar-tipos';
import { acoesDoEstado } from './tela-tipos';

// D-042: mensagens puras, dica `estadoVisto` e matriz de ações. Datas no fuso do salão, não do processo.

const D = new Date('2027-05-21T02:30:00Z'); // 20/05 23:30 em São Paulo; 21/05 em UTC

describe('mensagemDeCancelar', () => {
  it('CA-14: a data de acesso sai no fuso do salão (23:30 local não vira o dia seguinte)', () => {
    const m = mensagemDeCancelar({ resultado: 'cancelada', para: 'cancelada', acessoAte: D, fuso: 'America/Sao_Paulo' });
    expect(m).toEqual({ texto: 'Assinatura cancelada. Acesso até 20/05/2027.', variante: 'sucesso' });
    expect(mensagemDeCancelar({ resultado: 'cancelada', para: 'cancelada', acessoAte: D, fuso: 'UTC' }).texto).toContain('21/05/2027');
  });

  it('cada resultado tem texto e variante próprios, sem texto cru do provedor', () => {
    const casos = [
      [{ resultado: 'cancelada', para: 'encerrada', acessoAte: null, fuso: 'UTC' }, MENSAGENS_CANCELAR.encerrada, 'sucesso'],
      [{ resultado: 'cancelada', para: 'cancelada', acessoAte: null, fuso: 'UTC' }, MENSAGENS_CANCELAR.cancelada, 'sucesso'],
      [{ resultado: 'ja_cancelada', acessoAte: null, fuso: 'UTC' }, MENSAGENS_CANCELAR.jaCancelada, 'info'],
      [{ resultado: 'mudou' }, MENSAGENS_CANCELAR.mudou, 'info'],
      [{ resultado: 'provedor_indisponivel' }, MENSAGENS_CANCELAR.provedorIndisponivel, 'erro'],
      [{ resultado: 'tente_novamente' }, MENSAGENS_CANCELAR.tenteNovamente, 'erro'],
      [{ resultado: 'recusado', motivo: 'estado' }, MENSAGENS_CANCELAR.recusado, 'aviso'],
      [{ resultado: 'recusado', motivo: 'manual' }, MENSAGENS_CANCELAR.recusadoManual, 'aviso'],
    ] as const;
    for (const [r, texto, variante] of casos) expect(mensagemDeCancelar(r)).toEqual({ texto, variante });
    expect(mensagemDeCancelar({ resultado: 'ja_cancelada', acessoAte: D, fuso: 'America/Sao_Paulo' }).texto).toBe(
      'Sua assinatura já estava cancelada. Acesso até 20/05/2027.',
    );
    expect(MENSAGENS_CANCELAR.provedorIndisponivel).toBe('Não foi possível concluir agora. Nada foi alterado; tente novamente.');
  });
});

describe('lerEstadoVisto', () => {
  it('só aceita a lista fechada; qualquer outra coisa vira undefined', () => {
    for (const e of ESTADOS_VISTOS) expect(lerEstadoVisto(e)).toBe(e);
    for (const x of ['manual', 'sem_assinatura', '', 'ATIVA', 1, null, undefined, {}, ['ativa']]) expect(lerEstadoVisto(x)).toBeUndefined();
  });
});

describe('mensagemDeRegularizar', () => {
  it('mapeia cada resultado sem redirecionamento', () => {
    expect(mensagemDeRegularizar({ resultado: 'teste_iniciado' }).variante).toBe('sucesso');
    expect(mensagemDeRegularizar({ resultado: 'provedor_indisponivel' })).toEqual({ texto: MENSAGENS_REGULARIZAR.provedorIndisponivel, variante: 'erro' });
    expect(mensagemDeRegularizar({ resultado: 'tente_novamente' }).texto).toBe(MENSAGENS_REGULARIZAR.tenteNovamente);
    expect(mensagemDeRegularizar({ resultado: 'recusado', motivo: 'sem_vinculo' }).texto).toBe(MENSAGENS_REGULARIZAR.semVinculo);
    expect(mensagemDeRegularizar({ resultado: 'recusado', motivo: 'estado' }).texto).toBe(MENSAGENS_REGULARIZAR.recusado);
    expect(mensagemDeRegularizar({ resultado: 'recusado', motivo: 'manual' }).variante).toBe('aviso');
  });
});

describe('acoesDoEstado (RN-6, RN-7, RN-8)', () => {
  it.each([
    ['sem_assinatura', 'assinar', false],
    ['pendente', 'continuar', true],
    ['em_teste', null, true],
    ['ativa', 'atualizar', true],
    ['em_carencia', 'regularizar', true],
    ['suspensa', 'regularizar', true],
    ['cancelada', null, false],
    ['encerrada', 'assinar_novamente', false],
    ['manual', null, false],
  ] as const)('%s → primária %s, cancelar %s', (estado, primaria, podeCancelar) => {
    expect(acoesDoEstado(estado)).toEqual({ primaria, podeCancelar });
  });
});
