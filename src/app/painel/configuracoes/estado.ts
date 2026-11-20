// Estado e leitura dos formulários de configurações (D-017 §3.6). Só tipos e constantes de
// @/server/salao/tipos (arquivo sem imports de servidor de runtime): é importado por componentes cliente.
import { CAMPOS_REGRAS, LIMITES_SALAO } from '@/server/salao/tipos';
import type { CampoRegras, EntradaRegras, EntradaSlug, ErrosRegras, ValoresRegras } from '@/server/salao/tipos';

export type EstadoRegras = {
  /** Erro geral (acesso negado, não encontrado, formulário ilegível). */
  mensagem: string | null;
  /** Mensagem de sucesso (sem PRG, D-23). */
  sucesso: string | null;
  erros: ErrosRegras;
  /** Valores dos campos (preservados depois de um erro; normalizados pelo servidor depois de salvar). */
  valores: ValoresRegras;
};

export type EstadoSlug = {
  mensagem: string | null;
  sucesso: string | null;
  erros: { slug?: string };
  /** Valor do campo (vazio depois de trocar). */
  valor: string;
};

export const VALORES_REGRAS_VAZIOS: ValoresRegras = Object.freeze({
  nome: '',
  fuso: '',
  grade: '',
  antecedencia: '',
  janela: '',
  intervalo: '',
});

export function estadoRegrasInicial(valores: ValoresRegras = VALORES_REGRAS_VAZIOS): EstadoRegras {
  return { mensagem: null, sucesso: null, erros: {}, valores };
}

export function estadoSlugInicial(): EstadoSlug {
  return { mensagem: null, sucesso: null, erros: {}, valor: '' };
}

/** Id do campo na página: `config-<campo>` (o resumo de erros aponta para ele). */
export function idDoCampo(campo: CampoRegras | 'slug'): string {
  return `config-${campo}`;
}

/** Texto do FormData; ausente ou não texto (arquivo) → ''. */
const texto = (v: FormDataEntryValue | null): string => (typeof v === 'string' ? v : '');
const eco = (v: string): string => v.slice(0, LIMITES_SALAO.ecoMaxCaracteres);

/**
 * Lê SÓ os seis nomes conhecidos (salaoId e outros extras, e arquivos, são ignorados). `entrada` vai
 * inteira para a validação do servidor; `valores` volta aos campos cortado em ecoMaxCaracteres.
 */
export function lerFormularioRegras(fd: FormData): { entrada: EntradaRegras; valores: ValoresRegras } {
  const entrada = {} as Record<CampoRegras, string>;
  const valores = {} as Record<CampoRegras, string>;
  for (const campo of CAMPOS_REGRAS) {
    entrada[campo] = texto(fd.get(campo));
    valores[campo] = eco(entrada[campo]);
  }
  return { entrada, valores };
}

/** Lê só `slug`. */
export function lerFormularioSlug(fd: FormData): { entrada: EntradaSlug; valor: string } {
  const slug = texto(fd.get('slug'));
  return { entrada: { slug }, valor: eco(slug) };
}
