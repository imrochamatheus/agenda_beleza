// Resultado simulado da reserva manual na vitrine (D-029, sem banco): as MESMAS funções puras do serviço
// (leitura de data/hora, detecção de encaixe, validação da cliente e do consentimento), com dados em memória.
// Nada é gravado; sem a trava do banco, a sobreposição não é simulada.
import { validarEntradaCliente } from '@/server/clientes/validacao';
import { ehAceite } from '@/server/consentimento/validacao';
import { detectarMotivos } from '@/server/reservas/encaixe';
import { lerData, lerHora } from '@/server/reservas/reserva-equipe';
import { MENSAGENS_RESERVA, MENSAGENS_RESERVA_EQUIPE } from '@/server/reservas/tipos';
import type { EntradaReservaEquipe, ResultadoCriarReserva } from '@/server/reservas/tipos';
import { montarSemana } from '@/server/semana/montagem';
import { instanteDeHoraLocal } from '@/server/tempo/fuso';

export const FUSO_DEMO = 'America/Sao_Paulo';
export const NOME_SALAO_DEMO = 'Salão Exemplo';
export const ANA_DEMO = { id: '00000000-0000-4000-8000-00000000d029', nome: 'Ana Demonstração' };
export const BIA_DEMO = { id: '00000000-0000-4000-8000-00000001d029', nome: 'Bia Demonstração' };
export const SERVICOS_DEMO = [
  { id: '00000000-0000-4000-8000-0000000000a1', nome: 'Corte feminino', duracaoMin: 60, precoCentavos: 12000 },
  { id: '00000000-0000-4000-8000-0000000000a2', nome: 'Escova', duracaoMin: 45, precoCentavos: 8000 },
];

const hm = (h: number) => h * 60;
/** Jornada: segunda a sábado, 09:00–18:00. */
const JORNADA = montarSemana([1, 2, 3, 4, 5, 6].map((diaSemana) => ({ diaSemana, inicioMin: hm(9), fimMin: hm(18) })));
/** Funcionamento: segunda a sexta, 08:00–20:00 (sábado e domingo fechados). */
const FUNCIONAMENTO = { definido: true as const, semana: montarSemana([1, 2, 3, 4, 5].map((diaSemana) => ({ diaSemana, inicioMin: hm(8), fimMin: hm(20) }))) };

export function demonstrarReservaManual(e: EntradaReservaEquipe, agora: Date): ResultadoCriarReserva {
  const cliente = validarEntradaCliente({ nome: e.nome, telefone: e.telefone });
  const erros: Record<string, string> = cliente.ok ? {} : { ...cliente.erros };
  const ids = Array.isArray(e.servicoIds) ? (e.servicoIds as unknown[]) : [];
  const servicos = SERVICOS_DEMO.filter((s) => ids.includes(s.id));
  if (servicos.length === 0 || servicos.length !== ids.length || new Set(ids).size !== ids.length) erros.servicos = MENSAGENS_RESERVA.servicos;
  const data = lerData(e.data);
  const minutos = lerHora(e.hora);
  if (data === null || minutos === null) erros.inicio = MENSAGENS_RESERVA_EQUIPE.inicio;
  if (Object.keys(erros).length > 0) return { resultado: 'invalido', erros };
  if (e.profissionalId !== ANA_DEMO.id && e.profissionalId !== BIA_DEMO.id) return { resultado: 'profissional_indisponivel' };

  const inicio = instanteDeHoraLocal(data!, minutos!, FUSO_DEMO);
  if (inicio.getTime() < agora.getTime()) return { resultado: 'invalido', erros: { inicio: MENSAGENS_RESERVA.inicioPassado } };
  const duracao = servicos.reduce((t, s) => t + s.duracaoMin, 0);
  const fim = new Date(inicio.getTime() + duracao * 60_000);
  // Bloqueio de exemplo: 14:00–15:00 do dia pedido, só da Ana.
  const bloqueios =
    e.profissionalId === ANA_DEMO.id
      ? [{ inicio: instanteDeHoraLocal(data!, hm(14), FUSO_DEMO), fim: instanteDeHoraLocal(data!, hm(15), FUSO_DEMO) }]
      : [];
  const motivos = detectarMotivos({ inicio, fim, fuso: FUSO_DEMO, jornada: JORNADA, bloqueios, funcionamento: FUNCIONAMENTO });
  const confirmou = ehAceite(e.confirmarEncaixe);
  if (motivos.length > 0 && !confirmou) return { resultado: 'encaixe_requer_confirmacao', motivos };
  return {
    resultado: 'criada',
    reserva: {
      id: 'demonstracao',
      profissionalId: e.profissionalId as string,
      clienteId: 'demonstracao',
      inicio,
      fim,
      ocupadoAte: fim,
      status: 'confirmado',
      origem: 'equipe',
      encaixe: motivos.length > 0,
      revisao: 0,
      itens: [],
    },
    confirmacao: { mensagemId: 'demonstracao', estado: ehAceite((e.aceites as { mensagensReserva?: unknown })?.mensagensReserva) ? 'pendente' : 'nao_enviada' },
  };
}
