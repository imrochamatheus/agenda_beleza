// Estado e leitura do formulário de edição da cliente (D-022 §3.6). Só tipos e constantes de
// @/server/clientes/tipos (sem imports de servidor de runtime): é importado por componentes cliente.
import type { CampoCliente, ErrosCliente } from '@/server/clientes/tipos';

export type ValoresCliente = { nome: string; telefone: string };

export type EstadoFormularioCliente = {
  /** Erro geral (acesso negado, não encontrada). */
  mensagem: string | null;
  /** Mensagem de sucesso (sem PRG, A-10: funciona sem JavaScript). */
  sucesso: string | null;
  erros: ErrosCliente;
  /** Telefone já usado: a cliente existente, para o link do resumo. */
  existente: { id: string; nome: string } | null;
  /** Valores dos campos (preservados depois de um erro; normalizados pelo servidor depois de salvar). */
  valores: ValoresCliente;
};

export function estadoInicial(valores: ValoresCliente): EstadoFormularioCliente {
  return { mensagem: null, sucesso: null, erros: {}, existente: null, valores };
}

/** Id do campo na página: `cliente-<campo>` (o resumo de erros aponta para ele). */
export function idDoCampo(campo: CampoCliente): string {
  return `cliente-${campo}`;
}

/** Texto do FormData; ausente ou não texto (arquivo) → ''. */
const texto = (v: FormDataEntryValue | null): string => (typeof v === 'string' ? v : '');
const ECO_MAX = 200;

/**
 * Lê só os nomes conhecidos (salaoId e outros extras, e arquivos, são ignorados). `entrada` vai inteira
 * para a validação do servidor; `valores` volta aos campos cortado em ECO_MAX caracteres.
 */
export function lerFormularioCliente(fd: FormData): {
  entrada: { id: string; nome: string; telefone: string };
  valores: ValoresCliente;
} {
  const entrada = { id: texto(fd.get('id')), nome: texto(fd.get('nome')), telefone: texto(fd.get('telefone')) };
  return { entrada, valores: { nome: entrada.nome.slice(0, ECO_MAX), telefone: entrada.telefone.slice(0, ECO_MAX) } };
}

/** Endereço da lista com busca e página (só o que difere do padrão entra na consulta). */
export function hrefDaLista(base: string, q: string, pagina: number): string {
  const p = new URLSearchParams();
  if (q !== '') p.set('q', q);
  if (pagina > 1) p.set('pagina', String(pagina));
  const consulta = p.toString();
  return consulta === '' ? base : `${base}?${consulta}`;
}
