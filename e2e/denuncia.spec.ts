import { expect, test, type Page } from '@playwright/test';

import { analisarComAxe, semRolagemHorizontal } from './suporte/vitrine';

// D-035 CA-2: denúncia pública de avaliação só com o teclado em /dev/denuncia (a MESMA seção de avaliações da
// página do salão, ação que só valida, sem banco), em 375×812 e com o idioma do navegador em inglês: foco
// visível, motivo por setas, erro associado ao campo, resposta uniforme, axe 4.14.0 sem violações.

test.use({ locale: 'en-US' });

async function abrir(page: Page, consulta = '') {
  const resposta = await page.goto(`/dev/denuncia${consulta}`);
  if (resposta?.status() !== 200) {
    throw new Error(`/dev/denuncia respondeu ${resposta?.status()}: ligue VITRINE_COMPONENTES=true ou libere a porta do E2E (E2E_PORT, padrão 3000).`);
  }
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

type Focado = { tag: string; id: string; tipo: string; outline: number; estilo: string; texto: string };
const focado = (page: Page): Promise<Focado> =>
  page.evaluate(() => {
    const e = document.activeElement as HTMLInputElement;
    const s = getComputedStyle(e);
    return { tag: e.tagName, id: e.id, tipo: e.type ?? '', outline: parseFloat(s.outlineWidth), estilo: s.outlineStyle, texto: e.textContent ?? '' };
  });

async function tabAte(page: Page, alvo: (f: Focado) => boolean, limite = 40): Promise<Focado> {
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

test.describe('CA-2: denúncia só com o teclado (375×812)', () => {
  test('estado inicial: avaliações com "Denunciar" fechado; sem rolagem horizontal e sem violações do axe', async ({ page }) => {
    await abrir(page);
    await expect(page.getByRole('heading', { level: 2, name: 'Avaliações' })).toBeVisible();
    await expect(page.locator('details')).toHaveCount(2);
    await expect(page.locator('details[open]')).toHaveCount(0);
    await semRolagemHorizontal(page, '/dev/denuncia');
    await analisarComAxe(page, '/dev/denuncia (inicial)');
  });

  test('abrir pelo teclado, enviar vazio: erro associado ao motivo, texto preservado, axe sem violações', async ({ page }) => {
    await abrir(page);
    await tabAte(page, (f) => f.tag === 'SUMMARY');
    await page.keyboard.press('Enter');
    await expect(page.locator('details[open]')).toHaveCount(1);
    await tabAte(page, (f) => f.tag === 'TEXTAREA');
    await page.keyboard.type('detalhe da denúncia');
    await tabAte(page, (f) => f.tag === 'BUTTON');
    await page.keyboard.press('Enter');

    const grupo = page.getByRole('group', { name: /Motivo/ }).first();
    await expect(page.getByText('Escolha um motivo.')).toBeVisible();
    await expect(grupo).toHaveAttribute('aria-describedby', /motivo-erro/);
    await expect(page.getByLabel(/Detalhes/).first()).toHaveValue('detalhe da denúncia');
    await semRolagemHorizontal(page, '/dev/denuncia (erro)');
    await analisarComAxe(page, '/dev/denuncia (com erro)');
  });

  test('motivo por setas e envio por Enter mostram a resposta uniforme', async ({ page }) => {
    await abrir(page);
    await tabAte(page, (f) => f.tag === 'SUMMARY');
    await page.keyboard.press('Enter');
    await tabAte(page, (f) => f.tipo === 'radio');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('radio', { name: 'Propaganda ou spam' })).toBeChecked();
    await tabAte(page, (f) => f.tag === 'BUTTON');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status')).toContainText('Recebemos sua denúncia');
    await expect(page).toHaveURL(/\/dev\/denuncia\?denuncia=recebida/);
    await semRolagemHorizontal(page, '/dev/denuncia (sucesso)');
    await analisarComAxe(page, '/dev/denuncia (sucesso)');
  });

  test('verificação humana reprovada: alerta de erro e o formulário continua aberto', async ({ page }) => {
    await abrir(page);
    await page.locator('summary').first().click();
    await page.getByRole('radio', { name: 'Linguagem ofensiva' }).first().check();
    await page.locator('select[name="cf-turnstile-response"]').first().selectOption({ label: 'Token inválido' });
    await page.getByRole('button', { name: 'Enviar denúncia' }).first().click();
    await expect(page.getByRole('alert').filter({ hasText: 'Erro:' })).toContainText('Não foi possível confirmar que você é uma pessoa.');
    await expect(page.locator('details[open]')).toHaveCount(1);
  });
});
