import { normalizarNome } from '@/lib/texto';
import { esquemaEmail } from '@/server/auth/confirmacao-email';
import { chaveDeBusca, lerBusca, lerPagina } from '@/server/clientes/validacao';
import { MENSAGENS_CONFIGURACOES } from '@/server/salao/tipos';
import type { RegrasSalao } from '@/server/salao/tipos';
import { normalizarSlug, validarNovoSlug, validarRegras } from '@/server/salao/validacao';

import { DIAS_MAX, DIAS_MIN, ESTADOS_FILTRO, FILTROS_SUSPENSAO, FOLGA_TESTE_MS, LIMITES_ADMIN_SALOES, MENSAGENS_ADMIN_SALOES } from './saloes-tipos';
import type { ErrosEdicao, EstadoFiltro, FiltroSuspensao, FiltrosSaloes, MotivoRecusaExtensao } from './saloes-tipos';

// Validação pura dos salões no painel do admin (D-044 §3). Sem next/*, sem Prisma e sem repositórios.
// Reutiliza, sem copiar, os validadores da E2.5 (regras, slug, fuso) e o esquema de e-mail da D-011.

type Consulta = { [chave: string]: string | string[] | undefined };

/** Valor único de um parâmetro de consulta; lista ou ausente → undefined. */
const unico = (v: string | string[] | undefined): string | undefined => (typeof v === 'string' ? v : undefined);

/** GET `q`, `estado`, `suspenso` e `pagina`: qualquer valor fora do esperado cai no padrão. */
export function lerFiltros(sp: Consulta): FiltrosSaloes & { chave: string } {
  const { q } = lerBusca(unico(sp.q));
  const estado = unico(sp.estado);
  const suspenso = unico(sp.suspenso);
  return {
    q,
    chave: chaveDeBusca(q),
    estado: (ESTADOS_FILTRO as readonly string[]).includes(estado ?? '') ? (estado as EstadoFiltro) : null,
    suspenso: (FILTROS_SUSPENSAO as readonly string[]).includes(suspenso ?? '') ? (suspenso as FiltroSuspensao) : 'todas',
    pagina: lerPagina(unico(sp.pagina)),
  };
}

const CONTROLE = /\p{Cc}/u;
const EMAIL_NO_TEXTO = /[^\s@]+@[^\s@]+\.[^\s@]+/u;
/** Oito dígitos ou mais, mesmo com separadores comuns de telefone no meio. */
const TELEFONE_NO_TEXTO = /(?:\+?\d[\s().-]*){8,}/u;

/** Motivo (suspender, reativar, estender): 5–280 depois de aparado e colapsado; sem e-mail nem telefone óbvios. */
export function validarMotivo(v: unknown): { ok: true; motivo: string } | { ok: false; erro: string } {
  if (typeof v !== 'string' || CONTROLE.test(v)) return { ok: false, erro: MENSAGENS_ADMIN_SALOES.motivo };
  const m = v.trim().replace(/\s+/gu, ' ');
  const { min, max } = LIMITES_ADMIN_SALOES.motivo;
  if (Array.from(m).length < min || Array.from(m).length > max) return { ok: false, erro: MENSAGENS_ADMIN_SALOES.motivo };
  if (EMAIL_NO_TEXTO.test(m) || TELEFONE_NO_TEXTO.test(m)) {
    return { ok: false, erro: MENSAGENS_ADMIN_SALOES.motivoDadosPessoais };
  }
  return { ok: true, motivo: m };
}

const DIAS = /^[1-9]\d?$/;

/**
 * N (dias) da extensão: só `^[1-9]\d?$` depois de aparado, depois 1–90. `1e1`, `+5`, `0`, `-1`, decimais,
 * vazio e espaços internos são recusados.
 */
export function validarDias(v: unknown): { ok: true; dias: number } | { ok: false; erro: string } {
  const t = typeof v === 'string' ? v.trim() : '';
  if (!DIAS.test(t)) return { ok: false, erro: MENSAGENS_ADMIN_SALOES.dias };
  const n = Number(t);
  return n >= DIAS_MIN && n <= DIAS_MAX ? { ok: true, dias: n } : { ok: false, erro: MENSAGENS_ADMIN_SALOES.dias };
}

/** Valores gravados hoje, lidos SOB a trava do salão. `gestor` nulo = salão sem gestor (campos ignorados). */
export type AtualDoSalao = RegrasSalao & {
  slug: string;
  gestor: { nome: string; email: string } | null;
};

export type EntradaEdicao = Partial<Record<'nome' | 'slug' | 'fuso' | 'grade' | 'antecedencia' | 'janela' | 'intervalo' | 'gestorNome' | 'gestorEmail', unknown>>;

/** Só o que mudou, em unidades do banco. */
export type MudancasDoSalao = {
  /** Regras/nome/fuso completos (para o UPDATE) e só as chaves alteradas (para a auditoria). */
  regras: RegrasSalao;
  regrasAlteradas: Partial<RegrasSalao>;
  slug: string | null;
  gestorNome: string | null;
  gestorEmail: string | null;
};

/**
 * Valida o formulário inteiro contra o estado atual. Todos os erros juntos; valores iguais aos atuais não
 * entram em `mudancas`. `vazio` = nada mudou (nada se grava nem se audita).
 */
export function validarEdicao(
  e: EntradaEdicao,
  atual: AtualDoSalao,
): { ok: true; mudancas: MudancasDoSalao; vazio: boolean } | { ok: false; erros: ErrosEdicao } {
  const entrada: EntradaEdicao = typeof e === 'object' && e !== null ? e : {};
  const erros: ErrosEdicao = {};

  const r = validarRegras(
    { nome: entrada.nome, fuso: entrada.fuso, grade: entrada.grade, antecedencia: entrada.antecedencia, janela: entrada.janela, intervalo: entrada.intervalo },
    { fusoAtual: atual.fuso },
  );
  if (!r.ok) Object.assign(erros, r.erros);

  let slug: string | null = null;
  const slugNormalizado = normalizarSlug(entrada.slug);
  if (slugNormalizado === null) {
    erros.slug = MENSAGENS_CONFIGURACOES.slugFormato;
  } else if (slugNormalizado !== atual.slug) {
    const erroSlug = validarNovoSlug(slugNormalizado);
    if (erroSlug !== null) erros.slug = erroSlug;
    else slug = slugNormalizado;
  }

  let gestorNome: string | null = null;
  let gestorEmail: string | null = null;
  if (atual.gestor !== null) {
    const nome = normalizarNome(entrada.gestorNome, LIMITES_ADMIN_SALOES.gestorNome);
    if (nome === null) erros.gestorNome = MENSAGENS_ADMIN_SALOES.gestorNome;
    else if (nome !== atual.gestor.nome) gestorNome = nome;
    const email = esquemaEmail.safeParse(entrada.gestorEmail);
    if (!email.success) erros.gestorEmail = MENSAGENS_ADMIN_SALOES.gestorEmail;
    else if (email.data !== atual.gestor.email.toLowerCase()) gestorEmail = email.data;
  }

  if (Object.keys(erros).length > 0 || !r.ok) return { ok: false, erros };

  const regrasAlteradas: Partial<RegrasSalao> = {};
  for (const k of ['nome', 'fuso', 'gradeMin', 'antecedenciaMin', 'janelaDias', 'intervaloMin'] as const) {
    if (r.regras[k] !== atual[k]) (regrasAlteradas as Record<string, unknown>)[k] = r.regras[k];
  }
  const mudancas: MudancasDoSalao = { regras: r.regras, regrasAlteradas, slug, gestorNome, gestorEmail };
  const vazio =
    Object.keys(regrasAlteradas).length === 0 && slug === null && gestorNome === null && gestorEmail === null;
  return { ok: true, mudancas, vazio };
}

const COLUNA: Readonly<Record<keyof RegrasSalao, string>> = Object.freeze({
  nome: 'nome',
  fuso: 'fuso',
  gradeMin: 'grade_min',
  antecedenciaMin: 'antecedencia_min',
  janelaDias: 'janela_dias',
  intervaloMin: 'intervalo_min',
});

type Json = string | number;

/**
 * `antes`/`depois` de `salao.atualizar`: só os campos alterados (chaves em snake_case, as colunas do
 * banco), mais `slug` e `gestor_nome` quando mudaram. Nada de segredos nem de e-mail aqui.
 */
export function diferencaDoSalao(atual: AtualDoSalao, m: MudancasDoSalao): { antes: Record<string, Json>; depois: Record<string, Json> } {
  const antes: Record<string, Json> = {};
  const depois: Record<string, Json> = {};
  for (const [k, v] of Object.entries(m.regrasAlteradas) as [keyof RegrasSalao, Json][]) {
    antes[COLUNA[k]] = atual[k];
    depois[COLUNA[k]] = v;
  }
  if (m.slug !== null) {
    antes.slug = atual.slug;
    depois.slug = m.slug;
  }
  if (m.gestorNome !== null && atual.gestor !== null) {
    antes.gestor_nome = atual.gestor.nome;
    depois.gestor_nome = m.gestorNome;
  }
  return { antes, depois };
}

/** Há alteração em `salao` ou no nome do gestor (a auditoria `salao.atualizar` é gravada)? */
export const alteraSalao = (m: MudancasDoSalao): boolean =>
  Object.keys(m.regrasAlteradas).length > 0 || m.slug !== null || m.gestorNome !== null;

/**
 * Por que o teste NÃO pode ser estendido agora (ou null se pode). Ordem: sem assinatura → estado → sem vínculo
 * com o provedor → teste encerrado → menos de 5 minutos. Única regra: a página e o serviço a usam.
 * `estado` nulo = salão sem assinatura vigente.
 */
export function recusaDaExtensao(
  a: { estado: string | null; temProvedor: boolean; testeFimEm: Date | null },
  agora: Date,
): MotivoRecusaExtensao | null {
  if (a.estado === null) return 'sem_assinatura';
  if (a.estado !== 'em_teste') return 'estado';
  if (!a.temProvedor) return 'sem_provedor';
  if (a.testeFimEm === null || a.testeFimEm.getTime() <= agora.getTime()) return 'teste_encerrado';
  if (a.testeFimEm.getTime() - agora.getTime() < FOLGA_TESTE_MS) return 'teste_expirando';
  return null;
}
