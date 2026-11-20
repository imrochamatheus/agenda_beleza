import { SEGMENTOS_RESERVADOS } from '@/config/navegacao';
import { FORMATO_SLUG } from '@/lib/slug';
import { normalizarNome } from '@/lib/texto';
import type { ConfiguracoesDTO } from '@/server/repos/tipos';
import { ehFusoCanonico } from '@/server/tempo/fuso';

import { GRADES_PERMITIDAS, LIMITES_SALAO, MENSAGENS_CONFIGURACOES } from './tipos';
import type { EntradaRegras, ErrosRegras, RegrasSalao, ValoresRegras } from './tipos';

// Validação pura das configurações do salão (D-017 §3.4; RN-9..RN-14, RN-18). Sem next/*, sem Prisma e
// sem repositórios (só `import type`). Reutilizável pela E8.2 (super admin), que deve chamar as MESMAS
// funções: não há CHECK no banco para as regras (design §4).

const NUMERO = new RegExp(`^[0-9]{1,${LIMITES_SALAO.numeroMaxCaracteres}}$`);

/** Texto numérico (D-22): string aparada só com dígitos ASCII (zeros à esquerda aceitos). Senão null. */
function inteiro(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return NUMERO.test(t) ? Number(t) : null;
}

function naFaixa(n: number | null, f: { min: number; max: number }): n is number {
  return n !== null && n >= f.min && n <= f.max;
}

/**
 * RN-9..RN-11, RN-18: todos os erros juntos. `fusoAtual` é a exceção da RN-9 (o valor gravado hoje é
 * aceito, mesmo fora da lista). Chaves extras da entrada (salaoId…) são ignoradas.
 */
export function validarRegras(
  e: EntradaRegras,
  opcoes: { fusoAtual: string | null },
): { ok: true; regras: RegrasSalao } | { ok: false; erros: ErrosRegras } {
  const entrada: EntradaRegras = typeof e === 'object' && e !== null ? e : {};
  const erros: ErrosRegras = {};

  const nome = normalizarNome(entrada.nome, LIMITES_SALAO.nome);
  if (nome === null) erros.nome = MENSAGENS_CONFIGURACOES.nome;

  const fuso = entrada.fuso;
  const fusoOk = ehFusoCanonico(fuso) || (typeof fuso === 'string' && fuso !== '' && fuso === opcoes.fusoAtual);
  if (!fusoOk) erros.fuso = MENSAGENS_CONFIGURACOES.fuso;

  const grade = inteiro(entrada.grade);
  const gradeOk = grade !== null && (GRADES_PERMITIDAS as readonly number[]).includes(grade);
  if (!gradeOk) erros.grade = MENSAGENS_CONFIGURACOES.grade;

  const antecedencia = inteiro(entrada.antecedencia);
  const antecedenciaOk = naFaixa(antecedencia, LIMITES_SALAO.antecedenciaHoras);
  if (!antecedenciaOk) erros.antecedencia = MENSAGENS_CONFIGURACOES.antecedencia;

  const janela = inteiro(entrada.janela);
  const janelaOk = naFaixa(janela, LIMITES_SALAO.janelaDias);
  if (!janelaOk) erros.janela = MENSAGENS_CONFIGURACOES.janela;

  const intervalo = inteiro(entrada.intervalo);
  if (!naFaixa(intervalo, LIMITES_SALAO.intervaloMin)) erros.intervalo = MENSAGENS_CONFIGURACOES.intervalo;

  // D-5 / D-22: coerência só com antecedência e janela válidas; o erro vai no campo antecedência.
  if (antecedenciaOk && janelaOk && antecedencia >= janela * 24) {
    erros.antecedencia = MENSAGENS_CONFIGURACOES.antecedenciaJanela;
  }

  if (Object.keys(erros).length > 0) {
    return { ok: false, erros };
  }
  return {
    ok: true,
    regras: {
      nome: nome as string,
      fuso: fuso as string,
      gradeMin: grade as number,
      antecedenciaMin: (antecedencia as number) * 60,
      janelaDias: janela as number,
      intervaloMin: intervalo as number,
    },
  };
}

/** RN-12, 1ª parte: string → trim().toLowerCase(); não-string ou acima de slugMaxCaracteres → null. */
export function normalizarSlug(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > LIMITES_SALAO.slugMaxCaracteres) return null;
  return v.trim().toLowerCase();
}

/**
 * RN-12/RN-13 sobre o valor JÁ normalizado: null se válido; senão a mensagem. Ordem (D-21): formato →
 * reservado → tamanho (todo segmento reservado que case o formato recebe a mensagem de reservado).
 * `reservados` só é informado pelos testes; produção usa SEGMENTOS_RESERVADOS (fonte única).
 */
export function validarNovoSlug(slug: string, reservados: ReadonlySet<string> = SEGMENTOS_RESERVADOS): string | null {
  if (!FORMATO_SLUG.test(slug)) return MENSAGENS_CONFIGURACOES.slugFormato;
  if (reservados.has(slug)) return MENSAGENS_CONFIGURACOES.slugReservado;
  if (slug.length < LIMITES_SALAO.slug.min || slug.length > LIMITES_SALAO.slug.max) return MENSAGENS_CONFIGURACOES.slugFormato;
  return null;
}

/** Valores do banco → textos do formulário; antecedencia_min (minutos) → horas (RN-10). */
export function valoresDoSalao(c: ConfiguracoesDTO | RegrasSalao): ValoresRegras {
  return {
    nome: c.nome,
    fuso: c.fuso,
    grade: String(c.gradeMin),
    antecedencia: String(c.antecedenciaMin / 60),
    janela: String(c.janelaDias),
    intervalo: String(c.intervaloMin),
  };
}
