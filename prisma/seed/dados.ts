// Dados de demonstração (D-036 E9.2). Módulo puro: sem banco, sem relógio, sem ambiente. Tudo é fictício:
// e-mails em domínio `.example`, telefones gerados por `normalizarTelefoneBr`, senha pública de demonstração.
// NUNCA use este seed em produção (o CLI recusa NODE_ENV=production sem SEED_PERMITIR_PRODUCAO=true).
import { createHash } from 'node:crypto';

import { normalizarTelefoneBr } from '@/lib/telefone';

/** Credenciais de demonstração, públicas. O README as repete e um teste estático confere a igualdade. */
export const CREDENCIAIS_DEMO = {
  senha: 'Demo@12345',
  gestorA: { email: 'helena@aurora.example', nome: 'Helena Moura' },
  gestorB: { email: 'rafael@bromelia.example', nome: 'Rafael Barros' },
  profissionalA: { email: 'marcos@aurora.example', nome: 'Marcos Pires' },
  admin: { email: 'admin@agendabeleza.example', senha: 'Admin@Demo12345' },
} as const;

/** UUID v4 determinístico a partir de um espaço de nomes e uma chave: o mesmo par dá sempre o mesmo id. */
export function idDemo(espaco: string, chave: string): string {
  const h = createHash('sha256').update(`agenda-beleza-demo:${espaco}:${chave}`).digest();
  h[6] = (h[6]! & 0x0f) | 0x40;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

/** Celular brasileiro fictício, já em E.164 (lança se a regra de telefone mudar e o formato deixar de valer). */
export function telefoneDemo(ddd: string, n: number): string {
  const e164 = normalizarTelefoneBr(`(${ddd}) 9 8800-${String(n).padStart(4, '0')}`);
  if (e164 === null) throw new Error(`telefone de demonstração inválido: ${ddd} ${n}`);
  return e164;
}

/** Faixas em minutos do dia local do salão, por dia da semana (0 = domingo). */
export type DiaSpec = { dia: number; faixas: readonly (readonly [number, number])[] };

export type ServicoSpec = { chave: string; nome: string; precoCentavos: number; duracaoMin: number };

export type ProfissionalSpec = {
  chave: string;
  nome: string;
  /** É o gestor do salão (perfil vinculado ao usuário gestor). */
  gestor?: boolean;
  /** Cria também um usuário de papel `profissional` (e-mail confirmado, senha de demonstração). */
  usuarioEmail?: string;
  servicos: readonly string[];
  jornada: readonly DiaSpec[];
};

export type ClienteSpec = { chave: string; nome: string | null; telefone: string | null; avaliacaoAceita?: boolean };

export type StatusSpec = 'confirmado' | 'concluido' | 'cancelado' | 'nao_compareceu';

/**
 * Item de uma reserva (D-050): serviço, profissional e horário próprios. Sem `inicioMin`, começa no
 * `ocupado_ate` do item anterior (fim + intervalo do salão). `status` ausente = o da reserva.
 */
export type ItemSpec = { servico: string; profissional: string; inicioMin?: number; status?: StatusSpec };

/**
 * Reserva de demonstração. Forma abreviada: um profissional e serviços encadeados a partir de `inicioMin`.
 * Forma explícita (`itens`): cada serviço com o seu profissional e horário, no mesmo dia. O status, o início
 * e o fim gravados em `reserva` são DERIVADOS dos itens (`derivarReserva`), nunca escritos à mão.
 */
export type ReservaSpec = {
  chave: string;
  cliente: string;
  /** Dias a partir de hoje no fuso do salão (negativo = passado). */
  dia: number;
  /** Status padrão dos itens. */
  status: StatusSpec;
} & ({ profissional: string; inicioMin: number; servicos: readonly string[] } | { itens: readonly ItemSpec[] });

export type AvaliacaoSpec = { reserva: string; nota: number; comentario?: string; nomeExibicao?: string };

export type BloqueioSpec = { chave: string; profissional?: string; dia: number; inicioMin: number; fimMin: number; motivo: string };

export type PerfilSpec = {
  descricao: string;
  logradouro: string;
  numero: string;
  complemento?: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
  telefone: string;
  whatsapp: string;
  instagram: string;
  meiosPagamento: readonly string[];
  comodidades: readonly string[];
};

export type SalaoSpec = {
  /** Espaço de nomes dos ids (estável: nunca renomear depois de publicado). */
  chave: string;
  nome: string;
  slug: string;
  fuso: string;
  gradeMin: number;
  intervaloMin: number;
  perfil: PerfilSpec;
  /** `null` = horário de funcionamento não informado (`funcionamento_definido = false`). */
  funcionamento: readonly DiaSpec[] | null;
  gestor: { email: string; nome: string };
  servicos: readonly ServicoSpec[];
  profissionais: readonly ProfissionalSpec[];
  clientes: readonly ClienteSpec[];
  reservas: readonly ReservaSpec[];
  avaliacoes: readonly AvaliacaoSpec[];
  bloqueios: readonly BloqueioSpec[];
  fotos: number;
  assinatura: 'em_teste' | 'ativa' | null;
  suspenso?: boolean;
};

/** Segunda a sexta com as mesmas faixas. */
export function diasUteis(...faixas: [number, number][]): DiaSpec[] {
  return [1, 2, 3, 4, 5].map((dia) => ({ dia, faixas }));
}

export function dias(lista: readonly number[], ...faixas: [number, number][]): DiaSpec[] {
  return lista.map((dia) => ({ dia, faixas }));
}

export const h = (horas: number, minutos = 0): number => horas * 60 + minutos;
