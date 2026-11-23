import { expect, test, type Page } from '@playwright/test';

import {
  abrirSalao, continuar, diaFuturo, escolherDia, escolherHorarioDe, escolherServicos, linkDoDia, noPassoDoServico, paradasDoRoteiro,
  radioDoHorario, reguaDaSemana, verificarTela,
} from './suporte/publico';

// D-051 na página pública REAL (banco do E2E): CA-5, CA-7, CA-8 (HTTP 200 nas URLs antigas), CA-9, CA-10, CA-13 (d)
// e CA-16. Só leitura e navegação GET: nenhum teste aqui grava reserva, então o salão /e2e-reservas-5 (usado pelo
// spec de avaliação, que só cria reservas concluídas no passado) não disputa vaga com os outros specs. O fluxo
// completo até a confirmação sem JavaScript (CA-13 a) fica em publico-reserva.spec.ts e reserva-publica-sem-js.
// Salão: Escova (Ana, Bia), Hidratação (Ana, Cris); jornada 08:00–12:00 e 13:00–20:00 todos os dias.

const SLUG = 'e2e-reservas-5';

/** URLs visitadas (CA-16: nenhuma com dado pessoal). */
function registrarUrls(page: Page): string[] {
  const urls: string[] = [];
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) urls.push(f.url());
  });
  return urls;
}

const SEM_DADO_PESSOAL = /nome=|telefone=|aceite|consent|mensagensReserva|conviteAvaliacao|Maria|9\d{4}-?\d{4}/i;

test('CA-5/CA-7/CA-9/CA-10: régua no passo do 1º serviço, "Alterar" do item 0, troca de dia e de semana', async ({ page }) => {
  const urls = registrarUrls(page);
  // De 8 a 13 dias: sempre além da semana 0, então a régua navega por "Próxima semana".
  const dia = diaFuturo({ de: 8, ate: 13 });
  await abrirSalao(page, SLUG);
  await escolherServicos(page, ['Escova', 'Hidratação']);
  await continuar(page);

  // CA-1/CA-4: passo 0 sem dia.
  await noPassoDoServico(page, 'Escova', 1, 2);
  await expect(page.getByRole('heading', { level: 3, name: 'Escolha o dia' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 3, name: 'Escolha um dia para ver os horários' })).toBeVisible();
  await expect(page.locator('[aria-current="date"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Continuar/ })).toHaveCount(0);
  await expect(page.getByText('Semana anterior')).toHaveCount(0);
  await verificarTela(page, 'passo 0 sem dia');

  // CA-5: o dia pela régua; mesmo passo, dia marcado, horários abaixo, URL com s + data + #reservar.
  await escolherDia(page, dia);
  await expect(page).toHaveURL(new RegExp(`data=${dia}#reservar$`));
  await expect(page).not.toHaveURL(/h\d=/);
  await noPassoDoServico(page, 'Escova', 1, 2);
  await expect(page.getByRole('heading', { level: 2, name: 'Escova' })).toBeInViewport();
  await expect(page.getByRole('group', { name: 'Horários de Ana', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Escolher outro dia' })).toHaveCount(0);
  await verificarTela(page, 'passo 0 com dia');
  await escolherHorarioDe(page, 'Ana', '09:00');
  await continuar(page);

  // CA-6: passo 2 sem régua, com "Escolher outro dia".
  await noPassoDoServico(page, 'Hidratação', 2, 2);
  await expect(reguaDaSemana(page)).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Escolher outro dia' })).toBeVisible();
  await escolherHorarioDe(page, 'Cris', '10:00');
  await continuar(page);
  await expect(page.getByRole('heading', { level: 2, name: 'Seus dados' })).toBeVisible();

  // CA-9: "Alterar" da Escova: régua marcada, horário atual pré-selecionado, Hidratação no roteiro.
  await page.getByRole('link', { name: /^Alterar Escova/ }).click();
  await noPassoDoServico(page, 'Escova', 1, 2);
  await expect(linkDoDia(page, dia)).toHaveAttribute('aria-current', 'date');
  await expect(radioDoHorario(page, 'Ana', '09:00')).toBeChecked();
  expect((await paradasDoRoteiro(page)).some((p) => /Hidratação.*com Cris/.test(p))).toBe(true);
  await escolherHorarioDe(page, 'Bia', '11:00');
  await continuar(page);
  await expect(page.getByRole('heading', { level: 2, name: 'Seus dados' })).toBeVisible();
  expect(await paradasDoRoteiro(page)).toEqual([
    expect.stringMatching(/^10:00 .*Hidratação .*com Cris/),
    expect.stringMatching(/^11:00 .*Escova .*com Bia/),
  ]);

  // CA-7: de "Alterar" do item 0, outro dia descarta todos os horários; a semana desmarca o dia.
  await page.getByRole('link', { name: /^Alterar Escova/ }).click();
  const outro = reguaDaSemana(page).locator('a:not([aria-current])').first();
  expect(await outro.getAttribute('href')).not.toMatch(/h\d=|alterar|[?&]f=|enviado|aviso/);
  await outro.click();
  await expect(page.locator('[aria-current="date"]')).toHaveCount(1);
  await expect(page.getByRole('radio', { checked: true })).toHaveCount(0);
  // Nenhum item escolhido: o serviço em escolha e a Hidratação pendente.
  const roteiro = page.getByRole('list', { name: 'Seu dia' });
  await expect(roteiro.locator(':scope > li[data-estado="escolhida"]')).toHaveCount(0);
  await expect(roteiro.locator(':scope > li[data-estado="pendente"]')).toHaveCount(1);
  const semana = page.getByRole('navigation', { name: 'Semanas' }).getByRole('link').first();
  await semana.click();
  await expect(page).not.toHaveURL(/data=|h\d=/);
  await expect(page.getByRole('heading', { level: 3, name: 'Escolha um dia para ver os horários' })).toBeVisible();

  // CA-10: "Escolher outro dia" do passo 2 → passo 0 na semana da data, sem dia marcado nem itens.
  await escolherDia(page, dia);
  await escolherHorarioDe(page, 'Ana', '09:00');
  await continuar(page);
  await noPassoDoServico(page, 'Hidratação', 2, 2);
  await page.getByRole('link', { name: 'Escolher outro dia' }).click();
  await noPassoDoServico(page, 'Escova', 1, 2);
  await expect(page).toHaveURL(new RegExp(`de=${dia}#reservar$`));
  await expect(page).not.toHaveURL(/h\d=|data=/);
  await expect(linkDoDia(page, dia)).toBeVisible();
  await expect(page.locator('[aria-current="date"]')).toHaveCount(0);

  // CA-16: nenhuma URL do percurso com dado pessoal.
  expect(urls.length).toBeGreaterThan(8);
  for (const u of urls) expect(u, u).not.toMatch(SEM_DADO_PESSOAL);
});

test('CA-8: as URLs da tabela da RN-12 respondem 200 e caem no passo equivalente', async ({ page }) => {
  await abrirSalao(page, SLUG);
  const valorDe = async (nome: string) => page.getByRole('checkbox', { name: new RegExp(`^${nome}\\b`) }).getAttribute('value');
  const s = [await valorDe('Escova'), await valorDe('Hidratação')];
  const qs = `s=${s[0]}&s=${s[1]}`;
  const abrir = async (busca: string) => {
    const r = await page.goto(`/${SLUG}?${busca}`);
    expect(r?.status(), busca).toBe(200);
  };

  // Semana 1 e um `de` no meio dela: a semana inteira, não a que começa em `de`.
  await abrir(qs);
  const proxima = new URL((await page.getByRole('link', { name: 'Próxima semana' }).getAttribute('href'))!, 'http://l').searchParams.get('de')!;
  await abrir(`${qs}&de=${proxima}`);
  const periodo = await page.locator('[id="reservar-dia-periodo"]').innerText();
  const meio = new Date(`${proxima}T12:00:00Z`);
  meio.setUTCDate(meio.getUTCDate() + 3);
  await abrir(`${qs}&de=${meio.toISOString().slice(0, 10)}`);
  await expect(page.locator('[id="reservar-dia-periodo"]')).toHaveText(periodo);
  await expect(page.locator('[aria-current="date"]')).toHaveCount(0);

  // data=D (e data=D&de=X): passo 0 com D marcado.
  const data = new URL((await reguaDaSemana(page).getByRole('link').first().getAttribute('href'))!, 'http://l').searchParams.get('data')!;
  for (const extra of ['', `&de=${proxima}`, '&de=2099-01-01']) {
    await abrir(`${qs}&data=${data}${extra}`);
    await noPassoDoServico(page, 'Escova', 1, 2);
    await expect(linkDoDia(page, data)).toHaveAttribute('aria-current', 'date');
  }
  const h0 = await radioDoHorario(page, 'Ana', '09:00').inputValue();
  await abrir(`${qs}&data=${data}&h0=${encodeURIComponent(h0)}`);
  await noPassoDoServico(page, 'Hidratação', 2, 2);
  await expect(reguaDaSemana(page)).toHaveCount(0);
  const h1 = await radioDoHorario(page, 'Cris', '10:00').inputValue();
  const ambos = `${qs}&data=${data}&h0=${encodeURIComponent(h0)}&h1=${encodeURIComponent(h1)}`;
  await abrir(ambos);
  await expect(page.getByRole('heading', { level: 2, name: 'Seus dados' })).toBeVisible();
  await abrir(`${ambos}&alterar=0`);
  await noPassoDoServico(page, 'Escova', 1, 2);
  await expect(linkDoDia(page, data)).toHaveAttribute('aria-current', 'date');
  await expect(radioDoHorario(page, 'Ana', '09:00')).toBeChecked();
  await abrir(`${ambos}&alterar=1`);
  await noPassoDoServico(page, 'Hidratação', 2, 2);
  await expect(reguaDaSemana(page)).toHaveCount(0);
  // data fora da janela ou inválida: passo 0 sem dia.
  for (const fora of ['2099-01-01', '2000-01-01', 'x']) {
    await abrir(`${qs}&data=${fora}`);
    await noPassoDoServico(page, 'Escova', 1, 2);
    await expect(page.getByRole('heading', { level: 3, name: 'Escolha um dia para ver os horários' })).toBeVisible();
  }
});
