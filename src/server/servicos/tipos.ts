// Contratos de entrada e resultado da gestão de serviços (D-014 §3.1). Arquivo SEM imports de
// servidor de runtime: os componentes cliente o importam (só tipos e constantes). Os resultados de
// negócio são discriminados por `resultado` dentro de `{ ok: true, dados }`; ErroDeDominio continua
// só com 401/403/404 (padrão D-14 da D-013).

export const LIMITES_SERVICO = Object.freeze({
  nome: Object.freeze({ min: 2, max: 100 }),
  /** R$ 99.999,99 (D-2). */
  precoMaxCentavos: 9_999_999,
  /** D-3: de 5 a 720 minutos, múltiplo de 5. */
  duracao: Object.freeze({ min: 5, max: 720, passo: 5 }),
  /** Teto da lista de profissionais recebida, antes da deduplicação. */
  profissionaisMax: 200,
  /** Teto do texto do preço (casca e campo). */
  precoMaxCaracteres: 20,
});

export type CampoServico = 'nome' | 'preco' | 'duracao' | 'profissionais' | 'formulario';
export type ErrosServico = Partial<Record<CampoServico, string>>;

/** Linha da lista do painel. */
export type ServicoResumo = {
  id: string;
  nome: string;
  precoCentavos: number;
  duracaoMin: number;
  ativo: boolean;
  /** Só profissionais ATIVOS do salão vinculados (CA-10). */
  profissionaisAtivos: number;
  /** ativo && profissionaisAtivos > 0 (RN-7): false com ativo → aviso do CA-14. */
  ofertavel: boolean;
};

export type ProfissionalOpcao = { id: string; nome: string; ativo: boolean; vinculado: boolean };

/** Página de edição: ativos (todos, marcados se vinculados) + inativos vinculados (D-5). */
export type ServicoEdicao = Omit<ServicoResumo, 'profissionaisAtivos'> & { profissionais: ProfissionalOpcao[] };

export type EntradaCriarServico = { nome: unknown; preco: unknown; duracao: unknown; profissionais: unknown };
export type EntradaEditarServico = EntradaCriarServico & { id: unknown };
export type EntradaIdServico = { id: unknown };

export type ResultadoSalvarServico =
  | { resultado: 'salvo'; servico: ServicoResumo }
  | { resultado: 'invalido'; erros: ErrosServico };
export type ResultadoSituacaoServico = { resultado: 'desativado' | 'reativado'; ofertavel: boolean };

export const MENSAGENS_SERVICO = Object.freeze({
  nome: 'Informe o nome (de 2 a 100 caracteres).',
  preco: 'Informe o preço em reais, de 0,00 a 99.999,99 (ex.: 80,00).',
  duracao: 'Informe a duração em minutos: múltiplo de 5, de 5 a 720.',
  profissionais: 'Escolha só profissionais ativos deste salão. Recarregue a página e tente de novo.',
  formulario: 'Não foi possível ler os dados enviados. Tente de novo.',
  ajudaPreco: 'Ex.: 80,00',
  semProfissional: 'Não aparece na página pública: nenhum profissional ativo executa este serviço.',
  desativado: 'Serviço desativado. Ele não aparece mais na página pública.',
  reativado: 'Serviço reativado.',
  naoEncontrado: 'Serviço não encontrado.',
  acessoNegado: 'Acesso negado.',
});
