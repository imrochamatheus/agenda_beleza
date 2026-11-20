// Estados dos formulários de /painel/servicos (D-014 §3.6). Sem imports de servidor de runtime: só
// `import type` de @/server/servicos/tipos (arquivo sem dependências).
import type { ErrosServico } from '@/server/servicos/tipos';

export type ValoresFormularioServico = {
  nome: string;
  preco: string;
  duracao: string;
  /** Ids marcados (preservados depois de um erro, com ou sem JavaScript). */
  profissionais: string[];
};

export type EstadoFormularioServico = {
  /** Erro geral (acesso negado, serviço não encontrado). */
  mensagem: string | null;
  /** Erros por campo (RN-1, RN-4, RN-10). */
  erros: ErrosServico;
  /** Valores devolvidos aos campos depois de um erro (aparados e cortados nos tetos). */
  valores: ValoresFormularioServico;
};

export const ESTADO_INICIAL_FORMULARIO_SERVICO: EstadoFormularioServico = Object.freeze({
  mensagem: null,
  erros: Object.freeze({}),
  valores: Object.freeze({ nome: '', preco: '', duracao: '', profissionais: [] as string[] }),
}) as EstadoFormularioServico;

export type EstadoSituacao = {
  variante: 'sucesso' | 'erro' | null;
  mensagem: string | null;
};

export const ESTADO_INICIAL_SITUACAO: EstadoSituacao = Object.freeze({ variante: null, mensagem: null }) as EstadoSituacao;
