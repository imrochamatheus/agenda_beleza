import { criarRepoBloqueio } from './bloqueio';
import type { RepoBloqueio } from './bloqueio';
import { criarRepoCliente } from './cliente';
import type { RepoCliente } from './cliente';
import { obterPrisma } from './db';
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

export type { RepoBloqueio, RepoCliente, RepoFuncionamento, RepoJornada, RepoProfissional, RepoReserva, RepoSalao, RepoServico };

/** Repositórios de tenant: toda operação recebe ContextoEscopado e filtra salao_id (RN-8). */
export interface Repos {
  servicos: RepoServico;
  profissionais: RepoProfissional;
  clientes: RepoCliente;
  reservas: RepoReserva;
  jornadas: RepoJornada;
  bloqueios: RepoBloqueio;
  /** Configurações, slugs e perfil do próprio salão (D-017, D-020). */
  saloes: RepoSalao;
  /** Horário de funcionamento do salão (D-020). */
  funcionamento: RepoFuncionamento;
}

/** Conjunto ligado a um executor (cliente ou transação). Uso interno: emTransacao e repos(). */
export function criarRepos(db: Executor): Repos {
  return {
    servicos: criarRepoServico(db),
    profissionais: criarRepoProfissional(db),
    clientes: criarRepoCliente(db),
    reservas: criarRepoReserva(db),
    jornadas: criarRepoJornada(db),
    bloqueios: criarRepoBloqueio(db),
    saloes: criarRepoSalao(db),
    funcionamento: criarRepoFuncionamento(db),
  };
}

/** Conjunto ligado ao cliente padrão (DATABASE_URL, lida na chamada). */
export function repos(): Repos {
  return criarRepos(obterPrisma());
}
