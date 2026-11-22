import type { AcaoAuditavel } from '@/server/auditoria/tipos';
import type { EstadoMensagem, TipoMensagem } from '@/server/mensagens/tipos';

// Rótulos curtos pt-BR e selos do painel do super admin (D-045 web-design §3). Client-safe: sem imports de
// servidor de runtime. São intencionalmente distintos dos rótulos longos da equipe (`mensagens/rotulos.ts`,
// D-043): a lista do admin é densa. Valor fora da lista → rótulo neutro "—"/o texto gravado, nunca exceção.

export type FormaSelo = 'circulo' | 'relogio' | 'triangulo' | 'traco' | 'cadeado';
export type VarianteSelo = 'neutro' | 'sucesso' | 'aviso' | 'erro';
export type Selo = { rotulo: string; forma: FormaSelo; variante: VarianteSelo };

export const ESTADOS_MENSAGEM: readonly EstadoMensagem[] = [
  'pendente',
  'enviando',
  'enviada',
  'falhou',
  'nao_enviada',
  'substituida',
  'cancelada_anonimizacao',
];

export const TIPOS_MENSAGEM: readonly TipoMensagem[] = ['confirmacao', 'remarcacao', 'cancelamento', 'convite_avaliacao'];

const SELOS_MENSAGEM: Record<EstadoMensagem, Selo> = {
  enviada: { rotulo: 'Enviada', forma: 'circulo', variante: 'sucesso' },
  pendente: { rotulo: 'Aguardando envio', forma: 'relogio', variante: 'aviso' },
  enviando: { rotulo: 'Enviando', forma: 'relogio', variante: 'aviso' },
  falhou: { rotulo: 'Falhou', forma: 'triangulo', variante: 'erro' },
  nao_enviada: { rotulo: 'Não enviada', forma: 'traco', variante: 'neutro' },
  cancelada_anonimizacao: { rotulo: 'Cancelada (cliente removida)', forma: 'traco', variante: 'neutro' },
  substituida: { rotulo: 'Substituída', forma: 'traco', variante: 'neutro' },
};

const TIPOS: Record<TipoMensagem, string> = {
  confirmacao: 'Confirmação',
  remarcacao: 'Remarcação',
  cancelamento: 'Cancelamento',
  convite_avaliacao: 'Convite de avaliação',
};

const NEUTRO: Selo = { rotulo: '—', forma: 'traco', variante: 'neutro' };

export const seloDaMensagem = (estado: string): Selo => (Object.hasOwn(SELOS_MENSAGEM, estado) ? SELOS_MENSAGEM[estado as EstadoMensagem] : NEUTRO);

/** "Remarcação 2" quando há revisão (só a remarcação mostra o número). */
export function rotuloDoTipo(tipo: string, revisao = 0): string {
  if (!Object.hasOwn(TIPOS, tipo)) return '—';
  const nome = TIPOS[tipo as TipoMensagem];
  return tipo === 'remarcacao' && revisao > 0 ? `${nome} ${revisao}` : nome;
}

export type ResultadoWebhookAdmin = 'recebido' | 'processado' | 'ignorado' | 'rejeitado' | 'erro';

const SELOS_WEBHOOK: Record<ResultadoWebhookAdmin, Selo> = {
  processado: { rotulo: 'Processado', forma: 'circulo', variante: 'sucesso' },
  recebido: { rotulo: 'Recebido', forma: 'relogio', variante: 'aviso' },
  ignorado: { rotulo: 'Ignorado', forma: 'traco', variante: 'neutro' },
  rejeitado: { rotulo: 'Rejeitado', forma: 'triangulo', variante: 'erro' },
  erro: { rotulo: 'Erro', forma: 'triangulo', variante: 'erro' },
};

export const seloDoWebhook = (r: string): Selo => (Object.hasOwn(SELOS_WEBHOOK, r) ? SELOS_WEBHOOK[r as ResultadoWebhookAdmin] : NEUTRO);

export const SELO_ORIGEM_INVALIDA: Selo = { rotulo: 'Inválida', forma: 'triangulo', variante: 'aviso' };

export const RESULTADOS_AUDITORIA = ['sucesso', 'falha'] as const;
export type ResultadoAuditoriaAdmin = (typeof RESULTADOS_AUDITORIA)[number];

export const seloDaAuditoria = (r: string): Selo =>
  r === 'sucesso'
    ? { rotulo: 'Sucesso', forma: 'circulo', variante: 'sucesso' }
    : r === 'falha'
      ? { rotulo: 'Falha', forma: 'triangulo', variante: 'erro' }
      : NEUTRO;

const ACOES: Record<AcaoAuditavel, string> = {
  'avaliacao.retirar': 'Avaliação retirada',
  'avaliacao.restaurar': 'Avaliação restaurada',
  'avaliacao.denuncia_resolver': 'Denúncia arquivada',
  'salao.renomear': 'Salão renomeado',
  'salao.atualizar': 'Salão atualizado',
  'salao.suspender': 'Salão suspenso',
  'salao.reativar': 'Salão reativado',
  'salao.estender_teste': 'Teste estendido',
  'usuario.atualizar_email': 'E-mail do gestor atualizado',
  'login.falha_totp': 'Falha no código de verificação',
  'login.falha_senha': 'Falha de senha',
  'login.sucesso': 'Entrada no painel',
  'totp.cadastrar': 'Verificação em duas etapas cadastrada',
  'mensagem.reenviar': 'Mensagem reenviada',
};

/** Rótulo da ação; fora do vocabulário → o próprio código gravado (já `entidade.verbo`). */
export const rotuloDaAcao = (acao: string): string => (Object.hasOwn(ACOES, acao) ? ACOES[acao as AcaoAuditavel] : acao);

export const CODIGOS_DE_ACAO: readonly AcaoAuditavel[] = Object.freeze(Object.keys(ACOES) as AcaoAuditavel[]);

/** Código de erro mostrável: só `^[a-z0-9_]{1,40}$` (RN-9); senão null (a tela mostra "—"). */
export const codigoDeErroMostravel = (v: unknown): string | null => (typeof v === 'string' && /^[a-z0-9_]{1,40}$/.test(v) ? v : null);
