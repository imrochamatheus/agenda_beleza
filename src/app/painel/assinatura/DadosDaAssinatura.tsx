import estilos from './Assinatura.module.css';
import type { LinhaDeDado } from './textos';

/** Lista de definição sem moldura: empilhada no celular, duas colunas a partir de 48rem. */
export function DadosDaAssinatura({ linhas }: { linhas: LinhaDeDado[] }) {
  return (
    <dl className={estilos.dados}>
      {linhas.map((l) => (
        <div key={l.rotulo} className={estilos.dado}>
          <dt>{l.rotulo}</dt>
          <dd className={l.destaque ? estilos.destaque : l.rotulo === 'Plano' ? estilos.valorPlano : undefined}>
            {l.destaque ? <strong>{l.valor}</strong> : l.valor}
          </dd>
        </div>
      ))}
    </dl>
  );
}
