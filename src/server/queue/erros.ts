// Erros da fila (D-008 §3.3). Nenhum deles carrega a URL do banco nem credenciais: a `cause` é um
// objeto simples { nome, codigo }, nunca o erro original (cuja mensagem pode citar host e usuário).

export type MotivoIndisponivel = 'schema_ausente' | 'fila_inexistente' | 'conexao';

/** Falha de infraestrutura ao enfileirar (RN-12). O chamador decide o que fazer; não há nova tentativa. */
export class ErroFilaIndisponivel extends Error {
  readonly fila: string;
  readonly motivo: MotivoIndisponivel;
  /** SQLSTATE, código do Node (ECONNREFUSED) ou do pg-boss; nunca a URL. */
  readonly codigo: string | null;

  constructor(fila: string, original: unknown) {
    const { nome, codigo } = descreverErroSeguro(original);
    const motivo = motivoDe(original);
    super(`Fila "${fila}" indisponível (${motivo})`, { cause: { nome, codigo } });
    this.name = 'ErroFilaIndisponivel';
    this.fila = fila;
    this.motivo = motivo;
    this.codigo = codigo;
  }
}

/** Payload ou chave fora do contrato da fila (RN-11). Lista só os caminhos, nunca os valores. */
export class ErroPayloadInvalido extends Error {
  readonly fila: string;
  readonly campos: string[];

  constructor(fila: string, campos: string[]) {
    const unicos = [...new Set(campos)].sort();
    super(`Payload inválido para a fila "${fila}": ${unicos.join(', ')}`);
    this.name = 'ErroPayloadInvalido';
    this.fila = fila;
    this.campos = unicos;
  }
}

function mensagemDe(erro: unknown): string {
  if (erro instanceof Error) return erro.message;
  if (typeof erro === 'string') return erro;
  return '';
}

function codigoDe(erro: unknown): string | null {
  const codigo = (erro as { code?: unknown } | null)?.code;
  return typeof codigo === 'string' && codigo !== '' ? codigo : null;
}

function motivoDe(erro: unknown): MotivoIndisponivel {
  if (codigoDe(erro) === 'PGBOSS_QUEUE_NOT_FOUND') return 'fila_inexistente';
  const mensagem = mensagemDe(erro);
  if (/pg-boss is not installed|requires migrations/i.test(mensagem)) return 'schema_ausente';
  // 3F000: schema inexistente; 42P01: tabela inexistente (schema removido depois do start()).
  if (codigoDe(erro) === '3F000' || codigoDe(erro) === '42P01') return 'schema_ausente';
  return 'conexao';
}

const LIMITE_MENSAGEM = 300;
const URL_PG = /postgres(?:ql)?:\/\/[^\s"'`]+/gi;
const CREDENCIAL_EM_URL = /\/\/[^/\s:@]+:[^@\s]+@/g;

function escaparRegex(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Para logs: `{ nome, codigo, mensagem }` com a URL, o `usuario:senha` e a senha de `url` trocados
 * por `***`. A mensagem é cortada em 300 caracteres.
 */
export function descreverErroSeguro(
  erro: unknown,
  url?: string,
): { nome: string; codigo: string | null; mensagem: string } {
  const nome = erro instanceof Error ? erro.name : typeof erro;
  let mensagem = mensagemDe(erro);
  if (url) {
    mensagem = mensagem.split(url).join('***');
    try {
      const u = new URL(url);
      for (const segredo of [u.password, decodeURIComponent(u.password)]) {
        if (segredo) mensagem = mensagem.replace(new RegExp(escaparRegex(segredo), 'g'), '***');
      }
    } catch {
      // URL inválida: as substituições genéricas abaixo ainda valem.
    }
  }
  mensagem = mensagem.replace(URL_PG, '***').replace(CREDENCIAL_EM_URL, '//***@');
  return { nome, codigo: codigoDe(erro), mensagem: mensagem.slice(0, LIMITE_MENSAGEM) };
}
