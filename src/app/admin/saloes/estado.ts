// Estado e leitura dos formulários dos salões no painel do admin (D-044 §5). Só tipos e constantes
// client-safe (sem imports de servidor de runtime): é importado por componentes cliente e pela casca.
import { formatarData, formatarHora } from '@/lib/format';
import { MENSAGENS_ADMIN_SALOES as M } from '@/server/admin/saloes-tipos';
import type {
  CampoEdicao,
  DetalheSalao,
  FiltrosSaloes,
  ResultadoEdicao,
  ResultadoExtensao,
  ResultadoSuspensao,
  ValoresEdicao,
} from '@/server/admin/saloes-tipos';

/** `em`: instante (ms) em que o servidor produziu o estado; decide qual resultado a tela mostra no topo. */
export type EstadoEdicao = { em: number; mensagem: string | null; resultado: ResultadoEdicao | null; valores: ValoresEdicao };
export type EstadoSuspensao = { em: number; mensagem: string | null; resultado: ResultadoSuspensao | null; valores: { motivo: string } };
export type EstadoExtensao = { em: number; mensagem: string | null; resultado: ResultadoExtensao | null; valores: { dias: string } };

export const estadoEdicaoInicial = (valores: ValoresEdicao): EstadoEdicao => ({ em: 0, mensagem: null, resultado: null, valores });
export const estadoSuspensaoInicial = (): EstadoSuspensao => ({ em: 0, mensagem: null, resultado: null, valores: { motivo: '' } });
export const estadoExtensaoInicial = (): EstadoExtensao => ({ em: 0, mensagem: null, resultado: null, valores: { dias: '' } });

/** Id do campo na página: `salao-<campo>` (o resumo de erros aponta para ele). */
export const idDoCampo = (campo: CampoEdicao | 'motivo' | 'dias'): string => `salao-${campo}`;

export function valoresDoDetalhe(d: DetalheSalao): ValoresEdicao {
  return {
    nome: d.nome,
    slug: d.slug,
    fuso: d.fuso,
    grade: String(d.gradeMin),
    antecedencia: String(d.antecedenciaMin / 60),
    janela: String(d.janelaDias),
    intervalo: String(d.intervaloMin),
    gestorNome: d.gestor?.nome ?? '',
    gestorEmail: d.gestor?.email ?? '',
  };
}

/** "30/11/2026 às 14:00" no fuso do salão (só por format.ts; o instante vem em ISO 8601). */
export function dataEHora(iso: string, fuso: string): string {
  const d = new Date(iso);
  return `${formatarData(d, fuso)} às ${formatarHora(d, fuso)}`;
}

const texto = (v: FormDataEntryValue | null): string => (typeof v === 'string' ? v : '');
const ECO_MAX = 200;
const eco = (s: string): string => s.slice(0, ECO_MAX);

const CAMPOS_EDICAO: readonly CampoEdicao[] = ['nome', 'slug', 'fuso', 'grade', 'antecedencia', 'janela', 'intervalo', 'gestorNome', 'gestorEmail'];

/** Lê só os nomes conhecidos (chaves extras e arquivos são ignorados). `valores` volta aos campos cortado em 200. */
export function lerEdicao(fd: FormData): { entrada: Record<CampoEdicao, string> & { salaoId: string }; valores: ValoresEdicao } {
  const entrada = { salaoId: texto(fd.get('salaoId')) } as Record<CampoEdicao, string> & { salaoId: string };
  const valores = {} as ValoresEdicao;
  for (const c of CAMPOS_EDICAO) {
    entrada[c] = texto(fd.get(c));
    valores[c] = eco(entrada[c]);
  }
  return { entrada, valores };
}

export function lerSuspensao(fd: FormData): { entrada: { salaoId: string; motivo: string; etapa: string }; motivo: string } {
  const entrada = { salaoId: texto(fd.get('salaoId')), motivo: texto(fd.get('motivo')), etapa: texto(fd.get('etapa')) };
  return { entrada, motivo: eco(entrada.motivo) };
}

export function lerExtensao(fd: FormData): {
  entrada: { salaoId: string; dias: string; testeFimEmEsperado: string; etapa: string };
  dias: string;
} {
  const entrada = {
    salaoId: texto(fd.get('salaoId')),
    dias: texto(fd.get('dias')),
    testeFimEmEsperado: texto(fd.get('testeFimEmEsperado')),
    etapa: texto(fd.get('etapa')),
  };
  return { entrada, dias: eco(entrada.dias) };
}

export type AlertaDeResultado = { variante: 'sucesso' | 'info' | 'aviso' | 'erro'; texto: string };

type Candidato = { em: number; alerta: AlertaDeResultado };

/**
 * Resultado a mostrar NO TOPO da página: o do estado mais recente (maior `em`). Erros de campo e a etapa 2
 * ficam nos próprios formulários (null aqui); recusas da extensão ficam no lugar do campo.
 */
export function alertaDoUltimo(
  e: { edicao: EstadoEdicao; suspender: EstadoSuspensao; reativar: EstadoSuspensao; estender: EstadoExtensao },
  fuso: string,
): AlertaDeResultado | null {
  const c: Candidato[] = [];
  const falha = (s: { em: number; mensagem: string | null }) => {
    if (s.mensagem) c.push({ em: s.em, alerta: { variante: 'erro', texto: s.mensagem } });
  };
  falha(e.edicao);
  falha(e.suspender);
  falha(e.reativar);
  falha(e.estender);

  const ed = e.edicao.resultado;
  if (ed?.resultado === 'editado') {
    const extra =
      ed.confirmacao === 'enviado'
        ? ' Um link de confirmação foi enviado ao novo e-mail do gestor.'
        : ed.confirmacao === 'falhou'
          ? ' Não foi possível enviar o link de confirmação agora; peça ao gestor para usar "Reenviar link de confirmação".'
          : '';
    c.push({ em: e.edicao.em, alerta: { variante: 'sucesso', texto: `${M.salvo}${extra}` } });
  } else if (ed?.resultado === 'sem_mudanca') {
    c.push({ em: e.edicao.em, alerta: { variante: 'info', texto: M.semMudanca } });
  }

  const su = e.suspender.resultado;
  if (su?.resultado === 'suspenso') c.push({ em: e.suspender.em, alerta: { variante: 'sucesso', texto: M.suspenso } });
  if (su?.resultado === 'sem_efeito') c.push({ em: e.suspender.em, alerta: { variante: 'info', texto: M.jaSuspenso } });
  const re = e.reativar.resultado;
  if (re?.resultado === 'reativado') c.push({ em: e.reativar.em, alerta: { variante: 'sucesso', texto: M.reativado } });
  if (re?.resultado === 'sem_efeito') c.push({ em: e.reativar.em, alerta: { variante: 'info', texto: M.naoSuspenso } });

  const ex = e.estender.resultado;
  const em = e.estender.em;
  if (ex?.resultado === 'estendido') c.push({ em, alerta: { variante: 'sucesso', texto: `Teste estendido até ${dataEHora(ex.para, fuso)}.` } });
  if (ex?.resultado === 'provedor_falhou') c.push({ em, alerta: { variante: 'erro', texto: M.provedorFalhou } });
  if (ex?.resultado === 'divergencia') c.push({ em, alerta: { variante: 'erro', texto: M.divergencia } });
  if (ex?.resultado === 'mudou') {
    const fim = ex.novoFim === null ? '' : ` O fim do teste agora é ${dataEHora(ex.novoFim, fuso)}.`;
    c.push({ em, alerta: { variante: 'aviso', texto: `A assinatura mudou enquanto você decidia.${fim} Confira e tente de novo.` } });
  }

  if (c.length === 0) return null;
  return c.reduce((a, b) => (b.em >= a.em ? b : a)).alerta;
}

/** Endereço da lista com filtros e página (só o que difere do padrão entra na consulta). */
export function hrefDaLista(base: string, f: Pick<FiltrosSaloes, 'q' | 'estado' | 'suspenso'>, pagina: number): string {
  const p = new URLSearchParams();
  if (f.q !== '') p.set('q', f.q);
  if (f.estado !== null) p.set('estado', f.estado);
  if (f.suspenso !== 'todas') p.set('suspenso', f.suspenso);
  if (pagina > 1) p.set('pagina', String(pagina));
  const consulta = p.toString();
  return consulta === '' ? base : `${base}?${consulta}`;
}
