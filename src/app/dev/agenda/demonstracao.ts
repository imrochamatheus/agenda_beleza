import { montarVista } from '@/server/agenda/montagem';
import { lerParametros } from '@/server/agenda/validacao';
import type { ParametrosBrutos } from '@/server/agenda/validacao';
import type {
  AgendaVista,
  BloqueioDaAgenda,
  DetalheDaReserva,
  OpcaoDeProfissional,
  ReservaDaAgenda,
} from '@/server/agenda/tipos';
import { montarSemana } from '@/server/semana/montagem';
import type { SemanaHoraria } from '@/server/semana/tipos';
import { instanteDeHoraLocal, partesLocais, somarDias } from '@/server/tempo/fuso';
import type { MensagemSituacao } from '@/server/mensagens/situacao-tipos';
import type { DataCivil } from '@/server/tempo/fuso';

// Dados em memória da vitrine /dev/agenda (D-028 §2): relativos a "hoje" no fuso do salão, para o E2E
// sem banco. Passam pela MESMA montagem pura (`montarVista`) e pelos mesmos componentes da página real.

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

type Exemplo = {
  reservas: ReservaDaAgenda[];
  bloqueios: BloqueioDaAgenda[];
  detalhes: Map<string, DetalheDaReserva>;
  mensagens: Map<string, MensagemSituacao[]>;
};

/** Reservas da vitrine com falha de mensagem vigente: uma confirmada e uma cancelada (marca sem riscado). */
const COM_FALHA = new Set(['demo-r1', 'demo-r4']);

function em(d: DataCivil, hhmm: number) {
  return instanteDeHoraLocal(d, hhmm, FUSO_DEMONSTRACAO);
}

export function exemplos(agora: Date): Exemplo {
  const hoje = partesLocais(agora, FUSO_DEMONSTRACAO).data;
  const amanha = somarDias(hoje, 1);
  const ontem = somarDias(hoje, -1);
  const corte = { nome: 'Corte feminino', precoCentavos: 9000, duracaoMin: 60 };
  const escova = { nome: 'Escova', precoCentavos: 5500, duracaoMin: 30 };
  const mk = (
    id: string,
    prof: OpcaoDeProfissional,
    inicio: Date,
    fim: Date,
    status: ReservaDaAgenda['status'],
    clienteNome: string | null,
    encaixe = false,
    itens = [corte],
  ): ReservaDaAgenda => ({
    id,
    profissionalId: prof.id,
    inicio,
    fim,
    status,
    origem: 'equipe',
    encaixe,
    clienteNome,
    temFalhaDeMensagem: COM_FALHA.has(id),
    itens,
  });
  const reservas = [
    mk('demo-r1', ANA, em(hoje, 600), em(hoje, 660), 'confirmado', 'Maria Souza'),
    mk('demo-r2', ANA, em(hoje, 900), em(hoje, 990), 'concluido', 'Joana Lima', false, [corte, escova]),
    mk('demo-r3', ANA, em(hoje, 960), em(hoje, 1020), 'confirmado', 'Paula Encaixe', true),
    mk('demo-r4', BIA, em(hoje, 570), em(hoje, 630), 'cancelado', 'Renata Alves'),
    mk('demo-r5', BIA, em(hoje, 840), em(hoje, 900), 'nao_compareceu', null),
    mk('demo-r6', BIA, em(hoje, 23 * 60), em(amanha, 60), 'confirmado', 'Noite Longa', true),
    mk('demo-r7', CARLA, em(ontem, 600), em(ontem, 660), 'concluido', 'Cliente Antiga'),
    mk('demo-r8', ANA, em(amanha, 600), em(amanha, 660), 'confirmado', 'Maria Souza'),
  ].sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
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
  for (const r of reservas) {
    const prof = PROFISSIONAIS_DEMONSTRACAO.find((p) => p.id === r.profissionalId)!;
    detalhes.set(r.id, {
      id: r.id,
      fuso: FUSO_DEMONSTRACAO,
      profissional: prof,
      clienteNome: r.clienteNome,
      anonimizada: r.clienteNome === null,
      contato: r.clienteNome === null ? null : { telefoneE164: '+5511987654321' },
      inicio: r.inicio,
      fim: r.fim,
      status: r.status,
      origem: r.origem,
      encaixe: r.encaixe,
      temFalhaDeMensagem: r.temFalhaDeMensagem,
      itens: r.itens,
      totalCentavos: r.itens.reduce((t, i) => t + i.precoCentavos, 0),
      duracaoTotalMin: r.itens.reduce((t, i) => t + i.duracaoMin, 0),
    });
  }
  const mensagens = new Map<string, MensagemSituacao[]>();
  for (const r of reservas) {
    const base = { tentativas: 1, ultimaTentativaEm: new Date(r.inicio.getTime() - 2 * 3_600_000) };
    mensagens.set(
      r.id,
      COM_FALHA.has(r.id)
        ? [
            { id: `${r.id}-m1`, estado: 'falhou', rotulo: 'Falha ao enviar confirmação por WhatsApp', motivo: 'Não foi possível confirmar se a mensagem foi entregue.', ...base, tentativas: 3 },
          ]
        : [{ id: `${r.id}-m1`, estado: 'enviada', rotulo: 'Confirmação enviada', motivo: null, ...base }],
    );
  }
  return { reservas, bloqueios, detalhes, mensagens };
}

/** Vista em memória; `profissional` fora dos exemplos → null (a página responde 404, como a real). */
export function vistaDemonstracao(entrada: ParametrosBrutos, agora: Date): AgendaVista | null {
  const hoje = partesLocais(agora, FUSO_DEMONSTRACAO).data;
  const p = lerParametros(entrada, hoje);
  if (p.profissional !== null && !PROFISSIONAIS_DEMONSTRACAO.some((x) => x.id === p.profissional)) return null;
  const { reservas, bloqueios } = exemplos(agora);
  return montarVista({
    data: p.data,
    visao: p.visao,
    fuso: FUSO_DEMONSTRACAO,
    hoje,
    profissionais: PROFISSIONAIS_DEMONSTRACAO,
    filtro: p.profissional,
    colunaSempre: p.profissional !== null,
    comOpcoes: true,
    reservas: p.profissional === null ? reservas : reservas.filter((r) => r.profissionalId === p.profissional),
    bloqueios: p.profissional === null ? bloqueios : bloqueios.filter((b) => b.profissionalId === null || b.profissionalId === p.profissional),
    jornadas: JORNADAS,
    funcionamento: FUNCIONAMENTO,
    truncada: false,
  });
}

export { FUNCIONAMENTO as FUNCIONAMENTO_DEMONSTRACAO };
