import { expect, test, type Page } from '@playwright/test';

import { analisarComAxe, semRolagemHorizontal } from './suporte/vitrine';

// D-016 CA-21 (D-24): bloqueios só com o teclado (Tab/Shift+Tab/Enter/Espaço/setas), foco visível,
// resumo de erros e seção do aviso focados, erros ligados aos campos e axe sem violações. Roda em
// /dev/bloqueios (mesmos componentes da página real, ações que só validam, sem banco): "salvar" e
// "remover" aqui exercitam a validação do servidor e o estado sem gravar.

const SALVO = 'Bloqueio salvo';
const AVISO = 'Atenção: estas reservas confirmadas ficam sob o bloqueio.';

/** dd/mm/aaaa no fuso do salão, `dias` à frente. */
function dataLocal(dias: number): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(
    new Date(Date.now() + dias * 86_400_000),
  );
}

async function abrir(page: Page, busca = '') {
  const resposta = await page.goto(`/dev/bloqueios${busca}`);
  if (resposta?.status() !== 200) {
    throw new Error(`/dev/bloqueios respondeu ${resposta?.status()}: ligue VITRINE_COMPONENTES=true ou libere a porta do E2E (E2E_PORT, padrão 3000).`);
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
async function tabAte(page: Page, alvo: (f: Focado) => boolean, limite = 60, tecla = 'Tab'): Promise<Focado> {
  for (let i = 0; i < limite; i += 1) {
    await page.keyboard.press(tecla);
    const f = await focado(page);
    if (f.tag !== 'BODY') {
      expect(f.estilo, `foco visível em ${f.tag}#${f.id}`).not.toBe('none');
      expect(f.outline, `contorno de foco em ${f.tag}#${f.id}`).toBeGreaterThan(0);
    }
    if (alvo(f)) return f;
  }
  throw new Error('elemento não alcançado por Tab');
}

/** Seleciona o conteúdo do campo focado e digita o novo valor (só teclado). */
async function digitar(page: Page, valor: string) {
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(valor);
}

test.describe('CA-21: bloqueios só com o teclado (viewport 375×812)', () => {
  test('profissional cria um bloqueio com horário; o foco vai à seção do aviso', async ({ page }) => {
    await abrir(page, '?modo=profissional');
    await semRolagemHorizontal(page, '/dev/bloqueios?modo=profissional');
    const dia = dataLocal(4);
    await tabAte(page, (f) => f.id === 'bloqueio-modo');
    await expect(page.locator('#bloqueio-modo')).toBeChecked();
    await page.keyboard.press('Tab');
    expect((await focado(page)).id).toBe('bloqueio-dataInicio');
    await digitar(page, dia);
    await page.keyboard.press('Tab');
    await digitar(page, '14:00');
    // Shift+Tab volta e Tab avança na ordem visual.
    await page.keyboard.press('Shift+Tab');
    expect((await focado(page)).id).toBe('bloqueio-dataInicio');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    expect((await focado(page)).id).toBe('bloqueio-dataFim');
    await digitar(page, dia);
    await page.keyboard.press('Tab');
    await digitar(page, '16:00');
    await page.keyboard.press('Tab');
    await digitar(page, 'Dentista');
    await page.keyboard.press('Enter');

    const secao = page.locator('#bloqueio-salvo');
    await expect(secao).toBeFocused();
    await expect(secao).toContainText(`${SALVO}: ${dia} 14:00 a ${dia} 16:00.`);
    await expect(secao).toContainText(AVISO);
    await expect(secao.getByRole('listitem')).toHaveCount(2);
    // Na criação, os campos voltam vazios.
    await expect(page.locator('#bloqueio-dataInicio')).toHaveValue('');
    await semRolagemHorizontal(page, '/dev/bloqueios?modo=profissional depois de salvar');
  });

  test('gestor escolhe "Salão inteiro" e "Dia inteiro" pelo teclado e salva; o aviso recebe o foco', async ({ page }) => {
    await abrir(page);
    const dia = dataLocal(6);
    await tabAte(page, (f) => f.id === 'bloqueio-alvo');
    // Select fechado: a seta escolhe a próxima opção (Chromium).
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#bloqueio-alvo')).toHaveValue('salao');
    await page.keyboard.press('Tab');
    expect((await focado(page)).id).toBe('bloqueio-modo');
    // Grupo de rádios: a seta muda a escolha; Espaço confirma.
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Space');
    await expect(page.locator('#bloqueio-modo-dia-inteiro')).toBeChecked();
    await page.keyboard.press('Tab');
    await digitar(page, dia);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await digitar(page, dia);
    await page.keyboard.press('Enter');

    const secao = page.locator('#bloqueio-salvo');
    await expect(secao).toBeFocused();
    await expect(secao).toContainText(`${SALVO}: ${dia} (dia inteiro).`);
    await expect(secao).toContainText('cliente removida');
  });

  test('com erro, o foco vai ao resumo; o link leva ao campo, que descreve o erro', async ({ page }) => {
    await abrir(page);
    const dia = dataLocal(5);
    await tabAte(page, (f) => f.id === 'bloqueio-dataInicio');
    await digitar(page, dia);
    await page.keyboard.press('Tab');
    await digitar(page, '14:07');
    await page.keyboard.press('Tab');
    await digitar(page, dia);
    await page.keyboard.press('Tab');
    await digitar(page, '16:00');
    await page.keyboard.press('Enter');

    const resumo = page.locator('#bloqueio-resumo-erros');
    await expect(resumo).toBeFocused();
    await expect(resumo).toContainText('Corrija os campos indicados para salvar o bloqueio.');
    const f = await tabAte(page, (x) => x.tag === 'A');
    expect(f.texto).toContain('Hora de início');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#bloqueio-horaInicio$/);
    await page.keyboard.press('Tab');
    expect((await focado(page)).id).toBe('bloqueio-dataFim');

    const campo = page.locator('#bloqueio-horaInicio');
    await expect(campo).toHaveValue('14:07');
    await expect(campo).toHaveAttribute('aria-invalid', 'true');
    expect((await campo.getAttribute('aria-describedby'))!.split(' ')).toContain('bloqueio-horaInicio-erro');
    await expect(page.locator('#bloqueio-horaInicio-erro')).toContainText('Use minutos múltiplos de 5');
  });

  test('gestor remove um bloqueio pelo teclado e vê "Bloqueio removido."', async ({ page }) => {
    await abrir(page);
    await tabAte(page, (f) => f.rotulo.startsWith('Remover bloqueio: Bia Demonstração'), 120);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/dev\/bloqueios\?remocao=ok&modo=gestor$/);
    await expect(page.getByRole('status').filter({ hasText: 'Bloqueio removido.' })).toBeVisible();
  });
});

test.describe('CA-21: axe 4.14.0 sem violações', () => {
  test('lista e formulário (gestor, profissional, edição), erro e aviso', async ({ page }) => {
    for (const busca of ['', '?modo=profissional', '?modo=edicao']) {
      await abrir(page, busca);
      await analisarComAxe(page, `/dev/bloqueios${busca}`);
      await semRolagemHorizontal(page, `/dev/bloqueios${busca}`);
    }

    await abrir(page);
    await page.locator('#bloqueio-dataInicio').fill('31/02/2026');
    await page.locator('#bloqueio-horaInicio').fill('9h');
    await page.getByRole('button', { name: 'Salvar bloqueio' }).click();
    await expect(page.locator('#bloqueio-resumo-erros')).toBeFocused();
    await analisarComAxe(page, '/dev/bloqueios (erro)');
    await semRolagemHorizontal(page, '/dev/bloqueios (erro)');

    const dia = dataLocal(7);
    await page.locator('#bloqueio-alvo').selectOption('salao');
    await page.getByRole('radio', { name: 'Dia inteiro' }).check();
    await page.locator('#bloqueio-dataInicio').fill(dia);
    await page.locator('#bloqueio-dataFim').fill(dia);
    await page.getByRole('button', { name: 'Salvar bloqueio' }).click();
    await expect(page.locator('#bloqueio-salvo')).toBeFocused();
    await analisarComAxe(page, '/dev/bloqueios (aviso)');
    await semRolagemHorizontal(page, '/dev/bloqueios (aviso)');
  });
});
