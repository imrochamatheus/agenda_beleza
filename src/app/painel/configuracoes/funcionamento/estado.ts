// Estado e leitura do formulário do horário de funcionamento (D-020 §3.8). Só tipos e constantes
// client-safe (funcionamento-tipos e o editor de semana compartilhado): é importado por componentes cliente.
import { lerSemanaDoFormulario, valoresDaSemana } from '@/app/painel/_componentes/semana/formulario';
import type { ValoresSemana } from '@/app/painel/_componentes/semana/formulario';
import { DIAS_SEMANA } from '@/server/semana/tipos';
import type { SemanaHoraria } from '@/server/semana/tipos';
import type { EntradaFuncionamento, ErrosFuncionamento, Funcionamento, ModoFuncionamento } from '@/server/salao/funcionamento-tipos';

export type EstadoFuncionamento = {
  /** Erro geral (acesso negado, não encontrado). */
  mensagem: string | null;
  /** Mensagem de sucesso (sem PRG, A-9). */
  sucesso: string | null;
  erros: ErrosFuncionamento;
  /** Modo escolhido (o gravado, ou o enviado depois de um erro). */
  modo: ModoFuncionamento;
  /** Valores dos campos (preservados depois de um erro; canônicos depois de salvar). */
  valores: ValoresSemana;
  /** Depois de salvar: o funcionamento gravado, para os resumos dos dias (sem esperar a revalidação). */
  funcionamento?: Funcionamento;
};

/** Prefixo dos ids do funcionamento na página. */
export const PREFIXO_FUNCIONAMENTO = 'funcionamento';
/** Id do primeiro botão de opção (o resumo de erros aponta para ele). */
export const ID_MODO = 'funcionamento-modo';

/** Semana sem intervalos (resumos dos dias quando o funcionamento não foi informado). */
export const SEMANA_VAZIA: SemanaHoraria = Object.freeze(DIAS_SEMANA.map((diaSemana) => Object.freeze({ diaSemana, intervalos: [], pausas: [] })));

/** Valores dos campos a partir do funcionamento gravado (não informado → linhas vazias). */
export function valoresDoFuncionamento(f: Funcionamento): ValoresSemana {
  return valoresDaSemana(f.definido ? f.semana : SEMANA_VAZIA);
}

export function estadoFuncionamentoInicial(f: Funcionamento): EstadoFuncionamento {
  return { mensagem: null, sucesso: null, erros: {}, modo: f.definido ? 'informar' : 'nao_informar', valores: valoresDoFuncionamento(f) };
}

/**
 * Lê SÓ `modo` e os 7 × 6 × 2 horários (extras e arquivos ignorados). `entrada` vai para a validação do
 * servidor; `modo` é o enviado quando válido (senão 'nao_informar' para reexibição, com o erro de modo).
 */
export function lerFormularioFuncionamento(fd: FormData): { entrada: EntradaFuncionamento; modo: ModoFuncionamento; valores: ValoresSemana } {
  const bruto = fd.get('modo');
  const modoTexto = typeof bruto === 'string' ? bruto : undefined;
  const { dias, valores } = lerSemanaDoFormulario(fd);
  const modo: ModoFuncionamento = modoTexto === 'informar' ? 'informar' : 'nao_informar';
  return { entrada: { modo: modoTexto, dias }, modo, valores };
}
