import { rotuloDeSituacao } from '@/server/assinatura/rotulos';
import type { TelaAssinatura } from '@/server/assinatura/tela-tipos';

import estilos from './Assinatura.module.css';
import type { AcoesDaTela, EstadoAcaoAssinatura } from './estado';
import { HistoricoDePagamentos } from './HistoricoDePagamentos';
import { SituacaoDaAssinatura } from './SituacaoDaAssinatura';
import { TelaDaAssinatura } from './TelaDaAssinatura';
import { textoDoCancelamento, textosDoEstado } from './textos';

type Props = {
  tela: TelaAssinatura;
  acoes: AcoesDaTela;
  confirmando: boolean;
  /** Texto, nunca função: onde a etapa 1 leva e para onde "Manter assinatura" volta (a vitrine preserva `?situacao=`). */
  hrefCancelar: string;
  hrefManter: string;
  resultadoInicial?: EstadoAcaoAssinatura;
};

/** Composição única da página real e da vitrine (D-042): o MESMO conteúdo, com dados reais ou de exemplo. */
export function ConteudoDaAssinatura({ tela, acoes, confirmando, hrefCancelar, hrefManter, resultadoInicial }: Props) {
  return (
    <div className={estilos.pagina}>
      <h1>Assinatura</h1>
      <TelaDaAssinatura
        acoes={acoes}
        primaria={tela.acoes.primaria}
        podeCancelar={tela.acoes.podeCancelar}
        confirmando={confirmando}
        avisoDoCancelamento={textoDoCancelamento(tela.estado, tela.datas, tela.fuso)}
        estadoVisto={tela.estadoReal ?? ''}
        hrefCancelar={hrefCancelar}
        hrefManter={hrefManter}
        {...(resultadoInicial ? { resultadoInicial } : {})}
        situacao={<SituacaoDaAssinatura rotulo={rotuloDeSituacao(tela.estado)} textos={textosDoEstado(tela.estado, tela.datas, tela.fuso)} />}
        historico={<HistoricoDePagamentos pagamentos={tela.pagamentos} fuso={tela.fuso} />}
      />
    </div>
  );
}
