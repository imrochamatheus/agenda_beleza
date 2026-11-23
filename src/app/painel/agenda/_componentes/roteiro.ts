import type { EstadoDaParada, EtiquetaDoRoteiro, ParadaDoRoteiro } from '@/components/ui/RoteiroDoDia';
import { formatarDataCivil, formatarDiaDaSemana, formatarDuracao, formatarMinutosDoDia, formatarMoeda } from '@/lib/format';
import { ROTULO_TOTAL, rotuloDoStatusDoItem } from '@/server/agenda/rotulos';
import { MENSAGENS_AGENDA } from '@/server/agenda/tipos';
import type { DetalheDaReserva, ItemDoDetalhe, TotalDoDetalhe } from '@/server/agenda/tipos';
import { isoDaData } from '@/server/agenda/validacao';
import { compararDatas, partesLocais } from '@/server/tempo/fuso';
import type { DataCivil } from '@/server/tempo/fuso';

// Conversão PURA do detalhe da reserva (D-050 §3.9) em textos do roteiro (web-design §5.10). Sem hooks e sem
// estado: usada pelo detalhe somente leitura (vitrine /dev/agenda), pela página real e pela vitrine das ações.
// Datas e moeda só pelo format.ts; hora local só por partesLocais (o fuso do processo não interfere).

/** "09:00" no fuso do salão. */
export function horaLocal(instante: Date, fuso: string): string {
  return formatarMinutosDoDia(partesLocais(instante, fuso).minutosDoDia);
}

/** Fim do item: "24:00" quando o serviço termina exatamente na meia-noite seguinte (dia civil posterior). */
export function horaLocalDoFim(inicio: Date, fim: Date, fuso: string): string {
  const a = partesLocais(inicio, fuso);
  const b = partesLocais(fim, fuso);
  return compararDatas(b.data, a.data) > 0 && b.minutosDoDia === 0 ? formatarMinutosDoDia(1440) : formatarMinutosDoDia(b.minutosDoDia);
}

/** "Quinta-feira, 26/11/2026" a partir da data civil (sem fuso: já é a data local). */
export function textoDaData(d: DataCivil): string {
  const diaSemana = new Date(Date.UTC(d.ano, d.mes - 1, d.dia)).getUTCDay();
  return `${formatarDiaDaSemana(diaSemana)}, ${formatarDataCivil(isoDaData(d))}`;
}

/** "1 serviço" / "2 serviços" (plural por regra, não por "(s)"). */
export function quantidadeDeServicos(n: number): string {
  return `${n} ${n === 1 ? 'serviço' : 'serviços'}`;
}

/** Nome do profissional com a marca de inativo, como no restante da agenda. */
export function nomeDoProfissional(i: Pick<ItemDoDetalhe, 'profissionalNome' | 'profissionalAtivo'>): string {
  return i.profissionalAtivo ? i.profissionalNome : `${i.profissionalNome} (${MENSAGENS_AGENDA.inativo})`;
}

export function etiquetasDoItem(i: Pick<ItemDoDetalhe, 'status' | 'encaixe'>): EtiquetaDoRoteiro[] {
  const etiquetas: EtiquetaDoRoteiro[] = [{ texto: rotuloDoStatusDoItem(i.status), variante: i.status }];
  if (i.encaixe) etiquetas.push({ texto: MENSAGENS_AGENDA.encaixe, variante: 'encaixe' });
  return etiquetas;
}

/** Rótulo acessível da lista de serviços do detalhe. */
export const ROTULO_DO_ROTEIRO = 'Serviços da reserva';

/** Âncora de um item no detalhe (`#item-<id>`), usada pelos blocos da agenda. */
export const idDoItem = (itemId: string): string => `item-${itemId}`;

/**
 * Paradas do roteiro, SEM ações (o chamador acrescenta o slot `acoes`). `destaque` = item com um formulário
 * aberto (remarcar/cancelar): faixa de aviso atrás da parada. Item cancelado = parada riscada.
 */
export function paradasDaReserva(d: Pick<DetalheDaReserva, 'itens' | 'fuso'>, destaque: string | null = null): ParadaDoRoteiro[] {
  return d.itens.map((i) => {
    const estado: EstadoDaParada = i.status === 'cancelado' ? 'cancelada' : i.id === destaque ? 'destaque' : 'escolhida';
    return {
      chave: i.id,
      id: idDoItem(i.id),
      hora: horaLocal(i.inicio, d.fuso),
      fim: horaLocalDoFim(i.inicio, i.fim, d.fuso),
      servico: i.servicoNome,
      profissional: nomeDoProfissional(i),
      detalhe: `${formatarDuracao(i.duracaoMin)} · ${formatarMoeda(i.precoCentavos)}`,
      estado,
      etiquetas: etiquetasDoItem(i),
    };
  });
}

/** Textos do total (RN-35): rótulo conforme o papel/estado, valor em BRL e quantidade de serviços somados. */
export function textoDoTotal(t: TotalDoDetalhe): { rotulo: string; valor: string; servicos: string } {
  return { rotulo: ROTULO_TOTAL[t.rotulo], valor: formatarMoeda(t.centavos), servicos: quantidadeDeServicos(t.servicos) };
}

/** A nota "Itens cancelados não entram no total." só quando há item cancelado e a reserva não está toda cancelada. */
export function mostrarNotaDeCancelados(d: Pick<DetalheDaReserva, 'temItemCancelado' | 'total'>): boolean {
  return d.temItemCancelado && d.total.rotulo !== 'cancelada';
}
