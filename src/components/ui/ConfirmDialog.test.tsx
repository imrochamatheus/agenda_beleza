/** @vitest-environment jsdom */
import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { instalarDialogoFalso } from '../../../tests/support/dialogo';

import { ConfirmDialog, type ConfirmDialogProps } from './ConfirmDialog';

let restaurar: () => void;
beforeEach(() => {
  restaurar = instalarDialogoFalso();
});
afterEach(() => {
  restaurar();
});

type Cenario = Partial<ConfirmDialogProps> & {
  /** Depois de fechar, a origem some (true) ou fica desabilitada ('desabilitada'). */
  origemDepois?: 'some' | 'desabilitada';
  semMain?: boolean;
};

function montar(props: Cenario = {}) {
  const espioes = {
    onConfirmar: vi.fn<() => void | Promise<void>>(),
    onCancelar: vi.fn(),
    onFechar: vi.fn(),
  };
  const { origemDepois, semMain, ...resto } = props;
  const onConfirmar = resto.onConfirmar ?? espioes.onConfirmar;

  function Pagina() {
    const [aberto, setAberto] = useState(false);
    const [fechouUmaVez, setFechou] = useState(false);
    const conteudo = (
      <>
        {origemDepois === 'some' && fechouUmaVez ? null : (
          <button
            type="button"
            disabled={origemDepois === 'desabilitada' && fechouUmaVez}
            onClick={() => setAberto(true)}
          >
            Abrir
          </button>
        )}
        <button type="button">Fora</button>
        <ConfirmDialog
          aberto={aberto}
          titulo="Cancelar a reserva?"
          descricao="A cliente será avisada pelo WhatsApp."
          rotuloConfirmar="Confirmar"
          onCancelar={espioes.onCancelar}
          {...resto}
          onConfirmar={onConfirmar}
          onFechar={() => {
            espioes.onFechar();
            setFechou(true);
            setAberto(false);
          }}
        />
      </>
    );
    return semMain ? <div>{conteudo}</div> : <main tabIndex={-1}>{conteudo}</main>;
  }

  render(<Pagina />);
  const abrir = () => {
    const botao = screen.getByRole('button', { name: 'Abrir' });
    botao.focus();
    fireEvent.click(botao);
    return botao;
  };
  const dialogo = () => document.querySelector('dialog')!;
  const botao = (nome: string) => screen.getByRole('button', { name: nome, hidden: true });
  return { ...espioes, abrir, dialogo, botao };
}

function promessaControlada() {
  let resolver!: () => void;
  let rejeitar!: (e: unknown) => void;
  const promessa = new Promise<void>((res, rej) => {
    resolver = res;
    rejeitar = rej;
  });
  return { promessa, resolver, rejeitar };
}

describe('ConfirmDialog (CA-4 complementar, CA-17, RN-10)', () => {
  it('fechado na montagem: não abre nem move o foco', () => {
    const { dialogo } = montar();
    expect(dialogo().open).toBe(false);
    expect(document.activeElement).toBe(document.body);
  });

  it('abre com showModal, foco em Cancelar, título e descrição associados', () => {
    const { abrir, dialogo, botao } = montar();
    abrir();
    const d = dialogo();
    expect(d.open).toBe(true);
    expect(document.activeElement).toBe(botao('Cancelar'));
    expect(document.getElementById(d.getAttribute('aria-labelledby')!)!.textContent).toBe(
      'Cancelar a reserva?',
    );
    expect(document.getElementById(d.getAttribute('aria-labelledby')!)!.tagName).toBe('H2');
    expect(document.getElementById(d.getAttribute('aria-describedby')!)!.textContent).toBe(
      'A cliente será avisada pelo WhatsApp.',
    );
    expect(d.getAttribute('tabindex')).toBe('-1');
    // Ordem DOM: Cancelar, Confirmar.
    expect([...d.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Cancelar', 'Confirmar']);
    expect(botao('Confirmar').className).toContain('primaria');
  });

  it('variante de perigo no confirmar e rótulo de cancelar próprio', () => {
    const { abrir, botao } = montar({ variante: 'perigo', rotuloConfirmar: 'Excluir', rotuloCancelar: 'Voltar' });
    abrir();
    expect(botao('Excluir').className).toContain('perigo');
    expect(document.activeElement).toBe(botao('Voltar'));
  });

  it('ciclo de foco: Tab no último → primeiro; Shift+Tab no primeiro → último (preventDefault)', () => {
    const { abrir, dialogo, botao } = montar();
    abrir();
    const cancelar = botao('Cancelar');
    const confirmar = botao('Confirmar');

    // Tab no primeiro: o navegador segue sozinho (sem preventDefault).
    expect(fireEvent.keyDown(cancelar, { key: 'Tab' })).toBe(true);

    confirmar.focus();
    expect(fireEvent.keyDown(confirmar, { key: 'Tab' })).toBe(false);
    expect(document.activeElement).toBe(cancelar);

    expect(fireEvent.keyDown(cancelar, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(confirmar);

    // Shift+Tab no último: o navegador segue sozinho.
    expect(fireEvent.keyDown(confirmar, { key: 'Tab', shiftKey: true })).toBe(true);

    // Com o foco no próprio diálogo, os dois sentidos voltam para dentro.
    dialogo().focus();
    expect(fireEvent.keyDown(dialogo(), { key: 'Tab', shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(confirmar);
    dialogo().focus();
    expect(fireEvent.keyDown(dialogo(), { key: 'Tab' })).toBe(false);
    expect(document.activeElement).toBe(cancelar);

    // Outras teclas não são tratadas.
    expect(fireEvent.keyDown(cancelar, { key: 'a' })).toBe(true);
  });

  it('Esc: onCancelar 1× e onFechar 1×, sem onConfirmar, com preventDefault; foco volta à origem', () => {
    const { abrir, dialogo, onCancelar, onFechar, onConfirmar } = montar();
    const origem = abrir();
    const evento = fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(evento).toBe(false);
    expect(onCancelar).toHaveBeenCalledTimes(1);
    expect(onFechar).toHaveBeenCalledTimes(1);
    expect(onConfirmar).not.toHaveBeenCalled();
    expect(dialogo().open).toBe(false);
    expect(document.activeElement).toBe(origem);
  });

  it('botão Cancelar: cancela uma vez mesmo com clique duplo', () => {
    const { abrir, botao, onCancelar, onFechar } = montar();
    const origem = abrir();
    const cancelar = botao('Cancelar');
    fireEvent.click(cancelar);
    fireEvent.click(cancelar);
    expect(onCancelar).toHaveBeenCalledTimes(1);
    expect(onFechar).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(origem);
  });

  it('confirmar síncrono: onConfirmar 1× com duplo clique, fecha e devolve o foco', () => {
    const { abrir, botao, onConfirmar, onCancelar, onFechar, dialogo } = montar();
    const origem = abrir();
    const confirmar = botao('Confirmar');
    fireEvent.click(confirmar);
    fireEvent.click(confirmar);
    expect(onConfirmar).toHaveBeenCalledTimes(1);
    expect(onFechar).toHaveBeenCalledTimes(1);
    expect(onCancelar).not.toHaveBeenCalled();
    expect(dialogo().open).toBe(false);
    expect(document.activeElement).toBe(origem);
  });

  it('cada abertura permite uma nova confirmação', () => {
    const { abrir, botao, onConfirmar } = montar();
    abrir();
    fireEvent.click(botao('Confirmar'));
    abrir();
    fireEvent.click(botao('Confirmar'));
    expect(onConfirmar).toHaveBeenCalledTimes(2);
  });

  it('origem removida → foco no main', () => {
    const { abrir, botao } = montar({ origemDepois: 'some' });
    abrir();
    fireEvent.click(botao('Cancelar'));
    expect(screen.queryByRole('button', { name: 'Abrir' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('main'));
  });

  it('origem desabilitada → foco no main', () => {
    const { abrir, botao } = montar({ origemDepois: 'desabilitada' });
    abrir();
    fireEvent.click(botao('Cancelar'));
    expect(document.activeElement).toBe(screen.getByRole('main'));
  });

  it('sem main e sem origem → body', () => {
    const { abrir, botao } = montar({ origemDepois: 'some', semMain: true });
    abrir();
    fireEvent.click(botao('Cancelar'));
    expect(document.activeElement).toBe(document.body);
  });

  it('assíncrono: ocupado (botões desabilitados, aria-busy, foco no diálogo, Esc ignorado) e fecha ao resolver', async () => {
    const { promessa, resolver } = promessaControlada();
    const onConfirmar = vi.fn(() => promessa);
    const { abrir, botao, dialogo, onCancelar, onFechar } = montar({ onConfirmar });
    const origem = abrir();
    fireEvent.click(botao('Confirmar'));

    const ocupado = botao('Aguarde…');
    expect(ocupado).toHaveProperty('disabled', true);
    expect(ocupado.getAttribute('aria-busy')).toBe('true');
    expect(botao('Cancelar')).toHaveProperty('disabled', true);
    expect(document.activeElement).toBe(dialogo());

    // Esc ignorado (mas sempre com preventDefault) e clique duplo barrado.
    expect(fireEvent.keyDown(dialogo(), { key: 'Escape' })).toBe(false);
    fireEvent.click(ocupado);
    expect(onCancelar).not.toHaveBeenCalled();
    expect(onConfirmar).toHaveBeenCalledTimes(1);
    expect(dialogo().open).toBe(true);

    // Sem focáveis: Tab mantém o foco no diálogo.
    expect(fireEvent.keyDown(dialogo(), { key: 'Tab' })).toBe(false);
    expect(document.activeElement).toBe(dialogo());

    await act(async () => {
      resolver();
      await promessa;
    });
    expect(onFechar).toHaveBeenCalledTimes(1);
    expect(dialogo().open).toBe(false);
    expect(document.activeElement).toBe(origem);
  });

  it('assíncrono rejeitado: continua aberto, alerta genérico, foco no confirmar e nova tentativa', async () => {
    let tentativa = 0;
    const onConfirmar = vi.fn(() => {
      tentativa += 1;
      return tentativa === 1 ? Promise.reject(new Error('detalhe interno 42')) : undefined;
    });
    const { abrir, botao, dialogo, onFechar } = montar({ onConfirmar, rotuloOcupado: 'Excluindo…' });
    abrir();
    await act(async () => {
      fireEvent.click(botao('Confirmar'));
    });
    expect(dialogo().open).toBe(true);
    const alerta = screen.getByRole('alert', { hidden: true });
    expect(alerta.textContent).toBe('Não foi possível concluir. Tente novamente.');
    expect(dialogo().textContent).not.toContain('detalhe interno');
    const confirmar = botao('Confirmar');
    expect(confirmar).toHaveProperty('disabled', false);
    expect(document.activeElement).toBe(confirmar);
    expect(onFechar).not.toHaveBeenCalled();

    fireEvent.click(confirmar);
    expect(onConfirmar).toHaveBeenCalledTimes(2);
    expect(onFechar).toHaveBeenCalledTimes(1);
  });

  it('mensagem de erro própria e exceção síncrona tratada como falha', () => {
    const onConfirmar = vi.fn(() => {
      throw new Error('quebrou');
    });
    const { abrir, botao, dialogo } = montar({ onConfirmar, mensagemErro: 'Tente de novo.' });
    abrir();
    fireEvent.click(botao('Confirmar'));
    expect(dialogo().open).toBe(true);
    expect(screen.getByRole('alert', { hidden: true }).textContent).toBe('Tente de novo.');
    expect(document.activeElement).toBe(botao('Confirmar'));
  });

  it('reabrir zera o erro anterior', async () => {
    const onConfirmar = vi.fn(() => Promise.reject(new Error('x')));
    const { abrir, botao } = montar({ onConfirmar });
    abrir();
    await act(async () => {
      fireEvent.click(botao('Confirmar'));
    });
    expect(screen.queryByRole('alert', { hidden: true })).not.toBeNull();
    fireEvent.click(botao('Cancelar'));
    abrir();
    expect(screen.queryByRole('alert', { hidden: true })).toBeNull();
  });

  it('Promise resolvida depois de o pai fechar não pede outro fechamento', async () => {
    const { promessa, resolver } = promessaControlada();
    let fecharExterno!: () => void;
    const onFechar = vi.fn();
    function Pagina() {
      const [aberto, setAberto] = useState(true);
      fecharExterno = () => setAberto(false);
      return (
        <ConfirmDialog
          aberto={aberto}
          titulo="T"
          descricao="D"
          rotuloConfirmar="Ok"
          onConfirmar={() => promessa}
          onFechar={onFechar}
        />
      );
    }
    render(<Pagina />);
    fireEvent.click(screen.getByRole('button', { name: 'Ok', hidden: true }));
    act(() => fecharExterno());
    await act(async () => {
      resolver();
      await promessa;
    });
    expect(onFechar).not.toHaveBeenCalled();
  });

  it('rejeição depois de o pai fechar é ignorada', async () => {
    const { promessa, rejeitar } = promessaControlada();
    let fecharExterno!: () => void;
    function Pagina() {
      const [aberto, setAberto] = useState(true);
      fecharExterno = () => setAberto(false);
      return (
        <ConfirmDialog aberto={aberto} titulo="T" descricao="D" rotuloConfirmar="Ok" onConfirmar={() => promessa} onFechar={() => {}} />
      );
    }
    render(<Pagina />);
    fireEvent.click(screen.getByRole('button', { name: 'Ok', hidden: true }));
    act(() => fecharExterno());
    await act(async () => {
      rejeitar(new Error('x'));
      await promessa.catch(() => {});
    });
    expect(screen.queryByRole('alert', { hidden: true })).toBeNull();
  });

  it('evento cancel nativo é cancelado (redundância do Esc)', () => {
    const { abrir, dialogo, onCancelar } = montar();
    abrir();
    const evento = new Event('cancel', { cancelable: true });
    dialogo().dispatchEvent(evento);
    expect(evento.defaultPrevented).toBe(true);
    expect(onCancelar).not.toHaveBeenCalled();
  });

  it('close nativo inesperado fora do estado ocupado → cancelamento', () => {
    const { abrir, dialogo, onCancelar, onFechar } = montar();
    abrir();
    act(() => dialogo().close());
    expect(onCancelar).toHaveBeenCalledTimes(1);
    expect(onFechar).toHaveBeenCalledTimes(1);
  });

  it('close nativo inesperado durante a confirmação → reabre o modal', () => {
    const { promessa } = promessaControlada();
    const { abrir, botao, dialogo, onCancelar, onFechar } = montar({ onConfirmar: () => promessa });
    abrir();
    fireEvent.click(botao('Confirmar'));
    act(() => dialogo().close());
    expect(dialogo().open).toBe(true);
    expect(onCancelar).not.toHaveBeenCalled();
    expect(onFechar).not.toHaveBeenCalled();
  });
});
