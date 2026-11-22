import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import estilos from '@/app/painel/bloqueios/Bloqueios.module.css';
import { rotuloDoAlvo } from '@/app/painel/bloqueios/estado';
import { FormularioBloqueio } from '@/app/painel/bloqueios/FormularioBloqueio';
import { AlertaDeRemocao, ListaBloqueios } from '@/app/painel/bloqueios/ListaBloqueios';
import { PanelLayout } from '@/components/layout/PanelLayout';
import { ROTAS } from '@/config/navegacao';
import { opcoesDeAlvo, paraItem, valoresDeEdicao } from '@/server/bloqueios/apresentacao';
import { vitrineHabilitada } from '@/server/env';
import type { BloqueioDTO } from '@/server/repos/tipos';
import { instanteDeHoraLocal, intervaloDeDiasInteiros, partesLocais, somarDias } from '@/server/tempo/fuso';

import { demonstrarCriacaoAcao, demonstrarEdicaoAcao, demonstrarRemocaoAcao } from './acoes';

// Demonstração dos bloqueios para o E2E sem banco (D-016 §3.8, D-24): os MESMOS componentes da página
// real, com ações que só validam. Responde 404 sem VITRINE_COMPONENTES=true (exceto em next dev), lido
// na requisição, antes de qualquer parâmetro. Sem banco, sessão, adaptadores nem rede. Os instantes de
// exemplo são calculados a partir de agora (sempre futuros), no fuso America/Sao_Paulo.
export const dynamic = 'force-dynamic';

const METADADOS: Metadata = {
  title: 'Bloqueios (demonstração) · Agenda Beleza',
  robots: { index: false, follow: false },
};

/** Metadados só com a vitrine habilitada (D-009 DEF-2). */
export function generateMetadata(): Metadata {
  return vitrineHabilitada(process.env) ? METADADOS : {};
}

const FUSO = 'America/Sao_Paulo';
const NOME_SALAO = 'Salão Exemplo';
const ANA = { id: '00000000-0000-4000-8000-00000000d016', nome: 'Ana Demonstração', ativo: true };
const BIA = { id: '00000000-0000-4000-8000-00000001d016', nome: 'Bia Demonstração', ativo: false };

type ModoDemonstracao = 'gestor' | 'profissional' | 'edicao';

/** `?modo=`; ausente, repetido ou desconhecido → 'gestor'. */
function lerModo(params: Record<string, string | string[] | undefined>): ModoDemonstracao {
  const modo = params.modo;
  return modo === 'profissional' || modo === 'edicao' ? modo : 'gestor';
}

/** Bloqueios de exemplo: do salão (dia inteiro), da Ana (com horário e motivo) e da Bia (inativa). */
function exemplos(agora: Date): { salao: BloqueioDTO; ana: BloqueioDTO; bia: BloqueioDTO } {
  const hoje = partesLocais(agora, FUSO).data;
  const diaSalao = somarDias(hoje, 10);
  const diaAna = somarDias(hoje, 3);
  const diaBia = somarDias(hoje, 5);
  const salao = intervaloDeDiasInteiros(diaSalao, diaSalao, FUSO);
  return {
    salao: { id: 'exemplo-salao', profissionalId: null, profissional: null, ...salao, motivo: 'Feriado' },
    ana: {
      id: 'exemplo-ana',
      profissionalId: ANA.id,
      profissional: ANA,
      inicio: instanteDeHoraLocal(diaAna, 14 * 60, FUSO),
      fim: instanteDeHoraLocal(diaAna, 16 * 60, FUSO),
      motivo: 'Dentista',
    },
    bia: {
      id: 'exemplo-bia',
      profissionalId: BIA.id,
      profissional: BIA,
      inicio: instanteDeHoraLocal(diaBia, 9 * 60, FUSO),
      fim: instanteDeHoraLocal(diaBia, 12 * 60, FUSO),
      motivo: null,
    },
  };
}

const rotaEdicao = () => `${ROTAS.devBloqueios}?modo=edicao`;

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function DemonstracaoBloqueios({ searchParams }: Props) {
  // Antes de ler qualquer parâmetro.
  if (!vitrineHabilitada(process.env)) notFound();
  const params = await searchParams;
  const modo = lerModo(params);
  const { salao, ana, bia } = exemplos(new Date());

  if (modo === 'edicao') {
    const item = paraItem(ana, FUSO, { papel: 'gestor', profissionalId: null });
    return (
      <PanelLayout aviso={null} papel="gestor" nomeSalao={NOME_SALAO} caminhoAtual={ROTAS.bloqueios}>
        <div className={estilos.pagina}>
          <h1>Editar bloqueio</h1>
          <p>
            Período atual: <strong>{item.periodo}</strong>
          </p>
          <FormularioBloqueio
            acao={demonstrarEdicaoAcao}
            opcoesAlvo={null}
            id={item.id}
            alvoTexto={rotuloDoAlvo(item.alvo)}
            valoresIniciais={valoresDeEdicao(ana, FUSO)}
            rotuloEnviar="Salvar alterações"
          />
        </div>
      </PanelLayout>
    );
  }

  const gestor = modo === 'gestor';
  const ctx = gestor ? ({ papel: 'gestor', profissionalId: null } as const) : ({ papel: 'profissional', profissionalId: ANA.id } as const);
  const linhas = gestor ? [ana, bia, salao] : [ana, salao];
  const itens = linhas.map((l) => paraItem(l, FUSO, ctx));
  return (
    <PanelLayout aviso={null} papel={ctx.papel} nomeSalao={NOME_SALAO} caminhoAtual={ROTAS.bloqueios}>
      <div className={estilos.pagina}>
        <h1>Bloqueios</h1>
        <AlertaDeRemocao remocao={params.remocao} />
        <section className={estilos.secao} aria-labelledby="novo-bloqueio">
          <h2 id="novo-bloqueio">Novo bloqueio</h2>
          <FormularioBloqueio acao={demonstrarCriacaoAcao} opcoesAlvo={gestor ? opcoesDeAlvo([ANA, BIA]) : null} rotuloEnviar="Salvar bloqueio" />
        </section>
        <section className={estilos.secao} aria-labelledby="bloqueios-vigentes">
          <h2 id="bloqueios-vigentes">Bloqueios vigentes e futuros</h2>
          <ListaBloqueios itens={itens} acaoRemover={demonstrarRemocaoAcao.bind(null, modo)} rotaEdicao={rotaEdicao} />
        </section>
      </div>
    </PanelLayout>
  );
}
