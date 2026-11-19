// Dublê de HTMLDialogElement para os testes de componente em jsdom (D-009 §3.6). O jsdom 31 não
// implementa showModal()/close(); aqui eles só alternam o atributo `open` e disparam `close`.
// A inércia do fundo e o Esc nativo não existem no jsdom: são comprovados no E2E (CA-4).

type Metodos = Pick<HTMLDialogElement, 'showModal' | 'close'>;

/** Instala showModal/close no protótipo e devolve a função que restaura o estado anterior. */
export function instalarDialogoFalso(): () => void {
  const prototipo = HTMLDialogElement.prototype as Partial<Metodos>;
  const originais: Partial<Metodos> = {
    showModal: Object.hasOwn(prototipo, 'showModal') ? prototipo.showModal : undefined,
    close: Object.hasOwn(prototipo, 'close') ? prototipo.close : undefined,
  };

  prototipo.showModal = function showModal(this: HTMLDialogElement) {
    if (this.hasAttribute('open')) throw new DOMException('O diálogo já está aberto.', 'InvalidStateError');
    this.setAttribute('open', '');
  };
  prototipo.close = function close(this: HTMLDialogElement, valor?: string) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    if (valor !== undefined) this.returnValue = valor;
    this.dispatchEvent(new Event('close'));
  };

  return () => {
    for (const nome of ['showModal', 'close'] as const) {
      const original = originais[nome];
      if (original) (prototipo as Record<string, unknown>)[nome] = original;
      else delete prototipo[nome];
    }
  };
}
