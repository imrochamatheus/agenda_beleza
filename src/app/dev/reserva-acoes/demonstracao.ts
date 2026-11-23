// Reserva de exemplo e remarcação simulada da vitrine /dev/reserva-acoes (D-030; D-050 web-design §5.10), sem
// banco: as MESMAS funções puras do serviço (ações por item, status derivado, total, leitura de hora, detecção
// de encaixe) com dados em memória. Nada é gravado. A vista vai no id da reserva de exemplo (`demo-<vista>`),
// então a resposta das ações volta para a mesma vista.
import { ROTAS } from '@/config/navegacao';
import { totalDoDetalhe } from '@/server/agenda/consultar';
import type { DetalheDaReserva, ItemDoDetalhe, StatusAgenda } from '@/server/agenda/tipos';
import { isoDaData } from '@/server/agenda/validacao';
import { ehAceite } from '@/server/consentimento/validacao';
import { detectarMotivos } from '@/server/reservas/encaixe';
import { derivarStatus, envelope } from '@/server/reservas/itens';
import { lerData, lerHora } from '@/server/reservas/reserva-equipe';
import { acoesPermitidas } from '@/server/reservas/status';
import { MENSAGENS_ALTERACAO } from '@/server/reservas/tipos-alteracao';
import type { EntradaRemarcarItem, ResultadoRemarcarItem } from '@/server/reservas/tipos-alteracao';
import { montarSemana } from '@/server/semana/montagem';
import { instanteDeHoraLocal, partesLocais, somarDias } from '@/server/tempo/fuso';

export const FUSO_DEMO = 'America/Sao_Paulo';
export const NOME_SALAO_DEMO = 'Salão Exemplo';

export const VISTAS = ['futura', 'iniciada', 'profissional', 'cancelada'] as const;
export type Vista = (typeof VISTAS)[number];

export function lerVista(v: unknown): Vista {
  return typeof v === 'string' && (VISTAS as readonly string[]).includes(v) ? (v as Vista) : 'futura';
}

/** A vista vai no id da reserva de exemplo (o formulário só envia `reservaId`). */
export const idDaReservaDemo = (v: Vista): string => `demo-${v}`;
export const vistaDoId = (id: unknown): Vista => lerVista(typeof id === 'string' && id.startsWith('demo-') ? id.slice(5) : null);

/** Página da vitrine na vista dada ("Fechar", "Manter" e o PRG voltam para ela). */
export const baseDaVista = (v: Vista): string => `${ROTAS.devReservaAcoes}?vista=${v}`;

export const ANA_DEMO = { id: 'demo-ana', nome: 'Ana Demonstração', ativo: true };
export const BIA_DEMO = { id: 'demo-bia', nome: 'Bia Demonstração', ativo: true };
export const CARLA_DEMO = { id: 'demo-carla', nome: 'Carla Antiga', ativo: false };
/** Ativos: as opções de profissional do gestor ao remarcar. */
export const PROFISSIONAIS_DEMO = [ANA_DEMO, BIA_DEMO];

export const SERVICOS_DEMO = [
  { id: 'demo-escova', nome: 'Escova', ativo: true, precoCentavos: 9000, duracaoMin: 60 },
  { id: 'demo-hidratacao', nome: 'Hidratação', ativo: true, precoCentavos: 7500, duracaoMin: 40 },
  { id: 'demo-manicure', nome: 'Manicure', ativo: true, precoCentavos: 4000, duracaoMin: 45 },
  { id: 'demo-corte', nome: 'Corte feminino', ativo: true, precoCentavos: 9000, duracaoMin: 60 },
];
const [ESCOVA, HIDRATACAO, MANICURE] = SERVICOS_DEMO;

const MIN = 60_000;
/** Jornada usada na detecção de encaixe da vitrine: segunda a sábado, 09:00–18:00. */
const JORNADA = montarSemana([1, 2, 3, 4, 5, 6].map((diaSemana) => ({ diaSemana, inicioMin: 9 * 60, fimMin: 18 * 60 })));

type Base = { id: string; servico: (typeof SERVICOS_DEMO)[number]; prof: typeof ANA_DEMO; inicio: Date; status: StatusAgenda; encaixe?: boolean };

/** Instante de "daqui a 7 dias" às `hhmm` locais (sempre futuro). */
const emUmaSemana = (agora: Date, hhmm: number) => instanteDeHoraLocal(somarDias(partesLocais(agora, FUSO_DEMO).data, 7), hhmm, FUSO_DEMO);

function itensBase(vista: Vista, agora: Date): Base[] {
  if (vista === 'iniciada') {
    // O 1º serviço começou há 30 min (pode marcar a situação); os outros ainda vão começar.
    const inicio = new Date(Math.floor((agora.getTime() - 30 * MIN) / (5 * MIN)) * 5 * MIN);
    return [
      { id: 'item-escova', servico: ESCOVA, prof: ANA_DEMO, inicio, status: 'confirmado' },
      { id: 'item-hidratacao', servico: HIDRATACAO, prof: BIA_DEMO, inicio: new Date(inicio.getTime() + 60 * MIN), status: 'confirmado' },
      { id: 'item-manicure', servico: MANICURE, prof: CARLA_DEMO, inicio: new Date(inicio.getTime() + 120 * MIN), status: 'confirmado' },
    ];
  }
  const cancelada = vista === 'cancelada';
  return [
    { id: 'item-escova', servico: ESCOVA, prof: ANA_DEMO, inicio: emUmaSemana(agora, 9 * 60), status: cancelada ? 'cancelado' : 'confirmado' },
    { id: 'item-hidratacao', servico: HIDRATACAO, prof: BIA_DEMO, inicio: emUmaSemana(agora, 10 * 60), status: 'cancelado' },
    { id: 'item-manicure', servico: MANICURE, prof: CARLA_DEMO, inicio: emUmaSemana(agora, 15 * 60), status: cancelada ? 'cancelado' : 'confirmado', encaixe: true },
  ];
}

/**
 * Reserva de exemplo: Escova (Ana), Hidratação (Bia, cancelada) e Manicure (Carla, inativa, encaixe). `iniciada`:
 * a Escova já começou. `profissional`: papel profissional (só o item da Ana). `cancelada`: tudo cancelado.
 */
export function detalheDemo(vista: Vista, agora: Date): DetalheDaReserva {
  const papel: DetalheDaReserva['papel'] = vista === 'profissional' ? 'profissional' : 'gestor';
  const itens: ItemDoDetalhe[] = itensBase(vista, agora)
    .filter((b) => papel === 'gestor' || b.prof.id === ANA_DEMO.id)
    .map((b) => {
      const fim = new Date(b.inicio.getTime() + b.servico.duracaoMin * MIN);
      return {
        id: b.id,
        servicoId: b.servico.id,
        servicoNome: b.servico.nome,
        profissionalId: b.prof.id,
        profissionalNome: b.prof.nome,
        profissionalAtivo: b.prof.ativo,
        inicio: b.inicio,
        fim,
        status: b.status,
        encaixe: b.encaixe ?? false,
        precoCentavos: b.servico.precoCentavos,
        duracaoMin: b.servico.duracaoMin,
        acoes: acoesPermitidas({ status: b.status, inicio: b.inicio, fim, agora }),
      };
    });
  const todos = itensBase(vista, agora);
  const status = derivarStatus(todos);
  return {
    id: idDaReservaDemo(vista),
    clienteId: 'demo-cliente',
    fuso: FUSO_DEMO,
    clienteNome: 'Joana Lima',
    anonimizada: false,
    contato: { telefoneE164: '+5511987654321' },
    data: partesLocais(envelope(todos.map((b) => ({ ...b, fim: new Date(b.inicio.getTime() + b.servico.duracaoMin * MIN) }))).inicio, FUSO_DEMO).data,
    status,
    origem: 'equipe',
    temFalhaDeMensagem: false,
    itens,
    total: totalDoDetalhe(itens, status, papel),
    temItemCancelado: itens.some((i) => i.status === 'cancelado'),
    podeCancelarTodos: papel === 'gestor' && itens.filter((i) => i.acoes.cancelar).length >= 2,
    papel,
  };
}

const texto = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Remarcação simulada de um item (sem banco), com as mesmas recusas que a tela precisa demonstrar. */
export function demonstrarRemarcarItem(e: EntradaRemarcarItem, agora: Date): ResultadoRemarcarItem {
  const d = detalheDemo(vistaDoId(e.reservaId), agora);
  const item = d.itens.find((i) => i.id === e.itemId);
  if (!item || !item.acoes.remarcar) return { resultado: 'recusado', motivo: 'transicao_invalida' };
  const minutos = lerHora(e.hora);
  const dataTexto = texto(e.data);
  const data = dataTexto === '' ? partesLocais(item.inicio, FUSO_DEMO).data : lerData(dataTexto);
  if (minutos === null || data === null) return { resultado: 'invalido', erros: { inicio: MENSAGENS_ALTERACAO.inicio } };
  const outros = d.itens.filter((i) => i.id !== item.id);
  if (dataTexto !== '' && outros.some((i) => i.status !== 'cancelado') && dataTexto !== isoDaData(partesLocais(item.inicio, FUSO_DEMO).data)) {
    return { resultado: 'recusado', motivo: 'data_diferente' };
  }
  const servicoId = texto(e.servicoId) || item.servicoId;
  const servico = SERVICOS_DEMO.find((s) => s.id === servicoId);
  if (!servico) return { resultado: 'servico_indisponivel' };
  if (servicoId !== item.servicoId && outros.some((i) => i.servicoId === servicoId)) return { resultado: 'recusado', motivo: 'servico_repetido' };
  // DEF-1 (mesma regra do serviço): "manter" um profissional inativo é erro de campo, nunca troca silenciosa.
  if (texto(e.profissionalId) === '' && !item.profissionalAtivo) return { resultado: 'invalido', erros: { profissional: MENSAGENS_ALTERACAO.escolhaProfissional } };
  const profissionalId = texto(e.profissionalId) || item.profissionalId;
  if (!PROFISSIONAIS_DEMO.some((p) => p.id === profissionalId)) return { resultado: 'profissional_indisponivel' };
  const inicio = instanteDeHoraLocal(data, minutos, FUSO_DEMO);
  if (inicio.getTime() < agora.getTime()) return { resultado: 'invalido', erros: { inicio: MENSAGENS_ALTERACAO.inicioPassado } };
  const fim = new Date(inicio.getTime() + servico.duracaoMin * MIN);
  const motivos = detectarMotivos({ inicio, fim, fuso: FUSO_DEMO, jornada: JORNADA, bloqueios: [], funcionamento: { definido: false } });
  if (motivos.length > 0 && !ehAceite(e.confirmarEncaixe)) return { resultado: 'encaixe_requer_confirmacao', motivos };
  return { resultado: 'atualizada', itemId: item.id, revisao: 1, encaixe: motivos.length > 0, mensagem: { mensagemId: 'demonstracao', estado: 'pendente' } };
}
