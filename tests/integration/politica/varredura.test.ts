/// <reference types="vite/client" />
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { TABELA_CAPACIDADES } from '@/domain/assinatura';
import type { Capacidade } from '@/server/tenant/context';
import { metadadosDaAcao } from '@/server/tenant/define-acao';
import type { Acao } from '@/server/tenant/define-acao';

import { credencialDoGestor, credencialDoProfissional } from '../../support/auth';
import { criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { aplicarSituacao, impressaoDoSalao } from '../../support/politica';
import type { SituacaoDeTeste } from '../../support/politica';
import { conectar } from '../../support/sql';

// D-038 CA-2, CA-6, CA-8, CA-R2, CA-10: varredura do registro de ações. Cada exportação de
// `src/**/*.acao.ts` de salão é executada com sessão real em cada situação do salão: negada
// (`{ ok:false, erro:'acesso_negado', status:403 }`, sem alterar nada) se e somente se a capacidade
// declarada é negada pela tabela naquela situação. O oráculo da expectativa está escrito aqui (não lido da
// tabela) e um teste à parte o confere com a tabela única.

const ACESSO_NEGADO = { ok: false, erro: 'acesso_negado', status: 403 } as const;
const modulos = import.meta.glob<Record<string, unknown>>('/src/**/*.acao.ts', { eager: true });

const LEU_O_CORPO = vi.fn();
// Entrada mínima por ação (`arquivo#exportação`). A política decide antes do handler, então a entrada só
// precisa existir; uma ação nova sem entrada cadastrada reprova a varredura (CA-8).
const ENTRADA_VAZIA = {};
const ENTRADAS: Record<string, unknown> = {
  'bloqueios/bloqueios.acao.ts#criarBloqueio': ENTRADA_VAZIA,
  'bloqueios/bloqueios.acao.ts#editarBloqueio': ENTRADA_VAZIA,
  'bloqueios/bloqueios.acao.ts#removerBloqueio': ENTRADA_VAZIA,
  'clientes/clientes.acao.ts#editarCliente': ENTRADA_VAZIA,
  'clientes/clientes.acao.ts#anonimizarCliente': ENTRADA_VAZIA,
  'convites/convites.acao.ts#convidarProfissional': ENTRADA_VAZIA,
  'fotos/fotos.acao.ts#enviarFoto': {
    obterCorpo: async () => {
      LEU_O_CORPO();
      throw new Error('o corpo não deve ser lido');
    },
  },
  'fotos/fotos.acao.ts#editarAltDaFoto': ENTRADA_VAZIA,
  'fotos/fotos.acao.ts#moverFoto': ENTRADA_VAZIA,
  'fotos/fotos.acao.ts#removerFoto': ENTRADA_VAZIA,
  'jornadas/jornadas.acao.ts#salvarJornada': ENTRADA_VAZIA,
  'profissionais/profissionais.acao.ts#criarProfissional': ENTRADA_VAZIA,
  'profissionais/profissionais.acao.ts#editarProfissional': ENTRADA_VAZIA,
  'profissionais/profissionais.acao.ts#desativarProfissional': ENTRADA_VAZIA,
  'profissionais/profissionais.acao.ts#reativarProfissional': ENTRADA_VAZIA,
  'profissionais/profissionais.acao.ts#euTambemAtendo': ENTRADA_VAZIA,
  'reservas/reservas-equipe.acao.ts#criarReservaManual': ENTRADA_VAZIA,
  'reservas/reservas-status.acao.ts#remarcarReservaAcao': ENTRADA_VAZIA,
  'reservas/reservas-status.acao.ts#cancelarReservaAcao': ENTRADA_VAZIA,
  'reservas/reservas-status.acao.ts#marcarStatusReservaAcao': ENTRADA_VAZIA,
  'salao/configuracoes.acao.ts#salvarConfiguracoes': ENTRADA_VAZIA,
  'salao/configuracoes.acao.ts#trocarSlugDoSalao': ENTRADA_VAZIA,
  'salao/funcionamento.acao.ts#salvarFuncionamentoDoSalao': ENTRADA_VAZIA,
  'salao/perfil.acao.ts#salvarPerfilDoSalao': ENTRADA_VAZIA,
  'servicos/servicos.acao.ts#criarServico': ENTRADA_VAZIA,
  'servicos/servicos.acao.ts#editarServico': ENTRADA_VAZIA,
  'servicos/servicos.acao.ts#desativarServico': ENTRADA_VAZIA,
  'servicos/servicos.acao.ts#reativarServico': ENTRADA_VAZIA,
};

type Registro = { chave: string; acao: Acao<unknown, unknown>; capacidade: Capacidade; papeis: readonly string[] };

const todasAsAcoes: Registro[] = Object.entries(modulos).flatMap(([arquivo, modulo]) =>
  Object.entries(modulo).flatMap(([exportacao, valor]) => {
    const meta = metadadosDaAcao(valor);
    if (meta === undefined || (meta as { tipo?: unknown }).tipo === 'admin') return [];
    return [
      {
        chave: `${arquivo.replace('/src/server/', '')}#${exportacao}`,
        acao: valor as Acao<unknown, unknown>,
        capacidade: meta.capacidade,
        papeis: meta.papeis,
      },
    ];
  }),
);

// D-040: as ações de capacidade `assinatura` (iniciarAssinatura) ficam fora da varredura porque o handler
// cria a assinatura `pendente` e mudaria a situação do salão compartilhado entre os casos. Elas valem em
// QUALQUER situação (conferido na tabela abaixo) e o comportamento está em tests/integration/assinatura/.
const acoesDeAssinatura = todasAsAcoes.filter((a) => a.capacidade === 'assinatura');
const acoesDeSalao = todasAsAcoes.filter((a) => a.capacidade !== 'assinatura');

/** Oráculo explícito: o que cada situação nega entre as capacidades de salão em uso. */
const NEGADAS: Record<string, readonly Capacidade[]> = {
  suspensa: ['configurar', 'agendar'],
  encerrada: ['configurar', 'agendar'],
  manual: ['configurar', 'agendar'],
  cancelada_vencida: ['configurar', 'agendar'],
  pendente: ['agendar'],
  em_teste: [],
  ativa: [],
  em_carencia: [],
  cancelada: [],
  sem_assinatura: [],
};
const SITUACOES = Object.keys(NEGADAS) as SituacaoDeTeste[];

let c: pg.Client;
const saloes = new Map<string, SalaoCompleto>();

beforeAll(async () => {
  c = await conectar();
  for (const situacao of SITUACOES) {
    const s = await criarSalaoCompleto();
    await aplicarSituacao(s.salaoId, situacao);
    saloes.set(situacao, s);
  }
});
afterAll(async () => {
  await c.end();
});

describe('registro de ações (CA-8)', () => {
  it('toda ação de salão tem entrada cadastrada e toda entrada cadastrada existe', () => {
    expect(acoesDeSalao.map((a) => a.chave).sort()).toEqual(Object.keys(ENTRADAS).sort());
  });

  it('o registro não é vazio e só usa capacidades que o oráculo conhece', () => {
    expect(acoesDeSalao.length).toBeGreaterThanOrEqual(27);
    expect(new Set(acoesDeSalao.map((a) => a.capacidade))).toEqual(new Set(['configurar', 'agendar', 'cancelar', 'lgpd']));
  });

  it('a capacidade `assinatura` vale em toda situação e só o gestor a usa (D-040)', () => {
    expect(acoesDeAssinatura.map((a) => a.chave)).toEqual(['assinatura/assinatura.acao.ts#iniciarAssinatura']);
    for (const [situacao, caps] of Object.entries(TABELA_CAPACIDADES)) {
      expect(caps.assinatura, situacao).toBe(true);
    }
    expect(acoesDeAssinatura[0].papeis).toEqual(['gestor']);
  });

  it('o oráculo desta varredura coincide com a tabela única (TABELA_CAPACIDADES)', () => {
    const equivalente: Record<string, keyof typeof TABELA_CAPACIDADES> = {
      suspensa: 'suspensa', encerrada: 'encerrada', manual: 'manual', cancelada_vencida: 'encerrada', pendente: 'pendente',
      em_teste: 'em_teste', ativa: 'ativa', em_carencia: 'em_carencia', cancelada: 'cancelada', sem_assinatura: 'sem_assinatura',
    };
    for (const [situacao, negadas] of Object.entries(NEGADAS)) {
      const tabela = TABELA_CAPACIDADES[equivalente[situacao]];
      for (const cap of ['configurar', 'agendar', 'cancelar', 'lgpd'] as const) {
        expect(!tabela[cap], `${situacao}/${cap}`).toBe(negadas.includes(cap));
      }
    }
  });
});

describe.each(SITUACOES)('salão em %s: cada ação segue a capacidade declarada (CA-2, CA-6, CA-R2, CA-10)', (situacao) => {
  it.each(acoesDeSalao.map((a) => [a.chave, a] as const))('%s', async (_chave, a) => {
    const s = saloes.get(situacao)!;
    const negada = NEGADAS[situacao].includes(a.capacidade);
    const antes = await impressaoDoSalao(c, s.salaoId);
    LEU_O_CORPO.mockClear();
    const cred = await credencialDoGestor(s);

    let resultado: unknown;
    try {
      resultado = await a.acao.executar(cred, ENTRADAS[a.chave]);
    } catch {
      resultado = 'handler_executou'; // passou pela política e o handler falhou com a entrada mínima
    }

    if (negada) {
      expect(resultado).toEqual(ACESSO_NEGADO);
      expect(LEU_O_CORPO).not.toHaveBeenCalled();
      expect(await impressaoDoSalao(c, s.salaoId)).toEqual(antes);
    } else {
      expect(resultado).not.toEqual(ACESSO_NEGADO);
    }
  });
});

describe('profissional (bloqueios) no salão somente leitura', () => {
  it.each(['criarBloqueio', 'editarBloqueio', 'removerBloqueio'])('%s: 403 e nada muda', async (nome) => {
    const registro = acoesDeSalao.find((a) => a.chave === `bloqueios/bloqueios.acao.ts#${nome}`)!;
    expect(registro.papeis).toContain('profissional');
    for (const situacao of ['suspensa', 'manual']) {
      const s = saloes.get(situacao)!;
      const antes = await impressaoDoSalao(c, s.salaoId);
      const r = await registro.acao.executar(await credencialDoProfissional(s), {});
      expect(r).toEqual(ACESSO_NEGADO);
      expect(await impressaoDoSalao(c, s.salaoId)).toEqual(antes);
    }
  });
});

describe('entrada válida: a recusa vem da política, não de entrada inválida (CA-6)', () => {
  const nova = { nome: 'Hidratação', preco: '80,00', duracao: '45', profissionais: [] };
  const criar = acoesDeSalao.find((a) => a.chave === 'servicos/servicos.acao.ts#criarServico')!;

  it('suspenso: 403 e nenhum serviço criado; pendente e ativa: criado', async () => {
    const suspenso = saloes.get('suspensa')!;
    expect(await criar.acao.executar(await credencialDoGestor(suspenso), nova)).toEqual(ACESSO_NEGADO);
    const nomes = (s: SalaoCompleto) => c.query('SELECT 1 FROM servico WHERE salao_id = $1 AND nome = $2', [s.salaoId, 'Hidratação']).then((r) => r.rowCount);
    expect(await nomes(suspenso)).toBe(0);
    for (const situacao of ['pendente', 'ativa']) {
      const s = saloes.get(situacao)!;
      expect(await criar.acao.executar(await credencialDoGestor(s), nova)).toMatchObject({ ok: true, dados: { resultado: 'salvo' } });
      expect(await nomes(s)).toBe(1);
    }
  });
});
