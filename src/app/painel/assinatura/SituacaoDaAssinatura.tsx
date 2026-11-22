import { DadosDaAssinatura } from './DadosDaAssinatura';
import estilos from './Assinatura.module.css';
import type { TextosDoEstado } from './textos';

type Props = { rotulo: string; textos: TextosDoEstado };

/** Bloco de estado ("extrato de conta"): rótulo, frase em Fraunces, apoio e os dados. Sem cor por estado. */
export function SituacaoDaAssinatura({ rotulo, textos }: Props) {
  return (
    <section className={estilos.situacao} aria-labelledby="assinatura-estado">
      <span className={estilos.rotuloSituacao}>Situação: {rotulo}</span>
      <h2 id="assinatura-estado" className={estilos.frase}>
        {textos.frase}
      </h2>
      {textos.apoio ? <p className={estilos.apoio}>{textos.apoio}</p> : null}
      <DadosDaAssinatura linhas={textos.linhas} />
    </section>
  );
}
