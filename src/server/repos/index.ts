import { criarRepoCliente } from './cliente';
import type { RepoCliente } from './cliente';
import { obterPrisma } from './db';
import { criarRepoProfissional } from './profissional';
import type { RepoProfissional } from './profissional';
import { criarRepoReserva } from './reserva';
import type { RepoReserva } from './reserva';
import { criarRepoServico } from './servico';
import type { RepoServico } from './servico';
import type { Executor } from './transacao';

export type { RepoCliente, RepoProfissional, RepoReserva, RepoServico };

/** Repositórios de tenant: toda operação recebe ContextoEscopado e filtra salao_id (RN-8). */
export interface Repos {
  servicos: RepoServico;
  profissionais: RepoProfissional;
  clientes: RepoCliente;
  reservas: RepoReserva;
}

/** Conjunto ligado a um executor (cliente ou transação). Uso interno: emTransacao e repos(). */
export function criarRepos(db: Executor): Repos {
  return {
    servicos: criarRepoServico(db),
    profissionais: criarRepoProfissional(db),
    clientes: criarRepoCliente(db),
    reservas: criarRepoReserva(db),
  };
}

/** Conjunto ligado ao cliente padrão (DATABASE_URL, lida na chamada). */
export function repos(): Repos {
  return criarRepos(obterPrisma());
}
