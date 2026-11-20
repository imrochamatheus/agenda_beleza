import Link from 'next/link';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { ROTAS } from '@/config/navegacao';
import { MENSAGENS_BLOQUEIO } from '@/server/bloqueios/tipos';
import type { BloqueioItem } from '@/server/bloqueios/tipos';

import estilos from './Bloqueios.module.css';
import { rotuloDoAlvo } from './estado';

export type ListaBloqueiosProps = {
  itens: readonly BloqueioItem[];
  /** Ação de remoção (página real ou demonstração): recebe o FormData com o `id`. */
  acaoRemover: (formData: FormData) => Promise<void>;
  /** Rota da edição (padrão: ROTAS.bloqueio). A demonstração aponta para si mesma. */
  rotaEdicao?: (id: string) => string;
};

/**
 * Lista de bloqueios vigentes e futuros (D-016 §3.7; RN-18, RN-19). Componente de servidor (também
 * usado na demonstração). Cada item mostra o alvo ("Salão inteiro" ou o profissional, com "(inativo)"),
 * o período já formatado no fuso do salão e o motivo; os editáveis têm "Editar" e um formulário
 * "Remover" (funciona sem JavaScript); os demais, o texto de somente leitura (D-10).
 */
export function ListaBloqueios({ itens, acaoRemover, rotaEdicao = ROTAS.bloqueio }: ListaBloqueiosProps) {
  if (itens.length === 0) {
    return <p className={estilos.vazio}>{MENSAGENS_BLOQUEIO.vazio}</p>;
  }
  return (
    <ul className={estilos.lista}>
      {itens.map((item) => {
        const alvo = rotuloDoAlvo(item.alvo);
        const descricao = `${alvo}, ${item.periodo}`;
        return (
          <li key={item.id} className={estilos.item}>
            <p className={estilos.itemAlvo}>{alvo}</p>
            <p className={estilos.itemPeriodo}>{item.periodo}</p>
            {item.motivo ? <p className={estilos.itemMotivo}>Motivo: {item.motivo}</p> : null}
            {item.editavel ? (
              <div className={estilos.itemAcoes}>
                <Link href={rotaEdicao(item.id)} className={estilos.link} aria-label={`Editar bloqueio: ${descricao}`}>
                  Editar
                </Link>
                <form action={acaoRemover}>
                  <input type="hidden" name="id" value={item.id} />
                  <Button type="submit" variante="secundaria" aria-label={`Remover bloqueio: ${descricao}`}>
                    Remover
                  </Button>
                </form>
              </div>
            ) : (
              <p className={estilos.somenteLeitura}>{MENSAGENS_BLOQUEIO.somenteLeitura}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Resultado da remoção (PRG `?remocao=`, D-19) → alerta; outro valor → nada. */
export function AlertaDeRemocao({ remocao }: { remocao: unknown }) {
  if (remocao === 'ok') return <Alert variante="sucesso">{MENSAGENS_BLOQUEIO.removido}</Alert>;
  if (remocao === 'nao_encontrado') return <Alert variante="erro">{MENSAGENS_BLOQUEIO.naoEncontrado}</Alert>;
  if (remocao === 'negado') return <Alert variante="erro">{MENSAGENS_BLOQUEIO.acessoNegado}</Alert>;
  return null;
}
