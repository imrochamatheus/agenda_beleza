import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { CascaAdmin } from '@/app/admin/_componentes/CascaAdmin';
import { TelaDeAuditoria } from '@/app/admin/auditoria/_componentes/TelaDeAuditoria';
import { TelaDeMensagens } from '@/app/admin/mensagens/_componentes/TelaDeMensagens';
import type { ConfirmacaoDeReenvio } from '@/app/admin/mensagens/_componentes/TelaDeMensagens';
import { TelaDeAssinatura } from '@/app/admin/saloes/[id]/assinatura/_componentes/TelaDeAssinatura';
import { ROTAS } from '@/config/navegacao';
import type { ListaAuditoria } from '@/server/admin/auditoria-tipos';
import { lerFiltrosAuditoria, intervaloDoPeriodo } from '@/server/admin/auditoria-validacao';
import { lerCodigoDeReenvio } from '@/server/admin/mensagens-tipos';
import type { ListaMensagens } from '@/server/admin/mensagens-tipos';
import { lerFiltrosMensagens } from '@/server/admin/mensagens-validacao';
import { POR_PAGINA_ADMIN, totalDePaginas, unico } from '@/server/admin/paginacao';
import { vitrineHabilitada } from '@/server/env';

import { demonstrarReenvioAcao } from './acoes';
import { assinaturaDeDemonstracao, AUDITORIA_DEMONSTRACAO, MENSAGENS_DEMONSTRACAO, SALOES_DEMONSTRACAO, tentativasDeDemonstracao } from './demonstracao';

// Demonstração das telas do admin (D-045 CA-14/CA-16) para o E2E sem banco: os MESMOS componentes das páginas
// de /admin, com dados em memória e a mesma validação pura dos filtros. Sem `vista`, a fila de mensagens;
// `?vista=auditoria`, `?vista=assinatura`, `?vista=assinatura-vazia` e `?vista=assinatura-mais`. 404 sem
// VITRINE_COMPONENTES=true (exceto em next dev), lido na requisição.
export const dynamic = 'force-dynamic';

const METADADOS: Metadata = { title: 'Mensagens do admin (demonstração) · Agenda Beleza', robots: { index: false, follow: false } };

export function generateMetadata(): Metadata {
  return vitrineHabilitada(process.env) ? METADADOS : {};
}

type Props = { searchParams: Promise<{ [chave: string]: string | string[] | undefined }> };

const SALAO = { modo: 'select' as const, opcoes: SALOES_DEMONSTRACAO.map((s) => ({ id: s.id, nome: s.nome })) };

export default async function DemonstracaoAdminMensagens({ searchParams }: Props) {
  if (!vitrineHabilitada(process.env)) notFound();
  const sp = await searchParams;
  const vista = unico(sp.vista) ?? '';

  if (vista.startsWith('assinatura')) {
    const dados = assinaturaDeDemonstracao(vista);
    if (dados === null) notFound();
    return (
      <CascaAdmin caminhoAtual={ROTAS.adminSaloes}>
        <TelaDeAssinatura dados={dados} hrefSalao={ROTAS.devAdminSaloes} hrefAuditoria={`${ROTAS.devAdminMensagens}?vista=auditoria`} />
      </CascaAdmin>
    );
  }

  if (vista === 'auditoria') {
    const { filtros, erros, ignorados, ecoes } = lerFiltrosAuditoria(sp);
    const periodo = intervaloDoPeriodo(filtros.de, filtros.ate);
    const filtrados = AUDITORIA_DEMONSTRACAO.filter((r) => {
      if (filtros.salaoId !== null && r.salaoId !== filtros.salaoId) return false;
      if (filtros.acao !== null && r.acao !== filtros.acao) return false;
      if (filtros.resultado !== null && r.resultado !== filtros.resultado) return false;
      if (filtros.ator !== null && r.atorEmail?.toLowerCase() !== filtros.ator) return false;
      const t = Date.parse(r.ocorridoEm);
      if (periodo.de !== null && t < periodo.de.getTime()) return false;
      if (periodo.ate !== null && t >= periodo.ate.getTime()) return false;
      return true;
    });
    const inicio = (filtros.pagina - 1) * POR_PAGINA_ADMIN;
    const lista: ListaAuditoria = {
      itens: filtrados.slice(inicio, inicio + POR_PAGINA_ADMIN),
      total: filtrados.length,
      pagina: filtros.pagina,
      paginas: totalDePaginas(filtrados.length),
      filtros,
      erros,
      ignorados,
      ecoes,
      salao: SALAO,
    };
    return (
      <CascaAdmin caminhoAtual={ROTAS.adminAuditoria}>
        <h1>Auditoria</h1>
        <TelaDeAuditoria lista={lista} base={`${ROTAS.devAdminMensagens}?vista=auditoria`} ocultos={{ vista: 'auditoria' }} hrefDoSalao={() => `${ROTAS.devAdminSaloes}?vista=detalhe`} />
      </CascaAdmin>
    );
  }

  const { filtros, ignorados } = lerFiltrosMensagens(sp);
  const filtradas = MENSAGENS_DEMONSTRACAO.filter(
    (m) => (filtros.estado === null || m.estado === filtros.estado) && (filtros.tipo === null || m.tipo === filtros.tipo) && (filtros.salaoId === null || m.salaoId === filtros.salaoId),
  );
  const inicio = (filtros.pagina - 1) * POR_PAGINA_ADMIN;
  const lista: ListaMensagens = {
    itens: filtradas.slice(inicio, inicio + POR_PAGINA_ADMIN),
    total: filtradas.length,
    pagina: filtros.pagina,
    paginas: totalDePaginas(filtradas.length),
    filtros,
    ignorados,
    salao: SALAO,
  };
  const idConfirmar = unico(sp.confirmar);
  let confirmacao: ConfirmacaoDeReenvio | null = null;
  if (idConfirmar !== undefined) {
    const m = MENSAGENS_DEMONSTRACAO.find((x) => x.id === idConfirmar && x.estado === 'falhou');
    confirmacao = m === undefined ? { indisponivel: true } : { mensagem: m };
  }
  const idDetalhe = unico(sp.detalhe);
  const mDetalhe = idDetalhe === undefined ? undefined : MENSAGENS_DEMONSTRACAO.find((x) => x.id === idDetalhe);
  if (idDetalhe !== undefined && mDetalhe === undefined) notFound();
  return (
    <CascaAdmin caminhoAtual={ROTAS.adminMensagens}>
      <h1>Mensagens</h1>
      <TelaDeMensagens
        lista={lista}
        base={ROTAS.devAdminMensagens}
        hrefDoSalao={() => `${ROTAS.devAdminSaloes}?vista=detalhe`}
        reenvio={lerCodigoDeReenvio(unico(sp.reenvio))}
        confirmacao={confirmacao}
        detalhe={mDetalhe === undefined ? null : { mensagem: mDetalhe, tentativas: tentativasDeDemonstracao(mDetalhe.id) }}
        acaoReenviar={demonstrarReenvioAcao}
      />
    </CascaAdmin>
  );
}
