// Estado e leitura do editor de semana compartilhado (D-020 §3.7, extraído da jornada D-015 §3.6).
// Sem imports de servidor de runtime além de @/server/semana/tipos (só tipos e constantes) e da
// formatação de @/lib/format. Usado pela jornada (prefixo `jornada`, dia vazio "Folga") e pelo
// funcionamento do salão (prefixo `funcionamento`, dia vazio "Fechado").
import { formatarDiaDaSemana, formatarFaixaDeMinutos, formatarMinutosDoDia } from '@/lib/format';
import { DIAS_SEMANA, LIMITES_SEMANA, ORDEM_EXIBICAO_DIAS } from '@/server/semana/tipos';
import type { DiaEntrada, DiaSemana, DiaSemanaHoraria, ErrosSemana, IntervaloMin, SemanaHoraria } from '@/server/semana/tipos';

export type ValorLinha = { inicio: string; fim: string };
/** Valores dos campos: 6 linhas por dia (índice = diaSemana). */
export type ValoresSemana = Record<DiaSemana, ValorLinha[]>;

export type CampoHorario = 'inicio' | 'fim';

/** Nome do campo no FormData: `inicio-<dia>-<n>` / `fim-<dia>-<n>` (n a partir de 0). */
export function nomeDoCampo(dia: DiaSemana, n: number, campo: CampoHorario): string {
  return `${campo}-${dia}-${n}`;
}

/** Id do campo na página: `<prefixo>-<dia>-<n>-inicio` / `<prefixo>-<dia>-<n>-fim`. */
export function idDoCampo(prefixo: string, dia: DiaSemana, n: number, campo: CampoHorario): string {
  return `${prefixo}-${dia}-${n}-${campo}`;
}

/** Id do erro de uma linha (intervalo) e do erro do dia (limite). */
export const idDoErroDaLinha = (prefixo: string, dia: DiaSemana, n: number) => `${prefixo}-${dia}-${n}-erro`;
export const idDoErroDoDia = (prefixo: string, dia: DiaSemana) => `${prefixo}-${dia}-erro`;

const linhasVazias = (quantas: number): ValorLinha[] => Array.from({ length: quantas }, () => ({ inicio: '', fim: '' }));

/** Semana gravada → valores dos campos (HH:MM), completando com linhas vazias até 6. */
export function valoresDaSemana(semana: SemanaHoraria): ValoresSemana {
  const valores = {} as ValoresSemana;
  for (const dia of DIAS_SEMANA) {
    const intervalos = semana[dia]?.intervalos ?? [];
    const linhas = intervalos
      .slice(0, LIMITES_SEMANA.linhasPorDia)
      .map((i) => ({ inicio: formatarMinutosDoDia(i.inicioMin), fim: formatarMinutosDoDia(i.fimMin) }));
    valores[dia] = [...linhas, ...linhasVazias(LIMITES_SEMANA.linhasPorDia - linhas.length)];
  }
  return valores;
}

/** Texto do FormData; ausente ou não texto (arquivo) → ''. */
const texto = (v: FormDataEntryValue | null): string => (typeof v === 'string' ? v : '');

/**
 * Só os 7 × 6 × 2 nomes conhecidos (extras e arquivos ignorados). `valores` volta aos campos cortado
 * em `horarioMaxCaracteres` (não ecoa entradas enormes); `dias` vai inteiro para a validação.
 */
export function lerSemanaDoFormulario(fd: FormData): { dias: DiaEntrada[]; valores: ValoresSemana } {
  const valores = {} as ValoresSemana;
  const dias: DiaEntrada[] = [];
  for (const dia of DIAS_SEMANA) {
    const intervalos: ValorLinha[] = [];
    for (let n = 0; n < LIMITES_SEMANA.linhasPorDia; n += 1) {
      intervalos.push({ inicio: texto(fd.get(nomeDoCampo(dia, n, 'inicio'))), fim: texto(fd.get(nomeDoCampo(dia, n, 'fim'))) });
    }
    dias.push({ diaSemana: dia, intervalos });
    valores[dia] = intervalos.map((l) => ({
      inicio: l.inicio.slice(0, LIMITES_SEMANA.horarioMaxCaracteres),
      fim: l.fim.slice(0, LIMITES_SEMANA.horarioMaxCaracteres),
    }));
  }
  return { dias, valores };
}

const faixas = (lista: readonly IntervaloMin[]) => lista.map((i) => formatarFaixaDeMinutos(i.inicioMin, i.fimMin)).join(', ');

/** Intervalos do dia ("09:00–12:00, 13:00–18:00") ou o texto do dia vazio ("Folga", "Fechado"). */
export function textoDosIntervalos(dia: DiaSemanaHoraria, textoVazio: string): string {
  return dia.intervalos.length === 0 ? textoVazio : faixas(dia.intervalos);
}

/** Pausas do dia ("Pausa 12:00–13:00", "Pausas 10:00–10:30, 12:00–13:00") ou null. */
export function textoDasPausas(dia: DiaSemanaHoraria): string | null {
  if (dia.pausas.length === 0) return null;
  return `${dia.pausas.length === 1 ? 'Pausa' : 'Pausas'} ${faixas(dia.pausas)}`;
}

/** Resumo de uma linha do dia, para o `<summary>`: intervalos e pausas separados por " · ". */
export function resumoDoDia(dia: DiaSemanaHoraria, textoVazio: string): string {
  const pausas = textoDasPausas(dia);
  return pausas ? `${textoDosIntervalos(dia, textoVazio)} · ${pausas}` : textoDosIntervalos(dia, textoVazio);
}

export type ItemDoResumo = { href: string; texto: string };

/** Erros na ordem de exibição (segunda → domingo), cada um com o link para o primeiro campo afetado. */
export function itensDoResumo(prefixo: string, erros: ErrosSemana): ItemDoResumo[] {
  const itens: ItemDoResumo[] = [];
  for (const dia of ORDEM_EXIBICAO_DIAS) {
    const e = erros.dias?.[dia];
    if (!e) continue;
    const nome = formatarDiaDaSemana(dia);
    if (e.dia) itens.push({ href: `#${idDoCampo(prefixo, dia, 0, 'inicio')}`, texto: `${nome}: ${e.dia}` });
    const linhas = Object.entries(e.intervalos ?? {}).sort(([x], [y]) => Number(x) - Number(y));
    for (const [n, erro] of linhas) {
      if (!erro) continue;
      const i = Number(n);
      const campo = erro.inicio || erro.intervalo || !erro.fim ? 'inicio' : 'fim';
      const textoErro = erro.intervalo ?? erro.inicio ?? erro.fim;
      itens.push({ href: `#${idDoCampo(prefixo, dia, i, campo)}`, texto: `${nome}, intervalo ${i + 1}: ${textoErro}` });
    }
  }
  return itens;
}
