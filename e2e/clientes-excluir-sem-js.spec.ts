import { expect, test } from '@playwright/test';

// D-031 CA-13: as duas etapas da exclusão funcionam SEM JavaScript: o link leva à confirmação (GET), o
// botão é um POST de <form action> com redirecionamento (PRG) e "Cancelar" é um link. Em /dev/clientes.

test.use({ javaScriptEnabled: false, locale: 'en-US' });

test.describe('CA-13: exclusão sem JavaScript', () => {
  test('detalhe → confirmação → Confirmar → cliente removida com o aviso (PRG)', async ({ page }) => {
    await page.goto('/dev/clientes?vista=detalhe');
    await page.getByRole('link', { name: 'Excluir cliente' }).click();
    await expect(page).toHaveURL(/vista=excluir$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Excluir cliente' })).toBeVisible();
    await page.getByRole('button', { name: 'Confirmar exclusão' }).click();
    await expect(page).toHaveURL(/vista=anonimizada&exclusao=ok$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Cliente removida' })).toBeVisible();
    await expect(page.getByRole('status')).toContainText('Cliente excluída');
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Cliente removida' })).toBeVisible();
  });

  test('Cancelar volta ao detalhe', async ({ page }) => {
    await page.goto('/dev/clientes?vista=excluir');
    await page.getByRole('link', { name: 'Cancelar' }).click();
    await expect(page).toHaveURL(/vista=detalhe$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Maria Souza' })).toBeVisible();
  });
});
