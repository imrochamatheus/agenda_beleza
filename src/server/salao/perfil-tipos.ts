// Contratos, listas, limites e mensagens do perfil público do salão (D-020 §3.3; RN-4..RN-10).
// Client-safe: só constantes, tipos e funções puras, sem import de runtime de @/server/** (é importado
// por componentes cliente, pela casca e pela leitura pública). A validação está em perfil-validacao.ts.

/** RN-9 (D-8): chaves estáveis (gravadas, nunca renomeadas) e rótulos pt-BR (exibidos). */
export const MEIOS_PAGAMENTO = Object.freeze([
  { chave: 'dinheiro', rotulo: 'Dinheiro' },
  { chave: 'pix', rotulo: 'Pix' },
  { chave: 'cartao_credito', rotulo: 'Cartão de crédito' },
  { chave: 'cartao_debito', rotulo: 'Cartão de débito' },
  { chave: 'carteira_digital', rotulo: 'Carteira digital por aproximação' },
  { chave: 'vale_presente', rotulo: 'Vale-presente do salão' },
] as const);

export const COMODIDADES = Object.freeze([
  { chave: 'wifi', rotulo: 'Wi-Fi para clientes' },
  { chave: 'estacionamento', rotulo: 'Estacionamento' },
  { chave: 'acessibilidade', rotulo: 'Acesso para cadeira de rodas' },
  { chave: 'bebidas', rotulo: 'Café e bebidas' },
  { chave: 'criancas', rotulo: 'Atende crianças' },
  { chave: 'ar_condicionado', rotulo: 'Ar-condicionado' },
  { chave: 'animais', rotulo: 'Aceita animais de estimação' },
] as const);

export type ChaveMeioPagamento = (typeof MEIOS_PAGAMENTO)[number]['chave'];
export type ChaveComodidade = (typeof COMODIDADES)[number]['chave'];

/** RN-6: as 27 UFs. */
export const UFS = Object.freeze([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const);
export type Uf = (typeof UFS)[number];

export const LIMITES_PERFIL = Object.freeze({
  /** Unidades UTF-16 depois de normalizar (D-4); igual ao maxlength do navegador. */
  descricao: 1000,
  /** Acima disso → erro de descrição sem processar (anti-payload). */
  descricaoMaxBruta: 2000,
  logradouro: 120,
  numero: 10,
  complemento: 60,
  bairro: 80,
  cidade: 80,
  /** Campos de uma linha: acima disso → erro do campo sem processar. */
  textoMaxBruto: 200,
  instagram: 30,
  instagramMaxBruto: 200,
  /** Lista com mais itens → erro da lista. */
  itensListaMax: 20,
  /** Corte do valor devolvido para reexibição. */
  ecoMaxCaracteres: 200,
  ecoDescricaoMaxCaracteres: 2000,
});

/** Mantém só chaves conhecidas, sem repetição, na ordem da lista (RN-9). Puro. */
export function filtrarChaves<T extends string>(lista: readonly { chave: T }[], valores: readonly string[]): T[] {
  const presentes = new Set(valores);
  return lista.filter((item) => presentes.has(item.chave)).map((item) => item.chave);
}

export type CampoPerfil =
  | 'descricao'
  | 'logradouro'
  | 'numero'
  | 'complemento'
  | 'bairro'
  | 'cidade'
  | 'uf'
  | 'cep'
  | 'telefone'
  | 'whatsapp'
  | 'instagram'
  | 'meiosPagamento'
  | 'comodidades';
export type CampoTextoPerfil = Exclude<CampoPerfil, 'meiosPagamento' | 'comodidades'>;
/** Os 11 campos de texto, na ordem do formulário. */
export const CAMPOS_TEXTO_PERFIL: readonly CampoTextoPerfil[] = Object.freeze([
  'descricao',
  'logradouro',
  'numero',
  'complemento',
  'bairro',
  'cidade',
  'uf',
  'cep',
  'telefone',
  'whatsapp',
  'instagram',
]);
/** Ordem dos campos no formulário (resumo de erros). */
export const CAMPOS_PERFIL: readonly CampoPerfil[] = Object.freeze([...CAMPOS_TEXTO_PERFIL, 'meiosPagamento', 'comodidades']);

export type ErrosPerfil = Partial<Record<CampoPerfil, string>> & { formulario?: string };
/** Textos e listas do formulário (o que a casca lê e o que volta para a tela). */
export type ValoresPerfil = Record<CampoTextoPerfil, string> & { meiosPagamento: string[]; comodidades: string[] };
/** Chaves extras (salaoId…) são ignoradas. */
export type EntradaPerfil = Partial<Record<CampoPerfil, unknown>>;

export type Endereco = {
  logradouro: string;
  numero: string;
  complemento: string | null;
  bairro: string;
  cidade: string;
  uf: Uf;
  cep: string;
};

/** Perfil validado e normalizado (o que é gravado). */
export type PerfilSalao = {
  descricao: string | null;
  endereco: Endereco | null;
  telefoneE164: string | null;
  whatsappE164: string | null;
  instagram: string | null;
  meiosPagamento: ChaveMeioPagamento[];
  comodidades: ChaveComodidade[];
};

export type ResultadoSalvarPerfil = { resultado: 'salvo'; valores: ValoresPerfil } | { resultado: 'invalido'; erros: ErrosPerfil };

export const VALORES_PERFIL_VAZIOS: ValoresPerfil = Object.freeze({
  descricao: '',
  logradouro: '',
  numero: '',
  complemento: '',
  bairro: '',
  cidade: '',
  uf: '',
  cep: '',
  telefone: '',
  whatsapp: '',
  instagram: '',
  meiosPagamento: [],
  comodidades: [],
}) as ValoresPerfil;

export const MENSAGENS_PERFIL = Object.freeze({
  descricao: 'Use no máximo 1.000 caracteres na descrição.',
  descricaoCaracteres: 'A descrição tem caracteres não permitidos.',
  enderecoObrigatorio: 'Preencha este campo ou deixe o endereço todo em branco.',
  logradouro: 'Use até 120 caracteres, sem quebras de linha.',
  numero: 'Use até 10 caracteres, sem quebras de linha (ex.: 123, 123A ou s/n).',
  complemento: 'Use até 60 caracteres, sem quebras de linha.',
  bairro: 'Use até 80 caracteres, sem quebras de linha.',
  cidade: 'Use até 80 caracteres, sem quebras de linha.',
  uf: 'Escolha uma UF da lista.',
  cep: 'Informe o CEP com 8 dígitos (ex.: 01310-100).',
  telefone: 'Informe um telefone brasileiro com DDD (ex.: (11) 3456-7890 ou (11) 98765-4321).',
  instagram: 'Informe o perfil do Instagram (ex.: @meusalao).',
  lista: 'Escolha opções da lista.',
  resumoErros: 'Corrija os campos indicados para salvar o perfil.',
  salvo: 'Perfil público salvo.',
  demonstracao: 'Perfil válido (demonstração: nada foi gravado).',
  ajudaPublico: 'Tudo o que você preencher aqui aparece na página pública do salão, inclusive os telefones.',
  ajudaDescricao: 'Texto simples, sem formatação. As quebras de linha são mantidas.',
  formulario: 'Não foi possível ler os dados enviados. Recarregue a página e tente de novo.',
  acessoNegado: 'Acesso negado.',
});
