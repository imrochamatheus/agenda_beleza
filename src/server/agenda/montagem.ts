import type { Funcionamento } from '@/server/salao/funcionamento-tipos';
import type { SemanaHoraria } from '@/server/semana/tipos';
import type { DataCivil } from '@/server/tempo/fuso';

import { diaInteiroFechado, foraDaJornada, foraDoFuncionamento } from './faixas';
import { montarPeriodo } from './periodo';
import type {
  AgendaVista,
  BloqueioDaAgenda,
  ColunaDaAgenda,
  DiaDaAgenda,
  OpcaoDeProfissional,
  ReservaDaAgenda,
  Visao,
} from './tipos';
import { isoDaData } from './validacao';

// Montagem pura da vista (D-028 §3): a MESMA função serve ao serviço (dados do banco) e à vitrine
// /dev/agenda (dados em memória). Sem banco, sem relógio, sem next/*.

export type EntradaDaVista = {
  data: DataCivil;
  visao: Visao;
  fuso: string;
  hoje: DataCivil;
  /** Profissionais visíveis ao usuário (o gestor: todos; o profissional: só ele). */
  profissionais: readonly OpcaoDeProfissional[];
  /** Filtro do gestor já validado (id presente em `profissionais`), ou null. */
  filtro: string | null;
  /** Profissional ou filtro: a coluna aparece mesmo vazia. */
  colunaSempre: boolean;
  /** Mostra as opções do filtro (só o gestor). */
  comOpcoes: boolean;
  reservas: readonly ReservaDaAgenda[];
  bloqueios: readonly BloqueioDaAgenda[];
  jornadas: ReadonlyMap<string, SemanaHoraria>;
  funcionamento: Funcionamento;
  truncada: boolean;
};

const temJornada = (s: SemanaHoraria | undefined): boolean => (s ?? []).some((d) => d.intervalos.length > 0);

export function montarVista(e: EntradaDaVista): AgendaVista {
  const periodo = montarPeriodo(e.data, e.visao, e.fuso);
  const dias: DiaDaAgenda[] = periodo.dias.map((d) => {
    const fechado = foraDoFuncionamento(e.funcionamento, d.diaSemana);
    return { ...d, foraDoFuncionamento: fechado, salaoFechado: diaInteiroFechado(fechado) };
  });
  const doSalao = e.bloqueios.filter((b) => b.profissionalId === null);

  const colunas: ColunaDaAgenda[] = [];
  for (const p of e.profissionais) {
    if (e.filtro !== null && p.id !== e.filtro) continue;
    const reservas = e.reservas.filter((r) => r.profissionalId === p.id);
    const proprios = e.bloqueios.filter((b) => b.profissionalId === p.id);
    const jornada = e.jornadas.get(p.id);
    const aparece =
      e.colunaSempre || reservas.length > 0 || proprios.length > 0 || (p.ativo && temJornada(jornada));
    if (!aparece) continue;
    const fora: Record<string, ReturnType<typeof foraDaJornada>> = {};
    for (const d of dias) {
      fora[d.iso] = foraDaJornada(jornada ?? null, d.diaSemana, d.foraDoFuncionamento);
    }
    colunas.push({
      id: p.id,
      nome: p.nome,
      ativo: p.ativo,
      reservas,
      bloqueios: [...doSalao, ...proprios].sort((a, b) => a.inicio.getTime() - b.inicio.getTime() || a.id.localeCompare(b.id)),
      foraDaJornada: fora,
    });
  }

  return {
    visao: e.visao,
    data: isoDaData(e.data),
    fuso: e.fuso,
    dias,
    colunas,
    profissionais: e.comOpcoes ? [...e.profissionais] : [],
    profissionalFiltro: e.filtro,
    truncada: e.truncada,
    anterior: isoDaData(periodo.anterior),
    proximo: isoDaData(periodo.proximo),
    hoje: isoDaData(e.hoje),
  };
}
