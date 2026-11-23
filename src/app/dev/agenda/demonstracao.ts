import { totalDoDetalhe } from '@/server/agenda/consultar';
import { montarVista } from '@/server/agenda/montagem';
import { lerParametros } from '@/server/agenda/validacao';
import type { ParametrosBrutos } from '@/server/agenda/validacao';
import type {
  AgendaVista,
  BlocoDaAgenda,
  BloqueioDaAgenda,
  DetalheDaReserva,
  ItemDoDetalhe,
  OpcaoDeProfissional,
  StatusAgenda,
} from '@/server/agenda/tipos';
import { derivarStatus, envelope } from '@/server/reservas/itens';
import { acoesPermitidas } from '@/server/reservas/status';
import { montarSemana } from '@/server/semana/montagem';
import type { SemanaHoraria } from '@/server/semana/tipos';
import { instanteDeHoraLocal, partesLocais, somarDias } from '@/server/tempo/fuso';
import type { MensagemSituacao } from '@/server/mensagens/situacao-tipos';
import type { DataCivil } from '@/server/tempo/fuso';

// Dados em memória da vitrine /dev/agenda (D-028 §2; D-050 §3.9): relativos a "hoje" no fuso do salão, para o
// E2E sem banco. Um bloco por ITEM, montado pela MESMA função pura (`montarVista`) e pelos mesmos componentes
// da página real. A reserva `demo-r9` é o exemplo do web-design: 3 serviços em 3 profissionais ("1 de 3").

export const FUSO_DEMONSTRACAO = 'America/Sao_Paulo';
export const NOME_SALAO_DEMONSTRACAO = 'Salão Exemplo';

export const ANA: OpcaoDeProfissional = { id: 'demo-ana', nome: 'Ana Demonstração', ativo: true };
export const BIA: OpcaoDeProfissional = { id: 'demo-bia', nome: 'Bia Demonstração', ativo: true };
export const CARLA: OpcaoDeProfissional = { id: 'demo-carla', nome: 'Carla Antiga', ativo: false };
export const PROFISSIONAIS_DEMONSTRACAO: OpcaoDeProfissional[] = [ANA, BIA, CARLA];

const linhas = (faixas: [number, number][]) =>
  [1, 2, 3, 4, 5, 6].flatMap((diaSemana) => faixas.map(([inicioMin, fimMin]) => ({ diaSemana, inicioMin, fimMin })));

const FUNCIONAMENTO = { definido: true, semana: montarSemana(linhas([[8 * 60, 19 * 60]])) } as const;
const JORNADAS = new Map<string, SemanaHoraria>([
  [ANA.id, montarSemana(linhas([[9 * 60, 12 * 60], [14 * 60, 18 * 60]]))],
  [BIA.id, montarSemana(linhas([[9 * 60, 18 * 60]]))],
]);

type Servico = { id: string; nome: string; precoCentavos: number; duracaoMin: number };
const CORTE: Servico = { id: 'demo-s-corte', nome: 'Corte feminino', precoCentavos: 9000, duracaoMin: 60 };
const ESCOVA: Servico = { id: 'demo-s-escova', nome: 'Escova', precoCentavos: 5500, duracaoMin: 30 };
const HIDRATACAO: Servico = { id: 'demo-s-hidratacao', nome: 'Hidratação', precoCentavos: 7500, duracaoMin: 40 };
const MANICURE: Servico = { id: 'demo-s-manicure', nome: 'Manicure', precoCentavos: 4000, duracaoMin: 45 };

/** Item de exemplo: profissional, serviço, início e status próprios (D-050). */
type ItemDemo = { id: string; prof: OpcaoDeProfissional; servico: Servico; inicio: Date; fim?: Date; status: StatusAgenda; encaixe?: boolean };
type ReservaDemo = { id: string; clienteNome: string | null; itens: ItemDemo[] };

type Exemplo = {
  blocos: BlocoDaAgenda[];
  bloqueios: BloqueioDaAgenda[];
  detalhes: Map<string, DetalheDaReserva>;
  mensagens: Map<string, MensagemSituacao[]>;
};

/** Reservas da vitrine com falha de mensagem vigente: uma confirmada, uma cancelada (marca sem riscado) e a de 3 itens. */
const COM_FALHA = new Set(['demo-r1', 'demo-r4', 'demo-r9']);
const MIN = 60_000;

function em(d: DataCivil, hhmm: number) {
  return instanteDeHoraLocal(d, hhmm, FUSO_DEMONSTRACAO);
}

const fimDe = (i: ItemDemo): Date => i.fim ?? new Date(i.inicio.getTime() + i.servico.duracaoMin * MIN);

function reservasDeExemplo(agora: Date): ReservaDemo[] {
  const hoje = partesLocais(agora, FUSO_DEMONSTRACAO).data;
  const amanha = somarDias(hoje, 1);
  const ontem = somarDias(hoje, -1);
  const um = (id: string, prof: OpcaoDeProfissional, inicio: Date, status: StatusAgenda, clienteNome: string | null, extra: Partial<ItemDemo> = {}): ReservaDemo => ({
    id,
    clienteNome,
    itens: [{ id: `${id}-i1`, prof, servico: CORTE, inicio, status, ...extra }],
  });
  return [
    um('demo-r1', ANA, em(hoje, 600), 'confirmado', 'Maria Souza'),
    // Dois itens em profissionais diferentes, um cancelado: só um não cancelado → sem "n de N".
    {
      id: 'demo-r2',
      clienteNome: 'Joana Lima',
      itens: [
        { id: 'demo-r2-i1', prof: ANA, servico: CORTE, inicio: em(hoje, 900), status: 'concluido' },
        { id: 'demo-r2-i2', prof: BIA, servico: ESCOVA, inicio: em(hoje, 960), status: 'cancelado' },
      ],
    },
    um('demo-r3', ANA, em(hoje, 960), 'confirmado', 'Paula Encaixe', { encaixe: true }),
    um('demo-r4', BIA, em(hoje, 570), 'cancelado', 'Renata Alves'),
    um('demo-r5', BIA, em(hoje, 840), 'nao_compareceu', null),
    um('demo-r6', BIA, em(hoje, 23 * 60), 'confirmado', 'Noite Longa', { encaixe: true, fim: em(amanha, 60) }),
    um('demo-r7', CARLA, em(ontem, 600), 'concluido', 'Cliente Antiga'),
    um('demo-r8', ANA, em(amanha, 600), 'confirmado', 'Maria Souza'),
    {
      id: 'demo-r9',
      clienteNome: 'Lúcia Prado',
      itens: [
        { id: 'demo-r9-i1', prof: ANA, servico: ESCOVA, inicio: em(hoje, 11 * 60), status: 'confirmado' },
        { id: 'demo-r9-i2', prof: BIA, servico: HIDRATACAO, inicio: em(hoje, 11 * 60 + 30), status: 'confirmado' },
        { id: 'demo-r9-i3', prof: CARLA, servico: MANICURE, inicio: em(hoje, 12 * 60 + 30), status: 'confirmado', encaixe: true },
      ],
    },
  ];
}

/** "n de N" do gestor: entre os itens NÃO cancelados da reserva, por (inicio, id); só com 2+ (como o SQL da T-7). */
function posicaoDe(r: ReservaDemo, i: ItemDemo): BlocoDaAgenda['posicao'] {
  const ativos = r.itens
    .filter((x) => x.status !== 'cancelado')
    .sort((a, b) => a.inicio.getTime() - b.inicio.getTime() || a.id.localeCompare(b.id));
  if (i.status === 'cancelado' || ativos.length < 2) return null;
  return { n: ativos.findIndex((x) => x.id === i.id) + 1, de: ativos.length };
}

export function exemplos(agora: Date): Exemplo {
  const hoje = partesLocais(agora, FUSO_DEMONSTRACAO).data;
  const reservas = reservasDeExemplo(agora);
  const blocos: BlocoDaAgenda[] = reservas
    .flatMap((r) =>
      r.itens.map((i) => ({
        itemId: i.id,
        reservaId: r.id,
        profissionalId: i.prof.id,
        inicio: i.inicio,
        fim: fimDe(i),
        status: i.status,
        origem: 'equipe' as const,
        encaixe: i.encaixe ?? false,
        clienteNome: r.clienteNome,
        servicoNome: i.servico.nome,
        precoCentavos: i.servico.precoCentavos,
        duracaoMin: i.servico.duracaoMin,
        temFalhaDeMensagem: COM_FALHA.has(r.id),
        posicao: posicaoDe(r, i),
      })),
    )
    .sort((a, b) => a.inicio.getTime() - b.inicio.getTime() || a.itemId.localeCompare(b.itemId));
  const bloqueios: BloqueioDaAgenda[] = [
    { id: 'demo-b1', profissionalId: ANA.id, inicio: em(hoje, 780), fim: em(hoje, 840), motivo: 'Dentista <b>não negrito</b>' },
    {
      id: 'demo-b2',
      profissionalId: null,
      inicio: em(somarDias(hoje, 2), 0),
      fim: em(somarDias(hoje, 3), 0),
      motivo: 'Feriado',
    },
  ];
  const detalhes = new Map<string, DetalheDaReserva>();
  for (const r of reservas) detalhes.set(r.id, detalheDe(r, agora, 'gestor'));
  const mensagens = new Map<string, MensagemSituacao[]>();
  for (const r of reservas) {
    const base = { tentativas: 1, ultimaTentativaEm: new Date(r.itens[0].inicio.getTime() - 2 * 3_600_000) };
    mensagens.set(
      r.id,
      COM_FALHA.has(r.id)
        ? [
            { id: `${r.id}-m1`, estado: 'falhou', rotulo: 'Falha ao enviar confirmação por WhatsApp', motivo: 'Não foi possível confirmar se a mensagem foi entregue.', ...base, tentativas: 3 },
          ]
        : [{ id: `${r.id}-m1`, estado: 'enviada', rotulo: 'Confirmação enviada', motivo: null, ...base }],
    );
  }
  return { blocos, bloqueios, detalhes, mensagens };
}

/** Detalhe com as MESMAS regras puras do serviço (status derivado, envelope, ações por item, total). */
function detalheDe(r: ReservaDemo, agora: Date, papel: DetalheDaReserva['papel']): DetalheDaReserva {
  const itens: ItemDoDetalhe[] = [...r.itens]
    .sort((a, b) => a.inicio.getTime() - b.inicio.getTime() || a.id.localeCompare(b.id))
    .map((i) => ({
      id: i.id,
      servicoId: i.servico.id,
      servicoNome: i.servico.nome,
      profissionalId: i.prof.id,
      profissionalNome: i.prof.nome,
      profissionalAtivo: i.prof.ativo,
      inicio: i.inicio,
      fim: fimDe(i),
      status: i.status,
      encaixe: i.encaixe ?? false,
      precoCentavos: i.servico.precoCentavos,
      duracaoMin: i.servico.duracaoMin,
      acoes: acoesPermitidas({ status: i.status, inicio: i.inicio, fim: fimDe(i), agora }),
    }));
  const status = derivarStatus(itens);
  return {
    id: r.id,
    clienteId: `${r.id}-cliente`,
    fuso: FUSO_DEMONSTRACAO,
    clienteNome: r.clienteNome,
    anonimizada: r.clienteNome === null,
    contato: r.clienteNome === null ? null : { telefoneE164: '+5511987654321' },
    data: partesLocais(envelope(itens).inicio, FUSO_DEMONSTRACAO).data,
    status,
    origem: 'equipe',
    temFalhaDeMensagem: COM_FALHA.has(r.id),
    itens,
    total: totalDoDetalhe(itens, status, papel),
    temItemCancelado: itens.some((i) => i.status === 'cancelado'),
    podeCancelarTodos: papel === 'gestor' && itens.filter((i) => i.acoes.cancelar).length >= 2,
    papel,
  };
}

/** Vista em memória; `profissional` fora dos exemplos → null (a página responde 404, como a real). */
export function vistaDemonstracao(entrada: ParametrosBrutos, agora: Date): AgendaVista | null {
  const hoje = partesLocais(agora, FUSO_DEMONSTRACAO).data;
  const p = lerParametros(entrada, hoje);
  if (p.profissional !== null && !PROFISSIONAIS_DEMONSTRACAO.some((x) => x.id === p.profissional)) return null;
  const { blocos, bloqueios } = exemplos(agora);
  return montarVista({
    data: p.data,
    visao: p.visao,
    fuso: FUSO_DEMONSTRACAO,
    hoje,
    profissionais: PROFISSIONAIS_DEMONSTRACAO,
    filtro: p.profissional,
    colunaSempre: p.profissional !== null,
    comOpcoes: true,
    blocos: p.profissional === null ? blocos : blocos.filter((b) => b.profissionalId === p.profissional),
    bloqueios: p.profissional === null ? bloqueios : bloqueios.filter((b) => b.profissionalId === null || b.profissionalId === p.profissional),
    jornadas: JORNADAS,
    funcionamento: FUNCIONAMENTO,
    truncada: false,
  });
}

export { FUNCIONAMENTO as FUNCIONAMENTO_DEMONSTRACAO };
