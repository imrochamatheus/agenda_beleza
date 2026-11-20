/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MENSAGENS_PERFIL as M, VALORES_PERFIL_VAZIOS } from '@/server/salao/perfil-tipos';
import type { ValoresPerfil } from '@/server/salao/perfil-tipos';

import { estadoPerfilInicial, idDoCampo, lerFormularioPerfil } from './estado';
import type { EstadoPerfil } from './estado';
import { FormularioPerfil } from './FormularioPerfil';

// D-020 T-8: estrutura acessível (RN-19, CA-5), caixas preservadas (CA-15), resumo e sucesso focados,
// valores normalizados depois do sucesso (R-12).

const VALORES: ValoresPerfil = {
  descricao: 'Salão aconchegante.',
  logradouro: 'Av. Paulista',
  numero: '1000',
  complemento: '',
  bairro: 'Bela Vista',
  cidade: 'São Paulo',
  uf: 'SP',
  cep: '01310-100',
  telefone: '(11) 3456-7890',
  whatsapp: '(11) 98765-4321',
  instagram: 'meu.salao',
  meiosPagamento: ['dinheiro', 'pix'],
  comodidades: ['wifi'],
};
const semAcao = async (e: EstadoPerfil) => e;
const campo = (id: string) => document.getElementById(id) as HTMLInputElement;
const enviar = () => fireEvent.click(screen.getByRole('button', { name: 'Salvar perfil' }));

describe('FormularioPerfil: estrutura', () => {
  it('campos rotulados, tipos e atributos; valores iniciais; caixas marcadas', () => {
    render(<FormularioPerfil acao={semAcao} valoresIniciais={VALORES} />);
    expect(screen.getByText(M.ajudaPublico)).toBeTruthy();
    const descricao = screen.getByRole('textbox', { name: 'Descrição' }) as HTMLTextAreaElement;
    expect([descricao.tagName, descricao.name, descricao.maxLength, descricao.value]).toEqual(['TEXTAREA', 'descricao', 1000, 'Salão aconchegante.']);
    expect(descricao.getAttribute('aria-describedby')).toContain('perfil-descricao-ajuda');
    expect(document.getElementById('perfil-descricao-contador')!.textContent).toBe('19 de 1.000 caracteres');
    expect(document.getElementById('perfil-descricao-contador')!.getAttribute('aria-live')).toBe('polite');

    const uf = screen.getByRole('combobox', { name: 'UF' }) as HTMLSelectElement;
    expect(uf.options).toHaveLength(28);
    expect(uf.options[0].value).toBe('');
    expect(uf.value).toBe('SP');
    const cep = screen.getByRole('textbox', { name: 'CEP' }) as HTMLInputElement;
    expect([cep.inputMode, cep.autocomplete, cep.maxLength, cep.value]).toEqual(['numeric', 'postal-code', 9, '01310-100']);
    for (const nome of ['Telefone', 'WhatsApp']) {
      const t = screen.getByRole('textbox', { name: nome }) as HTMLInputElement;
      expect(t.type).toBe('tel');
    }
    expect((screen.getByRole('textbox', { name: 'Telefone' }) as HTMLInputElement).value).toBe('(11) 3456-7890');
    const insta = screen.getByRole('textbox', { name: 'Instagram' }) as HTMLInputElement;
    expect([insta.value, insta.getAttribute('autocapitalize')]).toEqual(['meu.salao', 'none']);

    const meios = screen.getByRole('group', { name: 'Meios de pagamento' });
    const caixas = within(meios).getAllByRole('checkbox') as HTMLInputElement[];
    expect(caixas.map((c) => [c.name, c.value, c.checked])).toEqual([
      ['meiosPagamento', 'dinheiro', true],
      ['meiosPagamento', 'pix', true],
      ['meiosPagamento', 'cartao_credito', false],
      ['meiosPagamento', 'cartao_debito', false],
      ['meiosPagamento', 'carteira_digital', false],
      ['meiosPagamento', 'vale_presente', false],
    ]);
    expect(within(screen.getByRole('group', { name: 'Comodidades' })).getAllByRole('checkbox')).toHaveLength(7);
    expect((screen.getByRole('checkbox', { name: 'Wi-Fi para clientes' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole('group', { name: 'Endereço' })).toBeTruthy();
    const botao = screen.getByRole('button', { name: 'Salvar perfil' }) as HTMLButtonElement;
    expect(botao.form!.noValidate).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('contador acompanha a digitação', () => {
    render(<FormularioPerfil acao={semAcao} valoresIniciais={VALORES_PERFIL_VAZIOS} />);
    const descricao = screen.getByRole('textbox', { name: 'Descrição' });
    expect(document.getElementById('perfil-descricao-contador')!.textContent).toBe('0 de 1.000 caracteres');
    fireEvent.change(descricao, { target: { value: 'abc' } });
    expect(document.getElementById('perfil-descricao-contador')!.textContent).toBe('3 de 1.000 caracteres');
  });
});

describe('FormularioPerfil: envio', () => {
  it('erros: resumo focado com links; aria-invalid/aria-describedby; valores e caixas preservados', async () => {
    const acao = vi.fn(async (_e: EstadoPerfil, fd: FormData): Promise<EstadoPerfil> => ({
      ...estadoPerfilInicial(lerFormularioPerfil(fd).valores),
      erros: { cep: M.cep, meiosPagamento: M.lista, instagram: M.instagram, descricao: M.descricao },
    }));
    render(<FormularioPerfil acao={acao} valoresIniciais={VALORES_PERFIL_VAZIOS} />);
    fireEvent.change(campo('perfil-cep'), { target: { value: '123' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pix' }));
    enviar();
    const resumo = await screen.findByRole('alert', { name: M.resumoErros });
    await waitFor(() => expect(document.activeElement).toBe(resumo));
    expect(within(resumo).getAllByRole('link').map((a) => [a.getAttribute('href'), a.textContent])).toEqual([
      ['#perfil-descricao', `Descrição: ${M.descricao}`],
      ['#perfil-cep', `CEP: ${M.cep}`],
      ['#perfil-instagram', `Instagram: ${M.instagram}`],
      ['#perfil-meiosPagamento', `Meios de pagamento: ${M.lista}`],
    ]);
    expect(campo('perfil-cep').value).toBe('123');
    expect(campo('perfil-cep').getAttribute('aria-invalid')).toBe('true');
    expect(campo('perfil-cep').getAttribute('aria-describedby')).toBe('perfil-cep-erro');
    expect(campo('perfil-instagram').getAttribute('aria-describedby')).toBe('perfil-instagram-ajuda perfil-instagram-erro');
    expect(campo('perfil-descricao').getAttribute('aria-describedby')).toContain('perfil-descricao-erro');
    expect((screen.getByRole('checkbox', { name: 'Pix' }) as HTMLInputElement).checked).toBe(true);
    expect(campo('perfil-meiosPagamento').getAttribute('aria-describedby')).toBe('perfil-meiosPagamento-erro');
    expect(campo('perfil-meiosPagamento-pix').getAttribute('aria-invalid')).toBe('true');
    const fd = acao.mock.calls[0][1];
    expect(fd.getAll('meiosPagamento')).toEqual(['pix']);
  });

  it('sucesso: mensagem focada e campos com os valores normalizados do servidor', async () => {
    const acao = async (): Promise<EstadoPerfil> => ({
      mensagem: null,
      sucesso: M.salvo,
      erros: {},
      valores: { ...VALORES_PERFIL_VAZIOS, telefone: '(11) 98765-4321', instagram: 'meu.salao', comodidades: ['wifi'] },
    });
    render(<FormularioPerfil acao={acao} valoresIniciais={VALORES_PERFIL_VAZIOS} />);
    fireEvent.change(campo('perfil-telefone'), { target: { value: '11987654321' } });
    enviar();
    const status = await screen.findByText(M.salvo);
    const caixa = document.getElementById('perfil-sucesso')!;
    expect(caixa.contains(status)).toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(caixa));
    expect(campo('perfil-telefone').value).toBe('(11) 98765-4321');
    expect(campo('perfil-instagram').value).toBe('meu.salao');
    expect((screen.getByRole('checkbox', { name: 'Wi-Fi para clientes' }) as HTMLInputElement).checked).toBe(true);
  });

  it('mensagem geral e erro de formulário em alertas', async () => {
    const acao = async (): Promise<EstadoPerfil> => ({ ...estadoPerfilInicial(), mensagem: M.acessoNegado, erros: { formulario: M.formulario } });
    render(<FormularioPerfil acao={acao} valoresIniciais={VALORES_PERFIL_VAZIOS} />);
    enviar();
    expect(await screen.findByText(M.acessoNegado)).toBeTruthy();
    expect(screen.getByText(M.formulario)).toBeTruthy();
  });
});

describe('estado do perfil', () => {
  it('lerFormularioPerfil: só os nomes conhecidos; arquivos ignorados; eco cortado', () => {
    const fd = new FormData();
    fd.set('descricao', 'd'.repeat(3000));
    fd.set('cep', 'c'.repeat(300));
    fd.set('salaoId', 'forjado');
    fd.append('meiosPagamento', 'pix');
    fd.append('meiosPagamento', new Blob(['x']));
    fd.append('comodidades', 'sauna');
    const { entrada, valores } = lerFormularioPerfil(fd);
    expect(Object.keys(entrada).sort()).toEqual(
      ['bairro', 'cep', 'cidade', 'comodidades', 'complemento', 'descricao', 'instagram', 'logradouro', 'meiosPagamento', 'numero', 'telefone', 'uf', 'whatsapp'].sort(),
    );
    expect(entrada.meiosPagamento).toEqual(['pix']);
    expect(entrada.comodidades).toEqual(['sauna']);
    expect((entrada.descricao as string).length).toBe(3000);
    expect(valores.descricao).toHaveLength(2000);
    expect(valores.cep).toHaveLength(200);
    expect(entrada.telefone).toBe('');
    expect(idDoCampo('uf')).toBe('perfil-uf');
    expect(estadoPerfilInicial()).toEqual({ mensagem: null, sucesso: null, erros: {}, valores: VALORES_PERFIL_VAZIOS });
  });
});
