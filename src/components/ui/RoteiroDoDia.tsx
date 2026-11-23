import { useId, type ReactNode } from 'react';

import estilos from './RoteiroDoDia.module.css';

/** Variantes da etiqueta de uma parada (cores do web-design D-050 §3.1). */
export type VarianteEtiquetaDoRoteiro =
  | 'confirmado'
  | 'concluido'
  | 'nao_compareceu'
  | 'cancelado'
  | 'encaixe'
  | 'neutra';

export type EtiquetaDoRoteiro = { texto: string; variante: VarianteEtiquetaDoRoteiro };

/**
 * - `escolhida`: horário definido, ponto cheio.
 * - `pendente`: horário a escolher (`hora: null`), ponto vazado.
 * - `destaque`: serviço em edição ou que caiu na reescolha (faixa de aviso + borda: forma além da cor).
 * - `cancelada`: serviço e detalhe riscados; as etiquetas não são riscadas.
 */
export type EstadoDaParada = 'escolhida' | 'pendente' | 'cancelada' | 'destaque';

export type ParadaDoRoteiro = {
  /** Chave estável da parada (id do item ou do serviço). */
  chave: string;
  /** Início já formatado ("09:00"); `null` = a escolher. */
  hora: string | null;
  /** Fim já formatado ("10:00"); só no painel e na confirmação. */
  fim?: string;
  servico: string;
  /** Nome do profissional; o componente escreve "com {profissional}". */
  profissional?: string;
  /** Duração, preço etc. já formatados pelo chamador ("1 h · R$ 90,00", "a escolher"). */
  detalhe: string;
  estado: EstadoDaParada;
  etiquetas?: readonly EtiquetaDoRoteiro[];
  /** Links ou formulários da parada (as únicas paradas de Tab do componente). */
  acoes?: ReactNode;
  /** `id` do `<li>` (alvo de âncora, ex. `item-<id>`); com ele o `<li>` recebe `tabIndex={-1}`. */
  id?: string;
};

export type RoteiroDoDiaProps = {
  /** Nome acessível da lista, ex.: "Seu dia". */
  rotulo: string;
  /** Data já formatada pelo `src/lib/format.ts`, em Fraunces. */
  titulo?: string;
  /** Padrão 3. */
  nivelTitulo?: 2 | 3;
  paradas: readonly ParadaDoRoteiro[];
  /** Total ou nota final. */
  rodape?: ReactNode;
};

const CLASSE_DO_ESTADO: Record<EstadoDaParada, string> = {
  escolhida: estilos.escolhida,
  pendente: estilos.pendente,
  cancelada: estilos.cancelada,
  destaque: estilos.destaque,
};

const CLASSE_DA_ETIQUETA: Record<VarianteEtiquetaDoRoteiro, string> = {
  confirmado: estilos.etiquetaConfirmado,
  concluido: estilos.etiquetaConcluido,
  nao_compareceu: estilos.etiquetaNaoCompareceu,
  cancelado: estilos.etiquetaCancelado,
  encaixe: estilos.etiquetaEncaixe,
  neutra: estilos.etiquetaNeutra,
};

function Hora({ hora, fim }: Pick<ParadaDoRoteiro, 'hora' | 'fim'>) {
  if (hora === null) {
    return (
      <p className={estilos.hora}>
        <span aria-hidden="true">—</span>
        <span className={estilos.somenteLeitor}>horário a escolher</span>
      </p>
    );
  }
  return (
    <p className={estilos.hora}>
      {hora}
      {fim ? (
        <span className={estilos.fim}>
          <span className={estilos.somenteLeitor}> até </span>
          <span aria-hidden="true">–</span>
          {fim}
        </span>
      ) : null}
    </p>
  );
}

/**
 * Roteiro de um dia de atendimento (D-050 §4.1): uma lista ordenada de paradas (hora → serviço →
 * profissional). Componente de servidor (sem estado nem funções em props); todos os textos chegam
 * prontos do chamador (datas e moeda pelo `format.ts`). Ponto e régua são decorativos.
 */
export function RoteiroDoDia({ rotulo, titulo, nivelTitulo = 3, paradas, rodape }: RoteiroDoDiaProps) {
  const idTitulo = useId();
  const Titulo = nivelTitulo === 2 ? 'h2' : 'h3';
  const lista = (
    <ol className={estilos.roteiro} aria-label={rotulo}>
      {paradas.map((parada) => (
        <li
          key={parada.chave}
          id={parada.id}
          tabIndex={parada.id ? -1 : undefined}
          className={`${estilos.parada} ${CLASSE_DO_ESTADO[parada.estado]}`}
          data-estado={parada.estado}
        >
          <span className={estilos.ponto} aria-hidden="true" />
          <Hora hora={parada.hora} fim={parada.fim} />
          <div className={estilos.corpo}>
            <p className={estilos.servico}>
              <span className={estilos.riscavel}>{parada.servico}</span>
            </p>
            <p className={estilos.meta}>
              <span className={estilos.riscavel}>
                {[parada.profissional ? `com ${parada.profissional}` : null, parada.detalhe]
                  .filter((parte) => parte)
                  .join(' · ')}
              </span>
            </p>
            {parada.etiquetas && parada.etiquetas.length > 0 ? (
              <p className={estilos.etiquetas}>
                {parada.etiquetas.map((etiqueta) => (
                  <span
                    key={`${etiqueta.variante}-${etiqueta.texto}`}
                    className={`${estilos.etiqueta} ${CLASSE_DA_ETIQUETA[etiqueta.variante]}`}
                  >
                    {etiqueta.texto}
                  </span>
                ))}
              </p>
            ) : null}
            {parada.acoes ? <div className={estilos.acoes}>{parada.acoes}</div> : null}
          </div>
        </li>
      ))}
    </ol>
  );

  if (!titulo) {
    return (
      <div className={estilos.bloco}>
        {lista}
        {rodape ? <div className={estilos.rodape}>{rodape}</div> : null}
      </div>
    );
  }
  return (
    <section className={estilos.bloco} aria-labelledby={idTitulo}>
      <Titulo id={idTitulo} className={estilos.titulo}>
        {titulo}
      </Titulo>
      {lista}
      {rodape ? <div className={estilos.rodape}>{rodape}</div> : null}
    </section>
  );
}
