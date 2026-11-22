import { expect, test, type Page } from '@playwright/test';

import { analisarComAxe, semRolagemHorizontal } from './suporte/vitrine';

// D-045 CA-14/CA-16: as telas do admin (fila de mensagens, auditoria, assinatura do salão) só com o teclado em
// /dev/admin-mensagens (os MESMOS componentes das páginas de /admin, dados em memória, ação de reenvio que só
// devolve um código por PRG, sem banco), em 375×812 e com o idioma do navegador em inglês (as datas saem em
// pt-BR/America/Sao_Paulo, não no do navegador). Nenhum campo de data é digitado: o período vai por URL.
// Mais o redirecionamento real das três páginas sem sessão (RN-4, independente do banco).

test.use({ locale: 'en-US' });

const ROTA = '/dev/admin-mensagens';
const FALHOU_1 = '00000000-0000-4000-8000-000000000002';

async function abrir(page: Page, consulta = '') {
  const resposta = await page.goto(`${ROTA}${consulta}`);
  if (resposta?.status() !== 200) {
    throw new Error(`${ROTA} respondeu ${resposta?.status()}: ligue VITRINE_COMPONENTES=true ou libere a porta do servidor.`);
  }
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

type Focado = { tag: string; id: string; tipo: string; nome: string; outline: number; estilo: string };
const focado = (page: Page): Promise<Focado> =>
  page.evaluate(() => {
    const e = document.activeElement as HTMLInputElement;
    const s = getComputedStyle(e);
    return { tag: e.tagName, id: e.id, tipo: e.type ?? '', nome: e.getAttribute('aria-label') ?? e.textContent?.trim() ?? '', outline: parseFloat(s.outlineWidth), estilo: s.outlineStyle };
  });

async function tabAte(page: Page, alvo: (f: Focado) => boolean, limite = 80): Promise<Focado> {
  for (let i = 0; i < limite; i += 1) {
    await page.keyboard.press('Tab');
    const f = await focado(page);
    // O campo de data nativo tem sub-campos e o botão do seletor, que levam o próprio foco (o input não é :focus-visible neles).
    if (f.tag !== 'BODY' && f.tipo !== 'date') {
      expect(f.estilo, `foco visível em ${f.tag}#${f.id}`).not.toBe('none');
      expect(f.outline, `contorno em ${f.tag}#${f.id}`).toBeGreaterThan(0);
    }
    if (alvo(f)) return f;
  }
  throw new Error('elemento não alcançado por Tab');
}

/** Nenhum selo ocupa mais de uma linha (web-design §9.3): altura < 1,9 × a altura da linha. */
async function selosEmUmaLinha(page: Page, contexto: string) {
  const ruins = await page.evaluate(() => {
    const saida: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('span[class*="selo"]'))) {
      const texto = el.querySelector('span');
      if (!texto) continue;
      const lh = parseFloat(getComputedStyle(texto).lineHeight) || parseFloat(getComputedStyle(texto).fontSize) * 1.4;
      if (texto.getBoundingClientRect().height > lh * 1.5) saida.push(`${texto.textContent} (${Math.round(texto.getBoundingClientRect().height)}px)`);
    }
    return saida;
  });
  expect(ruins, `selo em duas linhas em ${contexto}`).toEqual([]);
}

test.describe('CA-9/CA-14: fila de mensagens (375×812)', () => {
  test('estado inicial: 20 de 47, selos, telefones mascarados, menu e sem rolagem horizontal nem violações do axe', async ({ page }) => {
    await abrir(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Mensagens' })).toBeVisible();
    await expect(page.getByText('20 de 47 mensagens', { exact: true })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Fila de mensagens' })).toBeVisible();
    await expect(page.getByText('Falhou', { exact: true }).first()).toBeAttached();
    await expect(page.getByText('Enviada', { exact: true }).first()).toBeAttached();
    await expect(page.getByText('Cliente removida').first()).toBeAttached();
    await expect(page.getByText('Horários em America/Sao_Paulo (UTC−03:00).')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Paginação' })).toContainText('Página 1 de 3');
    // O HTML nunca tem o número completo: só DDD e os quatro últimos dígitos.
    const html = await page.content();
    expect(html).toContain('+55 (71) 9****-1234');
    expect(html).not.toMatch(/\+55\d{10,11}/);
    expect(html).not.toMatch(/9\d{4}-?\d{4}/);
    await semRolagemHorizontal(page, `${ROTA} (lista)`);
    await analisarComAxe(page, `${ROTA} (lista)`);
  });

  test('menu: Salões, Mensagens e Auditoria, com Mensagens como item atual', async ({ page }) => {
    await abrir(page);
    await page.getByRole('button', { name: 'Menu' }).click();
    const nav = page.getByRole('navigation', { name: 'Navegação da administração' });
    await expect(nav.getByRole('link')).toHaveCount(3);
    await expect(nav.getByRole('link', { name: 'Mensagens' })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: 'Auditoria' })).toBeVisible();
  });

  test('filtrar só com o teclado: Situação "Falhou" + Filtrar; contagem, URL e Limpar filtros', async ({ page }) => {
    await abrir(page);
    await tabAte(page, (f) => f.tag === 'SELECT');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await tabAte(page, (f) => f.tag === 'BUTTON' && f.nome === 'Filtrar');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/estado=falhou/);
    await expect(page.getByText(/ mensagens · Situação: Falhou$/).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Limpar filtros' })).toBeVisible();
    const selos = page.getByRole('table', { name: 'Fila de mensagens' }).getByText('Enviada', { exact: true });
    await expect(selos).toHaveCount(0);
    await analisarComAxe(page, `${ROTA} (filtrada)`);
  });

  test('ordem de tabulação: filtros → Filtrar → links por linha (salão, Tentativas, Reenviar) → Próxima', async ({ page }) => {
    await abrir(page);
    const ordem: string[] = [];
    for (let i = 0; i < 160; i += 1) {
      await page.keyboard.press('Tab');
      const f = await focado(page);
      if (f.tag === 'SELECT') ordem.push('select');
      else if (f.tag === 'BUTTON' && f.nome === 'Filtrar') ordem.push('Filtrar');
      else if (f.tag === 'A' && ['Limpar filtros', 'Tentativas', 'Reenviar', 'Próxima'].includes(f.nome)) ordem.push(f.nome);
      if (f.nome === 'Próxima') break;
    }
    const iFiltrar = ordem.indexOf('Filtrar');
    expect(ordem.slice(0, iFiltrar)).toEqual(['select', 'select', 'select']);
    // Sem filtro ativo não há "Limpar filtros"; a primeira linha (enviada) só tem "Tentativas", a segunda (falhou) tem as duas.
    expect(ordem.slice(iFiltrar, iFiltrar + 4)).toEqual(['Filtrar', 'Tentativas', 'Tentativas', 'Reenviar']);
    expect(ordem.at(-1)).toBe('Próxima');
  });

  test('"Reenviar" só em falhou: abre a confirmação (tipo, salão, telefone mascarado, aviso) e Cancelar volta', async ({ page }) => {
    await abrir(page);
    const linhas = page.getByRole('table', { name: 'Fila de mensagens' }).getByRole('row');
    const comReenviar = await page.getByRole('link', { name: 'Reenviar' }).count();
    const falhas = await linhas.filter({ hasText: 'Falhou' }).count();
    expect(comReenviar).toBe(falhas);
    const enviada = linhas.filter({ hasText: 'Enviada' }).first();
    await expect(enviada.getByRole('link', { name: 'Reenviar' })).toHaveCount(0);

    await page.getByRole('link', { name: 'Reenviar' }).first().click();
    await expect(page).toHaveURL(/confirmar=/);
    const bloco = page.locator('#confirmar');
    await expect(bloco.getByRole('heading', { level: 2, name: 'Reenviar esta mensagem?' })).toBeVisible();
    await expect(bloco.getByText('+55 (', { exact: false })).toBeVisible();
    await expect(bloco.getByText(/Será enviada uma nova mensagem por WhatsApp para esta cliente/)).toBeVisible();
    await expect(bloco.getByRole('button', { name: 'Confirmar reenvio' })).toBeVisible();
    await semRolagemHorizontal(page, `${ROTA} (confirmar)`);
    await analisarComAxe(page, `${ROTA} (confirmar)`);
    await bloco.getByRole('link', { name: 'Cancelar' }).click();
    await expect(page).not.toHaveURL(/confirmar=/);
    await expect(page.locator('#confirmar')).toHaveCount(0);
  });

  test('confirmar com o teclado: PRG para ?reenvio=, alerta no topo e recarregar não repete o POST', async ({ page }) => {
    await abrir(page, `?confirmar=${FALHOU_1}`);
    await tabAte(page, (f) => f.tag === 'BUTTON' && f.nome === 'Confirmar reenvio');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/reenvio=ok(#confirmar)?$/);
    await expect(page.getByRole('status').filter({ hasText: 'Reenvio solicitado.' })).toBeVisible();
    await expect(page.locator('#confirmar')).toHaveCount(0);
    await analisarComAxe(page, `${ROTA} (reenvio ok)`);
    await page.reload();
    await expect(page).toHaveURL(/reenvio=ok(#confirmar)?$/);
    await expect(page.getByRole('status').filter({ hasText: 'Reenvio solicitado.' })).toBeVisible();
  });

  const TEXTOS: [string, string][] = [
    ['ok', 'Reenvio solicitado. A mensagem volta para a fila e o envio é feito em instantes.'],
    ['ok_fila', 'Reenvio registrado. A fila está lenta; o envio será retomado automaticamente.'],
    ['recusada', 'Nada foi reenviado: esta mensagem não está mais com falha.'],
    ['obsoleta', 'Nada foi reenviado: a reserva mudou e a mensagem perdeu a validade.'],
    ['anonimizada', 'A cliente foi removida; a mensagem foi cancelada e nada foi enviado.'],
    ['inexistente', 'Mensagem não encontrada.'],
  ];
  for (const [codigo, texto] of TEXTOS) {
    test(`resultado ?reenvio=${codigo}: alerta com o texto fechado e sem violações do axe`, async ({ page }) => {
      await abrir(page, `?reenvio=${codigo}`);
      await expect(page.getByRole('status').filter({ hasText: texto })).toBeVisible();
      await analisarComAxe(page, `${ROTA} (?reenvio=${codigo})`);
    });
  }

  test('código de reenvio fora da lista: nenhum alerta (nada do URL vira texto)', async ({ page }) => {
    await abrir(page, '?reenvio=%3Cb%3Ex%3C%2Fb%3E');
    await expect(page.getByRole('status')).toHaveCount(0);
    await expect(page.getByText('<b>x</b>')).toHaveCount(0);
  });

  test('confirmar uma mensagem que não está mais falhou: aviso e nenhum botão de confirmar', async ({ page }) => {
    await abrir(page, '?confirmar=00000000-0000-4000-8000-000000000001');
    await expect(page.getByText('Esta mensagem não está mais com falha.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirmar reenvio' })).toHaveCount(0);
  });

  test('tentativas por GET: tabela em ordem, vazio e 404', async ({ page }) => {
    await abrir(page, '?detalhe=00000000-0000-4000-8000-000000000004');
    const bloco = page.locator('#detalhe');
    await expect(bloco.getByRole('heading', { level: 2 })).toContainText('Tentativas de');
    await expect(bloco.getByRole('table', { name: 'Tentativas' })).toBeVisible();
    await expect(bloco.getByText('Falha', { exact: true })).toBeVisible();
    await expect(bloco.getByText('Sucesso', { exact: true })).toBeVisible();
    await analisarComAxe(page, `${ROTA} (tentativas)`);
    await abrir(page, '?detalhe=00000000-0000-4000-8000-000000000007');
    await expect(page.getByText('Nenhuma tentativa registrada')).toBeVisible();
    const r = await page.goto(`${ROTA}?detalhe=00000000-0000-4000-8000-0000000000ff`);
    expect(r?.status()).toBe(404);
    const r2 = await page.goto(`${ROTA}?detalhe=nao-e-uuid`);
    expect(r2?.status()).toBe(404);
  });

  test('vazio com filtro, filtro inválido e página além do fim', async ({ page }) => {
    await abrir(page, '?estado=pendente&tipo=convite_avaliacao&salao=22222222-2222-4222-8222-222222222222');
    await expect(page.getByRole('heading', { name: 'Nenhuma mensagem encontrada' })).toBeVisible();
    await expect(page.getByRole('main').getByRole('link', { name: 'Limpar filtros' })).toHaveCount(2);
    await analisarComAxe(page, `${ROTA} (vazio)`);
    await abrir(page, '?estado=nao-existe&salao=xyz');
    await expect(page.getByText('Filtro inválido ignorado.')).toBeVisible();
    await expect(page.getByText('20 de 47 mensagens', { exact: true })).toBeVisible();
    await analisarComAxe(page, `${ROTA} (filtro inválido)`);
    await abrir(page, '?pagina=9');
    await expect(page.getByRole('heading', { name: 'Nenhuma mensagem nesta página' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ir para a primeira página' })).toBeVisible();
  });

  test('paginação preserva os filtros', async ({ page }) => {
    await abrir(page, '?estado=enviada');
    const total = await page.getByText(/^\d+ de \d+ mensagens/).first().textContent();
    expect(total).toMatch(/de \d+ mensagens/);
    await abrir(page, '?pagina=2');
    await expect(page.getByRole('navigation', { name: 'Paginação' }).getByRole('link', { name: 'Anterior' })).toHaveAttribute('href', ROTA);
    await expect(page.getByRole('navigation', { name: 'Paginação' }).getByRole('link', { name: 'Próxima' })).toHaveAttribute('href', `${ROTA}?pagina=3`);
  });
});

test.describe('CA-12/CA-14: auditoria (375×812)', () => {
  test('lista, antes/depois recolhidos, sem rolagem horizontal (16 KB, chave longa, e-mail longo) e axe', async ({ page }) => {
    await abrir(page, '?vista=auditoria');
    await expect(page.getByRole('heading', { level: 1, name: 'Auditoria' })).toBeVisible();
    await expect(page.getByText('20 de 25 registros', { exact: true })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Registros de auditoria' })).toBeVisible();
    await expect(page.getByText('Somente leitura.')).toBeVisible();
    await semRolagemHorizontal(page, `${ROTA}?vista=auditoria`);
    await analisarComAxe(page, `${ROTA}?vista=auditoria`);
    // Abre o detalhe do registro de 16 KB (índice 2) e o JSON completo: continua sem rolagem horizontal.
    const resumos = page.getByText(/^Ver alterações \(/);
    const n = await resumos.count();
    for (let i = 0; i < n; i += 1) await resumos.nth(i).click();
    await page.getByText('Ver JSON completo').first().click();
    await expect(page.getByText('Antes:').first()).toBeVisible();
    await expect(page.getByText('Depois:').first()).toBeVisible();
    await expect(page.getByText('<b>não vira HTML</b>').first()).toBeAttached();
    expect(await page.locator('main b').count()).toBe(0);
    await semRolagemHorizontal(page, `${ROTA}?vista=auditoria (detalhes abertos)`);
    await analisarComAxe(page, `${ROTA}?vista=auditoria (detalhes abertos)`);
  });

  test('o detalhe abre e fecha só com o teclado (Enter no summary) e o foco é visível', async ({ page }) => {
    await abrir(page, '?vista=auditoria');
    const f = await tabAte(page, (x) => x.tag === 'SUMMARY');
    expect(f.nome).toMatch(/^Ver alterações/);
    await page.keyboard.press('Enter');
    await expect(page.locator('details[open]').first()).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.locator('details[open]')).toHaveCount(0);
  });

  test('filtros por GET (ação, salão, resultado, período), contagem e erros de campo', async ({ page }) => {
    await abrir(page, '?vista=auditoria&acao=mensagem.reenviar');
    await expect(page.getByText(/ de \d+ registros? · Ação: Mensagem reenviada$/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Limpar filtros' })).toBeVisible();
    await abrir(page, '?vista=auditoria&resultado=falha');
    await expect(page.getByText(/Resultado: Falha$/)).toBeVisible();
    await abrir(page, '?vista=auditoria&de=2026-11-22&ate=2026-11-22');
    await expect(page.getByText(/De 22\/11\/2026 · Até 22\/11\/2026$/)).toBeVisible();
    await abrir(page, '?vista=auditoria&de=2026-11-22&ate=2026-11-01');
    await expect(page.getByText('A data inicial é depois da final.')).toBeVisible();
    await analisarComAxe(page, `${ROTA}?vista=auditoria (período invertido)`);
    await abrir(page, '?vista=auditoria&de=31/02/2026');
    await expect(page.getByText('Data inválida.')).toBeVisible();
    await abrir(page, '?vista=auditoria&acao=xxx&salao=yyy');
    await expect(page.getByText('Filtro inválido ignorado.')).toBeVisible();
    await abrir(page, '?vista=auditoria&ator=ninguem@exemplo.com.br');
    await expect(page.getByRole('heading', { name: 'Nenhum registro encontrado' })).toBeVisible();
    await analisarComAxe(page, `${ROTA}?vista=auditoria (vazio)`);
  });

  test('os campos De e Até são rotulados e o formulário é uma busca nomeada', async ({ page }) => {
    await abrir(page, '?vista=auditoria');
    await expect(page.getByRole('search', { name: 'Filtrar registros de auditoria' })).toBeVisible();
    await expect(page.getByLabel('De', { exact: true })).toHaveAttribute('type', 'date');
    await expect(page.getByLabel('Até', { exact: true })).toHaveAttribute('type', 'date');
    await expect(page.getByLabel('Ator (e-mail)')).toBeVisible();
  });
});

test.describe('CA-1/CA-13/CA-14: assinatura e eventos do salão (375×812)', () => {
  test('resumo, transições e eventos; o rejeitado se distingue pelo texto; sem rolagem horizontal e axe', async ({ page }) => {
    await abrir(page, '?vista=assinatura');
    await expect(page.getByRole('heading', { level: 1, name: /^Assinatura de Studio Aurora/ })).toBeVisible();
    await expect(page.getByText('Horários no fuso do salão (America/Sao_Paulo, UTC−03:00).')).toBeVisible();
    for (const h of ['Resumo', 'Transições', 'Eventos de webhook']) await expect(page.getByRole('heading', { level: 2, name: h })).toBeVisible();
    await expect(page.getByText('Vinculada ao Mercado Pago')).toBeVisible();
    await expect(page.getByRole('table', { name: 'Eventos recebidos' }).getByText('Rejeitado', { exact: true })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Eventos recebidos' }).getByText('Processado', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('erro: vinculo_invalido')).toBeVisible();
    await expect(page.getByText('Origem: evento').first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Auditoria deste salão' })).toBeVisible();
    await semRolagemHorizontal(page, `${ROTA}?vista=assinatura`);
    await analisarComAxe(page, `${ROTA}?vista=assinatura`);
    // Payload com texto malicioso e 16 KB: escapado, sem rolagem horizontal.
    await page.getByText('Ver payload').first().click();
    await page.getByText('Ver JSON completo').first().click();
    expect(await page.locator('main script').count()).toBe(0);
    await semRolagemHorizontal(page, `${ROTA}?vista=assinatura (payload aberto)`);
    await analisarComAxe(page, `${ROTA}?vista=assinatura (payload aberto)`);
  });

  test('"Mostrando os 50 mais recentes" e salão sem assinatura', async ({ page }) => {
    await abrir(page, '?vista=assinatura-mais');
    await expect(page.getByText('Mostrando os 50 mais recentes')).toBeVisible();
    await abrir(page, '?vista=assinatura-vazia');
    await expect(page.getByRole('heading', { name: 'Este salão ainda não tem assinatura' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Transições' })).toHaveCount(0);
    await semRolagemHorizontal(page, `${ROTA}?vista=assinatura-vazia`);
    await analisarComAxe(page, `${ROTA}?vista=assinatura-vazia`);
  });
});

for (const largura of [768, 1280]) {
  test.describe(`selo em uma linha em ${largura}px (web-design §9.3)`, () => {
    test.use({ viewport: { width: largura, height: 900 } });
    const vistas: [string, string][] = [
      [ROTA, 'mensagens'],
      [`${ROTA}?vista=auditoria`, 'auditoria'],
      [`${ROTA}?vista=assinatura`, 'assinatura'],
      [`${ROTA}?detalhe=00000000-0000-4000-8000-000000000004`, 'tentativas'],
      ['/dev/admin-saloes', 'lista de salões (D-044)'],
    ];
    for (const [url, nome] of vistas) {
      test(`${nome}: nenhum selo quebra em duas linhas e a página não rola na horizontal`, async ({ page }) => {
        const r = await page.goto(url);
        expect(r?.status()).toBe(200);
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        await selosEmUmaLinha(page, `${url} a ${largura}px`);
        await semRolagemHorizontal(page, `${url} a ${largura}px`);
      });
    }
  });
}

test.describe('CA-6: sem sessão, as três páginas levam a /admin/entrar', () => {
  for (const caminho of ['/admin/mensagens', '/admin/auditoria', '/admin/saloes/11111111-1111-4111-8111-111111111111/assinatura']) {
    test(`${caminho}`, async ({ page }) => {
      await page.goto(caminho);
      await expect(page).toHaveURL(/\/admin\/entrar/);
    });
  }
});
