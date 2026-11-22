// Contratos, limites e mensagens dos salões no painel do super admin (D-044, E8.2). Client-safe: só
// tipos e constantes, sem import de runtime de @/server/** (é importado por componentes cliente, pela
// casca e pela vitrine). A validação está em saloes-validacao.ts; as regras, em saloes.ts.
// Instantes que atravessam a fronteira ação → tela vão como ISO 8601 (texto): a tela os formata no fuso
// do salão por `format.ts`.
import type { EstadoAssinatura } from '@/domain/assinatura';
import type { CampoRegras } from '@/server/salao/tipos';

/** Estados do filtro. `encerrada` não aparece: só encerrada equivale a "Sem assinatura" (parecer do DBA). */
export const ESTADOS_FILTRO = Object.freeze([
  'pendente',
  'em_teste',
  'ativa',
  'em_carencia',
  'suspensa',
  'cancelada',
  'sem_assinatura',
] as const);
export type EstadoFiltro = (typeof ESTADOS_FILTRO)[number];

export const FILTROS_SUSPENSAO = Object.freeze(['todas', 'sim', 'nao'] as const);
export type FiltroSuspensao = (typeof FILTROS_SUSPENSAO)[number];

export type FiltrosSaloes = {
  /** Busca digitada (aparada, colapsada, até 80 pontos de código). */
  q: string;
  estado: EstadoFiltro | null;
  suspenso: FiltroSuspensao;
  pagina: number;
};

export const POR_PAGINA_SALOES = 20;

export type LinhaSalao = {
  id: string;
  nome: string;
  /** Endereço público ATUAL. */
  slug: string;
  /** Estado da assinatura vigente; null = sem assinatura. */
  estado: EstadoAssinatura | null;
  suspenso: boolean;
  gestorEmail: string | null;
};

export type ListaSaloes = {
  itens: LinhaSalao[];
  total: number;
  pagina: number;
  porPagina: number;
};

/** Dados do detalhe. Nunca carrega `provedor_assinatura_id`, hash de senha, TOTP nem token. */
export type DetalheSalao = {
  id: string;
  nome: string;
  slug: string;
  fuso: string;
  gradeMin: number;
  antecedenciaMin: number;
  janelaDias: number;
  intervaloMin: number;
  /** ISO 8601; null = não suspenso manualmente. */
  suspensoEm: string | null;
  gestor: { nome: string; email: string; confirmado: boolean } | null;
  assinatura: {
    estado: EstadoAssinatura;
    /** ISO 8601; só em teste. */
    testeFimEm: string | null;
    /** Há vínculo com o provedor (sem expor o identificador). */
    vinculada: boolean;
  } | null;
};

export const LIMITES_ADMIN_SALOES = Object.freeze({
  /** = LIMITES_CADASTRO.nome (teste de igualdade). */
  gestorNome: Object.freeze({ min: 2, max: 100 }),
  motivo: Object.freeze({ min: 5, max: 280 }),
  dias: Object.freeze({ min: 1, max: 90 }),
  /** Corte do valor devolvido para reexibição. */
  ecoMaxCaracteres: 200,
});

export const MOTIVO_MIN = LIMITES_ADMIN_SALOES.motivo.min;
export const MOTIVO_MAX = LIMITES_ADMIN_SALOES.motivo.max;
export const DIAS_MIN = LIMITES_ADMIN_SALOES.dias.min;
export const DIAS_MAX = LIMITES_ADMIN_SALOES.dias.max;
/** Folga mínima entre agora e o fim do teste para estendê-lo (S-4). */
export const FOLGA_TESTE_MS = 5 * 60_000;
export const DIA_MS = 24 * 60 * 60 * 1000;

export type CampoEdicao = CampoRegras | 'slug' | 'gestorNome' | 'gestorEmail';
export type ErrosEdicao = Partial<Record<CampoEdicao, string>>;

/** Texto dos campos do formulário de edição (o que a casca lê e o que volta para a tela). */
export type ValoresEdicao = Record<CampoEdicao, string>;

export type ResultadoEdicao =
  | { resultado: 'editado'; confirmacao?: 'enviado' | 'falhou' }
  | { resultado: 'sem_mudanca' }
  | { resultado: 'invalido' | 'conflito_slug' | 'email_em_uso'; erros: ErrosEdicao };

export type ResultadoSuspensao =
  | { resultado: 'previa'; motivo: string }
  | { resultado: 'suspenso' | 'reativado' | 'sem_efeito' }
  | { resultado: 'invalido'; erros: { motivo: string } };

export type MotivoRecusaExtensao =
  | 'sem_assinatura'
  | 'estado'
  | 'sem_provedor'
  | 'teste_encerrado'
  | 'teste_expirando';

export type ResultadoExtensao =
  | { resultado: 'previa'; de: string; para: string; dias: number }
  | { resultado: 'estendido'; de: string; para: string; dias: number }
  | { resultado: 'recusado'; motivo: MotivoRecusaExtensao }
  | { resultado: 'provedor_falhou' }
  | { resultado: 'mudou'; novoFim: string | null }
  | { resultado: 'divergencia' }
  | { resultado: 'invalido'; erros: { dias?: string; motivo?: string } };

export type EtapaDeConfirmacao = 'previa' | 'confirmar';

export const MENSAGENS_ADMIN_SALOES = Object.freeze({
  // Resultados
  salvo: 'Dados do salão salvos.',
  semMudanca: 'Nada mudou: os valores são os mesmos.',
  suspenso: 'Salão suspenso.',
  reativado: 'Salão reativado.',
  jaSuspenso: 'O salão já estava suspenso. Nada foi alterado.',
  naoSuspenso: 'O salão não estava suspenso. Nada foi alterado.',
  // Erros de campo
  motivo: 'Informe o motivo (5 a 280 caracteres).',
  motivoDadosPessoais: 'Não escreva telefone nem e-mail no motivo.',
  dias: 'Informe um número inteiro de 1 a 90.',
  emailEmUso: 'Este e-mail já é usado por outra conta.',
  gestorNome: 'Informe o nome do gestor (de 2 a 100 caracteres).',
  gestorEmail: 'Informe um e-mail válido.',
  resumoErros: 'Corrija os campos indicados para salvar.',
  formulario: 'Não foi possível ler os dados enviados. Recarregue a página e tente de novo.',
  acessoNegado: 'Acesso negado.',
  naoEncontrado: 'Salão não encontrado.',
  // Estender o teste: recusas
  recusaSemAssinatura: 'Este salão não tem assinatura.',
  recusaEstado: 'O teste só pode ser estendido enquanto a assinatura está em período de teste.',
  recusaSemProvedor: 'A assinatura não tem vínculo com o provedor.',
  recusaTesteEncerrado: 'O teste já terminou.',
  recusaTesteExpirando: 'O teste termina em menos de 5 minutos.',
  provedorFalhou: 'O provedor não refletiu o adiamento; nada foi alterado. Tente novamente mais tarde.',
  divergencia: 'O provedor adiou a cobrança, mas a assinatura mudou aqui. Nada foi gravado. Confira a situação com o provedor.',
  // Lista
  vazioTitulo: 'Nenhum salão encontrado.',
  vazioDescricao: 'Tente outro nome ou limpe os filtros.',
});

export const MENSAGEM_DE_RECUSA: Readonly<Record<MotivoRecusaExtensao, string>> = Object.freeze({
  sem_assinatura: MENSAGENS_ADMIN_SALOES.recusaSemAssinatura,
  estado: MENSAGENS_ADMIN_SALOES.recusaEstado,
  sem_provedor: MENSAGENS_ADMIN_SALOES.recusaSemProvedor,
  teste_encerrado: MENSAGENS_ADMIN_SALOES.recusaTesteEncerrado,
  teste_expirando: MENSAGENS_ADMIN_SALOES.recusaTesteExpirando,
});
