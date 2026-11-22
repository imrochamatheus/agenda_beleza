import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { CascaAdmin } from '@/app/admin/_componentes/CascaAdmin';
import { CabecalhoDoSalao } from '@/app/admin/saloes/_componentes/CabecalhoDoSalao';
import { ListaDeSaloes } from '@/app/admin/saloes/_componentes/ListaDeSaloes';
import { PainelDoSalao } from '@/app/admin/saloes/_componentes/PainelDoSalao';
import { ROTAS } from '@/config/navegacao';
import { POR_PAGINA_SALOES } from '@/server/admin/saloes-tipos';
import { lerFiltros, recusaDaExtensao } from '@/server/admin/saloes-validacao';
import { vitrineHabilitada } from '@/server/env';
import { opcoesDeFuso } from '@/server/salao/fusos';
import { chaveDeBusca } from '@/server/clientes/validacao';

import { demonstrarEdicaoAcao, demonstrarExtensaoAcao, demonstrarReativacaoAcao, demonstrarSuspensaoAcao } from './acoes';
import { detalheDeDemonstracao, SALOES_DEMONSTRACAO } from './demonstracao';

// Demonstração dos salões no painel do admin para o E2E sem banco (D-044 CA-14): os MESMOS componentes das
// páginas de /admin, com dados em memória e ações que só validam. `?vista=detalhe|detalhe-suspenso|
// detalhe-sem-assinatura|detalhe-ativa` mostra o detalhe; sem `vista`, a lista (com os mesmos filtros).
// 404 sem VITRINE_COMPONENTES=true (exceto em next dev), lido na requisição.
export const dynamic = 'force-dynamic';

const METADADOS: Metadata = { title: 'Salões (demonstração) · Agenda Beleza', robots: { index: false, follow: false } };

export function generateMetadata(): Metadata {
  return vitrineHabilitada(process.env) ? METADADOS : {};
}

type Props = { searchParams: Promise<{ [chave: string]: string | string[] | undefined }> };

export default async function DemonstracaoSaloes({ searchParams }: Props) {
  if (!vitrineHabilitada(process.env)) notFound();
  const consulta = await searchParams;
  const vista = typeof consulta.vista === 'string' ? consulta.vista : '';
  if (vista.startsWith('detalhe')) {
    const salao = detalheDeDemonstracao(vista);
    const a = salao.assinatura;
    const recusa = recusaDaExtensao(
      { estado: a?.estado ?? null, temProvedor: a?.vinculada ?? false, testeFimEm: a?.testeFimEm == null ? null : new Date(a.testeFimEm) },
      new Date(),
    );
    return (
      <CascaAdmin caminhoAtual={ROTAS.adminSaloes}>
        <CabecalhoDoSalao salao={salao} hrefLista={ROTAS.devAdminSaloes} />
        <PainelDoSalao
          salao={salao}
          fusos={opcoesDeFuso(salao.fuso)}
          acoes={{ editar: demonstrarEdicaoAcao, suspender: demonstrarSuspensaoAcao, reativar: demonstrarReativacaoAcao, estender: demonstrarExtensaoAcao }}
          recusaDaExtensao={recusa}
          hrefVoltar={`${ROTAS.devAdminSaloes}?vista=${encodeURIComponent(vista)}`}
        />
      </CascaAdmin>
    );
  }
  const filtros = lerFiltros(consulta);
  const filtrados = SALOES_DEMONSTRACAO.filter((s) => {
    const texto = `${chaveDeBusca(s.nome)} ${s.slug} ${s.gestorEmail ?? ''}`;
    if (filtros.chave !== '' && !texto.includes(filtros.chave)) return false;
    if (filtros.estado !== null && (filtros.estado === 'sem_assinatura' ? s.estado !== null : s.estado !== filtros.estado)) return false;
    if (filtros.suspenso === 'sim' && !s.suspenso) return false;
    if (filtros.suspenso === 'nao' && s.suspenso) return false;
    return true;
  });
  const inicio = (filtros.pagina - 1) * POR_PAGINA_SALOES;
  return (
    <CascaAdmin caminhoAtual={ROTAS.adminSaloes}>
      <h1>Salões</h1>
      <ListaDeSaloes
        lista={{ itens: filtrados.slice(inicio, inicio + POR_PAGINA_SALOES), total: filtrados.length, pagina: filtros.pagina, porPagina: POR_PAGINA_SALOES }}
        filtros={filtros}
        base={ROTAS.devAdminSaloes}
        hrefDoSalao={() => `${ROTAS.devAdminSaloes}?vista=detalhe`}
      />
    </CascaAdmin>
  );
}
