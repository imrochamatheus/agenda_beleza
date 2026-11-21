import { expect, test, type Page } from '@playwright/test';

import { arquivoDeFoto, textoComoJpg } from './suporte/imagens';
import { analisarComAxe, semRolagemHorizontal } from './suporte/vitrine';

// D-021 CA-15: fotos do salão só com o teclado (Tab/Shift+Tab/Enter), foco visível em cada parada,
// resultado anunciado e focado, erros ligados aos campos, nomes acessíveis por foto, zero violações
// axe e sem rolagem horizontal. Roda em /dev/fotos (mesmos componentes da página real; o envio valida e
// processa em memória, não grava; sem banco).

async function abrir(page: Page, busca = '') {
  const resposta = await page.goto(`/dev/fotos${busca}`);
  if (resposta?.status() !== 200) {
    throw new Error(`/dev/fotos respondeu ${resposta?.status()}: ligue VITRINE_COMPONENTES=true ou libere a porta 3000.`);
  }
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

type Focado = { tag: string; id: string; texto: string; rotulo: string; outline: number; estilo: string };

const focado = (page: Page): Promise<Focado> =>
  page.evaluate(() => {
    const e = document.activeElement as HTMLElement;
    const s = getComputedStyle(e);
    return {
      tag: e.tagName,
      id: e.id,
      texto: (e.textContent ?? '').trim(),
      rotulo: e.getAttribute('aria-label') ?? '',
      outline: parseFloat(s.outlineWidth),
      estilo: s.outlineStyle,
    };
  });

/** Tab (até `limite` vezes) até o predicado valer; confere o foco visível em cada parada. */
async function tabAte(page: Page, alvo: (f: Focado) => boolean, limite = 80): Promise<Focado> {
  for (let i = 0; i < limite; i += 1) {
    await page.keyboard.press('Tab');
    const f = await focado(page);
    if (f.tag !== 'BODY') {
      expect(f.estilo, `foco visível em ${f.tag}#${f.id}`).not.toBe('none');
      expect(f.outline, `contorno de foco em ${f.tag}#${f.id}`).toBeGreaterThan(0);
    }
    if (alvo(f)) return f;
  }
  throw new Error('elemento não alcançado por Tab');
}

test.describe('CA-15: fotos só com o teclado (viewport 375×812)', () => {
  test('escolhe o arquivo, descreve e envia pelo teclado → sucesso anunciado e focado', async ({ page }) => {
    await abrir(page);
    await semRolagemHorizontal(page, '/dev/fotos');
    await tabAte(page, (f) => f.id === 'foto-arquivo');
    await page.locator('#foto-arquivo').setInputFiles(await arquivoDeFoto());
    await page.keyboard.press('Tab');
    expect((await focado(page)).id).toBe('foto-alt');
    await page.keyboard.type('Fachada do salão');
    await page.keyboard.press('Tab');
    const botao = await focado(page);
    expect(botao.texto).toBe('Enviar foto');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/dev\/fotos\?envio=ok$/);
    const resultado = page.locator('#resultado-fotos');
    await expect(resultado).toBeFocused();
    await expect(resultado.getByRole('status')).toContainText('Foto enviada.');
    await semRolagemHorizontal(page, '/dev/fotos depois de enviar');
  });

  test('arquivo de texto com nome .jpg → mensagem do tipo, focada e ligada ao campo da foto', async ({ page }) => {
    await abrir(page);
    await page.locator('#foto-arquivo').setInputFiles(textoComoJpg());
    await page.locator('#foto-alt').fill('Texto qualquer');
    await page.getByRole('button', { name: 'Enviar foto' }).click();
    await expect(page).toHaveURL(/envio=tipo$/);
    await expect(page.locator('#resultado-fotos')).toBeFocused();
    await expect(page.locator('#resultado-fotos').getByRole('alert')).toContainText('Envie uma foto em JPEG, PNG ou WebP.');
    const campo = page.locator('#foto-arquivo');
    await expect(campo).toHaveAttribute('aria-invalid', 'true');
    const ids = (await campo.getAttribute('aria-describedby'))!.split(' ');
    expect(ids).toContain('foto-arquivo-erro');
    await expect(page.locator('#foto-arquivo-erro')).toContainText('Envie uma foto em JPEG, PNG ou WebP.');
  });

  test('descrição só com espaços → mensagem do texto, ligada ao campo da descrição', async ({ page }) => {
    await abrir(page);
    await page.locator('#foto-arquivo').setInputFiles(await arquivoDeFoto());
    await page.locator('#foto-alt').fill('   ');
    await page.getByRole('button', { name: 'Enviar foto' }).click();
    await expect(page).toHaveURL(/envio=alt_vazio$/);
    await expect(page.locator('#resultado-fotos')).toBeFocused();
    const campo = page.locator('#foto-alt');
    await expect(campo).toHaveAttribute('aria-invalid', 'true');
    expect((await campo.getAttribute('aria-describedby'))!.split(' ')).toContain('foto-alt-erro');
    await expect(page.locator('#foto-alt-erro')).toContainText('Descreva a foto');
  });

  test('mover e remover pelo teclado, com nomes acessíveis que identificam a foto', async ({ page }) => {
    await abrir(page);
    const lista = page.getByRole('list', { name: 'Fotos do salão' });
    await expect(lista.getByRole('button', { name: 'Mover para cima: foto 2' })).toBeVisible();
    await expect(lista.getByRole('button', { name: 'Remover a foto 3' })).toBeVisible();

    await tabAte(page, (f) => f.rotulo === 'Mover para cima: foto 2');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/acao=movida$/);
    await expect(page.locator('#resultado-fotos')).toBeFocused();
    await expect(page.locator('#resultado-fotos')).toContainText('Ordem das fotos alterada.');

    await tabAte(page, (f) => f.rotulo === 'Remover a foto 3');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/acao=removida$/);
    await expect(page.locator('#resultado-fotos')).toContainText('Foto removida.');
  });

  test('botões das pontas são aria-disabled e não navegam', async ({ page }) => {
    await abrir(page);
    const cima = page.getByRole('button', { name: 'Mover para cima: foto 1' });
    await expect(cima).toHaveAttribute('aria-disabled', 'true');
    await cima.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/dev\/fotos$/);
    const baixo = page.getByRole('button', { name: 'Mover para baixo: foto 3' });
    await expect(baixo).toHaveAttribute('aria-disabled', 'true');
  });

  test('editar a descrição de uma foto pelo teclado', async ({ page }) => {
    await abrir(page);
    await page.getByRole('textbox', { name: 'Descrição da foto 2' }).fill('Novo texto');
    await page.getByRole('textbox', { name: 'Descrição da foto 2' }).press('Tab');
    expect((await focado(page)).rotulo).toBe('Salvar descrição da foto 2');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/acao=alt_ok$/);
    await expect(page.locator('#resultado-fotos')).toContainText('Descrição da foto salva.');
  });
});

test.describe('CA-15: axe 4.14.0 sem violações e sem rolagem horizontal', () => {
  const telas: [string, string][] = [
    ['inicial', ''],
    ['sem fotos', '?n=0'],
    ['com erro de tipo', '?envio=tipo'],
    ['com erro de descrição', '?envio=alt_longo'],
    ['com sucesso', '?envio=ok'],
    ['ação com aviso', '?acao=ordem_mudou'],
    ['com 12 fotos (formulário substituído pelo aviso)', '?n=12'],
  ];
  for (const [nome, busca] of telas) {
    test(nome, async ({ page }) => {
      await abrir(page, busca);
      if (busca === '?n=12') {
        await expect(page.getByText('12 de 12 fotos')).toBeVisible();
        await expect(page.locator('#foto-arquivo')).toHaveCount(0);
        await expect(page.getByText('O salão já tem 12 fotos. Remova uma para enviar outra.')).toBeVisible();
      }
      await analisarComAxe(page, `/dev/fotos${busca}`);
      await semRolagemHorizontal(page, `/dev/fotos${busca}`);
    });
  }
});
