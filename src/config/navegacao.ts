// Rotas da v1 e navegação por papel (D-009 RN-15, RN-16). Fonte única dos caminhos: layouts e
// páginas não escrevem caminho como texto solto. Rotas com parâmetro codificam o valor.
// O tipo do papel vem por `import type` (apagado no bundle do cliente; D-16).
import type { PapelDeSalao } from '@/server/tenant/context';

const seg = (valor: string) => encodeURIComponent(valor);

export const ROTAS = {
  // públicas
  inicio: '/',
  entrar: '/entrar',
  cadastro: '/cadastro',
  confirmarEmail: '/confirmar-email',
  recuperarSenha: '/recuperar-senha',
  redefinirSenha: '/redefinir-senha',
  convite: (token: string) => `/convite/${seg(token)}`,
  termos: '/termos',
  privacidade: '/privacidade',
  salaoPublico: (slug: string) => `/${seg(slug)}`,
  /** Link individual do convite de avaliação (D-032): o token vai no caminho. */
  avaliar: (slug: string, token: string) => `/${seg(slug)}/avaliar/${seg(token)}`,
  // painel
  painel: '/painel',
  agenda: '/painel/agenda',
  novaReserva: '/painel/agenda/nova',
  agendaReserva: (id: string) => `/painel/agenda/reservas/${seg(id)}`,
  clientes: '/painel/clientes',
  cliente: (id: string) => `/painel/clientes/${seg(id)}`,
  excluirCliente: (id: string) => `/painel/clientes/${seg(id)}/excluir`,
  servicos: '/painel/servicos',
  novoServico: '/painel/servicos/novo',
  servico: (id: string) => `/painel/servicos/${seg(id)}`,
  profissionais: '/painel/profissionais',
  novoProfissional: '/painel/profissionais/novo',
  profissional: (id: string) => `/painel/profissionais/${seg(id)}`,
  jornada: (id: string) => `/painel/profissionais/${seg(id)}/jornada`,
  bloqueios: '/painel/bloqueios',
  bloqueio: (id: string) => `/painel/bloqueios/${seg(id)}`,
  configuracoes: '/painel/configuracoes',
  configuracoesPerfil: '/painel/configuracoes/perfil',
  configuracoesFuncionamento: '/painel/configuracoes/funcionamento',
  configuracoesFotos: '/painel/configuracoes/fotos',
  envioFotos: '/api/painel/fotos',
  fotoPublica: (id: string) => `/api/fotos/${seg(id)}`,
  assinatura: '/painel/assinatura',
  assinaturaRetorno: '/painel/assinatura/retorno',
  // super admin
  admin: '/admin',
  adminEntrar: '/admin/entrar',
  adminSaloes: '/admin/saloes',
  adminSalao: (id: string) => `/admin/saloes/${seg(id)}`,
  adminSalaoAssinatura: (id: string) => `/admin/saloes/${seg(id)}/assinatura`,
  adminMensagens: '/admin/mensagens',
  adminAuditoria: '/admin/auditoria',
  // desenvolvimento (fora de qualquer navegação)
  devComponentes: '/dev/componentes',
  devMpCheckout: '/dev/mp-checkout',
  devJornada: '/dev/jornada',
  devBloqueios: '/dev/bloqueios',
  devConfiguracoes: '/dev/configuracoes',
  devClientes: '/dev/clientes',
  devConsentimento: '/dev/consentimento',
  devAvaliacao: '/dev/avaliacao',
  devPerfil: '/dev/perfil',
  devFuncionamento: '/dev/funcionamento',
  devAdminEntrar: '/dev/admin-entrar',
  devFotos: '/dev/fotos',
  devFotosEnvio: '/dev/fotos/enviar',
  devReserva: '/dev/reserva',
  devAgenda: '/dev/agenda',
  devReservaNova: '/dev/reserva-nova',
  devReservaAcoes: '/dev/reserva-acoes',
} as const;

export type ItemNavegacao = {
  readonly chave: string;
  readonly rotulo: string;
  readonly href: string;
};

/** Chaves de ROTAS sem parâmetro (só elas viram item de navegação). */
type RotaFixa = {
  [K in keyof typeof ROTAS]: (typeof ROTAS)[K] extends string ? K : never;
}[keyof typeof ROTAS];

const item = (chave: RotaFixa, rotulo: string): ItemNavegacao =>
  Object.freeze({ chave, rotulo, href: ROTAS[chave] });

/** Navegação do painel por papel (RN-16; ordem da D-18). */
export const NAVEGACAO_PAINEL = {
  gestor: Object.freeze([
    item('agenda', 'Agenda'),
    item('clientes', 'Clientes'),
    item('servicos', 'Serviços'),
    item('profissionais', 'Profissionais'),
    item('bloqueios', 'Bloqueios'),
    item('configuracoes', 'Configurações'),
    item('assinatura', 'Assinatura'),
  ]),
  profissional: Object.freeze([item('agenda', 'Agenda'), item('bloqueios', 'Bloqueios')]),
} as const satisfies Record<PapelDeSalao, readonly ItemNavegacao[]>;

/** Navegação do super admin (RN-16). */
export const NAVEGACAO_ADMIN: readonly ItemNavegacao[] = Object.freeze([
  item('adminSaloes', 'Salões'),
  item('adminMensagens', 'Mensagens'),
  item('adminAuditoria', 'Auditoria'),
]);

/** Falha fechada: papel fora do tipo (inclusive 'super_admin', 'toString', undefined) → []. */
export function itensDoPainel(papel: unknown): readonly ItemNavegacao[] {
  if (typeof papel !== 'string' || !Object.hasOwn(NAVEGACAO_PAINEL, papel)) return [];
  return NAVEGACAO_PAINEL[papel as PapelDeSalao];
}

/** Remove `?…`, `#…` e a barra final (exceto na raiz). */
function normalizar(caminho: string): string {
  const semSufixo = caminho.split(/[?#]/, 1)[0];
  return semSufixo.length > 1 ? semSufixo.replace(/\/+$/, '') || '/' : semSufixo;
}

/**
 * href do item ativo: igual ao caminho ou prefixo dele por segmento; vence o mais longo;
 * null se nenhum (RN-14).
 */
export function itemAtivo(
  itens: readonly ItemNavegacao[],
  caminho: string | null | undefined,
): string | null {
  if (typeof caminho !== 'string' || caminho === '') return null;
  const atual = normalizar(caminho);
  let melhor: string | null = null;
  for (const { href } of itens) {
    const alvo = normalizar(href);
    const casa = atual === alvo || atual.startsWith(alvo === '/' ? '/' : `${alvo}/`);
    if (casa && (melhor === null || alvo.length > normalizar(melhor).length)) melhor = href;
  }
  return melhor;
}

/** Primeiro segmento de um caminho ('' para a raiz). */
function primeiroSegmento(caminho: string): string {
  return caminho.split('/')[1] ?? '';
}

/**
 * Primeiros segmentos de todas as rotas (exceto /[slug]) + 'api' + '_next' (RN-15).
 * Para E1.1/E2.5 recusarem slugs de salão que colidiriam com uma rota. `salaoPublico` e `avaliar`
 * (D-032) começam pelo slug do salão, não por um segmento fixo: ficam de fora.
 */
export const SEGMENTOS_RESERVADOS: ReadonlySet<string> = new Set(
  [
    ...Object.entries(ROTAS)
      .filter(([chave]) => chave !== 'salaoPublico' && chave !== 'avaliar')
      .map(([, rota]) => (typeof rota === 'function' ? (rota as (x: string) => string)('x') : rota))
      .map(primeiroSegmento)
      .filter((s) => s !== ''),
    'api',
    '_next',
  ].sort(),
);
