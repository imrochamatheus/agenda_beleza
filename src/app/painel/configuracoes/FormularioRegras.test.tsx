/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MENSAGENS_CONFIGURACOES as M } from '@/server/salao/tipos';
import type { OpcoesFuso, ValoresRegras } from '@/server/salao/tipos';

import { estadoRegrasInicial, estadoSlugInicial, idDoCampo, lerFormularioRegras, lerFormularioSlug, VALORES_REGRAS_VAZIOS } from './estado';
import type { EstadoRegras } from './estado';
import { FormularioRegras } from './FormularioRegras';

// D-017 T-7: estrutura acessível (CA-19), resumo de erros e sucesso focados, valores preservados.

const FUSOS: OpcoesFuso = {
  atualForaDaLista: null,
  brasil: [
    { valor: 'America/Sao_Paulo', rotulo: 'Brasília e São Paulo (America/Sao_Paulo)' },
    { valor: 'America/Manaus', rotulo: 'Manaus (America/Manaus)' },
  ],
  outros: [{ valor: 'Europe/Lisbon', rotulo: 'Europe/Lisbon' }],
};
const VALORES: ValoresRegras = { nome: 'Studio Bela', fuso: 'America/Sao_Paulo', grade: '15', antecedencia: '2', janela: '60', intervalo: '0' };
const semAcao = async (e: EstadoRegras) => e;
const campo = (id: string) => document.getElementById(id) as HTMLInputElement;
const enviar = () => fireEvent.click(screen.getByRole('button', { name: 'Salvar configurações' }));

describe('FormularioRegras: estrutura', () => {
  it('campos rotulados com unidade, select de fuso com grupos Brasil/Outros e de grade; valores iniciais', () => {
    render(<FormularioRegras acao={semAcao} valoresIniciais={VALORES} fusos={FUSOS} />);
    const nome = screen.getByRole('textbox', { name: 'Nome do salão' }) as HTMLInputElement;
    expect([nome.name, nome.value, nome.maxLength, nome.autocomplete]).toEqual(['nome', 'Studio Bela', 80, 'organization']);

    const fuso = screen.getByRole('combobox', { name: 'Fuso horário' }) as HTMLSelectElement;
    expect(fuso.name).toBe('fuso');
    expect(fuso.value).toBe('America/Sao_Paulo');
    const grupos = [...fuso.querySelectorAll('optgroup')];
    expect(grupos.map((g) => g.label)).toEqual(['Brasil', 'Outros']);
    expect([...grupos[0].querySelectorAll('option')].map((o) => o.value)).toEqual(['America/Sao_Paulo', 'America/Manaus']);
    expect([...grupos[1].querySelectorAll('option')].map((o) => o.textContent)).toEqual(['Europe/Lisbon']);
    expect(fuso.getAttribute('aria-describedby')).toBe('config-fuso-ajuda');
    expect(document.getElementById('config-fuso-ajuda')!.textContent).toBe(M.ajudaFuso);
    expect(fuso.getAttribute('aria-invalid')).toBeNull();

    const grade = screen.getByRole('combobox', { name: 'Grade de horários (minutos)' }) as HTMLSelectElement;
    expect([...grade.options].map((o) => o.value)).toEqual(['5', '10', '15', '20', '30', '60']);
    expect(grade.value).toBe('15');

    for (const [rotulo, nomeCampo, valor] of [
      ['Antecedência mínima (horas)', 'antecedencia', '2'],
      ['Janela máxima (dias)', 'janela', '60'],
      ['Intervalo entre atendimentos (minutos)', 'intervalo', '0'],
    ]) {
      const c = screen.getByRole('textbox', { name: rotulo }) as HTMLInputElement;
      expect([c.name, c.value, c.inputMode, c.maxLength, c.pattern]).toEqual([nomeCampo, valor, 'numeric', 4, '[0-9]*']);
    }
    const grupo = screen.getByRole('group', { name: 'Regras de horário' });
    expect(grupo.getAttribute('aria-describedby')).toBe('config-regras-ajuda');
    expect(document.getElementById('config-regras-ajuda')!.textContent).toBe(M.ajudaRegras);
    const botao = screen.getByRole('button', { name: 'Salvar configurações' }) as HTMLButtonElement;
    expect(botao.type).toBe('submit');
    expect(botao.form!.noValidate).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('fuso gravado fora da lista aparece como primeira opção, selecionada', () => {
    const fusos = { ...FUSOS, atualForaDaLista: { valor: 'Brazil/East', rotulo: 'Brazil/East (atual)' } };
    render(<FormularioRegras acao={semAcao} valoresIniciais={{ ...VALORES, fuso: 'Brazil/East' }} fusos={fusos} />);
    const fuso = screen.getByRole('combobox', { name: 'Fuso horário' }) as HTMLSelectElement;
    expect(fuso.value).toBe('Brazil/East');
    expect(fuso.options[0].textContent).toBe('Brazil/East (atual)');
    expect(fuso.options[0].parentElement!.tagName).toBe('SELECT');
  });
});

describe('FormularioRegras: envio', () => {
  it('erros: resumo focado com links, aria-invalid e aria-describedby; valores digitados preservados', async () => {
    const acao = vi.fn(async (_e: EstadoRegras, fd: FormData): Promise<EstadoRegras> => ({
      ...estadoRegrasInicial(lerFormularioRegras(fd).valores),
      erros: { fuso: M.fuso, antecedencia: M.antecedencia, intervalo: M.intervalo },
    }));
    render(<FormularioRegras acao={acao} valoresIniciais={VALORES} fusos={FUSOS} />);
    fireEvent.change(campo('config-antecedencia'), { target: { value: '99' } });
    fireEvent.change(campo('config-intervalo'), { target: { value: 'abc' } });
    fireEvent.change(campo('config-fuso'), { target: { value: 'America/Manaus' } });
    enviar();
    const resumo = await screen.findByRole('alert');
    await waitFor(() => expect(document.activeElement).toBe(resumo));
    expect(resumo.getAttribute('tabindex')).toBe('-1');
    expect(within(resumo).getByText(M.resumoErros)).toBeTruthy();
    expect(within(resumo).getAllByRole('link').map((a) => [a.getAttribute('href'), a.textContent])).toEqual([
      ['#config-fuso', `Fuso horário: ${M.fuso}`],
      ['#config-antecedencia', `Antecedência mínima (horas): ${M.antecedencia}`],
      ['#config-intervalo', `Intervalo entre atendimentos (minutos): ${M.intervalo}`],
    ]);
    const fd = acao.mock.calls[0][1];
    expect(fd.get('antecedencia')).toBe('99');
    expect(fd.get('fuso')).toBe('America/Manaus');
    const fuso = campo('config-fuso');
    expect(fuso.getAttribute('aria-invalid')).toBe('true');
    expect(fuso.getAttribute('aria-describedby')).toBe('config-fuso-ajuda config-fuso-erro');
    expect(document.getElementById('config-fuso-erro')!.textContent).toContain(M.fuso);
    const ant = campo('config-antecedencia');
    expect(ant.getAttribute('aria-invalid')).toBe('true');
    expect(ant.getAttribute('aria-describedby')).toBe('config-antecedencia-erro');
    expect(ant.value).toBe('99');
    expect(campo('config-intervalo').value).toBe('abc');
    expect((fuso as unknown as HTMLSelectElement).value).toBe('America/Manaus');
  });

  it('sucesso: mensagem de status focada; valores normalizados do servidor; mensagem geral em alerta', async () => {
    let chamada = 0;
    const acao = async (): Promise<EstadoRegras> => {
      chamada += 1;
      return chamada === 1
        ? { ...estadoRegrasInicial({ ...VALORES, nome: 'Studio Bela Nova', grade: '30' }), sucesso: M.regrasSalvas }
        : { ...estadoRegrasInicial(VALORES), mensagem: M.acessoNegado };
    };
    render(<FormularioRegras acao={acao} valoresIniciais={VALORES} fusos={FUSOS} />);
    fireEvent.change(campo('config-nome'), { target: { value: '  Studio   Bela Nova ' } });
    enviar();
    const status = await screen.findByRole('status');
    expect(status.textContent).toContain(M.regrasSalvas);
    const caixa = document.getElementById('config-regras-sucesso')!;
    await waitFor(() => expect(document.activeElement).toBe(caixa));
    expect(caixa.getAttribute('tabindex')).toBe('-1');
    expect(campo('config-nome').value).toBe('Studio Bela Nova');
    expect((campo('config-grade') as unknown as HTMLSelectElement).value).toBe('30');
    enviar();
    expect((await screen.findByRole('alert')).textContent).toContain(M.acessoNegado);
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('estado.ts', () => {
  it('lerFormularioRegras: só os seis nomes; extras e arquivos ignorados; eco cortado em 200', () => {
    const fd = new FormData();
    fd.set('nome', 'n'.repeat(250));
    fd.set('fuso', 'America/Manaus');
    fd.set('grade', '30');
    fd.set('antecedencia', new Blob(['2']));
    fd.set('janela', '60');
    fd.set('salaoId', 'outro');
    const { entrada, valores } = lerFormularioRegras(fd);
    expect(entrada).toEqual({ nome: 'n'.repeat(250), fuso: 'America/Manaus', grade: '30', antecedencia: '', janela: '60', intervalo: '' });
    expect('salaoId' in entrada).toBe(false);
    expect(valores.nome).toHaveLength(200);
    expect(valores.intervalo).toBe('');
  });

  it('lerFormularioSlug, estados iniciais e idDoCampo', () => {
    const fd = new FormData();
    fd.set('slug', 'x'.repeat(300));
    fd.set('salaoId', 'outro');
    const r = lerFormularioSlug(fd);
    expect(r.entrada).toEqual({ slug: 'x'.repeat(300) });
    expect(r.valor).toHaveLength(200);
    expect(lerFormularioSlug(new FormData())).toEqual({ entrada: { slug: '' }, valor: '' });
    expect(estadoSlugInicial()).toEqual({ mensagem: null, sucesso: null, erros: {}, valor: '' });
    expect(estadoRegrasInicial()).toEqual({ mensagem: null, sucesso: null, erros: {}, valores: VALORES_REGRAS_VAZIOS });
    expect(idDoCampo('janela')).toBe('config-janela');
    expect(idDoCampo('slug')).toBe('config-slug');
  });
});
