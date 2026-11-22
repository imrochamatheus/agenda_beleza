import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { FaixaDoPlano } from '@/components/layout/FaixaDoPlano';
import { PanelLayout } from '@/components/layout/PanelLayout';
import { ROTAS } from '@/config/navegacao';
import { decidirEstadoEfetivo } from '@/domain/assinatura';
import type { EstadoBruto } from '@/domain/assinatura';
import { avisoDoPlano } from '@/server/assinatura/aviso';
import { vitrineHabilitada } from '@/server/env';
import { ehPapelDeSalao } from '@/server/tenant/context';

// Demonstração da faixa do plano para o E2E sem banco (D-038 §3.5): o MESMO `avisoDoPlano` e a MESMA
// `FaixaDoPlano` do painel, com o estado escolhido por `?estado=` e o papel por `?papel=` (padrão gestor).
// 404 sem VITRINE_COMPONENTES=true (exceto em next dev), lido antes de qualquer parâmetro. O relógio é fixo
// e as datas ficam na virada de dia (UTC 02:30 = dia anterior em America/Sao_Paulo).
export const dynamic = 'force-dynamic';

const METADADOS: Metadata = {
  title: 'Faixa do plano (demonstração) · Agenda Beleza',
  robots: { index: false, follow: false },
};

export function generateMetadata(): Metadata {
  return vitrineHabilitada(process.env) ? METADADOS : {};
}

const AGORA = new Date('2026-11-20T12:00:00Z');
const FUSO = 'America/Sao_Paulo';
const VIRADA = new Date('2026-12-01T02:30:00Z');

const ASSINATURA = (estado: string, extra: Partial<{ carenciaAte: Date; acessoAte: Date }> = {}) => ({
  suspensoManualEm: null,
  assinatura: { estado, carenciaAte: extra.carenciaAte ?? null, acessoAte: extra.acessoAte ?? null },
});

const ESTADOS_DE_DEMONSTRACAO: Readonly<Record<string, EstadoBruto>> = {
  sem_assinatura: { suspensoManualEm: null, assinatura: null },
  pendente: ASSINATURA('pendente'),
  em_teste: ASSINATURA('em_teste'),
  ativa: ASSINATURA('ativa'),
  em_carencia: ASSINATURA('em_carencia', { carenciaAte: VIRADA }),
  cancelada: ASSINATURA('cancelada', { acessoAte: VIRADA }),
  suspensa: ASSINATURA('suspensa'),
  encerrada: ASSINATURA('encerrada'),
  manual: { ...ASSINATURA('ativa'), suspensoManualEm: AGORA },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function DemonstracaoAvisoPlano({ searchParams }: Props) {
  if (!vitrineHabilitada(process.env)) notFound();
  const params = await searchParams;
  const chave = typeof params.estado === 'string' && Object.hasOwn(ESTADOS_DE_DEMONSTRACAO, params.estado) ? params.estado : 'sem_assinatura';
  const papel = ehPapelDeSalao(params.papel) ? params.papel : 'gestor';
  const estado = decidirEstadoEfetivo(ESTADOS_DE_DEMONSTRACAO[chave], AGORA);
  const aviso = avisoDoPlano(estado, papel, FUSO);
  return (
    <PanelLayout
      papel={papel}
      nomeSalao="Salão Exemplo"
      caminhoAtual={ROTAS.painel}
      aviso={aviso === null ? null : <FaixaDoPlano aviso={aviso} />}
    >
      <h1>Faixa do plano</h1>
      <p>Estado exibido: {chave}.</p>
    </PanelLayout>
  );
}
