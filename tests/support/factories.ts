import type { Finalidade } from '@/config/termos';
import { gerarHashSenha } from '@/server/auth/senha';
import { obterPrisma } from '@/server/repos/db';

import { emailNovo, slugNovo, telefoneNovo } from './sql';

// Fábricas de dados de teste (D-005 §3.7, CA-3): dois salões COMPLETOS via Prisma, sem SQL manual no
// teste. Tudo grava na base deste worker (obterPrisma() usa DATABASE_URL, que o setup-arquivo aponta
// para ela). Cada chamada gera slug, e-mails e telefones novos: nenhuma asserção depende de contagem
// global. Instantes em UTC e no futuro relativo ao relógio (regras futuras de antecedência).

const DIA_MS = 24 * 60 * 60 * 1000;

/** Meia-noite UTC de hoje + `dias`, mais `horaUtc` horas. */
export function instanteFuturo(dias: number, horaUtc = 13, minuto = 0): Date {
  const hoje = new Date();
  return new Date(
    Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate(), horaUtc, minuto) + dias * DIA_MS,
  );
}

export type SalaoCompleto = {
  salaoId: string;
  nome: string;
  slugAtual: string;
  slugHistorico: string;
  /**
   * Gestor (confirmado por padrão), com senha SENHA_DE_TESTE. `profissionalId` é null quando criado
   * com `gestor.comPerfil: false`.
   */
  gestor: { usuarioId: string; profissionalId: string | null; nome: string; email: string };
  /** Usuário de papel `profissional` com perfil vinculado (ativo por padrão), senha SENHA_DE_TESTE. */
  profissional: { usuarioId: string; profissionalId: string; nome: string; email: string };
  profissionalInativoId: string;
  servicos: { ativos: [string, string]; inativoId: string; nomes: string[] };
  jornadaIds: string[];
  bloqueioId: string;
  clientes: { ativaId: string; anonimizadaId: string; nomeAtiva: string; telefoneAtiva: string };
  /** `confirmado`, relógio + 7 dias (UTC), dois itens com snapshot de preço e duração. */
  reserva: { id: string; itemIds: string[]; inicio: Date; fim: Date };
};

export type SobrescritasSalao = {
  salao?: { nome?: string; fuso?: string; gradeMin?: number; intervaloMin?: number };
  slugAtual?: string;
  slugHistorico?: string;
  /** `emailConfirmado` padrão true (D-010 CA-15). */
  gestor?: { nome?: string; email?: string; comPerfil?: boolean; emailConfirmado?: boolean };
  /** `ativo` (padrão true) é o do perfil do USUÁRIO profissional (D-010 CA-5). */
  profissional?: { nome?: string; email?: string; emailConfirmado?: boolean; ativo?: boolean };
  servicos?: {
    ativos?: [ServicoNovo?, ServicoNovo?];
    inativo?: ServicoNovo;
  };
  cliente?: { nome?: string; telefoneE164?: string };
  reserva?: { inicio?: Date };
};

type ServicoNovo = { nome?: string; precoCentavos?: number; duracaoMin?: number };

const SERVICOS_PADRAO: Required<ServicoNovo>[] = [
  { nome: 'Corte feminino', precoCentavos: 9000, duracaoMin: 60 },
  { nome: 'Escova', precoCentavos: 5500, duracaoMin: 30 },
  { nome: 'Coloração (descontinuada)', precoCentavos: 18000, duracaoMin: 120 },
];

/** Senha de todos os usuários das fábricas (D-010 §3.13). Hash argon2id real, via senha.ts. */
export const SENHA_DE_TESTE = 'Senha de teste 123';

let hashMemoizado: Promise<string> | undefined;

/** Hash argon2id de SENHA_DE_TESTE, gerado uma vez por processo (R-8, R-11). */
export function hashDaSenhaDeTeste(): Promise<string> {
  hashMemoizado ??= gerarHashSenha(SENHA_DE_TESTE);
  return hashMemoizado;
}

/** Cria um salão completo (CA-3). Os campos sobrescritos substituem os padrões; os IDs são devolvidos. */
export async function criarSalaoCompleto(s: SobrescritasSalao = {}): Promise<SalaoCompleto> {
  const db = obterPrisma();
  const senhaHash = await hashDaSenhaDeTeste();
  const sufixo = slugNovo().slice('salao-'.length);
  const nome = s.salao?.nome ?? `Salão ${sufixo}`;

  const salao = await db.salao.create({
    data: {
      nome,
      ...(s.salao?.fuso !== undefined && { fuso: s.salao.fuso }),
      ...(s.salao?.gradeMin !== undefined && { gradeMin: s.salao.gradeMin }),
      ...(s.salao?.intervaloMin !== undefined && { intervaloMin: s.salao.intervaloMin }),
    },
    select: { id: true },
  });
  const salaoId = salao.id;

  const slugAtual = s.slugAtual ?? slugNovo();
  const slugHistorico = s.slugHistorico ?? `${slugAtual}-antigo`;
  await db.salaoSlug.createMany({
    data: [
      { slug: slugAtual, salaoId, atual: true },
      { slug: slugHistorico, salaoId, atual: false },
    ],
  });

  // Gestor confirmado (um por salão), opcionalmente com perfil de profissional.
  const gestorNome = s.gestor?.nome ?? `Gestora ${sufixo}`;
  const gestorEmail = s.gestor?.email ?? emailNovo();
  const gestorUsuario = await db.usuario.create({
    data: {
      salaoId,
      papel: 'gestor',
      email: gestorEmail,
      nome: gestorNome,
      senhaHash,
      emailConfirmadoEm: s.gestor?.emailConfirmado === false ? null : new Date(),
    },
    select: { id: true },
  });
  const gestorProfissionalId =
    s.gestor?.comPerfil === false
      ? null
      : (
          await db.profissional.create({
            data: { salaoId, usuarioId: gestorUsuario.id, nome: gestorNome, email: gestorEmail },
            select: { id: true },
          })
        ).id;

  // Profissional com usuário próprio.
  const profNome = s.profissional?.nome ?? `Profissional ${sufixo}`;
  const profEmail = s.profissional?.email ?? emailNovo();
  const profUsuario = await db.usuario.create({
    data: {
      salaoId,
      papel: 'profissional',
      email: profEmail,
      nome: profNome,
      senhaHash,
      emailConfirmadoEm: s.profissional?.emailConfirmado === false ? null : new Date(),
    },
    select: { id: true },
  });
  const profissional = await db.profissional.create({
    data: {
      salaoId,
      usuarioId: profUsuario.id,
      nome: profNome,
      email: profEmail,
      ativo: s.profissional?.ativo !== false,
    },
    select: { id: true },
  });

  const inativo = await db.profissional.create({
    data: { salaoId, nome: `Ex-profissional ${sufixo}`, ativo: false },
    select: { id: true },
  });

  // Serviços: dois ativos e um inativo.
  const dadosServicos = [0, 1, 2].map((i) => ({
    ...SERVICOS_PADRAO[i],
    ...(i < 2 ? s.servicos?.ativos?.[i] : s.servicos?.inativo),
  }));
  const servicoIds: string[] = [];
  for (const [i, d] of dadosServicos.entries()) {
    const criado = await db.servico.create({
      data: { salaoId, ...d, ativo: i < 2 },
      select: { id: true },
    });
    servicoIds.push(criado.id);
  }
  const [servico1, servico2, servicoInativo] = servicoIds;

  // Vínculos serviço × profissional: os dois ativos com o profissional e com o gestor (se atende);
  // o inativo só com o profissional inativo.
  const atendem = [profissional.id, ...(gestorProfissionalId ? [gestorProfissionalId] : [])];
  await db.servicoProfissional.createMany({
    data: [
      ...atendem.flatMap((profissionalId) => [
        { salaoId, servicoId: servico1, profissionalId },
        { salaoId, servicoId: servico2, profissionalId },
      ]),
      { salaoId, servicoId: servicoInativo, profissionalId: inativo.id },
    ],
  });

  // Jornada semanal (hora local do salão em minutos): segunda a sábado, 9h–12h e 13h–18h, para quem atende.
  const jornadaIds: string[] = [];
  for (const profissionalId of atendem) {
    for (let diaSemana = 1; diaSemana <= 6; diaSemana++) {
      for (const [inicioMin, fimMin] of [
        [540, 720],
        [780, 1080],
      ]) {
        const j = await db.jornada.create({
          data: { salaoId, profissionalId, diaSemana, inicioMin, fimMin },
          select: { id: true },
        });
        jornadaIds.push(j.id);
      }
    }
  }

  const bloqueio = await db.bloqueio.create({
    data: {
      salaoId,
      profissionalId: profissional.id,
      inicio: instanteFuturo(8, 13),
      fim: instanteFuturo(8, 15),
      motivo: 'Curso',
    },
    select: { id: true },
  });

  // Clientes: uma ativa e uma anonimizada (nome e telefone nulos).
  const nomeAtiva = s.cliente?.nome ?? `Cliente ${sufixo}`;
  const telefoneAtiva = s.cliente?.telefoneE164 ?? telefoneNovo();
  const ativa = await db.cliente.create({
    data: { salaoId, nome: nomeAtiva, telefoneE164: telefoneAtiva },
    select: { id: true },
  });
  const anonimizada = await db.cliente.create({
    data: { salaoId, nome: null, telefoneE164: null, anonimizadaEm: new Date() },
    select: { id: true },
  });

  // Reserva confirmada com os dois serviços ativos em sequência (snapshot de preço e duração).
  const inicio = s.reserva?.inicio ?? instanteFuturo(7, 13);
  const duracaoTotal = dadosServicos[0].duracaoMin + dadosServicos[1].duracaoMin;
  const fim = new Date(inicio.getTime() + duracaoTotal * 60_000);
  const reserva = await db.reserva.create({
    data: {
      salaoId,
      profissionalId: profissional.id,
      clienteId: ativa.id,
      inicio,
      fim,
      ocupadoAte: fim,
      status: 'confirmado',
      origem: 'equipe',
    },
    select: { id: true },
  });
  const itemIds: string[] = [];
  for (const [ordem, servicoId] of [servico1, servico2].entries()) {
    const item = await db.reservaItem.create({
      data: {
        salaoId,
        reservaId: reserva.id,
        servicoId,
        ordem,
        precoCentavos: dadosServicos[ordem].precoCentavos,
        duracaoMin: dadosServicos[ordem].duracaoMin,
      },
      select: { id: true },
    });
    itemIds.push(item.id);
  }

  return {
    salaoId,
    nome,
    slugAtual,
    slugHistorico,
    gestor: { usuarioId: gestorUsuario.id, profissionalId: gestorProfissionalId, nome: gestorNome, email: gestorEmail },
    profissional: { usuarioId: profUsuario.id, profissionalId: profissional.id, nome: profNome, email: profEmail },
    profissionalInativoId: inativo.id,
    servicos: {
      ativos: [servico1, servico2],
      inativoId: servicoInativo,
      nomes: dadosServicos.map((d) => d.nome),
    },
    jornadaIds,
    bloqueioId: bloqueio.id,
    clientes: { ativaId: ativa.id, anonimizadaId: anonimizada.id, nomeAtiva, telefoneAtiva },
    reserva: { id: reserva.id, itemIds, inicio, fim },
  };
}

/** Os dois salões distintos dos testes de isolamento (salão A e salão B). */
export async function criarDoisSaloes(): Promise<{ a: SalaoCompleto; b: SalaoCompleto }> {
  const a = await criarSalaoCompleto({ salao: { nome: 'Salão Aurora' } });
  const b = await criarSalaoCompleto({ salao: { nome: 'Salão Bromélia' } });
  return { a, b };
}

/** Linha de consentimento direta (D-023): padrão `mensagens_reserva`, `publico`, versão e data fixas. */
export async function criarConsentimento(
  salaoId: string,
  clienteId: string,
  s: { finalidade?: Finalidade; origem?: 'publico' | 'equipe'; versaoTermos?: string; criadoEm?: Date } = {},
): Promise<{ id: string; finalidade: Finalidade; origem: 'publico' | 'equipe'; versaoTermos: string; criadoEm: Date }> {
  const db = obterPrisma();
  const linha = await db.consentimento.create({
    data: {
      salaoId,
      clienteId,
      finalidade: s.finalidade ?? 'mensagens_reserva',
      origem: s.origem ?? 'publico',
      versaoTermos: s.versaoTermos ?? 'versao-de-teste',
      criadoEm: s.criadoEm ?? new Date(),
    },
    select: { id: true, finalidade: true, origem: true, versaoTermos: true, criadoEm: true },
  });
  return linha;
}
