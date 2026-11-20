# D-017 — Desenho: configurar fuso, regras de horário e troca de slug com histórico (issue #26, E2.5)

Entradas: `docs/demandas/D-017/spec.md` (RN-1..RN-19, CA-1..CA-20, D-1..D-16), `issue-26.md`, `CLAUDE.md`, `docs/demandas/D-016/design.md` (padrão de módulo, `/dev/*` para o E2E sem banco, travas, `src/server/tempo/fuso.ts`) e `docs/demandas/D-011/design.md` (slug, `salao_slug`, `ON CONFLICT … DO NOTHING RETURNING`). Código lido: `src/server/tempo/fuso.ts`, `src/lib/{slug,texto}.ts`, `src/server/repos/{index,transacao,publico,cadastro,bloqueio,usuario}.ts`, `src/server/repos/index.test.ts`, `src/server/auth/{permissoes,pagina,cadastro}.ts`, `src/server/tenant/{context,define-acao}.ts`, `src/server/jornadas/jornadas.acao.ts`, `src/config/navegacao.ts`, `src/app/painel/bloqueios/{page,acoes}.tsx/ts`, `src/app/dev/jornada/acoes.ts`, `src/lib/format.fonte-unica.test.ts`, `prisma/schema.prisma` (`Salao`, `SalaoSlug`), `prisma/migrations/20261118000200_restricoes_sql/migration.sql:64-71`, `tests/support/{factories,sql,auth}.ts` e `tests/integration/bloqueios/paginas.test.ts`.

## 0. Verificações feitas antes do desenho

- **O esquema basta.** `salao.{nome,fuso,grade_min,antecedencia_min,janela_dias,intervalo_min}` com os defaults da RN-1; `salao_slug` com PK `slug` (unicidade global entre atuais e históricos), `salao_slug_formato_chk` e o índice único parcial `salao_slug_atual_uniq ON salao_slug (salao_id) WHERE atual`. É um **índice** (não uma constraint), portanto **não pode ser adiado**: a unicidade é conferida a cada comando. Nenhuma `DELETE` em `salao_slug` existe no código (a FK é `Restrict`).
- **Fusos do ICU (Node 24.21.0, verificado com `node -e`):** `Intl.supportedValuesOf('timeZone')` devolve 418 nomes e contém **os 16 fusos do Brasil** (`America/{Araguaina,Bahia,Belem,Boa_Vista,Campo_Grande,Cuiaba,Eirunepe,Fortaleza,Maceio,Manaus,Noronha,Porto_Velho,Recife,Rio_Branco,Santarem,Sao_Paulo}`). A lista usa os nomes canônicos do **CLDR**, não os mais novos do IANA: contém `Asia/Calcutta`, `Asia/Katmandu`, `Europe/Kiev`, `America/Buenos_Aires` e `Pacific/Chatham`; **não** contém `Asia/Kolkata`, `Asia/Kathmandu`, `Europe/Kyiv`, `America/Argentina/Buenos_Aires`, `UTC` nem `Etc/UTC`. Consequência para o exemplo da spec §6 em D-17 (§7).
- **`validarFuso` tem três chamadores internos** (`fuso.ts:52`, `:125`, `:164`) e é usado pelos testes da D-016 com `UTC` e `Asia/Kolkata`. Endurecê-lo quebraria a D-016. Por isso a validação estrita é uma função **nova** (§3.1), e `validarFuso` não muda.
- **Travas na linha de `salao`:** todo `INSERT` em tabela com FK para `salao` (reserva, bloqueio, cliente, `salao_slug`…) toma `FOR KEY SHARE` na linha do salão. `FOR UPDATE` conflita com `FOR KEY SHARE`; **`FOR NO KEY UPDATE` não**. A serialização por salão usa `FOR NO KEY UPDATE`, que é a mesma trava que o `UPDATE salao SET …` (colunas que não são chave) toma implicitamente. Assim a troca de slug e a gravação das regras se serializam entre si e **não** bloqueiam reservas, bloqueios nem cadastros de clientes.
- **Cabeçalho do painel:** as páginas leem o nome do salão por `buscarIdentidadeDoPainel` (`repos/usuario.ts`) a cada renderização (páginas dinâmicas por cookie). O novo nome aparece sem mudança nesse código (CA-7).
- **Registro de ações:** `tests/integration/tenant/registro.test.ts` usa `import.meta.glob('/src/**/*.acao.ts')`; o novo `configuracoes.acao.ts` entra sem mudança. A matriz já tem `'salao.configurar': linha('salao', 'negado', 'negado')`: **`permissoes.ts` não muda**.
- **Fábrica:** `criarSalaoCompleto({ slugAtual, slugHistorico, salao: { fuso, gradeMin, intervaloMin } })` grava um slug atual e um histórico (`<atual>-antigo`). Aceita `slugAtual: 'x'` (casa o CHECK), o que serve para o CA-11. `antecedenciaMin` e `janelaDias` ficam nos defaults. As bases de teste são recriadas por arquivo; dentro de um arquivo, slugs fixos só podem ser usados uma vez (os laços ×10 usam sufixo por iteração). **`tests/support/**` não muda.**
- **Formatação:** `format.fonte-unica.test.ts` proíbe `Intl.DateTimeFormat`, `Intl.NumberFormat` e `toLocale*` nas camadas de exibição. `Intl.supportedValuesOf` fica em `src/server/tempo/`, e nenhuma data ou moeda é exibida nesta demanda. `format.ts` não muda.
- `ROTAS.configuracoes` e o item "Configurações" da navegação do gestor existem. `dev` já é segmento reservado: `ROTAS.devConfiguracoes` não altera `SEGMENTOS_RESERVADOS`.

## 1. Resumo da solução

1. **Fuso estrito** em `src/server/tempo/fuso.ts` (acréscimo): `fusosCanonicos()` e `ehFusoCanonico(v)`, sobre `Intl.supportedValuesOf('timeZone')`, com cache. `validarFuso` fica como está.
2. **Domínio puro** `src/server/salao/`: `tipos.ts` (contratos, limites, mensagens; client-safe), `validacao.ts` (`validarRegras`, `normalizarSlug`, `validarNovoSlug`; reutilizável pela E8.2) e `fusos.ts` (opções do `<select>`: grupo "Brasil" e "Outros", mais o valor gravado fora da lista).
3. **Repositório** `src/server/repos/salao.ts` (`Repos.saloes`): leitura das configurações e dos slugs, trava do salão (`FOR NO KEY UPDATE`), gravação das regras e troca de slug em **inserir histórico → rebaixar atual → promover novo**, sem nunca abortar a transação (§3.3).
4. **Serviço** `src/server/salao/configuracoes.ts` (`obter`, `salvarRegras`, `trocarSlug`) e **ações** `src/server/salao/configuracoes.acao.ts` (`salvarConfiguracoes`, `trocarSlugDoSalao`; `papeis: ['gestor']`, `capacidade: 'configurar'`).
5. **Tela** `src/app/painel/configuracoes/` com dois formulários independentes (D-10): o estado da ação é devolvido sem PRG (como na criação de bloqueios da D-016), o que funciona sem JS.
6. **E2E sem banco** em `/dev/configuracoes` (mesmos componentes e ações de demonstração que só validam), como a D-015/D-016.

### 1.1 Alternativas descartadas

| Alternativa | Motivo |
|---|---|
| Endurecer `validarFuso` | Quebra os testes da D-016 (`UTC`, `Asia/Kolkata`) e os chamadores de conversão, que só precisam de "o `Intl` conhece". A regra "canônico" é de **entrada** do usuário, não de cálculo. |
| Validar fuso por `resolvedOptions().timeZone === v` | No Node 24 o V8 preserva o identificador informado (aliases passam). Não distingue `Brazil/East` de `America/Sao_Paulo`. |
| Lista fixa de fusos no código | Divergiria do tzdata do runtime. O ICU é a fonte, e só os 16 nomes do Brasil (para o grupo e os rótulos) são fixos, filtrados pela lista do runtime. |
| Rebaixar o atual e depois `INSERT … ON CONFLICT DO UPDATE SET atual = true WHERE salao_id = EXCLUDED.salao_id` | Elegante, mas o `DO UPDATE` **trava a linha conflitante mesmo quando o `WHERE` falha**, e a ordem "rebaixar primeiro" faz o salão segurar a trava do próprio slug antes de esperar o de outro. Duas trocas cruzadas (A pede o atual de B e B pede o atual de A) formam ciclo → `deadlock detected` → 5xx. |
| Rebaixar o atual e depois `INSERT … DO NOTHING` | Mesmo ciclo: a checagem de unicidade espera a transação que atualizou (rebaixou) a linha conflitante, e cada lado já atualizou a própria. |
| Capturar `unique_violation` (23505) com `SAVEPOINT` | O projeto evita capturar violação e abortar transação (D-011 D-16). `ON CONFLICT DO NOTHING` decide sem erro. |
| `SELECT … FOR UPDATE` em `salao` | Conflita com o `FOR KEY SHARE` de toda FK para `salao`: uma troca de slug bloquearia, por um instante, a criação de reservas e bloqueios do salão. `FOR NO KEY UPDATE` basta. |
| `pg_advisory_xact_lock(hash(salao_id))` | Funciona, mas cria um segundo mecanismo de trava, invisível no esquema. A trava de linha já existe e serializa também com a gravação das regras. |
| CHECKs nas regras de `salao` (migração) | Ver §4 (DBA dispensado). |
| Coluna "virou histórico em" em `salao_slug` | A spec D-16 aceita a ordem por `criado_em`. Seria DDL sem CA que a exija. |
| Um formulário único | A spec D-10 decide por dois. |
| PRG (`redirect`) após salvar | O erro precisa dos valores digitados no estado. O sucesso também vai no estado (mesma resposta do POST, sem JS), como a criação de bloqueios (D-016 D-19). |

### 1.2 Dependências novas

Nenhuma. Usa `Intl`, `next/cache`, `next/navigation` e `src/components/ui/` (`Field`, `ErroDoCampo`, `Alert`, `Button`, `<select>` nativo estilizado no CSS do módulo).

## 2. Componentes afetados

| Caminho | Mudança |
|---|---|
| `src/server/tempo/fuso.ts` (+ `fuso.test.ts`) | `fusosCanonicos`, `ehFusoCanonico` (§3.1) |
| `src/config/navegacao.ts` (+ `.test.ts`) | `ROTAS.devConfiguracoes = '/dev/configuracoes'` |
| `src/server/salao/tipos.ts` (novo) | contratos, limites, mensagens; client-safe |
| `src/server/salao/validacao.ts` (+ `.test.ts`) (novo) | validação pura das regras e do slug |
| `src/server/salao/fusos.ts` (+ `.test.ts`) (novo) | opções do `<select>` de fuso |
| `src/server/repos/salao.ts` (novo), `repos/index.ts`, `repos/tipos.ts`, `repos/index.test.ts` | `RepoSalao` em `Repos.saloes` |
| `src/server/salao/configuracoes.ts`, `configuracoes.acao.ts` (novos) | serviço e ações |
| `src/app/painel/configuracoes/**` (novo) | página, casca, estado, dois formulários, CSS |
| `src/app/dev/configuracoes/**` (novo) | demonstração para o E2E |
| `tests/integration/salao/**` (novo) | integração |
| `e2e/configuracoes.spec.ts`, `e2e/configuracoes-sem-js.spec.ts` (novos) | CA-19, CA-20 |
| `README.md` | seção curta "Configurações do salão" |

Nada muda em `prisma/**`, `.env.example`, `docker-compose.yml`, `.github/**`, `src/proxy.ts`, `src/server/tenant/**`, `src/server/auth/**`, `src/lib/**`, `src/components/**`, `src/server/repos/{publico,cadastro,usuario,bloqueio}.ts`, `eslint.config.mjs`, `vitest.config.ts`, `playwright.config.ts` nem `tests/support/**`.

## 3. Interfaces

### 3.1 Fuso estrito (`src/server/tempo/fuso.ts`, acréscimo)

```ts
/**
 * Nomes de fuso aceitos como ENTRADA (D-017 RN-9): Intl.supportedValuesOf('timeZone') do runtime
 * (nomes canônicos do CLDR/ICU; não inclui UTC, offsets nem aliases). Calculado uma vez e congelado.
 */
export function fusosCanonicos(): readonly string[];
/** true só se `v` é string e pertence EXATAMENTE (mesma caixa, sem aparar) a fusosCanonicos(). Nunca lança. */
export function ehFusoCanonico(v: unknown): v is string;
```

- Cache em módulo: `let canonicos: { lista: readonly string[]; conjunto: ReadonlySet<string> } | null`.
- Cabeçalho: `validarFuso` = "o Intl conhece" (cálculo, inclusive dados antigos); `ehFusoCanonico` = "aceito como entrada nova". Todo canônico passa em `validarFuso` (teste).

### 3.2 Contratos (`src/server/salao/tipos.ts`) — client-safe

Sem import de runtime de `@/server/**`.

```ts
export const GRADES_PERMITIDAS = Object.freeze([5, 10, 15, 20, 30, 60] as const); // D-1
export const LIMITES_SALAO = Object.freeze({
  nome: { min: 2, max: 80 },              // = LIMITES_CADASTRO.nomeSalao (teste de igualdade)
  antecedenciaHoras: { min: 0, max: 72 }, // D-2 (gravada × 60)
  janelaDias: { min: 1, max: 365 },       // D-3
  intervaloMin: { min: 0, max: 120 },     // D-4
  slug: { min: 3, max: 60 },              // D-7
  numeroMaxCaracteres: 4,                 // texto numérico aparado acima disso → inválido
  slugMaxCaracteres: 200,                 // acima disso nem se normaliza (nunca é igual ao atual)
  ecoMaxCaracteres: 200,                  // corte do valor devolvido para reexibição
});

export type CampoRegras = 'nome' | 'fuso' | 'grade' | 'antecedencia' | 'janela' | 'intervalo';
export type ErrosRegras = Partial<Record<CampoRegras, string>>;
/** Textos do formulário (o que a casca lê e o que volta para a tela). */
export type ValoresRegras = Record<CampoRegras, string>;
export type EntradaRegras = Partial<Record<CampoRegras, unknown>>; // chaves extras (salaoId…) são ignoradas
export type EntradaSlug = { slug?: unknown };

/** Valores já validados, nas unidades do banco. */
export type RegrasSalao = {
  nome: string; fuso: string; gradeMin: number; antecedenciaMin: number; janelaDias: number; intervaloMin: number;
};

export type OpcaoFuso = { valor: string; rotulo: string };
export type OpcoesFuso = { atualForaDaLista: OpcaoFuso | null; brasil: OpcaoFuso[]; outros: OpcaoFuso[] };

export type ConfiguracoesSalao = {
  valores: ValoresRegras;                       // a partir do banco (antecedência em horas)
  fusos: OpcoesFuso;
  slug: { atual: string; anteriores: string[] }; // anteriores por criado_em desc, slug asc
};

export type ResultadoSalvarRegras =
  | { resultado: 'salvo'; valores: ValoresRegras }
  | { resultado: 'invalido'; erros: ErrosRegras };
export type ResultadoTrocarSlug =
  | { resultado: 'trocado'; slug: string }
  | { resultado: 'sem_efeito'; slug: string }
  | { resultado: 'invalido'; erros: { slug: string } };

export const MENSAGENS_CONFIGURACOES = Object.freeze({
  nome: 'Informe o nome do salão (de 2 a 80 caracteres).', // = MENSAGENS_CADASTRO.nomeSalao (teste)
  fuso: 'Escolha um fuso horário da lista.',
  grade: 'Escolha uma grade da lista: 5, 10, 15, 20, 30 ou 60 minutos.',
  antecedencia: 'Informe a antecedência mínima em horas inteiras, de 0 a 72.',
  antecedenciaJanela: 'A antecedência mínima precisa ser menor que a janela máxima.',
  janela: 'Informe a janela máxima em dias inteiros, de 1 a 365.',
  intervalo: 'Informe o intervalo em minutos inteiros, de 0 a 120.',
  slugFormato: 'Use de 3 a 60 caracteres: letras minúsculas sem acento, números e hífens entre eles.',
  slugReservado: 'Este endereço é reservado pelo sistema. Escolha outro.',
  slugEmUso: 'Este endereço já está em uso. Escolha outro.',
  resumoErros: 'Corrija os campos indicados para salvar.',
  regrasSalvas: 'Configurações salvas.',
  slugTrocado: 'Endereço público alterado. O endereço anterior continua levando ao salão.',
  slugSemEfeito: 'Este já é o endereço público do salão. Nada foi alterado.',
  ajudaFuso: 'As jornadas continuam com os mesmos horários de relógio, agora no novo fuso. Bloqueios e reservas já marcados não mudam de instante e passam a ser exibidos no novo fuso.',
  ajudaRegras: 'As regras valem para os próximos horários oferecidos. Reservas já feitas não mudam.',
  ajudaSlug: 'Letras minúsculas sem acento, números e hífens. Os endereços anteriores continuam levando ao salão e não podem ser usados por outro salão.',
  semAnteriores: 'Nenhum endereço anterior.',
  acessoNegado: 'Acesso negado.',
  formulario: 'Não foi possível ler os dados enviados. Recarregue a página e tente de novo.',
});
```

### 3.3 Repositório (`src/server/repos/salao.ts`)

Todo método chama `exigirEscopo(ctx)`; o `salao_id` vem só do contexto. SQL bruto (`$queryRaw`/`$executeRaw` com parâmetros tipados `::uuid`/`::text`) onde houver trava ou `ON CONFLICT`.

```ts
// repos/tipos.ts
export type ConfiguracoesDTO = {
  nome: string; fuso: string; gradeMin: number; antecedenciaMin: number; janelaDias: number; intervaloMin: number;
};
export type SlugsDoSalaoDTO = { atual: string; anteriores: { slug: string; criadoEm: Date }[] };
export type ResultadoTrocaSlugDTO = 'trocado' | 'em_uso';
```

```ts
export interface RepoSalao {
  /** findUnique por id do contexto; sem linha → NaoEncontrado. */
  obterConfiguracoes(ctx: ContextoEscopado): Promise<ConfiguracoesDTO>;
  /** Atual (exatamente um; zero → NaoEncontrado) e anteriores (atual = false) por criado_em desc, slug asc. */
  listarSlugs(ctx: ContextoEscopado): Promise<SlugsDoSalaoDTO>;
  /**
   * `SELECT fuso FROM salao WHERE id = $1::uuid FOR NO KEY UPDATE` → fuso; sem linha → NaoEncontrado.
   * Só dentro de emTransacao. Serializa, por salão, troca de slug e gravação das regras (D-18).
   * O texto "FOR NO KEY UPDATE" é o marcador procurado em pg_stat_activity pela T-6.
   */
  travar(ctx: ContextoEscopado): Promise<{ fuso: string }>;
  /** `SELECT slug FROM salao_slug WHERE salao_id = $1 AND atual` em COMANDO SEPARADO, depois de travar (ver nota). */
  slugAtual(ctx: ContextoEscopado): Promise<string>;
  /** updateMany { id } → os seis campos (@updatedAt atualiza atualizado_em); 0 linhas → NaoEncontrado. */
  atualizarConfiguracoes(ctx: ContextoEscopado, d: ConfiguracoesDTO): Promise<void>;
  /**
   * Pré-condições (do serviço): dentro de emTransacao, depois de travar(ctx); `novo` validado
   * (formato, tamanho, não reservado) e diferente do atual. Passos, nesta ordem:
   *  1. INSERT INTO salao_slug (slug, salao_id, atual) VALUES ($novo, $salao, false)
   *       ON CONFLICT (slug) DO NOTHING RETURNING slug
   *     sem linha → SELECT salao_id FROM salao_slug WHERE slug = $novo:
   *       outro salão (ou nenhuma linha, por segurança) → devolve 'em_uso' SEM ter gravado nada;
   *       o próprio salão (histórico, D-8) → segue.
   *  2. UPDATE salao_slug SET atual = false WHERE salao_id = $salao AND atual   (exatamente 1 linha)
   *  3. UPDATE salao_slug SET atual = true  WHERE salao_id = $salao AND slug = $novo (exatamente 1 linha)
   *  Contagem diferente de 1 em 2 ou 3 → Error (invariante quebrada; desfaz a transação).
   *  Nunca captura violação de constraint. Não toca a linha de `salao` (nem atualizado_em).
   */
  trocarSlug(ctx: ContextoEscopado, novo: string): Promise<ResultadoTrocaSlugDTO>;
}
```

**Por que esta ordem (respeita `salao_slug_atual_uniq` e não forma ciclo de espera):**
- O índice parcial é conferido a cada comando. Depois do passo 2 o salão tem zero atuais, e depois do 3 tem um. Inserir o novo já como `atual = true` antes de rebaixar violaria o índice.
- Única espera possível **entre salões**: o passo 1 de uma transação esperando outra que inseriu ou atualizou a mesma chave. Os passos 2 e 3 só tocam linhas do próprio salão, que está serializado pela trava de `salao`, então uma transação nos passos 2 e 3 nunca espera outro salão. Logo, não há ciclo:
  - **Disputa do mesmo slug novo (CA-12):** B espera o `INSERT` de A no passo 1. A conclui e confirma. B vê o conflito, lê o dono (A) e devolve `em_uso`. Se A desfizer, o `INSERT` de B segue e B vence.
  - **Troca cruzada** (A pede o atual de B e B pede o de A): cada passo 1 vê uma linha confirmada do outro (ninguém rebaixou nada ainda) e as duas devolvem `em_uso`, sem esperar nada.
  - **Mesmo salão (CA-13):** a segunda transação espera em `travar`. Como é READ COMMITTED, o `slugAtual` seguinte, num **comando separado**, vê o resultado confirmado da primeira. Por isso a leitura do atual **não** pode ir no mesmo comando do `FOR NO KEY UPDATE` com junção a `salao_slug`, porque a releitura do EvalPlanQual só atualiza a linha travada.
- `em_uso` sai antes de qualquer escrita: a transação confirma vazia (G-3).
- **Histórico do próprio salão (CA-10):** o passo 1 não insere nada, e os passos 2 e 3 só mudam `atual`. O número de linhas não muda.

### 3.4 Validação e fusos (puros)

```ts
// validacao.ts — sem next/*, sem Prisma, sem repos (só import type). Reutilizável pela E8.2.
/** RN-9..RN-11, RN-18. Todos os erros juntos. `fusoAtual`: exceção da RN-9 (valor gravado hoje é aceito). */
export function validarRegras(e: EntradaRegras, opcoes: { fusoAtual: string | null }):
  { ok: true; regras: RegrasSalao } | { ok: false; erros: ErrosRegras };
/** RN-12, 1ª parte: string → trim().toLowerCase(); não-string ou > slugMaxCaracteres → null. */
export function normalizarSlug(v: unknown): string | null;
/** RN-12/RN-13 sobre o valor JÁ normalizado: null se válido; senão a mensagem. */
export function validarNovoSlug(slug: string, reservados?: ReadonlySet<string>): string | null;
/** antecedencia_min (min) → texto em horas para o campo (RN-10). */
export function valoresDoSalao(c: ConfiguracoesDTO): ValoresRegras; // import type de repos/tipos
```

Regras de `validarRegras`:
- **Nome:** `normalizarNome(e.nome, LIMITES_SALAO.nome)` (`src/lib/texto.ts`, a mesma função do cadastro). `null` → `nome`.
- **Fuso:** `ehFusoCanonico(e.fuso) || (typeof e.fuso === 'string' && e.fuso === fusoAtual)`, sem aparar. Senão → `fuso`.
- **Números** (`grade`, `antecedencia`, `janela`, `intervalo`): exige string. `t = v.trim()`; `t` deve casar `/^[0-9]{1,4}$/` (ASCII, sem sinal, ponto, vírgula, expoente nem espaço interno; zeros à esquerda aceitos, `015` = 15). Depois vem a faixa ou a lista. Não-string, vazio, `15.0`, `1e2`, `+2`, `2,5`, `-1` e `12345` → erro do campo.
- **Coerência** (D-5), só quando antecedência e janela são válidas individualmente: `antecedenciaHoras >= janelaDias * 24` → `antecedencia: antecedenciaJanela`.
- Resultado: `antecedenciaMin = horas * 60`.

`validarNovoSlug(n)`, em ordem: (1) não casa `FORMATO_SLUG` → `slugFormato`; (2) `reservados.has(n)` (padrão `SEGMENTOS_RESERVADOS`, sem cópia) → `slugReservado`; (3) tamanho fora de 3..60 → `slugFormato`. O reservado vem antes do tamanho para que todo segmento reservado que case o formato receba a mensagem de reservado (CA-9), mesmo que uma rota futura tenha 2 letras.

`valoresDoSalao`: `antecedencia = String(antecedenciaMin / 60)`. Se o valor gravado não for múltiplo de 60 (só por SQL direto), aparece com casas decimais e reprova ao salvar, de propósito: o gestor corrige. Os demais campos vêm de `String(n)`.

```ts
// fusos.ts — server-only (usa fusosCanonicos)
/** Os 16 fusos do Brasil com rótulo pt-BR, America/Sao_Paulo primeiro e os demais por rótulo (constante). */
export const FUSOS_BRASIL: readonly OpcaoFuso[]; // ex.: { valor: 'America/Sao_Paulo', rotulo: 'Brasília e São Paulo (America/Sao_Paulo)' }
/**
 * brasil = FUSOS_BRASIL ∩ fusosCanonicos() (na ordem da constante); outros = canônicos fora do Brasil,
 * na ordem do ICU, com rotulo = valor; atualForaDaLista = { valor: atual, rotulo: `${atual} (atual)` }
 * quando o atual não é canônico (RN-9, spec §6). Para a demonstração e para a página real.
 */
export function opcoesDeFuso(fusoAtual: string | null): OpcoesFuso;
```

Rótulos do Brasil (cidade, depois o nome IANA entre parênteses): Brasília e São Paulo; Araguaína; Belém; Boa Vista; Campo Grande; Cuiabá; Eirunepé; Fernando de Noronha; Fortaleza; Maceió; Manaus; Porto Velho; Recife; Rio Branco; Salvador (`America/Bahia`); Santarém.

### 3.5 Serviço e ações

Sem `next/*`. Cada função começa com `exigirPermissao(ctx, 'salao.configurar')` (segunda barreira depois de `defineAcao`).

```ts
// configuracoes.ts
export async function obter(ctx: TenantContext): Promise<ConfiguracoesSalao>;
export async function salvarRegras(ctx: TenantContext, e: unknown): Promise<ResultadoSalvarRegras>;
export async function trocarSlug(ctx: TenantContext, e: unknown): Promise<ResultadoTrocarSlug>;
```

- **`obter`:** `repos().saloes.obterConfiguracoes` + `listarSlugs` (em paralelo, sem transação) → `{ valores: valoresDoSalao(c), fusos: opcoesDeFuso(c.fuso), slug: { atual, anteriores: anteriores.map(s => s.slug) } }`.
- **`salvarRegras`:** entrada que não é objeto → todos os campos com erro (`validarRegras({})`). Depois, `emTransacao(t => { { fuso } = t.saloes.travar(ctx); v = validarRegras(e, { fusoAtual: fuso }); se !v.ok → invalido (nada gravado); t.saloes.atualizarConfiguracoes(ctx, v.regras); → salvo com valoresDoSalao(v.regras) })`. Prevalece a última gravação (D-11).
- **`trocarSlug`:** `n = normalizarSlug(e?.slug)`. Se `n === null` → `invalido { slug: slugFormato }`, sem consultar o banco. Senão, `emTransacao(t => { t.saloes.travar(ctx); atual = t.saloes.slugAtual(ctx); se n === atual → sem_efeito (D-9: sem validar o formato); erro = validarNovoSlug(n); se erro → invalido; r = t.saloes.trocarSlug(ctx, n); r === 'em_uso' → invalido { slug: slugEmUso }; → trocado })`.
- Log JSON numa linha, só com ids e resultados: `salao.configuracoes_salvas { salaoId }` e `salao.slug_trocado { salaoId, resultado: 'trocado'|'sem_efeito'|'em_uso' }`. O log não leva valores de campos.

```ts
// configuracoes.acao.ts — sem 'use server'; só exportações de defineAcao
export const salvarConfiguracoes = defineAcao<EntradaRegras, ResultadoSalvarRegras>(
  { papeis: ['gestor'], capacidade: 'configurar' }, (ctx, e) => servico.salvarRegras(ctx, e));
export const trocarSlugDoSalao = defineAcao<EntradaSlug, ResultadoTrocarSlug>(
  { papeis: ['gestor'], capacidade: 'configurar' }, (ctx, e) => servico.trocarSlug(ctx, e));
```

### 3.6 Telas (`src/app/painel/configuracoes/`)

| Arquivo | Conteúdo |
|---|---|
| `estado.ts` | `EstadoRegras = { mensagem: string \| null; sucesso: string \| null; erros: ErrosRegras; valores: ValoresRegras }`; `EstadoSlug = { mensagem; sucesso; erros: { slug?: string }; valor: string }`; `estadoRegrasInicial(valores)`, `estadoSlugInicial()`. `lerFormularioRegras(fd)` lê **só** os seis nomes conhecidos (ignora `salaoId` e outros extras e também arquivos) → `{ entrada, valores }` (eco cortado em `ecoMaxCaracteres`). `lerFormularioSlug(fd)` → `{ entrada: { slug }, valor }`. `idDoCampo(campo)` → `config-<campo>`. Só `import type` e constantes de `@/server/salao/tipos`. |
| `FormularioRegras.tsx` (+ `.test.tsx`) | `'use client'`; `useActionState(acao, inicial)`; `<form action noValidate>`. Props: `acao`, `valoresIniciais`, `fusos: OpcoesFuso`. Campos: `nome` (texto, `maxLength` 80, `autoComplete="organization"`); `fuso` (`<select>` nativo com a opção "fora da lista", se houver, depois `<optgroup label="Brasil">` e `<optgroup label="Outros">`; `aria-describedby` com a ajuda `ajudaFuso` e o erro); `grade` (`<select>` com `GRADES_PERMITIDAS`, rótulo "Grade de horários (minutos)"); `antecedencia` "Antecedência mínima (horas)", `janela` "Janela máxima (dias)" e `intervalo` "Intervalo entre atendimentos (minutos)" (`inputMode="numeric"`, `maxLength` 4, `pattern="[0-9]*"`). Ajuda geral `ajudaRegras`. Com erros: **resumo** no topo (`tabIndex=-1`, título `resumoErros`, links `#config-<campo>`), focado por `useEffect`. Com sucesso: `Alert` de status focável (`tabIndex=-1`), focado. `mensagem` (403 ou formulário) num `Alert` de erro. Botão "Salvar configurações". |
| `FormularioSlug.tsx` (+ `.test.tsx`) | `'use client'`. Props: `acao`, `slugAtual`, `anteriores: string[]`. Mostra "Endereço público atual:" + `ROTAS.salaoPublico(slugAtual)` como **texto** (D-16); campo `slug` (rótulo "Novo endereço", prefixo visual "/", `maxLength` 60, `autoCapitalize="none"`, `spellCheck={false}`, `aria-describedby` com `ajudaSlug` e o erro); botão "Trocar endereço"; lista "Endereços anteriores" (`<ul>` de `ROTAS.salaoPublico(s)` como texto, ou `semAnteriores`). Resumo e erros com o mesmo padrão; sucesso `slugTrocado` ou `slugSemEfeito`, focado. |
| `Configuracoes.module.css` | Só `var(--…)` e o breakpoint `48rem`; o `<select>` nativo ocupa 100% da largura (sem rolagem horizontal a 375 px, mesmo com os rótulos longos de "Outros"). |
| `page.tsx` | (1) `exigirAcessoAoPainel(ROTAS.configuracoes, ['gestor'], 'salao.configurar')`, negado → `<AcessoNegado />` (sem nenhuma leitura de dados); (2) `obter(ctx)` e `buscarIdentidadeDoPainel(ctx)` em paralelo; (3) `PanelLayout caminhoAtual=ROTAS.configuracoes`, `h1` "Configurações"; (4) seção "Dados e regras de horário" com `FormularioRegras acao={salvarConfiguracoesAcao}`; (5) seção "Endereço público" com `FormularioSlug acao={trocarSlugAcao}`. |
| `acoes.ts` | `'use server'`. `salvarConfiguracoesAcao(anterior, fd)` e `trocarSlugAcao(anterior, fd)`: `ler…` → ação. `nao_autenticado` → `redirect('/entrar?proximo=' + encodeURIComponent(ROTAS.configuracoes))` **fora de `try`**. `acesso_negado`/`nao_encontrado` → `mensagem` com os valores. `invalido` → erros com os valores. Sucesso: `revalidatePath(ROTAS.painel, 'layout')` (o nome no cabeçalho de todo o painel) e estado com `sucesso` e os valores **normalizados** do servidor (`valores` de `salvo`; no slug, campo vazio). A casca não importa `@/server/repos`. |

### 3.7 Demonstração (`src/app/dev/configuracoes/`)

- `page.tsx`: `dynamic = 'force-dynamic'`; `notFound()` sem `vitrineHabilitada(process.env)`; metadados `noindex`. Salão de exemplo: nome "Studio Exemplo", fuso `America/Sao_Paulo`, valores padrão (15, 2, 60, 0), slug atual `studio-exemplo`, anteriores `['studio-antigo']`, opções por `opcoesDeFuso('America/Sao_Paulo')`. `?fuso=alias` usa `Brazil/East` como atual (mostra a opção fora da lista).
- `acoes.ts`: `'use server'`. Sem vitrine → estado inicial, sem efeito. Com vitrine: regras → `lerFormularioRegras` → `validarRegras(entrada, { fusoAtual: 'America/Sao_Paulo' })` → erros ou sucesso com os valores normalizados; slug → `normalizarSlug` → igual a `studio-exemplo` → `sem_efeito`; `validarNovoSlug` → erro; `studio-antigo` → aceito (histórico próprio); `em-uso` (constante `SLUG_EM_USO_DEMONSTRACAO`) → `slugEmUso`; senão `trocado`. Sem banco, sessão nem rede; nada é gravado.

## 4. Dados: DBA **dispensado**

- **Nenhuma DDL.** A PK global, `salao_slug_formato_chk` e `salao_slug_atual_uniq` garantem RN-3/RN-4 no banco. A ordem de comandos da §3.3 respeita o índice parcial.
- **CHECKs nas regras de `salao`: não adotados nesta demanda.** Motivos: (a) as faixas são decisões de produto da spec (D-1..D-5), e ampliá-las exigiria migração; (b) há dois escritores previstos (esta demanda e a E8.2), e os dois usam a **mesma** `validarRegras` (obrigação registrada em §11), como no critério das D-014/D-015/D-016 para validação só no servidor com escritor validado; (c) o consumidor sensível (E3.1) recebe a obrigação de tratar valores fora da faixa de forma defensiva (§11). Se o líder ou o usuário quiserem defesa no banco, o gatilho abaixo vale.
- **SQL novo:** `FOR NO KEY UPDATE` numa linha de `salao` por id e `INSERT … ON CONFLICT (slug) DO NOTHING RETURNING`. É o mesmo padrão já usado e testado na D-011, com semântica padrão do PostgreSQL. A ausência de impasse é verificada por teste (T-6: disputa, troca cruzada e mesmo salão ×10, mais o caso determinístico com `pg_stat_activity`).

Gatilho para acionar o DBA: `deadlock detected`, `unique_violation` vazada ou falha intermitente no laço da T-6, ou decisão de adotar CHECKs. Transferência pronta:

```
DEMANDA: D-017 — configurar fuso, regras e slug
DE: arquiteto-software  PARA: dba
OBJETIVO: revisar a troca de slug (ordem de comandos e travas) e/ou propor migração com CHECKs nas regras de salao
CONTEXTO NECESSÁRIO: design.md §0 (FOR NO KEY UPDATE × FOR KEY SHARE), §3.3 (passos 1–3 e análise de ciclos), §4
CRITÉRIOS DE ACEITAÇÃO: CA-1, CA-10, CA-12, CA-13 (e CA-4/CA-5 se houver CHECK)
DECISÕES JÁ TOMADAS: sem coluna nova; histórico nunca liberado; serialização por salao FOR NO KEY UPDATE; sem captura de 23505
ARQUIVOS ENVOLVIDOS: src/server/repos/salao.ts (leitura; posse do desenvolvedor); migração nova em prisma/migrations/ (posse do DBA, se houver)
EVIDÊNCIAS: saída do laço ×10 de tests/integration/salao/concorrencia.test.ts
PENDÊNCIAS: —
PRÓXIMA AÇÃO: parecer em docs/demandas/D-017/dba.md
```

## 5. Infraestrutura: DevOps **dispensado**

Nenhuma variável, container, script, dependência ou job novo. O E2E usa `/dev/configuracoes`, ligado pela `VITRINE_COMPONENTES=true` que o `webServer` do Playwright já define, e entra no glob do job `e2e` sem banco. A lista de fusos vem do ICU completo do Node 24, o mesmo na CI, na imagem Docker e localmente (`.nvmrc`). Observabilidade: eventos `salao.configuracoes_salvas` e `salao.slug_trocado` (§3.5).

## 6. Verificação das invariantes

| Invariante | Aplica? | Como |
|---|---|---|
| Escopo por salão no servidor | Sim | `salao_id` só de `exigirEscopo(ctx)` em todo método. A casca lê só os nomes conhecidos (`salaoId` forjado é descartado), e o serviço ignora chaves extras. A leitura global de `salao_slug` (passo 1) só devolve `em_uso`, sem o dono. Página e ações só para o gestor (matriz + `defineAcao`). Testes com dois salões (CA-2, CA-15). |
| Exclusion constraint anti-sobreposição | Indireta | Não é tocada. As regras não alteram reservas (CA-16 confere que ficam idênticas). |
| UTC + fuso do salão | Sim (central) | Fuso só canônico na entrada (RN-9). A troca não recalcula nada: jornada em hora de parede e bloqueios/reservas em UTC (RN-16, CA-16). Antecedência é gravada em minutos. |
| Adaptadores de integração | Não | Nenhuma integração nem mensagem. |
| Soft delete / anonimização | Não | Não toca profissionais, serviços nem clientes. Slugs nunca são apagados (histórico permanente). |
| Somente leitura do salão suspenso | Declarado | As duas ações usam `capacidade: 'configurar'` (CA-18). O efeito é da E6.4. A página não é uma ação. |
| Idempotência de webhooks/mensagens | Não | Sem webhook nem mensagem. Duplo envio: o slug cai em `sem_efeito` e as regras regravam os mesmos valores. |
| Auditoria do super admin | Não (aqui) | O super admin é negado. A E8.2 reutiliza a validação e `trocarSlug` com auditoria própria (§11). Sem auditoria para o gestor (spec D-16). |

## 7. Decisões

| ID | Decisão |
|---|---|
| D-1..D-16 | **Confirmadas** como na spec, com o ajuste de exemplo de D-17. |
| D-17 (nova) | "IANA válido" = membro exato de `Intl.supportedValuesOf('timeZone')` (CLDR). Os exemplos da spec §6 ficam assim: `Pacific/Chatham` é aceito; `Asia/Kathmandu` **é recusado** como entrada (a lista oferece `Asia/Katmandu`, a mesma zona), e o mesmo vale para `Asia/Kolkata` × `Asia/Calcutta`. Pela UI só se escolhe da lista, então só um POST forjado chega a esses nomes. Se um ICU futuro trocar os nomes canônicos, o valor já gravado continua aceito (exceção da RN-9). |
| D-18 (nova) | Serialização por salão com `SELECT … FROM salao … FOR NO KEY UPDATE` (não `FOR UPDATE`, não advisory lock), tanto na troca de slug quanto na gravação das regras. |
| D-19 (nova) | Ordem da troca: inserir o novo como histórico (`ON CONFLICT DO NOTHING`), depois rebaixar o atual, depois promover o novo (§3.3). É livre de ciclos de espera entre salões. |
| D-20 (nova) | Validação estrita do fuso numa função nova (`ehFusoCanonico`); `validarFuso` não muda. |
| D-21 (nova) | Slug: igual ao atual → `sem_efeito` **antes** da validação de formato (D-9). Na validação, a ordem é formato → reservado → tamanho. |
| D-22 (nova) | Números: `/^[0-9]{1,4}$/` depois de aparar (zeros à esquerda aceitos). A coerência D-5 só é avaliada com antecedência e janela válidas, e o erro vai no campo antecedência. |
| D-23 (nova) | Sucesso e erro no estado da ação, sem PRG, com `revalidatePath(ROTAS.painel, 'layout')` para o nome do cabeçalho. |
| D-24 (nova) | **Limite de trocas de slug (risco D-12): sem limite na v1** (o PLAN não pede limite, e a ocupação é de texto curto, sem custo relevante). Risco registrado em R-9; reavaliar na E8.2 (o super admin pode ver os slugs do salão) e no pós-v1. |
| D-25 (nova) | Fusos do Brasil: os 16 nomes fixos da §3.4, com rótulos pt-BR, filtrados pela lista do runtime. O grupo "Outros" usa o nome IANA como rótulo. |
| D-26 (nova) | O E2E (CA-19, CA-20) roda em `/dev/configuracoes` com ações de demonstração. A página real é coberta por integração (`renderToStaticMarkup`, T-8) e pelo passo manual com Docker (T-10/T-11). |

## 8. Riscos

| Risco | Mitigação |
|---|---|
| R-1: impasse ou 23505 vazado na troca de slug | Ordem da §3.3. T-6: disputa ×10 (CA-12), mesmo salão ×10 (CA-13), troca cruzada ×10 (as duas `em_uso`) e regras × slug ×10 no mesmo salão. Nenhum `deadlock detected` nem exceção não mapeada. **`timeout` explícito (30 s) em cada `it` com laço.** |
| R-2: leitura do atual no mesmo comando da trava (EvalPlanQual) | Comando separado (§3.3). Teste determinístico na T-6: uma conexão `pg` faz `BEGIN; SELECT … FOR NO KEY UPDATE` no salão A e outra troca o slug por SQL; a ação disparada espera (`pg_stat_activity`: `query LIKE '%FOR NO KEY UPDATE%'` e `wait_event_type = 'Lock'`); depois do `COMMIT`, ela termina com 1 atual e todos os anteriores como histórico. |
| R-3: trava bloqueia reservas | `FOR NO KEY UPDATE`. Teste na T-6: com a trava segurada por outra conexão, um `INSERT` em `bloqueio` do mesmo salão (FK → `FOR KEY SHARE`) conclui sem esperar. |
| R-4: lista do ICU difere entre ambientes | Mesmo Node 24 em todos (`.nvmrc`, imagem). Os testes não fixam o tamanho da lista: só membros conhecidos (`America/Sao_Paulo`, `America/Manaus`, `Pacific/Chatham`) e não membros (`UTC`, `Brazil/East`, `+03:00`). O teste de `FUSOS_BRASIL` confere que os 16 estão na lista do runtime. |
| R-5: `Asia/Kathmandu` citado na spec | D-17. O tester confere `Asia/Katmandu` aceito e `Asia/Kathmandu` recusado. |
| R-6: slug fixo repetido dentro de um arquivo de teste | Os laços usam sufixo por iteração (`disputado-${i}`); os CAs com nomes fixos (`studio-bela`) aparecem uma única vez por arquivo. |
| R-7: `redirect` dentro de `try` / lint de `href` literal | `redirect` só na casca, fora de `try`. Caminhos só por `ROTAS`; o endereço público é **texto**, não link. Resumo de erros com `#âncoras`. |
| R-8: 418 opções e rolagem horizontal a 375 px | `select { inline-size: 100% }`. O E2E confere `scrollWidth <= clientWidth` nas três telas. Teclado: setas no `<select>` fechado (Chromium). Se ficar instável, só esse passo usa `selectOption`, registrado no `dev.md` (mesmo critério do R-10 da D-016). |
| R-9: acúmulo de slugs (D-24) | Sem limite na v1; obrigação registrada para E8.2/pós-v1 (§11). |
| R-10: cobertura de `.tsx` e da casca | jsdom (T-7), `renderToStaticMarkup` (T-8), unitários da demonstração (T-9), sem exclusões. |
| R-11: E3.1 lendo regras fora da faixa (gravadas por SQL) | Obrigação para a E3.1 (§11); sem CHECK (§4). |

## 9. Estratégia de testes

| Camada | O quê |
|---|---|
| Unitário (`node`) | `src/server/tempo/fuso.test.ts` (acréscimo): `ehFusoCanonico` aceita `America/Sao_Paulo`, `America/Manaus`, `Pacific/Chatham` e `Asia/Katmandu`; recusa `America/Inexistente`, `+03:00`, `-0300`, `UTC`, `Etc/GMT+3`, `Brazil/East`, `US/Eastern`, `EST5EDT`, `america/sao_paulo`, ` America/Sao_Paulo`, `''`, `null`, `3` e `Asia/Kathmandu`; todo canônico passa em `validarFuso`; a lista é congelada e estável entre chamadas. `src/server/salao/validacao.test.ts`: CA-3..CA-9 (todos os casos), coerência (CA-6), exceção do fuso atual (`Brazil/East` aceito só se for o atual), dois erros juntos, tipos errados (número, `null`, array, ausente) e 10 000 caracteres sem lançar; `normalizarSlug`; `validarNovoSlug` iterando **o próprio** `SEGMENTOS_RESERVADOS` filtrado por `FORMATO_SLUG` (CA-9) e `painel-2` aceito; `valoresDoSalao` (120 → `"2"`); igualdade de `LIMITES_SALAO.nome`/`MENSAGENS_CONFIGURACOES.nome` com as do cadastro. `src/server/salao/fusos.test.ts`: 16 do Brasil presentes e em primeiro lugar no grupo, São Paulo primeiro, nenhum do Brasil em "Outros", `atualForaDaLista` só para não canônico. `src/config/navegacao.test.ts`: `devConfiguracoes`; `SEGMENTOS_RESERVADOS` inalterado. `src/server/repos/index.test.ts`: `saloes.*` com contexto inválido lançam antes de consultar. `src/app/dev/configuracoes/{page.test.tsx,acoes.test.ts}`: 404 sem vitrine, os dois ramos das ações, `em-uso`, `sem_efeito`. |
| Unitário (`jsdom`) | `FormularioRegras.test.tsx` (rótulos com unidade, `optgroup` Brasil/Outros, opção fora da lista, `aria-describedby` com ajuda e erro, `aria-invalid`, resumo focado, sucesso focado, valores preservados). `FormularioSlug.test.tsx` (endereço atual como texto sem `<a>`, lista de anteriores ou vazia, erro, sucesso, campo vazio após trocar). |
| Integração (PostgreSQL real) | `tests/integration/salao/`: `repos.test.ts` (T-3: `obterConfiguracoes`/`listarSlugs` com escopo; `trocarSlug` novo, histórico próprio, `em_uso` sem escrita, contagens 1/1; B intacto; `travar` com salão inexistente → 404). `slug-historico.test.ts` (CA-1 incl. `resolverSalaoPorSlug`, CA-2, CA-8 amostra, CA-9 `painel`/`admin`, CA-10, CA-11 com `criado_em` idênticos, CA-15 slug). `configuracoes.test.ts` (CA-3, CA-4, CA-5 amostra + dois erros sem gravar nem mudar `atualizado_em`, CA-6, CA-7, CA-14 ações, CA-15 regras com `salaoId` de B forjado, CA-16 com fotografia `to_jsonb` de `jornada`, `bloqueio`, `reserva` e `reserva_item` e `listar` de bloqueios mostrando 13:00–15:00, CA-17 dados criados por `criarSalaoComGestor`, CA-18 metadados, super admin 403, sem credencial 401). `concorrencia.test.ts` (CA-12, CA-13, R-1..R-3). `paginas.test.ts` (página e casca por `renderToStaticMarkup`, com `next/headers`/`next/navigation`/`next/cache` substituídos: CA-4 e CA-3 exibição após salvar, CA-7 cabeçalho, CA-14 profissional "Acesso negado" sem dados, gestor com perfil de profissional, sem sessão → `/entrar?proximo=%2Fpainel%2Fconfiguracoes`, CA-15 página de A só com dados de A, CA-17 valores padrão; casca: `invalido` com valores, `salaoId` extra descartado, sucesso + `revalidatePath`). `tests/integration/tenant/registro.test.ts` fica verde sem mudança. |
| E2E (Playwright 375×812, sem banco) | `e2e/configuracoes.spec.ts` (CA-19): em `/dev/configuracoes`, só com o teclado: envio com grade/antecedência inválidas (por digitação) → resumo focado, link leva ao campo, `aria-describedby`; corrige e salva → sucesso focado; troca de fuso pelo `<select>` com setas; slug reservado (`painel`) → erro; `bela-studio` → sucesso; foco visível em cada parada; axe 4.14.0 sem violações nas telas inicial, com erro e com sucesso (inclusive `?fuso=alias`); sem rolagem horizontal. `e2e/configuracoes-sem-js.spec.ts` (CA-20): `javaScriptEnabled: false`; os dois formulários com erro (valores preservados) e com sucesso. |
| Manual | T-10 (dev) e T-11 (tester), com Docker na página real: gestor e profissional, com e sem JS, 375 px, só teclado; troca de slug e consulta a `salao_slug`; nome no cabeçalho de outra página do painel. |

**Cobertura ≥ 90%:** todo arquivo novo de `src/` tem teste direto; páginas e casca via `paginas.test.ts`; demonstração via unitário. Medição na T-10 com `npm run test:coverage`. Abaixo do limiar, a tarefa dona completa os testes.

Comando de estabilidade (registrar no `dev.md` e sugerir para o `CLAUDE.md`):
```
for i in $(seq 10); do npx vitest run --project integration tests/integration/salao/concorrencia.test.ts || break; done
```

## 10. Tarefas

DBA e DevOps dispensados (§4, §5). Implementação: `desenvolvedor`.

| ID | Responsável | Depende de | Paralelo com | Arquivos sob posse |
|---|---|---|---|---|
| T-1 | desenvolvedor | — | T-2, T-3 | `src/server/tempo/fuso.ts`, `src/server/tempo/fuso.test.ts` |
| T-2 | desenvolvedor | — | T-1, T-3 | `src/server/salao/tipos.ts`, `src/config/navegacao.ts`, `src/config/navegacao.test.ts` |
| T-3 | desenvolvedor | — | T-1, T-2 | `src/server/repos/salao.ts`, `src/server/repos/index.ts`, `src/server/repos/tipos.ts`, `src/server/repos/index.test.ts`, `tests/integration/salao/repos.test.ts` |
| T-4 | desenvolvedor | T-1, T-2 | T-3, T-7 | `src/server/salao/validacao.ts`, `validacao.test.ts`, `fusos.ts`, `fusos.test.ts` |
| T-5 | desenvolvedor | T-3, T-4 | T-7 | `src/server/salao/configuracoes.ts`, `src/server/salao/configuracoes.acao.ts`, `tests/integration/salao/apoio.ts`, `tests/integration/salao/configuracoes.test.ts`, `tests/integration/salao/slug-historico.test.ts` |
| T-6 | desenvolvedor | T-5 | T-8, T-9 | `tests/integration/salao/concorrencia.test.ts` |
| T-7 | desenvolvedor | T-2 | T-3, T-4, T-5 | `src/app/painel/configuracoes/{estado.ts, FormularioRegras.tsx, FormularioRegras.test.tsx, FormularioSlug.tsx, FormularioSlug.test.tsx, Configuracoes.module.css}` |
| T-8 | desenvolvedor | T-5, T-7 | T-6, T-9 | `src/app/painel/configuracoes/page.tsx`, `src/app/painel/configuracoes/acoes.ts`, `tests/integration/salao/paginas.test.ts` |
| T-9 | desenvolvedor | T-4, T-7 | T-5, T-6, T-8 | `src/app/dev/configuracoes/{page.tsx, page.test.tsx, acoes.ts, acoes.test.ts}`, `e2e/configuracoes.spec.ts`, `e2e/configuracoes-sem-js.spec.ts` |
| T-10 | desenvolvedor | T-6, T-8, T-9 | — | `README.md`, `docs/demandas/D-017/dev.md` |
| T-11 | tester | T-10 | — | `docs/demandas/D-017/testes.md` |

Rodadas (sem arquivo em comum):
- **Rodada 1:** T-1 ‖ T-2 ‖ T-3.
- **Rodada 2:** T-4 ‖ T-7 (T-3 segue em paralelo se ainda não terminou).
- **Rodada 3:** T-5 ‖ T-9 (T-9 só precisa de T-4 e T-7).
- **Rodada 4:** T-6 ‖ T-8.
- **Rodada 5:** T-10. **Rodada 6:** T-11.

Regras de posse:
- Defeito num arquivo reabre a tarefa dona. Entre tarefas, só leitura: T-6/T-8 importam `tests/integration/salao/apoio.ts` (T-5); T-8/T-9 importam `estado.ts` e os formulários (T-7); T-7 importa `src/server/salao/tipos.ts` (T-2); T-9 importa `validacao.ts`/`fusos.ts` (T-4) e `e2e/suporte/vitrine.ts`; T-5 pode importar `tests/integration/bloqueios/apoio.ts` (`criarReservaEm`, `inserirBloqueio`, `definirFuso`) para o CA-16.
- `estado.ts` (T-7) só importa tipos e constantes de `tipos.ts`. Os formulários recebem as opções de fuso prontas por prop (não importam `fusos.ts`).
- Ninguém edita `prisma/**`, `tests/support/**`, `tests/integration/{tenant,auth,bloqueios,jornadas,profissionais,servicos}/**`, `src/server/tenant/**`, `src/server/auth/**`, `src/server/repos/{publico,cadastro,usuario,bloqueio}.ts`, `src/lib/**`, `src/components/**`, `src/app/dev/{componentes,jornada,bloqueios}/**`, `e2e/suporte/**`, `e2e/a11y-base.spec.ts`, `playwright.config.ts`, `eslint.config.mjs` nem `vitest.config.ts`. O `CLAUDE.md` é do líder.

**T-1 — Fuso estrito.** Entregável: §3.1 com o comentário que distingue `validarFuso` de `ehFusoCanonico`. Conclusão: `npx vitest run src/server/tempo` verde com os casos da §9 e os testes da D-016 sem mudança; `validarFuso` sem alteração de comportamento; lint e typecheck verdes.

**T-2 — Contratos e rotas.** Entregável: §3.2; `ROTAS.devConfiguracoes`. Conclusão: `npm run test:unit -- src/config` verde; `tipos.ts` sem import de runtime de `@/server/**`; lint e typecheck verdes.

**T-3 — Repositório.** Entregável: §3.3 (cabeçalho com a ordem dos passos, a análise de ciclos, o marcador `FOR NO KEY UPDATE` e a nota do comando separado). Conclusão: `repos.test.ts` cobre o que está listado na §9, inclusive linhas de B intactas e `em_uso` sem escrita; `index.test.ts` atualizado; `tests/integration/{bloqueios,tenant}` verdes sem mudança; lint e typecheck verdes.

**T-4 — Validação e fusos.** Entregável: §3.4. Conclusão: `npm run test:unit -- src/server/salao` verde com CA-3..CA-9 (unidade) e D-17/D-21/D-22; arquivos puros (só `import type` de `repos/tipos`); lint e typecheck verdes.

**T-5 — Serviço e ações.** Entregável: §3.5; `apoio.ts` (credenciais de gestor, profissional, gestor que atende e super admin; `linhaSalao(id)` com `to_jsonb`, incluindo `atualizado_em`; `slugsDe(salaoId)` com `criado_em`; fotografias de `jornada`, `bloqueio`, `reserva` e `reserva_item`). Testes pela ação (`acao.executar(credencial, input)`) cobrindo os CAs da §9. Conclusão: `npx vitest run --project integration tests/integration/salao/configuracoes.test.ts tests/integration/salao/slug-historico.test.ts` verde; `registro.test.ts` verde com as duas ações; nenhum `next/*` em `src/server/salao/**`; lint e typecheck verdes.

**T-6 — Concorrência.** Entregável: CA-12, CA-13 e R-1..R-3. Conclusão: laço ×10 da §9 verde; `timeout` explícito em cada `it`; nenhum `deadlock detected`, 23505 ou exceção não mapeada; conexões `pg` fechadas no `afterAll`.

**T-7 — Componentes.** Entregável: §3.6 (`estado.ts`, os dois formulários, CSS) com os testes jsdom. Conclusão: `npm run test:unit -- src/app/painel/configuracoes` verde; todo `*.test.tsx` começa com `/** @vitest-environment jsdom */`; CSS só com `var(--…)` e o breakpoint `48rem`; caminhos só por `ROTAS`; lint e typecheck verdes.

**T-8 — Página e casca.** Entregável: §3.6 (`page.tsx`, `acoes.ts`) e `paginas.test.ts`. Conclusão: `npx vitest run --project integration tests/integration/salao/paginas.test.ts tests/integration/auth/paginas.test.ts` verde (o segundo sem mudança); `npm run build` lista `/painel/configuracoes`; `redirect` fora de `try`; a casca não importa `@/server/repos`; lint e typecheck verdes.

**T-9 — Demonstração e E2E.** Entregável: §3.7, `e2e/configuracoes.spec.ts` (CA-19), `e2e/configuracoes-sem-js.spec.ts` (CA-20) e os unitários da página e das ações. Conclusão: `npm run test:e2e` verde (inclusive os specs existentes, sem mudança); axe sem violações nos estados da §9; `/dev/configuracoes` dá 404 sem a variável; lint e typecheck verdes.

**T-10 — Documentação e gates.** Entregável: seção "Configurações do salão" no README (campos e faixas, fuso da lista, efeito da troca de fuso, slug anterior como histórico permanente e reservado ao salão, redirecionamento pela E4.1); `dev.md` com a evidência dos gates, a cobertura, o laço ×10 e o passo manual; texto sugerido para o `CLAUDE.md` (D-017: `src/server/salao/`, `ehFusoCanonico` como validação de entrada de fuso, `RepoSalao.trocarSlug` com a ordem dos passos, `FOR NO KEY UPDATE` em `salao`, `/dev/configuracoes`, comando de estabilidade). Conclusão: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test:coverage` (≥ 90%) e `npm run test:e2e` verdes; laço da T-6 ×10 verde.

**T-11 — Validação independente (tester).** Entregável: `testes.md` com o veredito. Escopo: repetir os gates e o laço; conferir o mapa abaixo; D-17 (`Asia/Katmandu` × `Asia/Kathmandu`); POST forjado com `salaoId` de B e com fuso fora da lista; prova manual com Docker na página real.

### Mapa CA → tarefa → tipo de teste

| CA | Tarefa(s) | Tipo | Arquivo |
|---|---|---|---|
| CA-1 | T-3, T-5 | Integração | `repos.test.ts`, `slug-historico.test.ts` |
| CA-2 | T-3, T-5 | Integração (dois salões) | `repos.test.ts`, `slug-historico.test.ts` |
| CA-3 | T-1, T-4, T-5, T-8 | Unitário + integração | `fuso.test.ts`, `validacao.test.ts`, `configuracoes.test.ts`, `paginas.test.ts` |
| CA-4 | T-4, T-5, T-8 | Unitário + integração | `validacao.test.ts`, `configuracoes.test.ts`, `paginas.test.ts` |
| CA-5 | T-4, T-5 | Unitário + integração | `validacao.test.ts`, `configuracoes.test.ts` |
| CA-6 | T-4, T-5 | Unitário + integração | idem |
| CA-7 | T-4, T-5, T-8 | Unitário + integração | `validacao.test.ts`, `configuracoes.test.ts`, `paginas.test.ts` |
| CA-8 | T-4, T-5 | Unitário + integração | `validacao.test.ts`, `slug-historico.test.ts` |
| CA-9 | T-4, T-5 | Unitário (todo o conjunto) + integração | `validacao.test.ts`, `slug-historico.test.ts` |
| CA-10 | T-3, T-5 | Integração | `repos.test.ts`, `slug-historico.test.ts` |
| CA-11 | T-5 | Integração | `slug-historico.test.ts` |
| CA-12 | T-6 | Integração (concorrência ×10) | `concorrencia.test.ts` |
| CA-13 | T-6 | Integração (concorrência ×10 + determinístico) | `concorrencia.test.ts` |
| CA-14 | T-5, T-8 | Integração | `configuracoes.test.ts`, `paginas.test.ts` |
| CA-15 | T-5, T-8 | Integração (dois salões) | `configuracoes.test.ts`, `slug-historico.test.ts`, `paginas.test.ts` |
| CA-16 | T-5 | Integração | `configuracoes.test.ts` |
| CA-17 | T-5, T-8 | Integração | `configuracoes.test.ts`, `paginas.test.ts` |
| CA-18 | T-5 | Integração + registro | `configuracoes.test.ts`, `tenant/registro.test.ts` |
| CA-19 | T-7, T-9, T-11 | jsdom + E2E + manual | `Formulario*.test.tsx`, `configuracoes.spec.ts`, `testes.md` |
| CA-20 | T-8, T-9, T-11 | Integração (casca) + E2E sem JS + manual | `paginas.test.ts`, `configuracoes-sem-js.spec.ts`, `testes.md` |

## 11. Obrigações registradas para as próximas demandas

- **E3.1 (#27):** ler as regras em `salao` (antecedência em **minutos**; grade ∈ `GRADES_PERMITIDAS`). Como não há CHECK no banco, tratar defensivamente um valor fora da faixa (por exemplo, grade ≤ 0 nunca entra em laço; registrar log e usar o padrão). A troca de fuso não recalcula nada: a jornada é interpretada no fuso **atual** do salão.
- **E4.1 (#37):** redirecionar o slug histórico com `resolverSalaoPorSlug` (`historico`/`slugAtual`). Um slug atual que depois coincida com uma rota nova continua atual (spec §6); o conflito com a rota fica com a E4.1.
- **E6.4 (#41):** as duas ações já declaram `configurar`. A recusa no salão suspenso entra pela política, e a página deve mostrar o estado somente leitura.
- **E8.2 (#52):** reutilizar `validarRegras` (com `fusoAtual`), `normalizarSlug`/`validarNovoSlug` e `RepoSalao.travar`/`slugAtual`/`trocarSlug` dentro de `emTransacao`, com o contexto escopado do salão alvo e a auditoria (valores antigos e novos) na mesma transação. Avaliar um limite ou a visualização do acúmulo de slugs (D-24).
