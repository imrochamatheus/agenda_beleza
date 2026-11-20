// Estado e leitura do formulário do perfil público (D-020 §3.8). Só tipos e constantes de
// @/server/salao/perfil-tipos (arquivo client-safe): é importado por componentes cliente.
import { CAMPOS_TEXTO_PERFIL, LIMITES_PERFIL, VALORES_PERFIL_VAZIOS } from '@/server/salao/perfil-tipos';
import type { CampoPerfil, CampoTextoPerfil, EntradaPerfil, ErrosPerfil, ValoresPerfil } from '@/server/salao/perfil-tipos';

export type EstadoPerfil = {
  /** Erro geral (acesso negado, não encontrado). */
  mensagem: string | null;
  /** Mensagem de sucesso (sem PRG, A-9). */
  sucesso: string | null;
  erros: ErrosPerfil;
  /** Valores dos campos (preservados depois de um erro; normalizados pelo servidor depois de salvar). */
  valores: ValoresPerfil;
};

export function estadoPerfilInicial(valores: ValoresPerfil = VALORES_PERFIL_VAZIOS): EstadoPerfil {
  return { mensagem: null, sucesso: null, erros: {}, valores };
}

/** Id do campo na página: `perfil-<campo>` (o resumo de erros aponta para ele). */
export function idDoCampo(campo: CampoPerfil): string {
  return `perfil-${campo}`;
}

/** Texto do FormData; ausente ou não texto (arquivo) → ''. */
const texto = (v: FormDataEntryValue | null): string => (typeof v === 'string' ? v : '');
/** Só os textos de uma lista (arquivos ignorados). */
const textos = (vs: FormDataEntryValue[]): string[] => vs.filter((v): v is string => typeof v === 'string');

/**
 * Lê SÓ os 11 nomes de texto e as duas listas (salaoId e outros extras, e arquivos, são ignorados).
 * `entrada` vai inteira para a validação do servidor; `valores` volta aos campos cortado (eco).
 */
export function lerFormularioPerfil(fd: FormData): { entrada: EntradaPerfil; valores: ValoresPerfil } {
  const entrada: Record<string, unknown> = {};
  const valores = {} as Record<CampoTextoPerfil, string>;
  for (const campo of CAMPOS_TEXTO_PERFIL) {
    const v = texto(fd.get(campo));
    entrada[campo] = v;
    valores[campo] = v.slice(0, campo === 'descricao' ? LIMITES_PERFIL.ecoDescricaoMaxCaracteres : LIMITES_PERFIL.ecoMaxCaracteres);
  }
  const meiosPagamento = textos(fd.getAll('meiosPagamento'));
  const comodidades = textos(fd.getAll('comodidades'));
  entrada.meiosPagamento = meiosPagamento;
  entrada.comodidades = comodidades;
  const ecoLista = (l: string[]) => l.slice(0, LIMITES_PERFIL.itensListaMax).map((v) => v.slice(0, LIMITES_PERFIL.ecoMaxCaracteres));
  return {
    entrada: entrada as EntradaPerfil,
    valores: { ...valores, meiosPagamento: ecoLista(meiosPagamento), comodidades: ecoLista(comodidades) },
  };
}
