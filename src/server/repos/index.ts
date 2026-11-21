import { criarRepoBloqueio } from './bloqueio';
import type { RepoBloqueio } from './bloqueio';
import { criarRepoCliente } from './cliente';
import type { RepoCliente } from './cliente';
import { criarRepoConsentimento } from './consentimento';
import type { RepoConsentimento } from './consentimento';
import { obterPrisma } from './db';
import { criarRepoDisponibilidade } from './disponibilidade';
import type { RepoDisponibilidade } from './disponibilidade';
import { criarRepoFoto } from './foto';
import type { RepoFoto } from './foto';
import { criarRepoFuncionamento } from './funcionamento';
import type { RepoFuncionamento } from './funcionamento';
import { criarRepoJornada } from './jornada';
import type { RepoJornada } from './jornada';
import { criarRepoProfissional } from './profissional';
import type { RepoProfissional } from './profissional';
import { criarRepoReserva } from './reserva';
import type { RepoReserva } from './reserva';
import { criarRepoSalao } from './salao';
import type { RepoSalao } from './salao';
import { criarRepoServico } from './servico';
import type { RepoServico } from './servico';
import type { Executor } from './transacao';

export type { RepoBloqueio, RepoCliente, RepoConsentimento, RepoDisponibilidade, RepoFoto, RepoFuncionamento, RepoJornada, RepoProfissional, RepoReserva, RepoSalao, RepoServico };

/** Repositórios de tenant: toda operação recebe ContextoEscopado e filtra salao_id (RN-8). */
export interface Repos {
  servicos: RepoServico;
  profissionais: RepoProfissional;
  clientes: RepoCliente;
  /** Consentimento por finalidade, versionado (D-023). */
  consentimentos: RepoConsentimento;
  reservas: RepoReserva;
  jornadas: RepoJornada;
  bloqueios: RepoBloqueio;
  /** Configurações, slugs e perfil do próprio salão (D-017, D-020). */
  saloes: RepoSalao;
  /** Horário de funcionamento do salão (D-020). */
  funcionamento: RepoFuncionamento;
  /** Fotos do salão (D-021). */
  fotos: RepoFoto;
  /** Leituras de agenda para o cálculo de disponibilidade (D-018): aceita também PublicoContext. */
  disponibilidade: RepoDisponibilidade;
}

/** Conjunto ligado a um executor (cliente ou transação). Uso interno: emTransacao e repos(). */
export function criarRepos(db: Executor): Repos {
  return {
    servicos: criarRepoServico(db),
    profissionais: criarRepoProfissional(db),
    clientes: criarRepoCliente(db),
    consentimentos: criarRepoConsentimento(db),
    reservas: criarRepoReserva(db),
    jornadas: criarRepoJornada(db),
    bloqueios: criarRepoBloqueio(db),
    saloes: criarRepoSalao(db),
    funcionamento: criarRepoFuncionamento(db),
    fotos: criarRepoFoto(db),
    disponibilidade: criarRepoDisponibilidade(db),
  };
}

/** Conjunto ligado ao cliente padrão (DATABASE_URL, lida na chamada). */
export function repos(): Repos {
  return criarRepos(obterPrisma());
}
