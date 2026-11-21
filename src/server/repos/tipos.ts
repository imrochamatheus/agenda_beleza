import type {
  EstadoMensagem as EstadoMensagemPrisma,
  OrigemReserva as OrigemReservaPrisma,
  PapelUsuario as PapelUsuarioPrisma,
  StatusReserva as StatusReservaPrisma,
  TipoMensagem as TipoMensagemPrisma,
} from '@/generated/prisma/enums';
import type { Finalidade } from '@/config/termos';
import type { Papel } from '@/server/tenant/context';

/**
 * DTOs dos repositórios de tenant e uniões literais usáveis fora de repos/** (S-6a: fora daqui só
 * `import type` do Prisma é permitido). Os DTOs não expõem salaoId: o chamador já o conhece pelo
 * contexto (D-005 §3.4, item 5).
 */
export type StatusReserva = 'confirmado' | 'cancelado' | 'concluido' | 'nao_compareceu';
export type OrigemReserva = 'publico' | 'equipe';
export type OrigemConsentimentoDTO = 'publico' | 'equipe';

// Asserções de tipo: as uniões são exatamente os enums do Prisma (o typecheck falha se divergirem).
type Igual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Verdadeiro<T extends true> = T;
export type StatusReservaEquivaleAoEnum = Verdadeiro<Igual<StatusReserva, StatusReservaPrisma>>;
export type OrigemReservaEquivaleAoEnum = Verdadeiro<Igual<OrigemReserva, OrigemReservaPrisma>>;
/** `Papel` (tenant/context.ts) fica sem importar o Prisma; a equivalência é conferida aqui. */
export type PapelEquivaleAoEnum = Verdadeiro<Igual<Papel, PapelUsuarioPrisma>>;

export type ServicoDTO = {
  id: string;
  nome: string;
  precoCentavos: number;
  duracaoMin: number;
  ativo: boolean;
  criadoEm: Date;
  atualizadoEm: Date;
};

/** Dados editáveis do serviço (D-014 RN-1), já validados. */
export type DadosServico = { nome: string; precoCentavos: number; duracaoMin: number };

/** Serviço para o painel do gestor (D-014 §3.2): com a contagem de profissionais ATIVOS vinculados. */
export type ServicoPainelDTO = ServicoDTO & { profissionaisAtivos: number };

/** Profissional na escolha de vínculos do serviço (D-014 D-5). */
export type ProfissionalVinculoDTO = { id: string; nome: string; ativo: boolean; vinculado: boolean };

export type ProfissionalDTO = {
  id: string;
  nome: string;
  email: string | null;
  usuarioId: string | null;
  ativo: boolean;
  criadoEm: Date;
  atualizadoEm: Date;
};

/** Usuário vinculado a um perfil de profissional (convite aceito ou o gestor que atende). */
export type VinculoProfissional = { papel: 'gestor' | 'profissional'; emailLogin: string };

/** Profissional para o painel do gestor (D-013 §3.2): inclui o vínculo, sem a senha. */
export type ProfissionalPainelDTO = ProfissionalDTO & { vinculo: VinculoProfissional | null };

/** Resultado da trava FOR UPDATE do profissional: estado atual e dados para as regras, numa consulta. */
export type TravaProfissional = {
  id: string;
  usuarioId: string | null;
  ativo: boolean;
  email: string | null;
  papelUsuario: 'gestor' | 'profissional' | null;
  fusoSalao: string;
};

/** Reserva confirmada que impede a desativação do profissional (D-013 RN-2). */
export type ReservaBloqueanteDTO = {
  id: string;
  inicio: Date;
  fim: Date;
  /** null = cliente anonimizada. */
  clienteNome: string | null;
  /** Nomes atuais dos serviços, na ordem dos itens (D-13). */
  servicos: string[];
};

/** Anonimizada: nome e telefone nulos e anonimizadaEm preenchido (a UI mostra "cliente removida"). */
export type ClienteDTO = {
  id: string;
  nome: string | null;
  telefoneE164: string | null;
  anonimizadaEm: Date | null;
  criadoEm: Date;
  atualizadoEm: Date;
};

/** Linha de consentimento (D-023): finalidade, origem, versão aceita e instante UTC. */
export type ConsentimentoDTO = {
  id: string;
  finalidade: Finalidade;
  origem: OrigemConsentimentoDTO;
  versaoTermos: string;
  criadoEm: Date;
};

/** Reserva no histórico da cliente (D-022 §3.3): nomes atuais, preço e duração do snapshot dos itens. */
export type ReservaHistoricoDTO = {
  id: string;
  inicio: Date;
  status: StatusReserva;
  profissionalNome: string;
  itens: { servicoNome: string; ordem: number; precoCentavos: number; duracaoMin: number }[];
};

export type ReservaItemDTO = {
  servicoId: string;
  ordem: number;
  precoCentavos: number;
  duracaoMin: number;
};

export type ReservaDTO = {
  id: string;
  profissionalId: string;
  clienteId: string;
  inicio: Date;
  fim: Date;
  ocupadoAte: Date;
  status: StatusReserva;
  origem: OrigemReserva;
  encaixe: boolean;
  revisao: number;
  itens: ReservaItemDTO[];
};

/** Período semiaberto [de, ate) (sobre `reserva.inicio` em listarPorPeriodo; intersecção nos demais usos). */
export type Periodo = { de: Date; ate: Date };

/** Linha de `jornada` (D-015 §3.2): hora local de parede em minutos do dia, 0 = domingo. */
export type JornadaLinhaDTO = { id: string; diaSemana: number; inicioMin: number; fimMin: number };

/** Profissional travado/buscado para a jornada (D-015 §3.2). Não filtra `ativo` (RN-13). */
export type TravaJornada = { id: string; nome: string; ativo: boolean };

/** Linha de `bloqueio` (D-016 §3.3) com o profissional (null = salão inteiro). */
export type BloqueioDTO = {
  id: string;
  profissionalId: string | null;
  inicio: Date;
  fim: Date;
  motivo: string | null;
  profissional: { id: string; nome: string; ativo: boolean } | null;
};

/** Profissional como alvo de bloqueio (ativo ou inativo, D-016 RN-14). */
export type ProfissionalAlvoDTO = { id: string; nome: string; ativo: boolean };

/** Reserva confirmada sob um bloqueio (D-016 RN-8). O telefone nunca é lido. */
export type ReservaCobertaDTO = {
  id: string;
  profissionalId: string;
  profissionalNome: string;
  inicio: Date;
  fim: Date;
  /** null = cliente anonimizada. */
  clienteNome: string | null;
};

/** Dados de um bloqueio já validados e convertidos para UTC. */
export type DadosBloqueio = { profissionalId: string | null; inicio: Date; fim: Date; motivo: string | null };

/** `todos` → salão inteiro + todos os profissionais; `profissionalId` → os dele + os do salão inteiro. */
export type FiltroBloqueios = { todos: true } | { profissionalId: string };

/** Configurações do salão (D-017 §3.3), nas unidades do banco (antecedência em minutos). */
export type ConfiguracoesDTO = {
  nome: string;
  fuso: string;
  gradeMin: number;
  antecedenciaMin: number;
  janelaDias: number;
  intervaloMin: number;
};

/** Slug atual (exatamente um) e anteriores (atual = false), por criado_em desc, slug asc. */
export type SlugsDoSalaoDTO = { atual: string; anteriores: { slug: string; criadoEm: Date }[] };

/** Resultado da troca de slug no banco: `em_uso` = de outro salão, nada gravado. */
export type ResultadoTrocaSlugDTO = 'trocado' | 'em_uso';

/** Colunas do perfil público do salão (D-020 §3.5). Listas cruas do banco (podem ter chave fora da lista). */
export type PerfilDTO = {
  descricao: string | null;
  enderecoLogradouro: string | null;
  enderecoNumero: string | null;
  enderecoComplemento: string | null;
  enderecoBairro: string | null;
  enderecoCidade: string | null;
  enderecoUf: string | null;
  enderecoCep: string | null;
  telefoneE164: string | null;
  whatsappE164: string | null;
  instagram: string | null;
  meiosPagamento: string[];
  comodidades: string[];
};

/** Linha de `salao_funcionamento` (D-020 §3.5): hora local de parede em minutos do dia, 0 = domingo. */
export type FuncionamentoLinhaDTO = { id: string; diaSemana: number; inicioMin: number; fimMin: number };

/** Leitura consistente do funcionamento (um comando). `linhas` é sempre [] quando definido = false (RN-13). */
export type FuncionamentoDTO = { definido: boolean; linhas: { diaSemana: number; inicioMin: number; fimMin: number }[] };

// ---------------------------------------------------------------------------
// Mensagens de WhatsApp (D-024 §3.4, §3.5). Declarados aqui para os repositórios não importarem
// src/server/mensagens; as uniões são conferidas contra os enums do Prisma.
// ---------------------------------------------------------------------------

export type TipoMensagemDTO = 'confirmacao' | 'remarcacao' | 'cancelamento' | 'convite_avaliacao';
export type EstadoMensagemDTO =
  | 'pendente'
  | 'enviando'
  | 'enviada'
  | 'falhou'
  | 'nao_enviada'
  | 'substituida'
  | 'cancelada_anonimizacao';
export type TipoMensagemEquivaleAoEnum = Verdadeiro<Igual<TipoMensagemDTO, TipoMensagemPrisma>>;
export type EstadoMensagemEquivaleAoEnum = Verdadeiro<Igual<EstadoMensagemDTO, EstadoMensagemPrisma>>;

/** Estados em que uma mensagem pode nascer (RN-8). */
export type EstadoInicialMensagem = 'pendente' | 'nao_enviada' | 'cancelada_anonimizacao';

/** Mensagem a gravar no registro: só `pendente` leva o telefone (RN-15). */
export type NovaMensagem = {
  reservaId: string;
  tipo: TipoMensagemDTO;
  revisao: number;
  estado: EstadoInicialMensagem;
  erroCodigo: string | null;
  destinatarioE164: string | null;
};

/** Linha de `mensagem` sem destinatário, parâmetros nem id do provedor. */
export type MensagemLinhaDTO = {
  id: string;
  reservaId: string;
  tipo: TipoMensagemDTO;
  revisao: number;
  estado: EstadoMensagemDTO;
  erroCodigo: string | null;
};

/** Reserva, cliente e consentimentos lidos num comando, com a cliente travada FOR KEY SHARE. */
export type ContextoDeRegistroDTO = {
  reservaRevisao: number;
  reservaStatus: StatusReserva;
  clienteAnonimizada: boolean;
  telefone: string | null;
  consentimentoMensagens: boolean;
  consentimentoConvite: boolean;
};

/** Parâmetros de conferência de vigência (RN-16), puros, injetados pelo serviço. */
export type ConferirVigenciaFn = (
  tipo: TipoMensagemDTO,
  m: { revisao: number },
  r: { revisao: number; status: StatusReserva },
) => 'vigente' | 'obsoleta';

export type ResultadoReenvioRepo =
  | { resultado: 'reenfileirada'; mensagemId: string; reservaId: string; tipo: TipoMensagemDTO; revisao: number }
  | { resultado: 'recusada'; motivo: 'nao_falhou' | 'obsoleta' | 'cliente_anonimizada' };

/** Situação de envio (RN-23): nunca destinatário, parâmetros nem provedor. */
export type MensagemDaReservaRepoDTO = {
  id: string;
  tipo: TipoMensagemDTO;
  revisao: number;
  estado: EstadoMensagemDTO;
  enviadaEm: Date | null;
  erroCodigo: string | null;
  tentativas: number;
  ultimaTentativaEm: Date | null;
};

/** Tudo que o envio lê da reserva no mesmo comando (A-5): sem trava. */
export type ContextoDeEnvio = {
  tipo: TipoMensagemDTO;
  mensagemRevisao: number;
  reservaId: string;
  reserva: { revisao: number; status: StatusReserva; inicio: Date };
  salaoNome: string;
  fuso: string;
  profissionalNome: string | null;
  /** Nomes atuais dos serviços, na ordem dos itens. */
  servicos: string[];
  clienteAnonimizada: boolean;
  telefone: string | null;
  consentimentoMensagens: boolean;
  consentimentoConvite: boolean;
};

/** Decisão pura tomada dentro de T1 (elegibilidade + vigência), recebida por callback. */
export type DecisaoDeEnvio =
  | { acao: 'enviar' }
  | { acao: 'terminal'; estado: 'nao_enviada' | 'cancelada_anonimizacao' | 'substituida'; erroCodigo: string | null };

export type ResultadoInicio =
  | { resultado: 'nao_reivindicada' }
  | {
      resultado: 'terminal';
      estado: 'nao_enviada' | 'cancelada_anonimizacao' | 'substituida';
      erroCodigo: string | null;
      tipo: TipoMensagemDTO;
      revisao: number;
    }
  | {
      resultado: 'enviar';
      tentativaId: string;
      numero: number;
      destinatarioE164: string;
      tipo: TipoMensagemDTO;
      revisao: number;
      reservaId: string;
      contexto: ContextoDeEnvio;
    };

/** Fechamento de uma tentativa (T2). `erroDetalhe` é um texto fixo por classe, nunca a mensagem do erro. */
export type ConclusaoEnvio =
  | { resultado: 'sucesso'; provedorMensagemId: string }
  | { resultado: 'falha'; estadoFinal: 'pendente' | 'falhou'; erroCodigo: string; erroDetalhe: string };
