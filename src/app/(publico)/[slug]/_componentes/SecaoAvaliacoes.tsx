import { formatarInteiro, formatarNota } from '@/lib/format';
import type { AvaliacoesPublicas } from '@/server/avaliacoes/tipos';

import estilos from './Salao.module.css';

/**
 * Avaliações verificadas na página pública (D-032 RN-9). Server component: recebe o DTO pronto. O
 * comentário e o nome saem como TEXTO (o React escapa; nunca HTML). Sem avaliações: "Ainda sem
 * avaliações", sem nota.
 */
export function SecaoAvaliacoes({ avaliacoes }: { avaliacoes: AvaliacoesPublicas }) {
  const { total, media, itens } = avaliacoes;
  return (
    <section aria-labelledby="avaliacoes" className={estilos.secao}>
      <h2 id="avaliacoes">Avaliações</h2>
      {total === 0 || media === null ? (
        <p className={estilos.suave}>Ainda sem avaliações</p>
      ) : (
        <>
          <p>
            <strong>{formatarNota(media)}</strong> de 5 · {formatarInteiro(total)} {total === 1 ? 'avaliação' : 'avaliações'}
          </p>
          <ul className={estilos.lista}>
            {itens.map((a, i) => (
              <li key={i} className={estilos.item}>
                <p>
                  <strong>{a.nome}</strong> · Nota {a.nota} de 5 · <span className={estilos.suave}>{a.mesAno}</span>
                </p>
                {a.comentario !== null ? <p>{a.comentario}</p> : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
