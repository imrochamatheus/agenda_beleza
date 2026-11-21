import { Alert } from '@/components/ui/Alert';
import { formatarInteiro, formatarNota } from '@/lib/format';
import type { AvaliacoesPublicas } from '@/server/avaliacoes/tipos';
import { MENSAGENS_DENUNCIA } from '@/server/denuncias/tipos';
import type { DadosDoWidget } from '@/server/protecao/widget-tipos';

import { FormularioDenuncia } from '../_denuncia/FormularioDenuncia';
import type { AcaoDenunciar } from '../_denuncia/estado';
import estilos from './Salao.module.css';

export type DenunciaDaSecao = {
  acao: AcaoDenunciar;
  slug: string;
  humano: DadosDoWidget;
  /** `?denuncia=recebida`: mostra a resposta uniforme depois do PRG. */
  recebida: boolean;
};

/**
 * Avaliações verificadas na página pública (D-032 RN-9). Server component: recebe o DTO pronto. O
 * comentário e o nome saem como TEXTO (o React escapa; nunca HTML). Sem avaliações: "Ainda sem
 * avaliações", sem nota.
 */
export function SecaoAvaliacoes({ avaliacoes, denuncia }: { avaliacoes: AvaliacoesPublicas; denuncia?: DenunciaDaSecao }) {
  const { total, media, itens } = avaliacoes;
  return (
    <section aria-labelledby="avaliacoes" className={estilos.secao}>
      <h2 id="avaliacoes">Avaliações</h2>
      {denuncia?.recebida ? <Alert variante="sucesso">{MENSAGENS_DENUNCIA.recebida}</Alert> : null}
      {total === 0 || media === null ? (
        <p className={estilos.suave}>Ainda sem avaliações</p>
      ) : (
        <>
          <p>
            <strong>{formatarNota(media)}</strong> de 5 · {formatarInteiro(total)} {total === 1 ? 'avaliação' : 'avaliações'}
          </p>
          <ul className={estilos.lista}>
            {itens.map((a) => (
              <li key={a.id} className={estilos.item}>
                <p>
                  <strong>{a.nome}</strong> · Nota {a.nota} de 5 · <span className={estilos.suave}>{a.mesAno}</span>
                </p>
                {a.comentario !== null ? <p>{a.comentario}</p> : null}
                {denuncia ? (
                  <FormularioDenuncia acao={denuncia.acao} slug={denuncia.slug} avaliacaoId={a.id} nome={a.nome} humano={denuncia.humano} />
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
