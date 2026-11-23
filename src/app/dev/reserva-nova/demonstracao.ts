// Resultado simulado da reserva manual na vitrine (D-029; D-050 §5.8, sem banco): as MESMAS funções puras do
// serviço (validação do formulário, conversão data + hora pelo fuso, checagem entre itens, detecção de
// encaixe e o texto de sobreposição), com dados em memória. Nada é gravado; sem a trava do banco, a
// sobreposição com outras reservas não é simulada.
import { ehAceite } from '@/server/consentimento/validacao';
import { detectarMotivos } from '@/server/reservas/encaixe';
import { conferirItens } from '@/server/reservas/itens';
import { errosDeSobreposicao, validarFormularioDaEquipe } from '@/server/reservas/reserva-equipe';
import type { ResultadoReservaEquipe } from '@/server/reservas/reserva-equipe';
import { MENSAGENS_RESERVA } from '@/server/reservas/tipos';
import type { EntradaReservaEquipe, ItemPedido, MotivosDoItem } from '@/server/reservas/tipos';
import { montarSemana } from '@/server/semana/montagem';
import { instanteDeHoraLocal, partesLocais } from '@/server/tempo/fuso';
import type { DataCivil } from '@/server/tempo/fuso';

export const FUSO_DEMO = 'America/Sao_Paulo';
export const NOME_SALAO_DEMO = 'Salão Exemplo';
export const ANA_DEMO = { id: '00000000-0000-4000-8000-00000000d029', nome: 'Ana Demonstração' };
export const BIA_DEMO = { id: '00000000-0000-4000-8000-00000001d029', nome: 'Bia Demonstração' };
export const CARLA_DEMO = { id: '00000000-0000-4000-8000-00000002d029', nome: 'Carla Demonstração' };
export const PROFISSIONAIS_DEMO = [ANA_DEMO, BIA_DEMO, CARLA_DEMO];
export const SERVICOS_DEMO = [
  { id: '00000000-0000-4000-8000-0000000000a1', nome: 'Escova', duracaoMin: 60, precoCentavos: 9000 },
  { id: '00000000-0000-4000-8000-0000000000a2', nome: 'Hidratação', duracaoMin: 45, precoCentavos: 12000 },
  { id: '00000000-0000-4000-8000-0000000000a3', nome: 'Manicure', duracaoMin: 40, precoCentavos: 5000 },
];

const hm = (h: number, m = 0) => h * 60 + m;
/** Jornada de todas: segunda a sábado, 09:00–18:00. */
const JORNADA = montarSemana([1, 2, 3, 4, 5, 6].map((diaSemana) => ({ diaSemana, inicioMin: hm(9), fimMin: hm(18) })));
/** Funcionamento: segunda a sexta, 08:00–20:00 (sábado e domingo fechados). */
const FUNCIONAMENTO = { definido: true as const, semana: montarSemana([1, 2, 3, 4, 5].map((diaSemana) => ({ diaSemana, inicioMin: hm(8), fimMin: hm(20) }))) };

/** Bloqueio de exemplo: 13:00–14:00 do dia pedido, só da Carla. */
function bloqueiosDe(profissionalId: string, data: DataCivil) {
  return profissionalId === CARLA_DEMO.id
    ? [{ inicio: instanteDeHoraLocal(data, hm(13), FUSO_DEMO), fim: instanteDeHoraLocal(data, hm(14), FUSO_DEMO) }]
    : [];
}

const SERVICOS_POR_ID = new Map(SERVICOS_DEMO.map((s) => [s.id, s]));
const IDS_PROFISSIONAIS = new Set(PROFISSIONAIS_DEMO.map((p) => p.id));

export function demonstrarReservaManual(e: EntradaReservaEquipe, agora: Date): ResultadoReservaEquipe {
  const v = validarFormularioDaEquipe(e);
  if (!v.ok) return { resultado: 'invalido', erros: v.erros };
  if (v.itens.some((i) => !SERVICOS_POR_ID.has(i.servicoId))) return { resultado: 'servico_indisponivel' };
  const semProfissional = v.itens.flatMap((i, k) => (IDS_PROFISSIONAIS.has(i.profissionalId) ? [] : [k]));
  if (semProfissional.length > 0) return { resultado: 'profissional_indisponivel', itens: semProfissional };

  const pedidos: ItemPedido[] = v.itens.map((i) => ({
    servicoId: i.servicoId,
    profissionalId: i.profissionalId,
    inicio: instanteDeHoraLocal(v.data, i.minutos, FUSO_DEMO),
  }));
  const itens = pedidos.map((p) => {
    const fim = new Date(p.inicio.getTime() + SERVICOS_POR_ID.get(p.servicoId)!.duracaoMin * 60_000);
    return { ...p, fim, ocupadoAte: fim, status: 'confirmado' as const };
  });
  const passados = itens.flatMap((i, k) => (i.inicio.getTime() < agora.getTime() ? [k] : []));
  if (passados.length > 0) {
    return { resultado: 'invalido', erros: { porItem: Object.fromEntries(passados.map((k) => [k, { inicio: MENSAGENS_RESERVA.inicioPassado }])) } };
  }
  const conferencia = conferirItens(itens, FUSO_DEMO);
  if (!conferencia.ok && conferencia.motivo === 'entre_itens') {
    return { resultado: 'invalido', erros: errosDeSobreposicao(pedidos, conferencia.conflitos, SERVICOS_POR_ID, FUSO_DEMO) };
  }

  const motivos: MotivosDoItem[] = itens
    .map((i, indice) => ({
      indice,
      motivos: detectarMotivos({
        inicio: i.inicio,
        fim: i.fim,
        fuso: FUSO_DEMO,
        jornada: JORNADA,
        bloqueios: bloqueiosDe(i.profissionalId, partesLocais(i.inicio, FUSO_DEMO).data),
        funcionamento: FUNCIONAMENTO,
      }),
    }))
    .filter((m) => m.motivos.length > 0);
  if (motivos.length > 0 && !ehAceite(e.confirmarEncaixe)) return { resultado: 'encaixe_requer_confirmacao', motivos };
  const comMotivo = new Set(motivos.map((m) => m.indice));

  const ordenados = itens
    .map((i, ordem) => ({
      id: `demonstracao-${ordem}`,
      servicoId: i.servicoId,
      profissionalId: i.profissionalId,
      ordem,
      inicio: i.inicio,
      fim: i.fim,
      ocupadoAte: i.ocupadoAte,
      precoCentavos: SERVICOS_POR_ID.get(i.servicoId)!.precoCentavos,
      duracaoMin: SERVICOS_POR_ID.get(i.servicoId)!.duracaoMin,
      encaixe: comMotivo.has(ordem),
      status: 'confirmado' as const,
    }))
    .sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
  return {
    resultado: 'criada',
    reserva: {
      id: 'demonstracao',
      clienteId: 'demonstracao',
      inicio: ordenados[0].inicio,
      fim: new Date(Math.max(...ordenados.map((i) => i.fim.getTime()))),
      status: 'confirmado',
      origem: 'equipe',
      revisao: 0,
      itens: ordenados,
    },
    confirmacao: {
      mensagemId: 'demonstracao',
      estado: ehAceite((e.aceites as { mensagensReserva?: unknown } | null)?.mensagensReserva) ? 'pendente' : 'nao_enviada',
    },
  };
}
