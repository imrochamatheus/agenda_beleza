import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

// Arquivos de código verificados pelas regras de arquitetura abaixo.
const CODIGO = '**/*.{ts,tsx,mts,js,mjs}';
// Testes (inclusive os E2E, que geram imagens com o sharp) ficam fora das regras de arquitetura: montam cenários com o banco e os adaptadores reais.
const TESTES = ['tests/**', 'e2e/**', '**/*.test.{ts,tsx}'];

// Pastas com permissões próprias. Cada arquivo de código casa com UM só bloco que configura
// `no-restricted-imports`: no flat config, dois blocos que configuram a mesma regra para o mesmo
// arquivo não se somam (o último substitui o anterior). Por isso os blocos têm `files` disjuntos e
// cada um lista a soma das restrições que lhe cabem (D-007 §3.8, R-1).
const INTEGRACOES = ['src/server/integrations/**'];
const ACESSO_AO_BANCO = ['src/server/repos/**', 'prisma/seed.ts'];
// D-008 (D-8): o worker continua com as permissões de antes (banco, sem SDKs nem adaptadores) e
// passa a poder importar o pg-boss; a fila (src/server/queue) importa o pg-boss, mas não o Prisma.
const WORKER = ['src/worker/**'];
const FILA = ['src/server/queue/**'];
const DEV = ['src/app/dev/**'];
// D-021 (A-9): o sharp só é importado pelo módulo de imagem.
const IMAGEM = ['src/server/imagem/**'];
// D-018 (A-1): o domínio puro (src/domain/**) não importa camadas de servidor, UI, banco, fila nem
// SDKs; a única exceção é a conversão de fuso (src/server/tempo/fuso). Também não lê o relógio nem usa
// métodos de data em hora local.
const DOMINIO = ['src/domain/**'];
// Restringe uma pasta (`x/**`) ou um arquivo aos arquivos de código.
const comExtensao = (padroes) =>
  padroes.map((p) => (p.endsWith('/**') ? `${p}/*.{ts,tsx,mts,js,mjs}` : p));

// RN-10 (D-005): o acesso ao banco passa pelos repositórios. Fora das pastas liberadas, é proibido
// importar o cliente Prisma gerado, @prisma/client, @prisma/adapter-pg, pg e o módulo da instância
// (src/server/repos/db), inclusive por caminho relativo. `import type` é permitido (S-6): não abre
// conexão nem permite consultar.
const PRISMA = [
  {
    regex: '(^|/)generated/prisma(/|$)',
    allowTypeImports: true,
    message: 'Acesse o banco pelos repositórios de src/server/repos (RN-10).',
  },
  {
    regex: '^@prisma/(client|adapter-pg)(/|$)',
    allowTypeImports: true,
    message: 'Acesse o banco pelos repositórios de src/server/repos (RN-10).',
  },
  {
    regex: '^pg(/|$)',
    allowTypeImports: true,
    message: 'Acesse o banco pelos repositórios de src/server/repos (RN-10).',
  },
  {
    regex: '(^|/)repos/db(\\.[cm]?[jt]s)?$',
    allowTypeImports: true,
    message: 'A instância do Prisma só é usada dentro de src/server/repos (RN-10).',
  },
];

// RN-16 (a) (D-007): nodemailer e SDKs de provedor só dentro de src/server/integrations.
const MENSAGEM_SDK = 'RN-16: use a porta ou o registro de src/server/integrations.';
const SDK_PROVEDOR = [
  '^nodemailer(/|$)',
  '^mercadopago(/|$)',
  '^@mercadopago/',
  '^@cloudflare/',
  '^cloudflare(/|$)',
  '^(whatsapp|@whatsapp|@meta)',
  '^@aws-sdk/',
].map((regex) => ({ regex, message: MENSAGEM_SDK }));

// RN-16 (b): os módulos de adaptador (integrations/*/real e integrations/*/simulado) e o checkout
// simulado do MP não são importados diretamente; use a porta ou o registro. `import type` também é
// barrado: os tipos ficam na porta.
const MENSAGEM_ADAPTADOR =
  'RN-16: não importe o adaptador diretamente; use a porta ou o registro de src/server/integrations.';
const SUFIXO = '(\\.[cm]?[jt]s)?$';
const ADAPTADORES = [
  { regex: `(^|/)integrations/[^/]+/(real|simulado)${SUFIXO}`, message: MENSAGEM_ADAPTADOR },
  { regex: `(^|/)integrations/mercadopago/checkout-simulado${SUFIXO}`, message: MENSAGEM_ADAPTADOR },
];
// Exceção da RN-16 (b) para src/app/dev/**: as telas de desenvolvimento usam as funções específicas
// do MP simulado (mercadopago/simulado e mercadopago/checkout-simulado). Os demais adaptadores,
// inclusive o MP real, continuam proibidos.
const ADAPTADORES_EXCETO_MP_SIMULADO = [
  {
    regex: `(^|/)integrations/(?!mercadopago/)[^/]+/(real|simulado)${SUFIXO}`,
    message: MENSAGEM_ADAPTADOR,
  },
  { regex: `(^|/)integrations/mercadopago/real${SUFIXO}`, message: MENSAGEM_ADAPTADOR },
];

// D-8 (D-008): o pg-boss só é importado em src/server/queue e src/worker. Assim todo enfileiramento
// passa pelo cliente, que valida o payload (RN-5) e não participa de transação (uso pós-commit).
// `import type` também é barrado: os tipos ficam em src/server/queue.
const PG_BOSS = [
  {
    regex: '^pg-boss(/|$)',
    message: 'D-8: enfileire pelo cliente de src/server/queue (pg-boss só em src/server/queue e src/worker).',
  },
];

// D-021 (A-9): sharp (decodificação e reprocessamento de imagem) só em src/server/imagem.
const IMAGEM_SHARP = [
  {
    regex: '^sharp(/|$)',
    message: 'D-021: processe imagens pelo módulo de src/server/imagem (sharp só ali).',
  },
];

// D-018 (A-1): fora de `@/server/tempo/fuso`, o domínio não importa `@/server/**`, `@/app/**`,
// `@/components/**`, `next`, `react` nem caminhos relativos que saiam da pasta.
const MENSAGEM_DOMINIO =
  'D-018: o domínio (src/domain) é puro; a única importação externa permitida é @/server/tempo/fuso.';
const DOMINIO_IMPORTS = [
  { regex: '^@/server/(?!tempo/fuso$)', message: MENSAGEM_DOMINIO },
  { regex: '^@/(app|components)(/|$)', message: MENSAGEM_DOMINIO },
  { regex: '^(next|react|react-dom)(/|$)', message: MENSAGEM_DOMINIO },
  { regex: '^\\.\\.(/|$)', message: MENSAGEM_DOMINIO },
];

const restringirImports = (...grupos) => ({
  'no-restricted-imports': ['error', { patterns: grupos.flat() }],
});

// RN-16 (c): hosts de provedor só aparecem dentro de src/server/integrations (defesa contra
// chamadas HTTP diretas com o fetch global).
const HOSTS_PROVEDOR = '/challenges\\.cloudflare\\.com|api\\.mercadopago\\.com|graph\\.facebook\\.com/';
const MENSAGEM_HOST = 'RN-16: chamadas a provedores ficam nos adaptadores de src/server/integrations.';

// D-018 (A-1): o domínio não lê o relógio nem usa métodos de data em hora local.
const MENSAGEM_RELOGIO = 'D-018: o domínio não lê o relógio; receba `agora` por parâmetro.';
const MENSAGEM_LOCAL = 'D-018: métodos de data em hora local são proibidos no domínio; use @/server/tempo/fuso ou getUTC*.';
const METODOS_LOCAIS =
  '/^(getDay|getDate|getMonth|getFullYear|getYear|getHours|getMinutes|getSeconds|getMilliseconds|setDate|setMonth|setFullYear|setHours|setMinutes|setSeconds|setMilliseconds|getTimezoneOffset|toLocaleString|toLocaleDateString|toLocaleTimeString|toDateString|toTimeString)$/';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // Geral: tudo que não está nas pastas com permissões próprias nem é teste.
  {
    files: [CODIGO],
    ignores: [...INTEGRACOES, ...ACESSO_AO_BANCO, ...WORKER, ...FILA, ...DEV, ...IMAGEM, ...DOMINIO, ...TESTES],
    rules: restringirImports(PRISMA, SDK_PROVEDOR, ADAPTADORES, PG_BOSS, IMAGEM_SHARP),
  },
  // Domínio (D-018 A-1): sem banco, SDKs, adaptadores, fila, imagem nem camadas de servidor/UI.
  {
    files: comExtensao(DOMINIO),
    ignores: TESTES,
    rules: {
      ...restringirImports(PRISMA, SDK_PROVEDOR, ADAPTADORES, PG_BOSS, IMAGEM_SHARP, DOMINIO_IMPORTS),
      'no-restricted-syntax': [
        'error',
        { selector: `Literal[value=${HOSTS_PROVEDOR}]`, message: MENSAGEM_HOST },
        { selector: `TemplateElement[value.raw=${HOSTS_PROVEDOR}]`, message: MENSAGEM_HOST },
        { selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']", message: MENSAGEM_RELOGIO },
        { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: MENSAGEM_RELOGIO },
        { selector: "CallExpression[callee.name='Date']", message: MENSAGEM_RELOGIO },
        { selector: `CallExpression[callee.property.name=${METODOS_LOCAIS}]`, message: MENSAGEM_LOCAL },
      ],
    },
  },
  // Integrações: podem usar SDKs e os próprios adaptadores, mas acessam o banco só via repos.
  {
    files: comExtensao(INTEGRACOES),
    ignores: TESTES,
    rules: restringirImports(PRISMA, PG_BOSS, IMAGEM_SHARP),
  },
  // Repositórios e seed: acessam o banco, mas não os SDKs, os adaptadores nem o pg-boss.
  {
    files: comExtensao(ACESSO_AO_BANCO),
    ignores: TESTES,
    rules: restringirImports(SDK_PROVEDOR, ADAPTADORES, PG_BOSS, IMAGEM_SHARP),
  },
  // Worker: acessa o banco e o pg-boss, mas não os SDKs nem os adaptadores.
  {
    files: comExtensao(WORKER),
    ignores: TESTES,
    rules: restringirImports(SDK_PROVEDOR, ADAPTADORES, IMAGEM_SHARP),
  },
  // Fila: usa o pg-boss, mas acessa o banco de domínio só via repos e não usa SDKs nem adaptadores.
  {
    files: comExtensao(FILA),
    ignores: TESTES,
    rules: restringirImports(PRISMA, SDK_PROVEDOR, ADAPTADORES, IMAGEM_SHARP),
  },
  // Telas de desenvolvimento: como o geral, com a exceção do MP simulado.
  {
    files: comExtensao(DEV),
    ignores: TESTES,
    rules: restringirImports(PRISMA, SDK_PROVEDOR, ADAPTADORES_EXCETO_MP_SIMULADO, PG_BOSS, IMAGEM_SHARP),
  },
  // Imagem: usa o sharp, mas como o geral não acessa banco, SDKs, adaptadores nem o pg-boss.
  {
    files: comExtensao(IMAGEM),
    ignores: TESTES,
    rules: restringirImports(PRISMA, SDK_PROVEDOR, ADAPTADORES, PG_BOSS),
  },
  // RN-16 (c). O eslint-config-next não configura no-restricted-syntax; se passar a configurar,
  // mesclar aqui (este bloco substituiria o dele).
  {
    files: [CODIGO],
    ignores: [...INTEGRACOES, ...DOMINIO, ...TESTES, 'eslint.config.mjs'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: `Literal[value=${HOSTS_PROVEDOR}]`, message: MENSAGEM_HOST },
        { selector: `TemplateElement[value.raw=${HOSTS_PROVEDOR}]`, message: MENSAGEM_HOST },
      ],
    },
  },
  // D-026: a rota dinâmica /[slug] passa a casar qualquer caminho de um segmento (ex.: "/termos/" com barra
  // final), o que faz esta regra de navegação reprovar os <a> de exemplo nos testes de componentes. Ela
  // vale para o código de produção; os testes só renderizam marcação.
  {
    files: TESTES,
    rules: { '@next/next/no-html-link-for-pages': 'off' },
  },
  // Artefatos gerados (node_modules já é ignorado por padrão).
  globalIgnores([
    '.next/**',
    'out/**',
    'coverage/**',
    'playwright-report/**',
    'test-results/**',
    'blob-report/**',
    'next-env.d.ts',
    // Cliente Prisma gerado por `npm run db:generate` (não é código escrito à mão).
    'src/generated/**',
    // Bundles do worker e do check-env gerados por `npm run build:node`.
    'dist/**',
  ]),
]);
