import type { Metadata } from 'next';

import { PanelLayout } from '@/components/layout/PanelLayout';
import { ROTAS } from '@/config/navegacao';
import { formatarDuracao, formatarMoeda } from '@/lib/format';
import { exigirAcessoAoPainel } from '@/server/auth/pagina';
import { repos } from '@/server/repos';
import { buscarIdentidadeDoPainel } from '@/server/repos/usuario';
import { partesLocais } from '@/server/tempo/fuso';

import { AcessoNegado } from '../../_componentes/AcessoNegado';
import { AreaUsuario } from '../../_componentes/AreaUsuario';

import { criarReservaManualAcao } from './acoes';
import { estadoInicial } from './estado';
import { FormularioReservaManual } from './FormularioReservaManual';
import estilos from './NovaReserva.module.css';
import { valoresIniciais } from './pre-preenchimento';

export const metadata: Metadata = { title: 'Nova reserva', robots: { index: false } };
export const dynamic = 'force-dynamic';

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

/**
 * Reserva manual da equipe (D-029; D-050: N serviços, cada um com profissional e hora). Gestor: qualquer
 * profissional ativo do salão em cada linha; profissional: só ele mesmo (o servidor repete a regra na ação).
 * Ordem: 401 (redirect) → 403 ("Acesso negado"). A chave de idempotência nasce aqui, no render do servidor.
 */
export default async function PaginaNovaReserva({ searchParams }: Props) {
  const acesso = await exigirAcessoAoPainel(ROTAS.novaReserva, ['gestor', 'profissional'], 'reserva.criar');
  if (acesso.tipo === 'negado') {
    return <AcessoNegado />;
  }
  const { ctx } = acesso;
  const params = (await searchParams) ?? {};
  const r = repos();
  const [ativos, servicos, fuso, { nomeUsuario, nomeSalao }] = await Promise.all([
    r.profissionais.listarAtivos(ctx),
    r.servicos.listar(ctx),
    r.bloqueios.fusoDoSalao(ctx),
    buscarIdentidadeDoPainel(ctx),
  ]);
  const ehGestor = ctx.papel === 'gestor';
  const valores = valoresIniciais(params, {
    profissionaisValidos: ativos.map((p) => p.id),
    fixo: ehGestor ? null : ctx.profissionalId,
    hoje: partesLocais(new Date(), fuso).data,
  });
  const proprio = ativos.find((p) => p.id === ctx.profissionalId);
  const ativosDoSalao = servicos.filter((s) => s.ativo);
  return (
    <PanelLayout papel={ctx.papel} nomeSalao={nomeSalao} caminhoAtual={ROTAS.agenda} areaUsuario={<AreaUsuario nome={nomeUsuario} />}>
      <div className={estilos.pagina}>
        <h1>Nova reserva</h1>
        <FormularioReservaManual
          acao={criarReservaManualAcao}
          estadoInicial={estadoInicial(crypto.randomUUID(), valores)}
          servicos={ativosDoSalao.map((s) => ({
            id: s.id,
            nome: s.nome,
            rotulo: `${s.nome} · ${formatarDuracao(s.duracaoMin)} · ${formatarMoeda(s.precoCentavos)}`,
          }))}
          profissionais={ehGestor ? ativos.map((p) => ({ valor: p.id, rotulo: p.nome })) : null}
          profissionalFixo={ehGestor ? undefined : { id: ctx.profissionalId ?? '', nome: proprio?.nome ?? '' }}
          fuso={fuso}
        />
      </div>
    </PanelLayout>
  );
}
