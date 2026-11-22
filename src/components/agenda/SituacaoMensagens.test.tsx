/** @vitest-environment jsdom */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { MensagemSituacao } from '@/server/mensagens/situacao-tipos';

import { SituacaoMensagens, TEXTO_SEM_MENSAGENS } from './SituacaoMensagens';

const m = (o: Partial<MensagemSituacao> & { rotulo: string }): MensagemSituacao => ({
  id: o.rotulo,
  estado: 'enviada',
  motivo: null,
  tentativas: 0,
  ultimaTentativaEm: null,
  ...o,
});

describe('SituacaoMensagens', () => {
  it('sem mensagens: título e texto vazio (CA-13)', () => {
    render(<SituacaoMensagens mensagens={[]} fuso="America/Sao_Paulo" />);
    expect(screen.getByRole('heading', { level: 2, name: 'Mensagens de WhatsApp' })).toBeTruthy();
    expect(screen.getByText(TEXTO_SEM_MENSAGENS)).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('enviada: rótulo e data da última tentativa no fuso do salão (CA-2, virada de dia)', () => {
    render(
      <SituacaoMensagens
        fuso="America/Sao_Paulo"
        mensagens={[m({ rotulo: 'Confirmação enviada', tentativas: 1, ultimaTentativaEm: new Date('2026-11-23T02:50:00Z') })]}
      />,
    );
    const li = screen.getByRole('listitem');
    expect(li.textContent).toContain('Confirmação enviada');
    expect(li.textContent).toContain('Última tentativa: 22/11/2026 23:50');
    expect(li.textContent).not.toContain('tentativas');
  });

  it('falha: texto, data, nº de tentativas e motivo; ícone oculto do leitor (CA-1, CA-14)', () => {
    render(
      <SituacaoMensagens
        fuso="UTC"
        mensagens={[
          m({
            rotulo: 'Falha ao enviar confirmação por WhatsApp',
            estado: 'falhou',
            motivo: 'Não foi possível confirmar se a mensagem foi entregue.',
            tentativas: 3,
            ultimaTentativaEm: new Date('2026-11-22T14:35:00Z'),
          }),
        ]}
      />,
    );
    const li = screen.getByRole('listitem');
    expect(li.textContent).toContain('Falha ao enviar confirmação por WhatsApp');
    expect(li.textContent).toContain('Última tentativa: 22/11/2026 14:35 · 3 tentativas');
    expect(li.textContent).toContain('Não foi possível confirmar se a mensagem foi entregue.');
    expect(li.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    expect(li.getAttribute('data-estado')).toBe('falhou');
  });

  it('só a falha tem ícone; sem tentativa não há data; ordem preservada (CA-6)', () => {
    render(
      <SituacaoMensagens
        fuso="UTC"
        mensagens={[
          m({ rotulo: 'Confirmação substituída por remarcação posterior', estado: 'substituida' }),
          m({ rotulo: 'Remarcação 1 aguardando envio', estado: 'pendente' }),
          m({ rotulo: 'Confirmação não enviada', estado: 'nao_enviada', motivo: 'A cliente não autorizou receber mensagens.' }),
        ]}
      />,
    );
    const itens = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(itens.map((i) => i.querySelector('strong')!.textContent)).toEqual([
      'Confirmação substituída por remarcação posterior',
      'Remarcação 1 aguardando envio',
      'Confirmação não enviada',
    ]);
    expect(document.querySelector('svg')).toBeNull();
    expect(screen.queryByText(/Última tentativa/)).toBeNull();
    expect(itens[2].textContent).toContain('A cliente não autorizou receber mensagens.');
  });

  it('só exibe o que o DTO traz: nenhum campo extra vira texto (CA-5)', () => {
    const extra = { ...m({ rotulo: 'Confirmação enviada' }), erroCodigo: 'SENTINELA_ERRO', destinatarioE164: '+5599SENTINELA' };
    render(<SituacaoMensagens fuso="UTC" mensagens={[extra]} />);
    expect(document.body.innerHTML).not.toContain('SENTINELA');
  });
});
