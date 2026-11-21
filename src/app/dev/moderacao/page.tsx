import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { PublicLayout } from '@/components/layout/PublicLayout';
import { PARAMETRO_RESULTADO } from '@/config/moderacao';
import { ROTAS } from '@/config/navegacao';
import { vitrineHabilitada } from '@/server/env';
import { POR_PAGINA_FILA } from '@/server/denuncias/tipos';
import type { DetalheDaAvaliacao, ItemDaFila } from '@/server/denuncias/tipos';
import { lerFiltrosDaFila } from '@/server/denuncias/validacao';
import { DetalheDaModeracao } from '@/app/admin/avaliacoes/_componentes/DetalheDaModeracao';
import { FilaDeAvaliacoes } from '@/app/admin/avaliacoes/_componentes/FilaDeAvaliacoes';
import { lerResultado } from '@/app/admin/avaliacoes/resultado';

import { arquivarDemonstracao, restaurarDemonstracao, retirarDemonstracao } from './acoes';

// Demonstração da moderação para o E2E sem banco (D-035): os MESMOS componentes das páginas de /admin, com
// dados em memória e ações que só validam. `?vista=detalhe` mostra o detalhe. 404 sem
// VITRINE_COMPONENTES=true (exceto em next dev), lido na requisição.
export const dynamic = 'force-dynamic';

const METADADOS: Metadata = { title: 'Moderação (demonstração) · Agenda Beleza', robots: { index: false, follow: false } };

export function generateMetadata(): Metadata {
  return vitrineHabilitada(process.env) ? METADADOS : {};
}

const SALAO_A = '33333333-3333-4333-8333-333333333333';
const SALAO_B = '44444444-4444-4444-8444-444444444444';
const base = { criadoEm: new Date('2026-11-20T15:30:00Z'), retiradaEm: null, naoPublicada: false };

const ITENS: ItemDaFila[] = [
  { ...base, id: '11111111-1111-4111-8111-111111111111', salaoId: SALAO_A, salaoNome: 'Salão Aurora', nota: 1, nome: 'Maria S.', comentario: 'Texto com <b>marcação</b> que deve aparecer escapado.', pendentes: 2, motivos: ['ofensivo', 'falso'] },
  { ...base, id: '22222222-2222-4222-8222-222222222222', salaoId: SALAO_B, salaoNome: 'Espaço Lótus', nota: 5, nome: 'Ana L.', comentario: 'Atendimento excelente.', pendentes: 0, motivos: [] },
  { ...base, id: '55555555-5555-4555-8555-555555555555', salaoId: SALAO_A, salaoNome: 'Salão Aurora', nota: 2, nome: null, comentario: null, pendentes: 1, motivos: ['spam'], retiradaEm: new Date('2026-11-21T09:00:00Z'), naoPublicada: true },
];

const DETALHE: DetalheDaAvaliacao = {
  id: ITENS[0].id,
  salaoId: SALAO_A,
  salaoNome: 'Salão Aurora',
  nota: 1,
  nome: 'Maria S.',
  comentario: ITENS[0].comentario,
  criadoEm: ITENS[0].criadoEm,
  retiradaEm: null,
  naoPublicada: false,
  denuncias: [
    { id: 'a0000000-0000-4000-8000-000000000001', motivo: 'ofensivo', texto: 'Ofende a equipe. <i>Sem HTML.</i>', criadoEm: new Date('2026-11-21T10:00:00Z'), resolvidaEm: null, resolucao: null },
    { id: 'a0000000-0000-4000-8000-000000000002', motivo: 'falso', texto: null, criadoEm: new Date('2026-11-21T11:00:00Z'), resolvidaEm: null, resolucao: null },
    { id: 'a0000000-0000-4000-8000-000000000003', motivo: 'spam', texto: null, criadoEm: new Date('2026-11-19T11:00:00Z'), resolvidaEm: new Date('2026-11-20T08:00:00Z'), resolucao: 'mantida' },
  ],
};

type Props = { searchParams: Promise<{ [chave: string]: string | string[] | undefined }> };

export default async function DemonstracaoModeracao({ searchParams }: Props) {
  if (!vitrineHabilitada(process.env)) notFound();
  const consulta = await searchParams;
  if (consulta.vista === 'detalhe') {
    return (
      <PublicLayout>
        <DetalheDaModeracao
          detalhe={DETALHE}
          acoes={{ retirar: retirarDemonstracao, restaurar: restaurarDemonstracao, arquivar: arquivarDemonstracao }}
          resultado={lerResultado(consulta[PARAMETRO_RESULTADO])}
          hrefDaFila={ROTAS.devModeracao}
        />
      </PublicLayout>
    );
  }
  const filtros = lerFiltrosDaFila(consulta);
  const itens = ITENS.filter(
    (i) =>
      (filtros.salaoId === null || i.salaoId === filtros.salaoId) &&
      (filtros.estado === null ||
        (filtros.estado === 'visivel' ? i.retiradaEm === null : filtros.estado === 'retirada' ? i.retiradaEm !== null : i.pendentes > 0)),
  );
  return (
    <PublicLayout>
      <h1>Moderação de avaliações (demonstração)</h1>
      <FilaDeAvaliacoes
        fila={{ total: itens.length, pagina: 1, porPagina: POR_PAGINA_FILA, itens }}
        filtros={filtros}
        base={ROTAS.devModeracao}
        hrefDoDetalhe={() => `${ROTAS.devModeracao}?vista=detalhe`}
      />
    </PublicLayout>
  );
}
