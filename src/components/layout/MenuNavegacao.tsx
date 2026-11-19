'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

import { itemAtivo, type ItemNavegacao } from '@/config/navegacao';

import estilos from './Layout.module.css';

export type MenuNavegacaoProps = {
  itens: readonly ItemNavegacao[];
  /** aria-label da <nav>. */
  rotulo: string;
  /** Caminho atual (aria-current); padrão: usePathname(). */
  caminhoAtual?: string;
  rotuloBotao?: string;
};

/**
 * Navegação com menu móvel (D-009 RN-13, D-17): disclosure (não prende o foco). Abaixo de 48rem,
 * fica atrás do botão "Menu"; fechada, os itens não recebem foco (display: none). A partir de
 * 48rem, o botão some e a navegação fica sempre visível.
 */
export function MenuNavegacao({ itens, rotulo, caminhoAtual, rotuloBotao = 'Menu' }: MenuNavegacaoProps) {
  const caminhoDaRota = usePathname();
  const [aberto, setAberto] = useState(false);
  const [rotaAnterior, setRotaAnterior] = useState(caminhoDaRota);
  // Mudança de rota fecha o menu (ajuste de estado durante a renderização).
  if (caminhoDaRota !== rotaAnterior) {
    setRotaAnterior(caminhoDaRota);
    setAberto(false);
  }
  const idNav = useId();
  const botaoRef = useRef<HTMLButtonElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const focarPrimeiro = useRef(false);

  useEffect(() => {
    if (aberto && focarPrimeiro.current) {
      focarPrimeiro.current = false;
      navRef.current?.querySelector('a')?.focus();
    }
  }, [aberto]);

  if (itens.length === 0) return null;

  const ativo = itemAtivo(itens, caminhoAtual ?? caminhoDaRota);

  function alternar() {
    if (!aberto) focarPrimeiro.current = true;
    setAberto(!aberto);
  }

  function aoTeclar(evento: KeyboardEvent<HTMLElement>) {
    if (evento.key !== 'Escape' || !aberto) return;
    evento.preventDefault();
    setAberto(false);
    botaoRef.current?.focus();
  }

  return (
    <div className={estilos.menu}>
      <button
        ref={botaoRef}
        type="button"
        className={estilos.botaoMenu}
        aria-expanded={aberto}
        aria-controls={idNav}
        onClick={alternar}
      >
        <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false">
          <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        {rotuloBotao}
      </button>
      <nav ref={navRef} id={idNav} aria-label={rotulo} className={estilos.nav} data-aberto={aberto} onKeyDown={aoTeclar}>
        <ul className={estilos.itens}>
          {itens.map((item) => (
            <li key={item.href}>
              <a
                href={item.href}
                className={estilos.item}
                aria-current={item.href === ativo ? 'page' : undefined}
                onClick={() => setAberto(false)}
              >
                {item.rotulo}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
