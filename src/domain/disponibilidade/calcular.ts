// Cálculo de disponibilidade (D-018 §3.1). Puro: sem banco, sem relógio implícito (`agora` é entrada).
// A grade do dia é montada UMA vez por data e compartilhada por todos os profissionais (CA-27/R-1):
// nenhuma chamada a `fuso.ts` por (candidato × profissional).
import { compararDatas, ehDataCivilValida, instanteDeHoraLocal, somarDias, validarFuso } from '@/server/tempo/fuso';

import { diaDaSemana, gradeDoDia, limitesDaJanela, type CandidatoDaGrade } from './calendario';
import { janelasDoDia, validarFuncionamento } from './funcionamento';
import { intersecta, unirIntervalos, unirMinutos } from './intervalos';
import type {
  DataCivil,
  DiaDeDisponibilidade,
  DisponibilidadeCalculada,
  EntradaDeCalculo,
  HorarioOferecido,
  IntervaloMin,
  LinhaDeJornada,
} from './tipos';

const MS_MIN = 60_000;

function exigirInteiro(nome: string, v: number, min: number, max = Number.MAX_SAFE_INTEGER): void {
  if (!Number.isInteger(v) || v < min || v > max) {
    throw new RangeError(`${nome} inválido: ${String(v)}`);
  }
}

function validarEntrada(e: EntradaDeCalculo): void {
  if (!(e.agora instanceof Date) || Number.isNaN(e.agora.getTime())) {
    throw new RangeError('`agora` inválido');
  }
  validarFuso(e.regras.fuso);
  exigirInteiro('gradeMin', e.regras.gradeMin, 1, 1440);
  exigirInteiro('antecedenciaMin', e.regras.antecedenciaMin, 0);
  exigirInteiro('janelaDias', e.regras.janelaDias, 0);
  exigirInteiro('intervaloMin', e.regras.intervaloMin, 0);
  exigirInteiro('duracaoMin', e.duracaoMin, 1);
  validarFuncionamento(e.funcionamento);
  let anterior: DataCivil | null = null;
  for (const d of e.datas) {
    if (!ehDataCivilValida(d)) throw new RangeError(`Data inválida: ${JSON.stringify(d)}`);
    if (anterior !== null && compararDatas(anterior, d) >= 0) {
      throw new RangeError('As datas devem estar em ordem crescente e sem repetição');
    }
    anterior = d;
  }
  for (const p of e.profissionais) {
    for (const l of p.jornada) {
      exigirInteiro('diaSemana', l.diaSemana, 0, 6);
      if (!Number.isInteger(l.inicioMin) || !Number.isInteger(l.fimMin) || l.inicioMin < 0 || l.inicioMin >= l.fimMin || l.fimMin > 1440) {
        throw new RangeError(`Jornada inválida: ${JSON.stringify(l)}`);
      }
    }
  }
}

function jornadaPorDia(linhas: readonly LinhaDeJornada[]): IntervaloMin[][] {
  const porDia: IntervaloMin[][] = [[], [], [], [], [], [], []];
  for (const l of linhas) porDia[l.diaSemana].push({ inicioMin: l.inicioMin, fimMin: l.fimMin });
  return porDia.map(unirMinutos);
}

const chave = (d: DataCivil, m: number): string => `${d.ano}-${d.mes}-${d.dia}:${m}`;

export function calcularDisponibilidade(e: EntradaDeCalculo): DisponibilidadeCalculada {
  validarEntrada(e);
  const { regras, duracaoMin } = e;
  const duracaoMs = duracaoMin * MS_MIN;
  const intervaloMs = regras.intervaloMin * MS_MIN;
  const limiteAntecedencia = e.agora.getTime() + regras.antecedenciaMin * MS_MIN;
  const { hoje, ultima } = limitesDaJanela(e.agora, regras);

  const bloqueiosSalao = e.bloqueiosDoSalao;
  const funcionamentoPorDia: (readonly IntervaloMin[])[] | null = e.funcionamento.definido
    ? e.funcionamento.dias.map(unirMinutos)
    : null;

  // Por profissional: janelas (minutos) por dia da semana, uma vez; bloqueios e ocupações unidos.
  const preparados = e.profissionais.map((p) => {
    const jornada = jornadaPorDia(p.jornada);
    const janelas = jornada.map((j, w) => janelasDoDia(j, funcionamentoPorDia === null ? null : funcionamentoPorDia[w]));
    return {
      id: p.profissionalId,
      janelas,
      bloqueios: unirIntervalos([...bloqueiosSalao, ...p.bloqueios]),
      ocupacoes: unirIntervalos(p.ocupacoes),
    };
  });

  const cacheLimites = new Map<string, number>();
  const instanteDoLimite = (d: DataCivil, m: number): number => {
    const k = chave(d, m);
    let t = cacheLimites.get(k);
    if (t === undefined) {
      t = m >= 1440 ? instanteDeHoraLocal(somarDias(d, 1), 0, regras.fuso).getTime() : instanteDeHoraLocal(d, m, regras.fuso).getTime();
      cacheLimites.set(k, t);
    }
    return t;
  };

  const saida = preparados.map((p) => ({ profissionalId: p.id, dias: [] as DiaDeDisponibilidade[] }));
  const horariosPorDia: HorarioOferecido[][][] = [];

  e.datas.forEach((d, idxData) => {
    const dentro = compararDatas(d, hoje) >= 0 && compararDatas(d, ultima) <= 0;
    const w = diaDaSemana(d);
    const horariosDoDia: HorarioOferecido[][] = preparados.map(() => []);
    horariosPorDia[idxData] = horariosDoDia;
    if (dentro) {
      let minIni = 1440;
      let maxFim = 0;
      for (const p of preparados) {
        for (const j of p.janelas[w]) {
          if (j.inicioMin < minIni) minIni = j.inicioMin;
          if (j.fimMin > maxFim) maxFim = j.fimMin;
        }
      }
      if (minIni < maxFim) {
        const grade: CandidatoDaGrade[] = gradeDoDia(d, regras, minIni, maxFim);
        preparados.forEach((p, idxProf) => {
          for (const j of p.janelas[w]) {
            const j0 = instanteDoLimite(d, j.inicioMin);
            const j1 = instanteDoLimite(d, j.fimMin);
            for (const c of grade) {
              if (c.minutosDoDia < j.inicioMin) continue;
              if (c.minutosDoDia >= j.fimMin) break;
              const t = c.instante;
              if (t < j0 || t + duracaoMs > j1 || t < limiteAntecedencia) continue;
              if (intersecta(p.bloqueios, t, t + duracaoMs)) continue;
              if (intersecta(p.ocupacoes, t, t + duracaoMs + intervaloMs)) continue;
              horariosDoDia[idxProf].push({
                inicio: new Date(t),
                fim: new Date(t + duracaoMs),
                local: { data: d, minutosDoDia: c.minutosDoDia },
              });
            }
          }
        });
      }
    }
    preparados.forEach((_, idxProf) => {
      saida[idxProf].dias.push({ data: d, horarios: horariosDoDia[idxProf] });
    });
  });

  return saida;
}
