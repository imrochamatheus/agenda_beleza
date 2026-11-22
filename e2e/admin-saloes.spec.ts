import { expect, test, type Page } from '@playwright/test';

import { analisarComAxe, semRolagemHorizontal } from './suporte/vitrine';

// D-044 CA-14: lista e detalhe dos salões do admin só com o teclado em /dev/admin-saloes (os MESMOS componentes das
// páginas de /admin, dados em memória, ações que só validam, sem banco), em 375×812 e com o idioma do navegador em
// inglês (as datas saem no fuso do salão, em pt-BR, não no do navegador). Nenhum campo de data é digitado: não há.
// Mais o redirecionamento real das páginas sem sessão (RN-1, independente do banco).

test.use({ locale: 'en-US' });

async function abrir(page: Page, consulta = '') {
  const resposta = await page.goto(`/dev/admin-saloes${consulta}`);
  if (resposta?.status() !== 200) {
    throw new Error(`/dev/admin-saloes respondeu ${resposta?.status()}: ligue VITRINE_COMPONENTES=true ou libere a porta do servidor.`);
  }
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

type Focado = { tag: string; id: string; tipo: string; nome: string; outline: number; estilo: string };
const focado = (page: Page): Promise<Focado> =>
  page.evaluate(() => {
    const e = document.activeElement as HTMLInputElement;
    const s = getComputedStyle(e);
    return {
      tag: e.tagName,
      id: e.id,
      tipo: e.type ?? '',
      nome: e.getAttribute('aria-label') ?? e.textContent?.trim() ?? '',
      outline: parseFloat(s.outlineWidth),
      estilo: s.outlineStyle,
    };
  });

async function tabAte(page: Page, alvo: (f: Focado) => boolean, limite = 60): Promise<Focado> {
  for (let i = 0; i < limite; i += 1) {
    await page.keyboard.press('Tab');
    const f = await focado(page);
    if (f.tag !== 'BODY') {
      expect(f.estilo, `foco visível em ${f.tag}#${f.id}`).not.toBe('none');
      expect(f.outline, `contorno em ${f.tag}#${f.id}`).toBeGreaterThan(0);
    }
    if (alvo(f)) return f;
  }
  throw new Error('elemento não alcançado por Tab');
}

/** Tab até o campo com o id e digita o texto (substituindo o que houver). */
async function digitar(page: Page, id: string, texto: string) {
  await tabAte(page, (f) => f.id === id);
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(texto);
}

test.describe('CA-1/CA-14: lista de salões (375×812)', () => {
  test('estado inicial: 20 de 23, selos, menu com Salões marcado, sem rolagem horizontal e sem violações do axe', async ({ page }) => {
    await abrir(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Salões' })).toBeVisible();
    await expect(page.getByText('23 salões')).toBeVisible();
    await expect(page.getByRole('link', { name: /^Abrir / })).toHaveCount(20);
    await expect(page.getByText('Suspenso manualmente').first()).toBeAttached();
    await expect(page.getByText('Em período de teste').first()).toBeAttached();
    await expect(page.getByText('Sem assinatura').first()).toBeAttached();
    await expect(page.getByRole('navigation', { name: 'Paginação' })).toContainText('Página 1 de 2');
    // O e-mail e o endereço longos quebram linha em vez de estourar a tela.
    await expect(page.getByText('gestora.com.nome.bastante.comprido@dominio-de-demonstracao.com.br')).toBeAttached();
    await semRolagemHorizontal(page, '/dev/admin-saloes (lista)');
    await analisarComAxe(page, '/dev/admin-saloes (lista)');
  });

  test('menu do admin: abre pelo botão e "Salões" é o item atual', async ({ page }) => {
    await abrir(page);
    await page.getByRole('button', { name: 'Menu' }).click();
    const nav = page.getByRole('navigation', { name: 'Navegação da administração' });
    await expect(nav.getByRole('link')).toHaveCount(3);
    await expect(nav.getByRole('link', { name: 'Salões' })).toHaveAttribute('aria-current', 'page');
  });

  test('buscar e filtrar só com o teclado; os filtros ficam na URL e na paginação', async ({ page }) => {
    await abrir(page);
    await digitar(page, 'salao-q', 'ESPAÇO lume');
    // Foi `ESPAÇO` com cedilha: a chave de busca ignora acento e caixa.
    await tabAte(page, (f) => f.tag === 'SELECT');
    await page.keyboard.press('ArrowDown');
    await tabAte(page, (f) => f.tag === 'BUTTON' && f.nome === 'Filtrar');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/q=ESPA%C3%87O\+lume/);
    await expect(page.getByRole('link', { name: /^Abrir / })).toHaveCount(1);
    await expect(page.getByText('1 salão', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Limpar filtros' })).toBeVisible();
    await analisarComAxe(page, '/dev/admin-saloes (filtrada)');
  });

  test('filtro de estado e de suspensão por GET, com a lista e a contagem coerentes', async ({ page }) => {
    await abrir(page, '?suspenso=sim');
    await expect(page.getByRole('link', { name: /^Abrir / })).toHaveCount(2);
    await abrir(page, '?estado=sem_assinatura&suspenso=nao');
    const total = await page.getByRole('link', { name: /^Abrir / }).count();
    expect(total).toBeGreaterThan(0);
    await expect(page.getByText(`${total} ${total === 1 ? 'salão' : 'salões'}`, { exact: true })).toBeVisible();
    await expect(page.getByText('Sem assinatura', { exact: true }).first()).toBeAttached();
  });

  test('segunda página pelo link Próxima, que preserva os filtros', async ({ page }) => {
    await abrir(page, '?suspenso=nao');
    await page.getByRole('link', { name: 'Próxima' }).click();
    await expect(page).toHaveURL(/suspenso=nao&pagina=2/);
    await expect(page.getByRole('link', { name: /^Abrir / })).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'Anterior' })).toHaveAttribute('href', /suspenso=nao$/);
  });

  test('vazio: mensagem e Limpar filtros; sem violações do axe', async ({ page }) => {
    await abrir(page, '?q=zzzz-nada');
    await expect(page.getByRole('heading', { name: 'Nenhum salão encontrado.' })).toBeVisible();
    await expect(page.getByText('Tente outro nome ou limpe os filtros.')).toBeVisible();
    await expect(page.getByText('0 salões')).toBeVisible();
    await semRolagemHorizontal(page, '/dev/admin-saloes (vazio)');
    await analisarComAxe(page, '/dev/admin-saloes (vazio)');
  });
});

test.describe('CA-8/CA-14: detalhe e edição (375×812)', () => {
  test('detalhe: seções, datas no fuso do salão, sem rolagem horizontal e sem violações do axe', async ({ page }) => {
    await abrir(page, '?vista=detalhe');
    await expect(page.getByRole('heading', { level: 1, name: 'Studio Aurora' })).toBeVisible();
    for (const h of ['Dados do salão', 'Regras da agenda', 'Gestor', 'Assinatura', 'Suspensão', 'Teste gratuito']) {
      await expect(page.getByRole('heading', { level: 2, name: h })).toBeVisible();
    }
    await expect(page.getByText('30/11/2030 às 14:00').first()).toBeVisible();
    await expect(page.getByText(/Trocar o e-mail desfaz a confirmação/)).toBeVisible();
    await semRolagemHorizontal(page, '/dev/admin-saloes (detalhe)');
    await analisarComAxe(page, '/dev/admin-saloes (detalhe)');
  });

  test('ordem de tabulação: voltar → campos na ordem visual → Salvar → motivo → Continuar → dias → Ver novo fim', async ({ page }) => {
    await abrir(page, '?vista=detalhe');
    const ordem: string[] = [];
    const botoes = ['Salvar alterações', 'Continuar', 'Ver novo fim'];
    for (let i = 0; i < 60; i += 1) {
      await page.keyboard.press('Tab');
      const f = await focado(page);
      if (f.id.startsWith('salao-')) ordem.push(f.id);
      else if (f.tag === 'BUTTON' && botoes.includes(f.nome)) ordem.push(f.nome);
      if (f.nome === 'Ver novo fim') break;
    }
    expect(ordem).toEqual([
      'salao-nome', 'salao-slug', 'salao-fuso', 'salao-grade', 'salao-antecedencia', 'salao-janela', 'salao-intervalo',
      'salao-gestorNome', 'salao-gestorEmail', 'Salvar alterações', 'salao-motivo', 'Continuar', 'salao-dias', 'Ver novo fim',
    ]);
  });

  test('erros de campo: resumo focado, valores preservados, aria-invalid e sem violações do axe', async ({ page }) => {
    await abrir(page, '?vista=detalhe');
    await digitar(page, 'salao-nome', 'A');
    await digitar(page, 'salao-antecedencia', '9999');
    await digitar(page, 'salao-gestorEmail', 'sem-arroba');
    await tabAte(page, (f) => f.tag === 'BUTTON' && f.nome === 'Salvar alterações');
    await page.keyboard.press('Enter');
    const resumo = page.getByRole('alert').filter({ hasText: 'Corrija os campos indicados para salvar.' });
    await expect(resumo).toBeVisible();
    await expect(resumo).toBeFocused();
    await expect(resumo.getByRole('link')).toHaveCount(3);
    await expect(page.locator('#salao-nome')).toHaveValue('A');
    await expect(page.locator('#salao-nome')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#salao-gestorEmail')).toHaveValue('sem-arroba');
    await semRolagemHorizontal(page, '/dev/admin-saloes (erros)');
    await analisarComAxe(page, '/dev/admin-saloes (erros de campo)');
  });

  test('conflitos de slug e de e-mail aparecem como erro de campo', async ({ page }) => {
    await abrir(page, '?vista=detalhe');
    await page.locator('#salao-slug').fill('ocupado');
    await page.locator('#salao-gestorEmail').fill('ocupado@exemplo.com.br');
    await page.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect(page.locator('#salao-resumo-erros')).toContainText('Este endereço já está em uso');
    await page.locator('#salao-slug').fill('aurora');
    await page.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect(page.locator('#salao-resumo-erros')).toContainText('Este e-mail já é usado por outra conta.');
    await analisarComAxe(page, '/dev/admin-saloes (conflitos)');
  });

  test('salvar sem mudar nada e salvar uma mudança válida mostram o resultado no topo', async ({ page }) => {
    await abrir(page, '?vista=detalhe');
    await page.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Nada mudou: os valores são os mesmos.' })).toBeVisible();
    await analisarComAxe(page, '/dev/admin-saloes (nada mudou)');
    await page.locator('#salao-nome').fill('Studio Aurora Novo');
    await page.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Dados do salão salvos.' })).toBeVisible();
    await page.locator('#salao-gestorEmail').fill('outra@exemplo.com.br');
    await page.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'link de confirmação foi enviado' })).toBeVisible();
    await analisarComAxe(page, '/dev/admin-saloes (salvo)');
  });
});

test.describe('CA-2/CA-14: suspensão em duas etapas (375×812)', () => {
  test('motivo inválido: erro de campo; válido: etapa 2 com o texto, o motivo e "Voltar"; confirmar: resultado', async ({ page }) => {
    await abrir(page, '?vista=detalhe');
    await digitar(page, 'salao-motivo', 'fale com a@b.com');
    await page.keyboard.press('Enter');
    await expect(page.locator('p', { hasText: /^Erro:/ })).toContainText('Não escreva telefone nem e-mail no motivo.');
    await analisarComAxe(page, '/dev/admin-saloes (motivo inválido)');

    await page.locator('#salao-motivo').fill('Pedido do gestor');
    await page.keyboard.press('Enter');
    const grupo = page.getByRole('group', { name: 'Confirmar a suspensão' });
    await expect(grupo).toBeVisible();
    await expect(grupo).toContainText('Suspender Studio Aurora? Ela deixa de aceitar novas reservas agora.');
    await expect(grupo.locator('blockquote')).toHaveText('Pedido do gestor');
    await expect(grupo.getByRole('link', { name: 'Voltar' })).toBeVisible();
    // O motivo nunca vai na URL.
    expect(page.url()).not.toContain('Pedido');
    await semRolagemHorizontal(page, '/dev/admin-saloes (etapa 2 da suspensão)');
    await analisarComAxe(page, '/dev/admin-saloes (etapa 2 da suspensão)');

    await tabAte(page, (f) => f.tag === 'BUTTON' && f.nome === 'Suspender salão');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status').filter({ hasText: 'Salão suspenso.' })).toBeVisible();
    await analisarComAxe(page, '/dev/admin-saloes (suspenso)');
  });

  test('"Voltar" da etapa 2 recarrega o detalhe sem a confirmação', async ({ page }) => {
    await abrir(page, '?vista=detalhe');
    await page.locator('#salao-motivo').fill('Pedido do gestor');
    await page.getByRole('button', { name: 'Continuar' }).click();
    await page.getByRole('link', { name: 'Voltar', exact: true }).click();
    await expect(page.getByRole('group', { name: 'Confirmar a suspensão' })).toHaveCount(0);
    await expect(page.locator('#salao-motivo')).toHaveValue('');
  });

  test('salão suspenso: data e hora no fuso, aviso da assinatura suspensa e reativar numa etapa', async ({ page }) => {
    await abrir(page, '?vista=detalhe-suspenso');
    await expect(page.getByText('Suspenso manualmente em 20/11/2030 às 09:12.')).toBeVisible();
    await expect(page.getByText('Reativar o salão não reativa a assinatura.')).toBeVisible();
    await semRolagemHorizontal(page, '/dev/admin-saloes (suspenso)');
    await analisarComAxe(page, '/dev/admin-saloes (detalhe suspenso)');
    await page.locator('#salao-motivo').fill('oi');
    await page.getByRole('button', { name: 'Reativar salão' }).click();
    await expect(page.locator('p', { hasText: /^Erro:/ })).toContainText('Informe o motivo (5 a 280 caracteres).');
    await page.locator('#salao-motivo').fill('');
    await page.getByRole('button', { name: 'Reativar salão' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Salão reativado.' })).toBeVisible();
    await analisarComAxe(page, '/dev/admin-saloes (reativado)');
  });
});

test.describe('CA-4 a CA-7/CA-14: estender o teste (375×812)', () => {
  test.beforeEach(async ({ page }) => {
    await abrir(page, '?vista=detalhe');
  });

  test('prévia D → D+N com o efeito no botão; confirmar mostra o novo fim; só o teclado', async ({ page }) => {
    await digitar(page, 'salao-dias', '10');
    await page.keyboard.press('Enter');
    const grupo = page.getByRole('group', { name: 'Confirmar a extensão do teste' });
    await expect(grupo).toBeVisible();
    await expect(grupo).toContainText('30/11/2030 às 14:00 → 10/12/2030 às 14:00');
    await expect(grupo).toContainText('+10 dias de 24 h');
    await expect(grupo).toContainText('não pode ser desfeito por aqui');
    await semRolagemHorizontal(page, '/dev/admin-saloes (etapa 2 da extensão)');
    await analisarComAxe(page, '/dev/admin-saloes (etapa 2 da extensão)');
    await tabAte(page, (f) => f.tag === 'BUTTON' && f.nome === 'Estender teste em 10 dias');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status').filter({ hasText: 'Teste estendido até 10/12/2030 às 14:00.' })).toBeVisible();
    await analisarComAxe(page, '/dev/admin-saloes (estendido)');
  });

  for (const valor of ['1e1', '+5', '0', '91', '5.5', '']) {
    test(`N inválido (${JSON.stringify(valor)}): erro de campo, sem prévia`, async ({ page }) => {
      await page.locator('#salao-dias').fill(valor);
      await page.getByRole('button', { name: 'Ver novo fim' }).click();
      await expect(page.locator('p', { hasText: /^Erro:/ })).toContainText('Informe um número inteiro de 1 a 90.');
      await expect(page.getByRole('group', { name: 'Confirmar a extensão do teste' })).toHaveCount(0);
      await expect(page.locator('#salao-dias')).toHaveValue(valor);
    });
  }

  const RESULTADOS: [string, string, string][] = [
    ['13', 'O provedor não refletiu o adiamento; nada foi alterado. Tente novamente mais tarde.', 'provedor falhou'],
    ['14', 'A assinatura mudou enquanto você decidia. O fim do teste agora é 02/12/2030 às 14:00. Confira e tente de novo.', 'mudou'],
    ['15', 'O provedor adiou a cobrança, mas a assinatura mudou aqui. Nada foi gravado. Confira a situação com o provedor.', 'divergência'],
  ];
  for (const [dias, texto, nome] of RESULTADOS) {
    test(`resultado "${nome}" aparece no topo e passa no axe`, async ({ page }) => {
      await page.locator('#salao-dias').fill(dias);
      await page.getByRole('button', { name: 'Ver novo fim' }).click();
      await page.getByRole('button', { name: `Estender teste em ${dias} dias` }).click();
      await expect(page.getByText(texto)).toBeVisible();
      await semRolagemHorizontal(page, `/dev/admin-saloes (${nome})`);
      await analisarComAxe(page, `/dev/admin-saloes (${nome})`);
    });
  }
});

test.describe('CA-5/CA-14: outras vistas do detalhe (375×812)', () => {
  const VISTAS: [string, string][] = [
    ['detalhe-sem-assinatura', 'Este salão não tem assinatura.'],
    ['detalhe-ativa', 'O teste só pode ser estendido enquanto a assinatura está em período de teste.'],
  ];
  for (const [vista, recusa] of VISTAS) {
    test(`${vista}: recusa no lugar do campo, sem rolagem horizontal e sem violações do axe`, async ({ page }) => {
      await abrir(page, `?vista=${vista}`);
      await expect(page.getByText(recusa)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Ver novo fim' })).toHaveCount(0);
      await semRolagemHorizontal(page, `/dev/admin-saloes (${vista})`);
      await analisarComAxe(page, `/dev/admin-saloes (${vista})`);
    });
  }
});

test.describe('RN-1: sem sessão de admin', () => {
  test('/admin/saloes e o detalhe redirecionam para /admin/entrar (cabeçalhos reais, sem banco)', async ({ page }) => {
    await page.goto('/admin/saloes');
    await expect(page).toHaveURL(/\/admin\/entrar$/);
    await page.goto('/admin/saloes/11111111-1111-4111-8111-111111111111');
    await expect(page).toHaveURL(/\/admin\/entrar$/);
  });
});
