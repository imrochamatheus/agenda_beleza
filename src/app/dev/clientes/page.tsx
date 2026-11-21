import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { BuscaClientes } from '@/app/painel/clientes/BuscaClientes';
import estilos from '@/app/painel/clientes/Clientes.module.css';
import { FormularioCliente } from '@/app/painel/clientes/FormularioCliente';
import { HistoricoCliente } from '@/app/painel/clientes/HistoricoCliente';
import { ListaClientes } from '@/app/painel/clientes/ListaClientes';
import { PanelLayout } from '@/components/layout/PanelLayout';
import { formatarTelefone } from '@/lib/format';
import { ROTAS } from '@/config/navegacao';
import { MENSAGENS_CLIENTE, LIMITES_CLIENTE } from '@/server/clientes/tipos';
import type { ListaClientes as Lista } from '@/server/clientes/tipos';
import { chaveDeBusca, lerBusca, lerPagina } from '@/server/clientes/validacao';
import { vitrineHabilitada } from '@/server/env';

import { demonstrarEdicaoAcao } from './acoes';
import {
  CLIENTES_DEMONSTRACAO,
  CLIENTE_DETALHE_DEMONSTRACAO,
  HISTORICO_DEMONSTRACAO,
  NOME_SALAO_DEMONSTRACAO,
} from './demonstracao';

// Demonstração das clientes para o E2E sem banco (D-022 §3.6): os MESMOS componentes das páginas reais,
// com dados fixos e uma ação que só valida. 404 sem VITRINE_COMPONENTES=true (exceto em next dev), lido
// na requisição, antes de qualquer parâmetro. `?vista=detalhe` mostra a edição e o histórico;
// `?vista=anonimizada`, a cliente removida; sem vista, a lista (busca e página em memória, com as mesmas
// regras do servidor).
export const dynamic = 'force-dynamic';

const METADADOS: Metadata = {
  title: 'Clientes (demonstração) · Agenda Beleza',
  robots: { index: false, follow: false },
};

/** Metadados só com a vitrine habilitada (D-009 DEF-2). */
export function generateMetadata(): Metadata {
  return vitrineHabilitada(process.env) ? METADADOS : {};
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const BASE = ROTAS.devClientes;
const hrefDetalhe = () => `${BASE}?vista=detalhe`;

/** Mesma regra do repositório, em memória: nome por chave de busca; telefone por dígitos do E.164. */
function listarEmMemoria(q: unknown, paginaBruta: unknown): Lista {
  const busca = lerBusca(q);
  const pagina = lerPagina(paginaBruta);
  const achadas = CLIENTES_DEMONSTRACAO.filter(
    (c) =>
      busca.nome === '' ||
      chaveDeBusca(c.nome ?? '').includes(busca.nome) ||
      (busca.digitos !== null && (c.telefone ?? '').slice(1).includes(busca.digitos)),
  );
  const ordenadas = [...achadas].sort((x, y) => (chaveDeBusca(x.nome ?? '') < chaveDeBusca(y.nome ?? '') ? -1 : 1));
  const de = (pagina - 1) * LIMITES_CLIENTE.porPagina;
  return { itens: ordenadas.slice(de, de + LIMITES_CLIENTE.porPagina), total: ordenadas.length, pagina, porPagina: LIMITES_CLIENTE.porPagina, q: busca.q };
}

export default async function DemonstracaoClientes({ searchParams }: Props) {
  // Antes de ler qualquer parâmetro.
  if (!vitrineHabilitada(process.env)) notFound();
  const params = await searchParams;
  const vista = params.vista;
  return (
    <PanelLayout papel="gestor" nomeSalao={NOME_SALAO_DEMONSTRACAO} caminhoAtual={ROTAS.clientes}>
      <div className={estilos.pagina}>
        {vista === 'detalhe' ? (
          <>
            <h1>{CLIENTE_DETALHE_DEMONSTRACAO.nome}</h1>
            <p>
              <a href={BASE} className={estilos.link}>
                Voltar para clientes
              </a>
            </p>
            <section className={estilos.secao} aria-labelledby="cliente-dados">
              <h2 id="cliente-dados">Dados</h2>
              <FormularioCliente
                acao={demonstrarEdicaoAcao}
                id="demo-detalhe"
                valoresIniciais={{ nome: CLIENTE_DETALHE_DEMONSTRACAO.nome, telefone: formatarTelefone(CLIENTE_DETALHE_DEMONSTRACAO.telefone) }}
                hrefExistente={hrefDetalhe()}
              />
            </section>
            <HistoricoCliente itens={HISTORICO_DEMONSTRACAO} total={HISTORICO_DEMONSTRACAO.length} />
          </>
        ) : vista === 'anonimizada' ? (
          <>
            <h1>{MENSAGENS_CLIENTE.removida}</h1>
            <p>
              <a href={BASE} className={estilos.link}>
                Voltar para clientes
              </a>
            </p>
            <p>Os dados de contato desta cliente foram removidos. O histórico de agendamentos foi mantido.</p>
            <HistoricoCliente itens={HISTORICO_DEMONSTRACAO} total={HISTORICO_DEMONSTRACAO.length} />
          </>
        ) : (
          <>
            <h1>Clientes</h1>
            {(() => {
              const lista = listarEmMemoria(params.q, params.pagina);
              return (
                <>
                  <BuscaClientes base={BASE} q={lista.q} />
                  <ListaClientes lista={lista} base={BASE} hrefDetalhe={hrefDetalhe} />
                </>
              );
            })()}
          </>
        )}
      </div>
    </PanelLayout>
  );
}
