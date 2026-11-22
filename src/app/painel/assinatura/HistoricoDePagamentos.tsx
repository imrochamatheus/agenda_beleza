import { DataList } from '@/components/ui/DataList';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatarData, formatarMoeda } from '@/lib/format';
import type { PagamentoDaTela } from '@/server/assinatura/tela-tipos';

import estilos from './Assinatura.module.css';

type Props = { pagamentos: PagamentoDaTela[]; fuso: string };

/** Pagamentos (somente leitura, até 12, mais recentes primeiro): data, valor e situação; nunca ids. */
export function HistoricoDePagamentos({ pagamentos, fuso }: Props) {
  return (
    <section className={estilos.secao} aria-labelledby="assinatura-pagamentos">
      <h2 id="assinatura-pagamentos" className={estilos.tituloSecao}>
        Pagamentos
      </h2>
      <DataList
        legenda="Pagamentos"
        legendaVisivel={false}
        linhas={pagamentos.map((p, indice) => ({ ...p, indice }))}
        chaveDaLinha={(p) => String(p.indice)}
        colunas={[
          { chave: 'data', rotulo: 'Data', renderizar: (p) => formatarData(p.data, fuso) },
          { chave: 'valor', rotulo: 'Valor', renderizar: (p) => <span className={estilos.valorMoeda}>{formatarMoeda(p.valorCentavos)}</span> },
          {
            chave: 'situacao',
            rotulo: 'Situação',
            renderizar: (p) =>
              p.situacao === 'aprovado' ? (
                <span className={estilos.aprovado}>Aprovado</span>
              ) : (
                <span className={estilos.recusado}>Recusado</span>
              ),
          },
        ]}
        vazio={<EmptyState titulo="Nenhum pagamento registrado." nivelTitulo={3} />}
      />
    </section>
  );
}
