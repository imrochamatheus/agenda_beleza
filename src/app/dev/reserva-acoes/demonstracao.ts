// Resultado simulado de remarcar na vitrine (D-030, sem banco): as MESMAS funções puras do serviço (leitura
// de data/hora, detecção de encaixe) com dados em memória. Nada é gravado.
import { ANA_DEMO, BIA_DEMO, FUSO_DEMO, SERVICOS_DEMO } from '@/app/dev/reserva-nova/demonstracao';
import type { DetalheDaReserva } from '@/server/agenda/tipos';
import { detectarMotivos } from '@/server/reservas/encaixe';
import { lerData, lerHora } from '@/server/reservas/reserva-equipe';
import { ehAceite } from '@/server/consentimento/validacao';
import { MENSAGENS_ALTERACAO } from '@/server/reservas/tipos-alteracao';
import type { EntradaRemarcar, ResultadoRemarcar } from '@/server/reservas/tipos-alteracao';
import { montarSemana } from '@/server/semana/montagem';
import { instanteDeHoraLocal } from '@/server/tempo/fuso';

export const ID_RESERVA_DEMO = '00000000-0000-4000-8000-00000000d030';
export const VISTAS = ['futura', 'iniciada', 'concluida', 'cancelada'] as const;
export type Vista = (typeof VISTAS)[number];

export function lerVista(v: string | string[] | undefined): Vista {
  return typeof v === 'string' && (VISTAS as readonly string[]).includes(v) ? (v as Vista) : 'futura';
}

const MIN = 60_000;
/** Jornada da Ana: segunda a sábado, 09:00–18:00. */
const JORNADA = montarSemana([1, 2, 3, 4, 5, 6].map((diaSemana) => ({ diaSemana, inicioMin: 9 * 60, fimMin: 18 * 60 })));

/** Reserva de exemplo: Ana, "Corte feminino" (60 min), relativa ao relógio (futura ou já iniciada). */
export function detalheDemo(vista: Vista, agora: Date): DetalheDaReserva {
  const futura = vista === 'futura' || vista === 'cancelada';
  const inicio = new Date(Math.floor((agora.getTime() + (futura ? 7 * 24 * 60 * MIN : -30 * MIN)) / (5 * MIN)) * 5 * MIN);
  const fim = new Date(inicio.getTime() + 60 * MIN);
  return {
    id: ID_RESERVA_DEMO,
    fuso: FUSO_DEMO,
    profissional: { id: ANA_DEMO.id, nome: ANA_DEMO.nome, ativo: true },
    clienteNome: 'Joana Lima',
    anonimizada: false,
    contato: { telefoneE164: '+5511987654321' },
    inicio,
    fim,
    status: vista === 'concluida' ? 'concluido' : vista === 'cancelada' ? 'cancelado' : 'confirmado',
    origem: 'equipe',
    encaixe: false,
    itens: [{ nome: SERVICOS_DEMO[0].nome, precoCentavos: SERVICOS_DEMO[0].precoCentavos, duracaoMin: SERVICOS_DEMO[0].duracaoMin }],
    totalCentavos: SERVICOS_DEMO[0].precoCentavos,
    duracaoTotalMin: SERVICOS_DEMO[0].duracaoMin,
  };
}

export const PROFISSIONAIS_DEMO = [ANA_DEMO, BIA_DEMO];

export function demonstrarRemarcar(e: EntradaRemarcar, agora: Date): ResultadoRemarcar {
  const ids = Array.isArray(e.servicoIds) ? (e.servicoIds as unknown[]) : [];
  const servicos = SERVICOS_DEMO.filter((s) => ids.includes(s.id));
  const erros: Record<string, string> = {};
  if (servicos.length === 0 || servicos.length !== ids.length || new Set(ids).size !== ids.length) erros.servicos = MENSAGENS_ALTERACAO.servicos;
  const data = lerData(e.data);
  const minutos = lerHora(e.hora);
  if (data === null || minutos === null) erros.inicio = MENSAGENS_ALTERACAO.inicio;
  if (Object.keys(erros).length > 0) return { resultado: 'invalido', erros };
  if (e.profissionalId !== ANA_DEMO.id && e.profissionalId !== BIA_DEMO.id) return { resultado: 'profissional_indisponivel' };
  const inicio = instanteDeHoraLocal(data!, minutos!, FUSO_DEMO);
  if (inicio.getTime() < agora.getTime()) return { resultado: 'invalido', erros: { inicio: MENSAGENS_ALTERACAO.inicioPassado } };
  const fim = new Date(inicio.getTime() + servicos.reduce((t, s) => t + s.duracaoMin, 0) * MIN);
  const motivos = detectarMotivos({ inicio, fim, fuso: FUSO_DEMO, jornada: JORNADA, bloqueios: [], funcionamento: { definido: false } });
  if (motivos.length > 0 && !ehAceite(e.confirmarEncaixe)) return { resultado: 'encaixe_requer_confirmacao', motivos };
  return {
    resultado: 'atualizada',
    reserva: {
      id: ID_RESERVA_DEMO,
      profissionalId: e.profissionalId as string,
      clienteId: 'demonstracao',
      inicio,
      fim,
      ocupadoAte: fim,
      status: 'confirmado',
      origem: 'equipe',
      encaixe: motivos.length > 0,
      revisao: 1,
      itens: [],
    },
    mensagem: { mensagemId: 'demonstracao', estado: 'pendente' },
  };
}
