'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react';

import { Button } from './Button';
import estilos from './ConfirmDialog.module.css';

export type ConfirmDialogProps = {
  /** Controlado pelo pai. */
  aberto: boolean;
  titulo: string;
  descricao: ReactNode;
  rotuloConfirmar: string;
  /** Variante do botão confirmar. Padrão 'primaria'. */
  variante?: 'primaria' | 'perigo';
  rotuloCancelar?: string;
  rotuloOcupado?: string;
  mensagemErro?: string;
  /** A ação. Se devolver uma Promise, o diálogo espera por ela (ocupado). */
  onConfirmar: () => void | Promise<void>;
  /** Aviso de cancelamento (botão Cancelar ou Esc). */
  onCancelar?: () => void;
  /** Pedido de fechamento: o pai põe aberto=false. */
  onFechar: () => void;
};

const FOCAVEIS =
  'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

function ehThenable(valor: unknown): valor is PromiseLike<unknown> {
  return (
    (typeof valor === 'object' || typeof valor === 'function') &&
    valor !== null &&
    typeof (valor as { then?: unknown }).then === 'function'
  );
}

/** Devolve o foco à origem; se ela sumiu ou não é focável, ao <main>; por último, ao <body>. */
function devolverFoco(origem: Element | null) {
  if (origem instanceof HTMLElement && origem.isConnected) {
    origem.focus();
    if (document.activeElement === origem) return;
  }
  const principal = document.querySelector('main');
  if (principal instanceof HTMLElement) {
    principal.focus();
    if (document.activeElement === principal) return;
  }
  // Último recurso: tira o foco do diálogo fechado (o activeElement passa a ser o <body>).
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

/**
 * Diálogo de confirmação com <dialog> nativo e showModal() (D-009 RN-10, D-12): foco inicial em
 * Cancelar, ciclo de foco explícito, Esc cancela (tratado no keydown, porque o close watcher do
 * Chromium ignora o preventDefault do `cancel`), sem fechar por clique no fundo, confirmação
 * assíncrona com uma única chamada por tentativa e foco devolvido à origem.
 */
export function ConfirmDialog({
  aberto,
  titulo,
  descricao,
  rotuloConfirmar,
  variante = 'primaria',
  rotuloCancelar = 'Cancelar',
  rotuloOcupado = 'Aguarde…',
  mensagemErro = 'Não foi possível concluir. Tente novamente.',
  onConfirmar,
  onCancelar,
  onFechar,
}: ConfirmDialogProps) {
  const dialogoRef = useRef<HTMLDialogElement>(null);
  const cancelarRef = useRef<HTMLButtonElement>(null);
  const confirmarRef = useRef<HTMLButtonElement>(null);
  const origemRef = useRef<Element | null>(null);
  const abriuRef = useRef(false);
  /** Barra a 2ª chamada de onConfirmar (duplo clique, Enter repetido) na mesma tentativa. */
  const emAndamento = useRef(false);
  /** Barra um 2º pedido de fechamento antes de o pai pôr aberto=false. */
  const fechando = useRef(false);
  const focarConfirmar = useRef(false);
  const idTitulo = useId();
  const idDescricao = useId();

  const [ocupado, setOcupado] = useState(false);
  const [falhou, setFalhou] = useState(false);
  // Zera o estado a cada abertura (ajuste de estado durante a renderização, sem efeito).
  const [abertoAnterior, setAbertoAnterior] = useState(aberto);
  if (aberto !== abertoAnterior) {
    setAbertoAnterior(aberto);
    if (aberto) {
      setOcupado(false);
      setFalhou(false);
    }
  }

  useEffect(() => {
    const dialogo = dialogoRef.current;
    if (!dialogo) return;
    if (aberto) {
      if (!dialogo.open) {
        origemRef.current = document.activeElement;
        emAndamento.current = false;
        fechando.current = false;
        dialogo.showModal();
      }
      abriuRef.current = true;
      cancelarRef.current?.focus();
    } else if (abriuRef.current) {
      abriuRef.current = false;
      // Uma Promise que termine depois do fechamento não pede outro fechamento.
      fechando.current = true;
      if (dialogo.open) dialogo.close();
      const origem = origemRef.current;
      origemRef.current = null;
      devolverFoco(origem);
    }
  }, [aberto]);

  // Rejeição: depois que o botão deixa de estar desabilitado, o foco volta ao confirmar.
  useEffect(() => {
    if (!ocupado && focarConfirmar.current) {
      focarConfirmar.current = false;
      confirmarRef.current?.focus();
    }
  }, [ocupado, falhou]);

  function fechar() {
    if (fechando.current) return;
    fechando.current = true;
    onFechar();
  }

  function cancelar() {
    if (emAndamento.current || fechando.current) return;
    onCancelar?.();
    fechar();
  }

  function falha() {
    if (!abriuRef.current) return;
    emAndamento.current = false;
    focarConfirmar.current = true;
    setOcupado(false);
    setFalhou(true);
  }

  function confirmar() {
    if (emAndamento.current || fechando.current) return;
    emAndamento.current = true;
    let resultado: unknown;
    try {
      resultado = onConfirmar();
    } catch {
      falha();
      return;
    }
    if (!ehThenable(resultado)) {
      fechar();
      return;
    }
    // O botão focado vai ficar desabilitado: o foco vai para o próprio diálogo (tabIndex=-1).
    dialogoRef.current?.focus();
    setFalhou(false);
    setOcupado(true);
    resultado.then(fechar, falha);
  }

  function aoTeclar(evento: KeyboardEvent<HTMLDialogElement>) {
    const dialogo = evento.currentTarget;
    if (evento.key === 'Escape') {
      // Sempre: impede o close watcher do navegador de fechar sozinho (inclusive quando ocupado).
      evento.preventDefault();
      cancelar();
      return;
    }
    if (evento.key !== 'Tab') return;
    const focaveis = [...dialogo.querySelectorAll<HTMLElement>(FOCAVEIS)];
    if (focaveis.length === 0) {
      evento.preventDefault();
      dialogo.focus();
      return;
    }
    const primeiro = focaveis[0];
    const ultimo = focaveis[focaveis.length - 1];
    const ativo = document.activeElement;
    const dentro = ativo instanceof Node && dialogo.contains(ativo) && ativo !== dialogo;
    if (evento.shiftKey) {
      if (ativo === primeiro || !dentro) {
        evento.preventDefault();
        ultimo.focus();
      }
    } else if (ativo === ultimo || !dentro) {
      evento.preventDefault();
      primeiro.focus();
    }
  }

  function aoCancelarNativo(evento: SyntheticEvent<HTMLDialogElement>) {
    evento.preventDefault();
  }

  /** Fechamento que não partiu de nós (o navegador fechou com aberto ainda true). */
  function aoFecharNativo() {
    if (!aberto || fechando.current) return;
    if (emAndamento.current) {
      dialogoRef.current?.showModal();
      return;
    }
    cancelar();
  }

  return (
    <dialog
      ref={dialogoRef}
      className={estilos.dialogo}
      aria-labelledby={idTitulo}
      aria-describedby={idDescricao}
      tabIndex={-1}
      onKeyDown={aoTeclar}
      onCancel={aoCancelarNativo}
      onClose={aoFecharNativo}
    >
      <h2 id={idTitulo} className={estilos.titulo}>
        {titulo}
      </h2>
      <div id={idDescricao} className={estilos.descricao}>
        {descricao}
      </div>
      {falhou ? (
        <p role="alert" className={estilos.erro}>
          {mensagemErro}
        </p>
      ) : null}
      <div className={estilos.acoes}>
        <Button ref={cancelarRef} variante="secundaria" onClick={cancelar} disabled={ocupado}>
          {rotuloCancelar}
        </Button>
        <Button
          ref={confirmarRef}
          variante={variante}
          onClick={confirmar}
          ocupado={ocupado}
          rotuloOcupado={rotuloOcupado}
        >
          {rotuloConfirmar}
        </Button>
      </div>
    </dialog>
  );
}
