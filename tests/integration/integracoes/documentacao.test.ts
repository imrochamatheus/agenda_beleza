import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DIAS_TESTE, PRECO_MENSAL_CENTAVOS } from '@/config/plano';
import { ErroDeAmbiente, chavesDeclaradas, validarEnv } from '@/server/env';
import * as ambienteEmail from '@/server/integrations/email/ambiente';
import { opcoesDoTransporte } from '@/server/integrations/email/real';
import { criarEmailSimulado } from '@/server/integrations/email/simulado';
import * as ambienteMercadoPago from '@/server/integrations/mercadopago/ambiente';
import { criarMercadoPagoSimulado } from '@/server/integrations/mercadopago/simulado';
import { SEGREDO_WEBHOOK_SIMULADO } from '@/server/integrations/mercadopago/webhook-simulado';
import { NaoImplementado } from '@/server/integrations/nao-implementado';
import * as ambienteTurnstile from '@/server/integrations/turnstile/ambiente';
import {
  CHAVE_SITE_TURNSTILE_SIMULADA,
  TOKEN_TURNSTILE_SIMULADO,
  criarTurnstileSimulado,
} from '@/server/integrations/turnstile/simulado';
import * as ambienteWhatsApp from '@/server/integrations/whatsapp/ambiente';
import { criarWhatsAppSimulado } from '@/server/integrations/whatsapp/simulado';

import { conectar, emailNovo, telefoneNovo } from '../../support/sql';

// README × .env.example × código (CA-4, CA-25; dba.md §2.7). O README é a documentação dos
// adaptadores: este teste prova que os nomes, valores e comandos que ele cita existem no código e
// funcionam. Os comandos SQL documentados são extraídos do README e executados contra a base deste
// worker (PostgreSQL real), sem cópia do SQL no teste.

const README = readFileSync(new URL('../../../README.md', import.meta.url), 'utf8');
const EXEMPLO = parseEnv(readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8')) as Record<
  string,
  string
>;

const APP_URL = 'http://localhost:3000';
const SELETORES = [
  ambienteEmail.SELETOR,
  ambienteWhatsApp.SELETOR,
  ambienteMercadoPago.SELETOR,
  ambienteTurnstile.SELETOR,
] as const;
const CHAVES_DOS_PROVEDORES = [
  ...ambienteEmail.CHAVES,
  ...ambienteTurnstile.CHAVES,
  ...ambienteMercadoPago.CHAVES,
  ...ambienteWhatsApp.CHAVES,
];

/** Texto da seção cujo título (sem os `#`) começa com `titulo`, até o próximo título de nível igual ou maior. */
function secao(titulo: string, texto = README): string {
  const linhas = texto.split('\n');
  const inicio = linhas.findIndex((l) => /^#{2,4} /.test(l) && l.replace(/^#+ /, '').startsWith(titulo));
  if (inicio < 0) throw new Error(`seção ausente no README: ${titulo}`);
  const nivel = /^#+/.exec(linhas[inicio])![0].length;
  const fim = linhas.findIndex((l, i) => i > inicio && /^#+ /.test(l) && /^#+/.exec(l)![0].length <= nivel);
  return linhas.slice(inicio, fim < 0 ? undefined : fim).join('\n');
}

/** Parágrafo (até a linha em branco seguinte a um bloco) que começa com o rótulo em negrito. */
function paragrafo(rotulo: string, texto = README): string {
  const i = texto.indexOf(`**${rotulo}**`);
  if (i < 0) throw new Error(`parágrafo ausente no README: ${rotulo}`);
  const proximo = texto.indexOf('\n**', i + rotulo.length + 4);
  return texto.slice(i, proximo < 0 ? undefined : proximo);
}

/** O SQL do `-c "…"` da única linha `docker compose exec postgres psql …` que contém `marcador`. */
function sqlDoComandoPsql(marcador: string): { usuario: string; base: string; sql: string } {
  const linhas = README.split('\n').filter(
    (l) => l.startsWith('docker compose exec postgres psql ') && l.includes(marcador),
  );
  expect(linhas, `um único comando psql com ${marcador}`).toHaveLength(1);
  const m = /-U (\S+) -d (\S+) -c "([^"]+)"$/.exec(linhas[0]);
  if (!m) throw new Error(`comando psql fora do formato esperado: ${linhas[0]}`);
  return { usuario: m[1], base: m[2], sql: m[3] };
}

let c: pg.Client;

beforeAll(async () => {
  c = await conectar();
});
afterAll(async () => {
  await c.end();
});

describe('CA-25: README × .env.example × env.ts', () => {
  const credenciais = secao('Credenciais para os serviços reais');

  it('CA-25: a seção de credenciais cita os 4 seletores e todas as variáveis dos provedores, que existem no .env.example e no env.ts', () => {
    expect(CHAVES_DOS_PROVEDORES.length).toBeGreaterThan(0);
    for (const chave of [...SELETORES, ...CHAVES_DOS_PROVEDORES]) {
      expect(credenciais, `README (credenciais) cita ${chave}`).toContain(`\`${chave}\``);
      expect(Object.keys(EXEMPLO), `.env.example declara ${chave}`).toContain(chave);
      expect(chavesDeclaradas(), `env.ts declara ${chave}`).toContain(chave);
    }
  });

  it('CA-25: nenhuma variável de integração citada no README deixou de existir (sem nome obsoleto)', () => {
    const citadas = new Set(README.match(/\b(?:SMTP|EMAIL|TURNSTILE|MP|WHATSAPP)_[A-Z][A-Z0-9_]*\b/g) ?? []);
    expect(citadas.size).toBeGreaterThanOrEqual(SELETORES.length + CHAVES_DOS_PROVEDORES.length);
    const desconhecidas = [...citadas].filter((v) => !chavesDeclaradas().includes(v));
    expect(desconhecidas).toEqual([]);
  });

  it('CA-25: o .env.example deixa os seletores em simulado e as variáveis dos provedores vazias, como o README diz', () => {
    expect(SELETORES.map((s) => EXEMPLO[s])).toEqual(SELETORES.map(() => 'simulado'));
    expect(CHAVES_DOS_PROVEDORES.filter((k) => EXEMPLO[k] !== '')).toEqual([]);
    expect(credenciais).toContain('Nunca versione valores reais');
  });

  it('CA-25: as portas SMTP padrão e o requireTLS documentados são os do código', () => {
    const email = secao('E-mail transacional', credenciais);
    const base = { SMTP_HOST: 'smtp.exemplo.com.br', EMAIL_FROM: 'nao-responda@exemplo.com.br' };
    const padrao = ambienteEmail.lerConfigReal(base);
    const seguro = ambienteEmail.lerConfigReal({ ...base, SMTP_SECURE: 'true' });
    if (!padrao.ok || !seguro.ok) throw new Error('config SMTP de referência inválida');
    expect([padrao.config.porta, seguro.config.porta]).toEqual([
      ambienteEmail.PORTA_PADRAO,
      ambienteEmail.PORTA_PADRAO_SEGURA,
    ]);
    const linhaPorta = email.split('\n').find((l) => l.startsWith('| `SMTP_PORT`'));
    expect(linhaPorta).toContain(`**${padrao.config.porta}**`);
    expect(linhaPorta).toContain(`**${seguro.config.porta}**`);

    const comAuth = ambienteEmail.lerConfigReal({ ...base, SMTP_USER: 'u', SMTP_PASSWORD: 'p' });
    if (!comAuth.ok) throw new Error('config SMTP com autenticação inválida');
    expect(opcoesDoTransporte(comAuth.config).requireTLS).toBe(true);
    expect(email).toContain('`requireTLS`');
  });

  it('CA-25: MP e WhatsApp reais aparecem como E6.6 e E7.2 e são de fato recusados na inicialização', () => {
    const mp = secao('Mercado Pago', credenciais);
    const wa = secao('WhatsApp Business Platform', credenciais);
    expect(mp).toContain(`Adaptador real: ${new NaoImplementado('E6.6').item}`);
    expect(wa).toContain(`Adaptador real: ${new NaoImplementado('E7.2').item}`);
    expect(mp).toContain('recusado na inicialização');
    expect(wa).toContain('recusado na inicialização');
    expect(wa).toContain('4 templates aprovados');

    const fonte = { DATABASE_URL: 'postgresql://u:p@localhost:5432/b', MP_ADAPTER: 'real', WHATSAPP_ADAPTER: 'real' };
    let erro: unknown;
    try {
      validarEnv(fonte);
    } catch (e) {
      erro = e;
    }
    expect(erro).toBeInstanceOf(ErroDeAmbiente);
    expect((erro as ErroDeAmbiente).variaveis).toEqual(['MP_ADAPTER', 'WHATSAPP_ADAPTER']);
  });

  it('CA-25: credenciais exigidas pelo CLAUDE.md têm subseção própria (MP, WhatsApp, e-mail, Turnstile)', () => {
    for (const titulo of ['E-mail transacional', 'Cloudflare Turnstile', 'Mercado Pago', 'WhatsApp Business Platform']) {
      expect(() => secao(titulo, credenciais), titulo).not.toThrow();
    }
  });

  it('CA-25 (CA-2, ajuste A-1 do DevOps): a saída documentada para EMAIL_ADAPTER=real com o .env.example é a do check-env', () => {
    const integracoes = secao('Integrações (adaptadores)');
    let erro: unknown;
    try {
      validarEnv({ ...EXEMPLO, EMAIL_ADAPTER: 'real' });
    } catch (e) {
      erro = e;
    }
    expect(erro).toBeInstanceOf(ErroDeAmbiente);
    expect((erro as ErroDeAmbiente).variaveis).toEqual(['EMAIL_FROM', 'SMTP_HOST']);
    // Mesmo prefixo que src/server/check-env.ts escreve na saída de erro.
    expect(integracoes).toContain(`\`check-env: ${(erro as ErroDeAmbiente).message}\``);
  });

  it('CA-25: o valor do plano citado é o de src/config/plano.ts', () => {
    const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
      .format(PRECO_MENSAL_CENTAVOS / 100)
      .replace(/ /g, ' ');
    const integracoes = secao('Integrações (adaptadores)');
    expect(integracoes).toContain(brl);
    expect(integracoes).toContain(`PRECO_MENSAL_CENTAVOS = ${PRECO_MENSAL_CENTAVOS}`);
    expect(integracoes).toContain(`DIAS_TESTE = ${DIAS_TESTE}`);
  });
});

describe('CA-4: Turnstile simulado documentado', () => {
  it('CA-4: o token e a chave do README são os do simulado, e o token documentado é aceito', async () => {
    const texto = paragrafo('Turnstile simulado.');
    const [token, chave] = [...texto.matchAll(/`([^`]+)`/g)].map((m) => m[1]).filter((v) => !v.includes('('));
    expect(token).toBe(TOKEN_TURNSTILE_SIMULADO);
    expect(chave).toBe(CHAVE_SITE_TURNSTILE_SIMULADA);

    const turnstile = criarTurnstileSimulado();
    await expect(turnstile.validar({ token })).resolves.toEqual({ valido: true });
    await expect(turnstile.validar({ token: `${token}x` })).resolves.toEqual({
      valido: false,
      motivo: 'token_invalido',
    });
    expect(turnstile.chaveDoSite()).toBe(chave);
  });
});

describe('CA-25: comandos e recursos dos simulados documentados', () => {
  const simulados = secao('Adaptadores simulados');

  it('CA-25 (D-9): o psql do email_log usa o usuário e a base do .env.example e lê o e-mail enviado', async () => {
    const { usuario, base, sql } = sqlDoComandoPsql('email_log');
    expect([usuario, base]).toEqual([EXEMPLO.POSTGRES_USER, EXEMPLO.POSTGRES_DB]);

    const para = emailNovo();
    const link = `${APP_URL}/recuperar-senha?token=${randomUUID()}`;
    await criarEmailSimulado().enviar({ para, assunto: 'Recuperação de senha', texto: `Acesse ${link}` });

    const r = await c.query<{ destinatario: string; assunto: string; corpo: string; criado_em: Date }>(sql);
    expect(r.rows.length).toBeGreaterThanOrEqual(1);
    expect(r.rows[0]).toMatchObject({ destinatario: para, assunto: 'Recuperação de senha', corpo: `Acesse ${link}` });
    expect(r.rows[0].criado_em).toBeInstanceOf(Date);
  });

  it('CA-25 (RN-20): /dev/mp-checkout documentado é a urlCheckout gerada, só com MP_ADAPTER=simulado, noindex e preapproval_id', async () => {
    const mp = paragrafo('Mercado Pago simulado.', simulados);
    const modelo = /`(\$\{APP_URL\}\/dev\/mp-checkout\?assinatura=<id>)`/.exec(mp)?.[1];
    expect(modelo).toBeDefined();

    const { assinaturaId, urlCheckout } = await criarMercadoPagoSimulado({ appUrl: APP_URL }).criarAssinatura({
      salaoId: randomUUID(),
      emailPagador: emailNovo(),
      urlRetorno: `${APP_URL}/assinatura/retorno`,
    });
    expect(urlCheckout).toBe(modelo!.replace('${APP_URL}', APP_URL).replace('<id>', assinaturaId));

    expect(mp).toContain('**só existe com `MP_ADAPTER=simulado`**');
    expect(mp).toContain('`noindex`');
    expect(mp).toContain('`preapproval_id=<id>`');
    expect(mp).toContain('`urlRetorno` **gravada**');
    expect(mp).toContain(`\`${SEGREDO_WEBHOOK_SIMULADO}\``);
  });

  it('CA-25 (RN-4): as funções de controle dos exemplos existem nos simulados do MP e do WhatsApp', () => {
    const metodos = (obj: string) =>
      [...simulados.matchAll(new RegExp(`await ${obj}\\.(\\w+)\\(`, 'g'))].map((m) => m[1]);
    const doMp = metodos('mp');
    const doWa = metodos('wa');
    expect(doMp).toEqual(['autorizar', 'aprovarCobranca', 'falharCobranca', 'cancelar', 'forcarErro']);
    expect(doWa).toEqual(['forcarFalhas', 'forcarFalhas', 'listarChamadas']);

    const mp = criarMercadoPagoSimulado({ appUrl: APP_URL }) as unknown as Record<string, unknown>;
    const wa = criarWhatsAppSimulado() as unknown as Record<string, unknown>;
    expect(doMp.filter((m) => typeof mp[m] !== 'function')).toEqual([]);
    expect(doWa.filter((m) => typeof wa[m] !== 'function')).toEqual([]);
    expect(simulados).toContain('`listarAdiamentos(id)`');
    expect(typeof mp.listarAdiamentos).toBe('function');
  });

  it('CA-25 (D-5/R-7): o aviso de que o modo simulado não serve para publicação está na seção', () => {
    expect(simulados).toContain('**Não publique**');
    expect(simulados).toContain('`MP_ADAPTER=simulado`');
    // Ajuste A-2 do DevOps: o POST do checkout não tem proteção CSRF, junto da recomendação.
    const aviso = simulados.split('\n').find((l) => l.startsWith('> **Aviso:**'));
    expect(aviso).toContain('`POST /dev/mp-checkout/decisao` não verifica a origem');
    expect(aviso).toContain('proteção CSRF');
    expect(aviso).toContain('nunca publique com nenhum seletor em `simulado`');
  });

  it('CA-25 (dba.md §2.7): a limpeza documentada cobre exatamente as tabelas sim_*, esvazia todas e não toca o resto', async () => {
    const { usuario, base, sql } = sqlDoComandoPsql('DELETE FROM sim_');
    expect([usuario, base]).toEqual([EXEMPLO.POSTGRES_USER, EXEMPLO.POSTGRES_DB]);
    expect(paragrafo('Limpeza das tabelas dos simulados.', simulados)).toContain(
      '**só na base local de desenvolvimento ou de teste**',
    );

    const catalogo = await c.query<{ tabela: string }>(
      "SELECT tablename AS tabela FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'sim\\_%' ORDER BY 1",
    );
    const noComando = [...sql.matchAll(/DELETE FROM (\w+);/g)].map((m) => m[1]);
    expect([...noComando].sort()).toEqual(catalogo.rows.map((r) => r.tabela));
    expect(noComando).toHaveLength(6);

    // Uma linha em cada tabela sim_*, mais um e-mail (fora da limpeza).
    const mp = criarMercadoPagoSimulado({ appUrl: APP_URL });
    const { assinaturaId } = await mp.criarAssinatura({
      salaoId: randomUUID(),
      emailPagador: emailNovo(),
      urlRetorno: `${APP_URL}/retorno`,
    });
    await mp.autorizar(assinaturaId);
    await mp.aprovarCobranca(assinaturaId);
    await mp.adiarProximaCobranca(assinaturaId, new Date(Date.now() + 90 * 86_400_000));
    await mp.forcarErro('consultarPagamento');
    const wa = criarWhatsAppSimulado();
    await wa.enviarModelo({
      destinatarioE164: telefoneNovo(),
      modelo: 'confirmacao',
      parametros: { nome: 'Ana' },
      chaveIdempotencia: `${randomUUID()}:confirmacao:1`,
    });
    await wa.forcarFalhas(1, 'temporaria');
    await criarEmailSimulado().enviar({ para: emailNovo(), assunto: 'Fica', texto: 'fora da limpeza' });

    const contar = async () => {
      const r = await c.query<{ tabela: string; n: number }>(
        noComando.map((t) => `SELECT '${t}' AS tabela, count(*)::int AS n FROM ${t}`).join(' UNION ALL '),
      );
      return Object.fromEntries(r.rows.map((x) => [x.tabela, x.n]));
    };
    const emails = async () => (await c.query<{ n: number }>('SELECT count(*)::int AS n FROM email_log')).rows[0].n;

    const antes = await contar();
    expect(Object.values(antes).every((n) => n >= 1), JSON.stringify(antes)).toBe(true);
    const emailsAntes = await emails();

    await c.query(sql);

    expect(await contar()).toEqual(Object.fromEntries(noComando.map((t) => [t, 0])));
    expect(await emails()).toBe(emailsAntes);
  });
});
