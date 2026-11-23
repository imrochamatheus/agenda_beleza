// Montagem PURA das props do roteiro interativo (D-050 web-design §5.10) a partir do detalhe lido no servidor.
// Usada pela página real e pela vitrine /dev/reserva-acoes (mesma regra, sem cópia). Sem next/* e sem banco.
import { horaLocal, paradasDaReserva } from '@/app/painel/agenda/_componentes/roteiro';
import type { Opcao } from '@/components/ui/Select';
import { formatarDataCivil, formatarDuracao, formatarMoeda } from '@/lib/format';
import type { DetalheDaReserva } from '@/server/agenda/tipos';
import { isoDaData } from '@/server/agenda/validacao';
import { partesLocais } from '@/server/tempo/fuso';

import type { AcoesDaReservaProps } from './AcoesDaReserva';
import { textoConfirmarCancelamento, textoConfirmarCancelarTodos } from './estado';
import type { Abertura } from './estado';

export type ServicoDaLista = { id: string; nome: string; ativo: boolean; precoCentavos: number; duracaoMin: number };
export type ProfissionalDaLista = { id: string; nome: string };

export type EntradaDasAcoes = {
  reserva: DetalheDaReserva;
  abrir: Abertura;
  /** Serviços do salão (só lidos quando o remarcar está aberto; vazio nos demais casos). */
  servicos: readonly ServicoDaLista[];
  /** Profissionais ativos para o gestor; ignorado para o profissional (agenda própria, fixa). */
  profissionais: readonly ProfissionalDaLista[];
};

export type DadosDasAcoes = Pick<AcoesDaReservaProps, 'paradas' | 'itens' | 'abrir' | 'remarcar' | 'textos' | 'podeCancelarTodos'>;

const rotuloDoServico = (s: ServicoDaLista): string =>
  `${s.nome} · ${formatarDuracao(s.duracaoMin)} · ${formatarMoeda(s.precoCentavos)}${s.ativo ? '' : ' (inativo)'}`;

export function montarAcoes({ reserva: d, abrir, servicos, profissionais }: EntradaDasAcoes): DadosDasAcoes {
  const destaque = abrir.remarcar ?? abrir.cancelar;
  const alvo = abrir.remarcar === null ? undefined : d.itens.find((i) => i.id === abrir.remarcar);
  let remarcar: DadosDasAcoes['remarcar'] = null;
  if (alvo) {
    const outros = d.itens.filter((i) => i.id !== alvo.id);
    // O serviço novo não pode repetir outro da reserva, nem de item cancelado (M-5); o atual sempre aparece.
    const usados = new Set(outros.map((i) => i.servicoId));
    const opcoes: Opcao[] = servicos
      .filter((s) => s.id === alvo.servicoId || (s.ativo && !usados.has(s.id)))
      .map((s) => ({ valor: s.id, rotulo: rotuloDoServico(s) }));
    if (!opcoes.some((o) => o.valor === alvo.servicoId)) opcoes.unshift({ valor: alvo.servicoId, rotulo: alvo.servicoNome });
    const ehGestor = d.papel === 'gestor';
    // DEF-1: com o profissional atual inativo, o gestor começa sem seleção (nunca a 1ª opção ativa em silêncio).
    const inativo = ehGestor && !alvo.profissionalAtivo;
    const outroAtivo = outros.some((i) => i.status !== 'cancelado');
    const local = partesLocais(alvo.inicio, d.fuso);
    remarcar = {
      valores: {
        servicoId: alvo.servicoId,
        profissionalId: ehGestor && !inativo ? alvo.profissionalId : '',
        data: isoDaData(local.data),
        hora: horaLocal(alvo.inicio, d.fuso),
        confirmarEncaixe: false,
      },
      servicos: opcoes,
      profissionais: ehGestor ? profissionais.map((p) => ({ valor: p.id, rotulo: p.nome })) : null,
      profissionalFixo: alvo.profissionalNome,
      profissionalInativo: inativo ? alvo.profissionalNome : null,
      // RN-22: com outro serviço não cancelado, a data não muda e aparece como texto.
      dataFixa: outroAtivo ? formatarDataCivil(isoDaData(local.data)) : null,
    };
  }
  const cancelarAlvo = abrir.cancelar === null ? undefined : d.itens.find((i) => i.id === abrir.cancelar);
  const cancelaveis = d.itens.filter((i) => i.acoes.cancelar);
  return {
    paradas: paradasDaReserva(d, destaque),
    itens: d.itens.map((i) => ({ id: i.id, servico: i.servicoNome, hora: horaLocal(i.inicio, d.fuso), acoes: i.acoes })),
    abrir,
    remarcar,
    textos: {
      cancelarItem: cancelarAlvo ? textoConfirmarCancelamento(cancelarAlvo, d.fuso) : null,
      cancelarTodos: d.podeCancelarTodos ? textoConfirmarCancelarTodos(cancelaveis, d.fuso) : null,
    },
    podeCancelarTodos: d.podeCancelarTodos,
  };
}
