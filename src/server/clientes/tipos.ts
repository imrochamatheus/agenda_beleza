// Contratos client-safe da manutenção de clientes (D-022 §3.1). Sem imports de servidor de runtime:
// é importado por componentes cliente, pelas telas e por E3.x/E5.2.
import type { StatusReserva } from '@/server/repos/tipos';

/** RN-17: texto exibido onde a cliente foi anonimizada (E5.2/E3.3 importam daqui, nunca copiam). */
export const TEXTO_CLIENTE_REMOVIDA = 'cliente removida';

export const LIMITES_CLIENTE = {
  nomeMin: 2,
  nomeMax: 100,
  buscaMax: 80,
  porPagina: 20,
  historicoMax: 50,
} as const;

export const MENSAGENS_CLIENTE = {
  telefone: 'Informe um telefone brasileiro com DDD, por exemplo (11) 98765-4321.',
  nomeObrigatorio: 'Informe o nome da cliente.',
  nomeTamanho: 'O nome deve ter de 2 a 100 caracteres, em uma linha.',
  telefoneEmUso: 'Este telefone já pertence a outra cliente do salão.',
  resumoErros: 'Corrija os campos indicados para salvar.',
  salva: 'Cliente atualizada.',
  semAlteracao: 'Nenhuma alteração para salvar.',
  acessoNegado: 'Você não tem permissão para alterar clientes.',
  naoEncontrado: 'Cliente não encontrada.',
  nenhumaEncontrada: 'Nenhuma cliente encontrada.',
  semAgendamentos: 'Nenhum agendamento ainda.',
  removida: 'Cliente removida',
} as const;

export type ErrosCliente = { telefone?: string; nome?: string };
export type CampoCliente = keyof ErrosCliente;

export type EntradaUpsertCliente = { telefone: unknown; nome: unknown };
export type ResultadoUpsertCliente =
  | { resultado: 'ok'; cliente: { id: string; nome: string; telefoneE164: string }; criada: boolean }
  | { resultado: 'invalido'; erros: ErrosCliente };

export type EntradaEditarCliente = { id: unknown; nome: unknown; telefone: unknown };

/** nome/telefone nulos = cliente anonimizada (a UI mostra TEXTO_CLIENTE_REMOVIDA). */
export type ClienteVisao = {
  id: string;
  nome: string | null;
  /** E.164 gravado (valor do campo de edição); null se anonimizada. */
  telefone: string | null;
  telefoneFormatado: string | null;
  anonimizada: boolean;
};

export type ResultadoEditarCliente =
  | { resultado: 'ok'; cliente: ClienteVisao; alterada: boolean }
  | { resultado: 'invalido'; erros: ErrosCliente }
  | { resultado: 'recusado'; motivo: 'telefone_em_uso'; existente: { id: string; nome: string } };

/** Rótulos pt-BR dos status de reserva (A-7). */
export const ROTULO_STATUS: Readonly<Record<StatusReserva, string>> = Object.freeze({
  confirmado: 'Confirmado',
  cancelado: 'Cancelado',
  concluido: 'Concluído',
  nao_compareceu: 'Não compareceu',
});

export type StatusRotulo = (typeof ROTULO_STATUS)[StatusReserva];

/** Um serviço (item) de uma reserva do histórico (D-050 RN-35/RN-38): cancelados aparecem, com o preço. */
export type ServicoHistorico = {
  servico: string;
  profissional: string;
  /** Hora de início do item no fuso do salão (`formatarHora`). */
  horaLocal: string;
  status: StatusRotulo;
  cancelado: boolean;
  preco: string;
};

export type ItemHistorico = {
  id: string;
  /** Data e hora do início da reserva (envelope derivado) no fuso do salão (`formatarDataHora`). */
  inicioLocal: string;
  /** Status DERIVADO da reserva (D-050 A-1). */
  status: StatusRotulo;
  /** Itens por (inicio, id). */
  servicos: ServicoHistorico[];
  /** RN-35: soma dos itens não cancelados; reserva toda cancelada → soma de todos. */
  precoTotal: string;
  /** true quando todos os itens estão cancelados (o total é o "da cancelada"). */
  totalDaCancelada: boolean;
};

export type ListaClientes = { itens: ClienteVisao[]; total: number; pagina: number; porPagina: number; q: string };
export type DetalheCliente = { cliente: ClienteVisao; historico: ItemHistorico[]; totalReservas: number };
export type ContatoCliente = { id: string; nome: string | null; telefoneE164: string | null; anonimizada: boolean };

/** D-031: anonimização (exclusão LGPD) da cliente. Textos únicos da confirmação e dos avisos. */
export const TEXTO_CONFIRMACAO_EXCLUSAO = {
  titulo: 'Excluir cliente',
  oQueAcontece: [
    'O nome e o telefone da cliente serão apagados e não poderão ser recuperados.',
    'Os agendamentos e o histórico serão mantidos, identificados como "cliente removida".',
    'Esta ação é irreversível.',
    'A cliente não receberá mais avisos do salão: mensagens pendentes serão canceladas.',
  ],
  confirmar: 'Confirmar exclusão',
  cancelar: 'Cancelar',
} as const;

export const MENSAGENS_EXCLUSAO = {
  ok: 'Cliente excluída: os dados pessoais foram removidos e o histórico foi mantido.',
  jaAnonimizada: 'Esta cliente já havia sido excluída.',
  acessoNegado: 'Você não tem permissão para excluir clientes.',
  naoEncontrado: 'Cliente não encontrada.',
} as const;

export type EntradaAnonimizarCliente = { clienteId: unknown };

export type ResultadoAnonimizar =
  | { resultado: 'anonimizada'; canceladas: number }
  | { resultado: 'recusado'; motivo: 'ja_anonimizada' };

/** Valores aceitos de `?exclusao=` (D-031): qualquer outro é ignorado. */
export function mensagemDeExclusao(codigo: unknown): { variante: 'sucesso' | 'info' | 'erro'; texto: string } | null {
  if (codigo === 'ok') return { variante: 'sucesso', texto: MENSAGENS_EXCLUSAO.ok };
  if (codigo === 'ja_anonimizada') return { variante: 'info', texto: MENSAGENS_EXCLUSAO.jaAnonimizada };
  if (codigo === 'negado') return { variante: 'erro', texto: MENSAGENS_EXCLUSAO.acessoNegado };
  return null;
}
