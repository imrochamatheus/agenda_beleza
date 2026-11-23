import { describe, expect, it } from 'vitest';

import { rotuloDaMensagem } from './rotulos';
import type { EstadoMensagem, TipoMensagem } from './tipos';

const TIPOS: TipoMensagem[] = ['confirmacao', 'remarcacao', 'cancelamento', 'convite_avaliacao'];
const ESTADOS: EstadoMensagem[] = ['pendente', 'enviando', 'enviada', 'falhou', 'nao_enviada', 'substituida', 'cancelada_anonimizacao'];

const r = (tipo: TipoMensagem, estado: EstadoMensagem, erroCodigo: string | null = null, revisao = 1) =>
  rotuloDaMensagem({ tipo, revisao, estado, erroCodigo });

describe('rotuloDaMensagem (CA-4, tabela do design §0)', () => {
  const esperado: Record<EstadoMensagem, [string, string, string, string]> = {
    enviada: ['Confirmação enviada', 'Remarcação 1 enviada', 'Cancelamento enviado', 'Convite de avaliação enviado'],
    pendente: ['Confirmação aguardando envio', 'Remarcação 1 aguardando envio', 'Cancelamento aguardando envio', 'Convite de avaliação aguardando envio'],
    enviando: ['Confirmação sendo enviada', 'Remarcação 1 sendo enviada', 'Cancelamento sendo enviado', 'Convite de avaliação sendo enviado'],
    nao_enviada: ['Confirmação não enviada', 'Remarcação 1 não enviada', 'Cancelamento não enviado', 'Convite de avaliação não enviado'],
    cancelada_anonimizacao: ['Confirmação não enviada', 'Remarcação 1 não enviada', 'Cancelamento não enviado', 'Convite de avaliação não enviado'],
    substituida: [
      'Confirmação substituída por alteração posterior',
      'Remarcação 1 substituída por alteração posterior',
      'Cancelamento substituído por alteração posterior',
      'Convite de avaliação substituído por alteração posterior',
    ],
    falhou: [
      'Falha ao enviar confirmação por WhatsApp',
      'Falha ao enviar remarcação 1 por WhatsApp',
      'Falha ao enviar cancelamento por WhatsApp',
      'Falha ao enviar convite de avaliação por WhatsApp',
    ],
  };

  it.each(ESTADOS)('rótulo de cada tipo no estado %s', (estado) => {
    expect(TIPOS.map((t) => r(t, estado).rotulo)).toEqual(esperado[estado]);
  });

  it('a revisão aparece só na remarcação', () => {
    expect(r('remarcacao', 'enviada', null, 2).rotulo).toBe('Remarcação 2 enviada');
    expect(r('confirmacao', 'enviada', null, 2).rotulo).toBe('Confirmação enviada');
    expect(r('cancelamento', 'enviada', null, 3).rotulo).toBe('Cancelamento enviado');
  });

  it('motivos mapeados por lista fechada', () => {
    expect(r('confirmacao', 'falhou', 'resultado_incerto').motivo).toBe('Não foi possível confirmar se a mensagem foi entregue.');
    expect(r('convite_avaliacao', 'falhou', 'link_indisponivel').motivo).toBe('Link de avaliação indisponível.');
    expect(r('confirmacao', 'nao_enviada', 'sem_consentimento').motivo).toBe('A cliente não autorizou receber mensagens.');
    expect(r('confirmacao', 'cancelada_anonimizacao').motivo).toBe('Cliente removida; a mensagem foi cancelada.');
  });

  it('código desconhecido, bruto ou de outro estado não vira motivo nem aparece', () => {
    for (const estado of ESTADOS) {
      for (const codigo of ['limite_de_taxa', 'erro_desconhecido', 'SENTINELA_XYZ']) {
        const x = r('confirmacao', estado, codigo);
        expect(JSON.stringify(x)).not.toContain(codigo);
        if (estado !== 'cancelada_anonimizacao') expect(x.motivo).toBeNull();
      }
    }
    expect(r('confirmacao', 'falhou', 'sem_consentimento').motivo).toBeNull();
    expect(r('confirmacao', 'enviada', 'resultado_incerto').motivo).toBeNull();
  });

  it('substituída por obsoleta mostra que a reserva mudou antes do envio', () => {
    expect(r('confirmacao', 'substituida', 'obsoleta').rotulo).toBe('Confirmação não enviada: a reserva mudou antes do envio');
    expect(r('remarcacao', 'substituida', 'obsoleta').rotulo).toBe('Remarcação 1 não enviada: a reserva mudou antes do envio');
    expect(r('cancelamento', 'substituida', 'obsoleta').rotulo).toBe('Cancelamento não enviado: a reserva mudou antes do envio');
  });
});
