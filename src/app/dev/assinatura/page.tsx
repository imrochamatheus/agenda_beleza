import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ConteudoDaAssinatura } from '@/app/painel/assinatura/ConteudoDaAssinatura';
import type { EstadoAcaoAssinatura } from '@/app/painel/assinatura/estado';
import { PanelLayout } from '@/components/layout/PanelLayout';
import { PRECO_MENSAL_CENTAVOS } from '@/config/plano';
import { ROTAS } from '@/config/navegacao';
import type { SituacaoOperacional } from '@/domain/assinatura';
import { mensagemDeCancelar } from '@/server/assinatura/cancelar-tipos';
import type { ResultadoCancelar } from '@/server/assinatura/cancelar-tipos';
import { LIMITE_PAGAMENTOS, acoesDoEstado } from '@/server/assinatura/tela-tipos';
import type { DatasDaTela, PagamentoDaTela, TelaAssinatura } from '@/server/assinatura/tela-tipos';
import { vitrineHabilitada } from '@/server/env';

import { demonstrarAssinarAcao, demonstrarCancelarAcao, demonstrarRegularizarAcao } from './acoes';

// Demonstração da assinatura para o E2E sem banco (D-040, D-042): os MESMOS componentes da página real, com
// o estado escolhido por `?situacao=` (os 9), `?cancelar=1` (etapa 2), `?resultado=` e `?historico=` (0 a 12)
// e ações que não chamam provedor. 404 sem VITRINE_COMPONENTES=true (exceto em next dev), lido na
// requisição, antes de qualquer parâmetro.
export const dynamic = 'force-dynamic';

const METADADOS: Metadata = {
  title: 'Assinatura (demonstração) · Agenda Beleza',
  robots: { index: false, follow: false },
};

export function generateMetadata(): Metadata {
  return vitrineHabilitada(process.env) ? METADADOS : {};
}

const SITUACOES: readonly SituacaoOperacional[] = [
  'sem_assinatura', 'pendente', 'em_teste', 'ativa', 'em_carencia', 'suspensa', 'cancelada', 'encerrada', 'manual',
];

const FUSO = 'America/Sao_Paulo';
// 23:30 locais de 20/06 (virada de dia: em UTC já é 21/06), para a vitrine também provar o fuso.
const DATA_EXEMPLO = new Date('2027-06-21T02:30:00Z');
const DIA_MS = 86_400_000;

const DATAS: Partial<Record<SituacaoOperacional, DatasDaTela>> = {
  em_teste: { testeFimEm: DATA_EXEMPLO },
  ativa: { periodoPagoAte: DATA_EXEMPLO },
  em_carencia: { carenciaAte: DATA_EXEMPLO },
  cancelada: { acessoAte: DATA_EXEMPLO },
};

const RESULTADOS: Record<string, ResultadoCancelar> = {
  cancelada: { resultado: 'cancelada', para: 'cancelada', acessoAte: DATA_EXEMPLO, fuso: FUSO },
  encerrada: { resultado: 'cancelada', para: 'encerrada', acessoAte: null, fuso: FUSO },
  ja_cancelada: { resultado: 'ja_cancelada', acessoAte: DATA_EXEMPLO, fuso: FUSO },
  mudou: { resultado: 'mudou' },
  erro: { resultado: 'provedor_indisponivel' },
};

function pagamentos(n: number): PagamentoDaTela[] {
  return Array.from({ length: n }, (_, i) => ({
    data: new Date(DATA_EXEMPLO.getTime() - (i + 1) * 30 * DIA_MS),
    valorCentavos: PRECO_MENSAL_CENTAVOS,
    situacao: i === 1 ? 'recusado' : 'aprovado',
  }));
}

const um = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function DemonstracaoAssinatura({ searchParams }: Props) {
  if (!vitrineHabilitada(process.env)) notFound();
  const q = await searchParams;
  const pedido = um(q.situacao);
  const estado = SITUACOES.find((s) => s === pedido) ?? 'sem_assinatura';
  const acoes = acoesDoEstado(estado);
  const n = Number(um(q.historico));
  const quantos =
    Number.isInteger(n) && n >= 0 && n <= LIMITE_PAGAMENTOS ? n : ['sem_assinatura', 'pendente', 'em_teste'].includes(estado) ? 0 : 3;
  const tela: TelaAssinatura = {
    estado,
    estadoReal: estado === 'sem_assinatura' || estado === 'manual' ? null : estado,
    fuso: FUSO,
    datas: DATAS[estado] ?? {},
    acoes,
    pagamentos: pagamentos(quantos),
  };
  const pedidoResultado = um(q.resultado);
  const resultado = pedidoResultado === undefined ? undefined : RESULTADOS[pedidoResultado];
  const resultadoInicial: EstadoAcaoAssinatura | undefined =
    resultado === undefined
      ? undefined
      : { mensagem: mensagemDeCancelar(resultado).texto, variante: mensagemDeCancelar(resultado).variante, em: 1 };
  const base = `${ROTAS.devAssinatura}?situacao=${estado}`;
  return (
    <PanelLayout aviso={null} papel="gestor" nomeSalao="Salão de demonstração" caminhoAtual={ROTAS.assinatura}>
      <ConteudoDaAssinatura
        tela={tela}
        acoes={{ assinar: demonstrarAssinarAcao, regularizar: demonstrarRegularizarAcao, cancelar: demonstrarCancelarAcao }}
        confirmando={um(q.cancelar) === '1'}
        hrefCancelar={`${base}&cancelar=1${q.historico !== undefined ? `&historico=${quantos}` : ''}`}
        hrefManter={`${base}${q.historico !== undefined ? `&historico=${quantos}` : ''}`}
        {...(resultadoInicial ? { resultadoInicial } : {})}
      />
    </PanelLayout>
  );
}
