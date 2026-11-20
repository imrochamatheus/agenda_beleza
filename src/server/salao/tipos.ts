// Contratos, limites e mensagens das configurações do salão (D-017 §3.2; RN-7..RN-19). Client-safe: só
// constantes e tipos, sem import de runtime de @/server/** (é importado por componentes cliente e pela
// casca). A validação está em validacao.ts; as opções de fuso, em fusos.ts (servidor).

/** D-1: grades permitidas, em minutos. */
export const GRADES_PERMITIDAS = Object.freeze([5, 10, 15, 20, 30, 60] as const);

export const LIMITES_SALAO = Object.freeze({
  /** = LIMITES_CADASTRO.nomeSalao (teste de igualdade). */
  nome: Object.freeze({ min: 2, max: 80 }),
  /** D-2: horas inteiras, gravadas × 60 em antecedencia_min. */
  antecedenciaHoras: Object.freeze({ min: 0, max: 72 }),
  /** D-3. */
  janelaDias: Object.freeze({ min: 1, max: 365 }),
  /** D-4. */
  intervaloMin: Object.freeze({ min: 0, max: 120 }),
  /** D-7. */
  slug: Object.freeze({ min: 3, max: 60 }),
  /** Texto numérico aparado com mais caracteres que isto → inválido. */
  numeroMaxCaracteres: 4,
  /** Slug acima disto nem é normalizado (nunca é igual ao atual). */
  slugMaxCaracteres: 200,
  /** Corte do valor devolvido para reexibição. */
  ecoMaxCaracteres: 200,
});

export type CampoRegras = 'nome' | 'fuso' | 'grade' | 'antecedencia' | 'janela' | 'intervalo';
export const CAMPOS_REGRAS: readonly CampoRegras[] = Object.freeze(['nome', 'fuso', 'grade', 'antecedencia', 'janela', 'intervalo']);
export type ErrosRegras = Partial<Record<CampoRegras, string>>;
/** Textos do formulário (o que a casca lê e o que volta para a tela). */
export type ValoresRegras = Record<CampoRegras, string>;
/** Chaves extras (salaoId…) são ignoradas. */
export type EntradaRegras = Partial<Record<CampoRegras, unknown>>;
export type EntradaSlug = { slug?: unknown };

/** Valores já validados, nas unidades do banco. */
export type RegrasSalao = {
  nome: string;
  fuso: string;
  gradeMin: number;
  antecedenciaMin: number;
  janelaDias: number;
  intervaloMin: number;
};

export type OpcaoFuso = { valor: string; rotulo: string };
export type OpcoesFuso = { atualForaDaLista: OpcaoFuso | null; brasil: OpcaoFuso[]; outros: OpcaoFuso[] };

export type ConfiguracoesSalao = {
  /** A partir do banco (antecedência em horas). */
  valores: ValoresRegras;
  fusos: OpcoesFuso;
  /** anteriores: por criado_em desc, slug asc. */
  slug: { atual: string; anteriores: string[] };
};

export type ResultadoSalvarRegras = { resultado: 'salvo'; valores: ValoresRegras } | { resultado: 'invalido'; erros: ErrosRegras };

export type ResultadoTrocarSlug =
  | { resultado: 'trocado'; slug: string }
  | { resultado: 'sem_efeito'; slug: string }
  | { resultado: 'invalido'; erros: { slug: string } };

export const MENSAGENS_CONFIGURACOES = Object.freeze({
  /** = MENSAGENS_CADASTRO.nomeSalao (teste). */
  nome: 'Informe o nome do salão (de 2 a 80 caracteres).',
  fuso: 'Escolha um fuso horário da lista.',
  grade: 'Escolha uma grade da lista: 5, 10, 15, 20, 30 ou 60 minutos.',
  antecedencia: 'Informe a antecedência mínima em horas inteiras, de 0 a 72.',
  antecedenciaJanela: 'A antecedência mínima precisa ser menor que a janela máxima.',
  janela: 'Informe a janela máxima em dias inteiros, de 1 a 365.',
  intervalo: 'Informe o intervalo em minutos inteiros, de 0 a 120.',
  slugFormato: 'Use de 3 a 60 caracteres: letras minúsculas sem acento, números e hífens entre eles.',
  slugReservado: 'Este endereço é reservado pelo sistema. Escolha outro.',
  slugEmUso: 'Este endereço já está em uso. Escolha outro.',
  resumoErros: 'Corrija os campos indicados para salvar.',
  regrasSalvas: 'Configurações salvas.',
  slugTrocado: 'Endereço público alterado. O endereço anterior continua levando ao salão.',
  slugSemEfeito: 'Este já é o endereço público do salão. Nada foi alterado.',
  ajudaFuso:
    'As jornadas continuam com os mesmos horários de relógio, agora no novo fuso. Bloqueios e reservas já marcados não mudam de instante e passam a ser exibidos no novo fuso.',
  ajudaRegras: 'As regras valem para os próximos horários oferecidos. Reservas já feitas não mudam.',
  ajudaSlug:
    'Letras minúsculas sem acento, números e hífens. Os endereços anteriores continuam levando ao salão e não podem ser usados por outro salão.',
  semAnteriores: 'Nenhum endereço anterior.',
  acessoNegado: 'Acesso negado.',
  formulario: 'Não foi possível ler os dados enviados. Recarregue a página e tente de novo.',
});
