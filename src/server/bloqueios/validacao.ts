import { z } from 'zod';

import { compararDatas, diferencaEmDias, ehDataCivilValida, instanteDeHoraLocal, intervaloDeDiasInteiros } from '@/server/tempo/fuso';
import type { DataCivil } from '@/server/tempo/fuso';

import { LIMITES_BLOQUEIO, MENSAGENS_BLOQUEIO } from './tipos';
import type { ErrosBloqueio } from './tipos';

// Leitura e validação do período de um bloqueio (D-016 §3.4; RN-2..RN-7, RN-15). Pura: sem banco,
// sem next/* e sem Prisma; só a conversão de src/server/tempo/fuso.ts. O servidor é a autoridade: o
// `pattern` dos campos é conveniência. A CHECK `bloqueio_ordem_chk` continua sendo a garantia final.

const PADRAO_DATA = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const PADRAO_HORA = /^(\d{1,2}):(\d{2})$/;

/** 'dd/mm/aaaa' (trim; ≤ campoMaxCaracteres). Formato → 'data'; inexistente (31/02) → 'dataInexistente'. */
export function lerData(v: unknown): { ok: true; data: DataCivil } | { ok: false; erro: 'data' | 'dataInexistente' } {
  if (typeof v !== 'string' || v.length > LIMITES_BLOQUEIO.campoMaxCaracteres) {
    return { ok: false, erro: 'data' };
  }
  const casado = PADRAO_DATA.exec(v.trim());
  if (!casado) return { ok: false, erro: 'data' };
  const data = { ano: Number(casado[3]), mes: Number(casado[2]), dia: Number(casado[1]) };
  return ehDataCivilValida(data) ? { ok: true, data } : { ok: false, erro: 'dataInexistente' };
}

/** 'H:MM' | 'HH:MM' (trim; h 0..23; m 0..59). Formato → 'hora' (inclusive 24:00); m % 5 ≠ 0 → 'granularidade'. */
export function lerHora(v: unknown): { ok: true; min: number } | { ok: false; erro: 'hora' | 'granularidade' } {
  if (typeof v !== 'string' || v.length > LIMITES_BLOQUEIO.campoMaxCaracteres) {
    return { ok: false, erro: 'hora' };
  }
  const casado = PADRAO_HORA.exec(v.trim());
  if (!casado) return { ok: false, erro: 'hora' };
  const h = Number(casado[1]);
  const m = Number(casado[2]);
  if (h > 23 || m > 59) return { ok: false, erro: 'hora' };
  if (m % LIMITES_BLOQUEIO.passoMin !== 0) return { ok: false, erro: 'granularidade' };
  return { ok: true, min: h * 60 + m };
}

/** trim; '' ou ausente → null; > 200 (UTF-16) ou não-texto → erro (RN-15). */
export function lerMotivo(v: unknown): { ok: true; motivo: string | null } | { ok: false } {
  if (v === undefined) return { ok: true, motivo: null };
  if (typeof v !== 'string') return { ok: false };
  const motivo = v.trim();
  if (motivo.length > LIMITES_BLOQUEIO.motivoMax) return { ok: false };
  return { ok: true, motivo: motivo === '' ? null : motivo };
}

const texto = z.string().optional();
const CAMPOS_PERIODO = {
  modo: texto,
  dataInicio: texto,
  horaInicio: texto,
  dataFim: texto,
  horaFim: texto,
  motivo: texto,
};
/** Criação: o alvo é texto (ou ausente); chave extra (salaoId, profissionalId, id…) → formulario. */
const esquemaCriar = z.strictObject({ ...CAMPOS_PERIODO, alvo: texto });
/** Edição: sem alvo (RN-11, D-21); o id é conferido pelo serviço (não-texto → 404). */
const esquemaEditar = z.strictObject({ ...CAMPOS_PERIODO, id: z.unknown().optional() });

export type PeriodoResolvido = { ok: true; inicio: Date; fim: Date; motivo: string | null; alvo: unknown; id: unknown };

const MENSAGEM_DATA = { data: MENSAGENS_BLOQUEIO.data, dataInexistente: MENSAGENS_BLOQUEIO.dataInexistente } as const;
const MENSAGEM_HORA = { hora: MENSAGENS_BLOQUEIO.hora, granularidade: MENSAGENS_BLOQUEIO.granularidade } as const;

/**
 * Valida a forma e os campos e resolve o período no fuso do salão. Ordem:
 * 1. Forma (chave extra ou tipo errado → só erros.formulario).
 * 2. Campos: modo ∈ {horario, dia_inteiro} (senão erros.modo e para); datas; no modo 'horario' as horas
 *    (no 'dia_inteiro' as horas são IGNORADAS, inclusive inválidas); motivo. Erros de campo acumulam.
 * 3. Conversão (só sem erros de campo): horario → instanteDeHoraLocal; dia_inteiro → data final antes
 *    da inicial → erros.dataFim = ordemDias, senão intervaloDeDiasInteiros.
 * 4. Regras temporais em erros.periodo, a primeira que falhar: ordem (RN-5); passado (RN-6); duração
 *    (RN-7: 366 × 24 h com horário, 366 datas no dia inteiro); antecedência (RN-7). Início no passado
 *    é aceito.
 * O alvo NÃO é validado aqui (depende do papel; o serviço resolve).
 */
export function resolverPeriodo(
  e: unknown,
  fuso: string,
  agora: Date,
  opcoes: { edicao: boolean },
): PeriodoResolvido | { ok: false; erros: ErrosBloqueio } {
  const forma = (opcoes.edicao ? esquemaEditar : esquemaCriar).safeParse(e);
  if (!forma.success) {
    return { ok: false, erros: { formulario: MENSAGENS_BLOQUEIO.formulario } };
  }
  const v = forma.data as z.infer<typeof esquemaCriar> & { id?: unknown };
  const erros: ErrosBloqueio = {};
  const modo = v.modo?.trim();
  if (modo !== 'horario' && modo !== 'dia_inteiro') {
    return { ok: false, erros: { modo: MENSAGENS_BLOQUEIO.modo } };
  }

  const dataInicio = lerData(v.dataInicio ?? '');
  if (!dataInicio.ok) erros.dataInicio = MENSAGEM_DATA[dataInicio.erro];
  let horaInicio: ReturnType<typeof lerHora> | null = null;
  if (modo === 'horario') {
    horaInicio = lerHora(v.horaInicio ?? '');
    if (!horaInicio.ok) erros.horaInicio = MENSAGEM_HORA[horaInicio.erro];
  }
  const dataFim = lerData(v.dataFim ?? '');
  if (!dataFim.ok) erros.dataFim = MENSAGEM_DATA[dataFim.erro];
  let horaFim: ReturnType<typeof lerHora> | null = null;
  if (modo === 'horario') {
    horaFim = lerHora(v.horaFim ?? '');
    if (!horaFim.ok) erros.horaFim = MENSAGEM_HORA[horaFim.erro];
  }
  const motivo = lerMotivo(v.motivo);
  if (!motivo.ok) erros.motivo = MENSAGENS_BLOQUEIO.motivo;
  if (Object.keys(erros).length > 0 || !dataInicio.ok || !dataFim.ok || !motivo.ok) {
    return { ok: false, erros };
  }

  let inicio: Date;
  let fim: Date;
  if (modo === 'horario') {
    // Sem erros de campo, as horas foram lidas com sucesso.
    inicio = instanteDeHoraLocal(dataInicio.data, (horaInicio as { min: number }).min, fuso);
    fim = instanteDeHoraLocal(dataFim.data, (horaFim as { min: number }).min, fuso);
  } else {
    if (compararDatas(dataFim.data, dataInicio.data) < 0) {
      return { ok: false, erros: { dataFim: MENSAGENS_BLOQUEIO.ordemDias } };
    }
    ({ inicio, fim } = intervaloDeDiasInteiros(dataInicio.data, dataFim.data, fuso));
  }

  const periodo = regraTemporal(modo, inicio, fim, agora, dataInicio.data, dataFim.data);
  if (periodo !== null) {
    return { ok: false, erros: { periodo } };
  }
  return { ok: true, inicio, fim, motivo: motivo.motivo, alvo: v.alvo, id: v.id };
}

function regraTemporal(
  modo: 'horario' | 'dia_inteiro',
  inicio: Date,
  fim: Date,
  agora: Date,
  d1: DataCivil,
  d2: DataCivil,
): string | null {
  const i = inicio.getTime();
  const f = fim.getTime();
  if (f <= i) return MENSAGENS_BLOQUEIO.ordem;
  if (f <= agora.getTime()) return MENSAGENS_BLOQUEIO.passado;
  const longo =
    modo === 'horario' ? f - i > LIMITES_BLOQUEIO.duracaoMaxMs : diferencaEmDias(d1, d2) + 1 > LIMITES_BLOQUEIO.diasInteirosMax;
  if (longo) return MENSAGENS_BLOQUEIO.duracao;
  if (i - agora.getTime() > LIMITES_BLOQUEIO.antecedenciaMaxMs) return MENSAGENS_BLOQUEIO.antecedencia;
  return null;
}
