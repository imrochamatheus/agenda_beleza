/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MENSAGENS_BLOQUEIO } from '@/server/bloqueios/tipos';
import type { ValoresBloqueio } from '@/server/bloqueios/tipos';

import { estadoInicial, idDoCampo, lerFormularioBloqueio, rotuloDoAlvo, VALORES_VAZIOS } from './estado';
import type { EstadoFormularioBloqueio } from './estado';
import { FormularioBloqueio } from './FormularioBloqueio';

// D-016 T-7: estrutura acessível (CA-21), resumo de erros e seção do aviso focados, valores preservados e
// campos limpos após salvar na criação. A ação é uma função de teste.

const M = MENSAGENS_BLOQUEIO;
const OPCOES = [
  { valor: 'salao', rotulo: 'Salão inteiro' },
  { valor: 'p1', rotulo: 'Ana' },
  { valor: 'p2', rotulo: 'Bia (inativo)' },
];
const semAcao = async (e: EstadoFormularioBloqueio) => e;
const campo = (id: string) => document.getElementById(id) as HTMLInputElement;
const enviar = (rotulo = 'Salvar bloqueio') => fireEvent.click(screen.getByRole('button', { name: rotulo }));

describe('FormularioBloqueio: estrutura', () => {
  it('gestor: select de alvo com opção vazia, fieldset Período com rádios e quatro campos de texto rotulados', () => {
    render(<FormularioBloqueio acao={semAcao} opcoesAlvo={OPCOES} rotuloEnviar="Salvar bloqueio" />);
    const alvo = screen.getByRole('combobox', { name: 'Para quem' }) as HTMLSelectElement;
    expect(alvo.name).toBe('alvo');
    expect([...alvo.options].map((o) => [o.value, o.textContent])).toEqual([
      ['', 'Escolha…'],
      ['salao', 'Salão inteiro'],
      ['p1', 'Ana'],
      ['p2', 'Bia (inativo)'],
    ]);
    const periodo = screen.getByRole('group', { name: 'Período' });
    expect(periodo.tagName).toBe('FIELDSET');
    expect(periodo.getAttribute('aria-describedby')).toBe('bloqueio-ajuda');
    expect(document.getElementById('bloqueio-ajuda')!.textContent).toBe(M.ajudaPeriodo);
    const modos = within(periodo).getByRole('group', { name: 'Tipo de bloqueio' });
    const radios = within(modos).getAllByRole('radio') as HTMLInputElement[];
    expect(radios.map((r) => [r.value, r.checked])).toEqual([
      ['horario', true],
      ['dia_inteiro', false],
    ]);
    expect(screen.getByLabelText('Com horário')).toBe(radios[0]);
    expect(screen.getByLabelText('Dia inteiro')).toBe(radios[1]);
    const textos = within(periodo).getAllByRole('textbox') as HTMLInputElement[];
    expect(textos.map((t) => t.name)).toEqual(['dataInicio', 'horaInicio', 'dataFim', 'horaFim']);
    expect(textos.map((t) => document.querySelector(`label[for="${t.id}"]`)!.textContent)).toEqual([
      'Data de início',
      'Hora de início',
      'Data de fim',
      'Hora de fim',
    ]);
    expect([textos[0].maxLength, textos[0].pattern, textos[0].autocomplete]).toEqual([10, '\\d{2}/\\d{2}/\\d{4}', 'off']);
    expect([textos[1].maxLength, textos[1].pattern]).toEqual([5, '([01]?[0-9]|2[0-3]):[0-5][0-9]']);
    expect(textos.every((t) => t.getAttribute('aria-describedby') === 'bloqueio-ajuda')).toBe(true);
    const motivo = screen.getByRole('textbox', { name: 'Motivo (opcional)' }) as HTMLInputElement;
    expect(motivo.maxLength).toBe(200);
    const botao = screen.getByRole('button', { name: 'Salvar bloqueio' }) as HTMLButtonElement;
    expect(botao.type).toBe('submit');
    expect(botao.form!.noValidate).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('profissional: sem select; texto da própria agenda', () => {
    render(<FormularioBloqueio acao={semAcao} opcoesAlvo={null} rotuloEnviar="Salvar bloqueio" />);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByText(M.propriaAgenda)).toBeTruthy();
    expect(document.querySelector('input[name="alvo"]')).toBeNull();
  });

  it('edição: campo oculto id, alvo como texto e valores iniciais (dia inteiro marcado)', () => {
    const valores: ValoresBloqueio = { ...VALORES_VAZIOS, modo: 'dia_inteiro', dataInicio: '25/12/2026', dataFim: '26/12/2026', motivo: 'Natal' };
    render(
      <FormularioBloqueio acao={semAcao} opcoesAlvo={null} id="b1" alvoTexto="Salão inteiro" valoresIniciais={valores} rotuloEnviar="Salvar alterações" />,
    );
    expect((document.querySelector('input[name="id"]') as HTMLInputElement).value).toBe('b1');
    expect(screen.getByText('Salão inteiro')).toBeTruthy();
    expect(screen.queryByText(M.propriaAgenda)).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect((screen.getByLabelText('Dia inteiro') as HTMLInputElement).checked).toBe(true);
    expect(campo('bloqueio-dataInicio').value).toBe('25/12/2026');
    expect(campo('bloqueio-dataFim').value).toBe('26/12/2026');
    expect(campo('bloqueio-motivo').value).toBe('Natal');
  });
});

describe('FormularioBloqueio: envio', () => {
  it('erros: resumo focado com links aos campos, aria-invalid e aria-describedby; valores preservados', async () => {
    const acao = vi.fn(async (_e: EstadoFormularioBloqueio, fd: FormData): Promise<EstadoFormularioBloqueio> => ({
      ...estadoInicial(lerFormularioBloqueio(fd, 'criar').valores),
      erros: { alvo: M.alvo, horaInicio: M.granularidade, periodo: M.ordem },
    }));
    render(<FormularioBloqueio acao={acao} opcoesAlvo={OPCOES} rotuloEnviar="Salvar bloqueio" />);
    fireEvent.change(campo('bloqueio-dataInicio'), { target: { value: '25/12/2026' } });
    fireEvent.change(campo('bloqueio-horaInicio'), { target: { value: '14:07' } });
    enviar();
    const resumo = await screen.findByRole('alert');
    await waitFor(() => expect(document.activeElement).toBe(resumo));
    expect(resumo.id).toBe('bloqueio-resumo-erros');
    expect(resumo.getAttribute('tabindex')).toBe('-1');
    expect(within(resumo).getByText(M.resumoErros)).toBeTruthy();
    expect(within(resumo).getAllByRole('link').map((a) => [a.getAttribute('href'), a.textContent])).toEqual([
      ['#bloqueio-alvo', `Para quem: ${M.alvo}`],
      ['#bloqueio-horaInicio', `Hora de início: ${M.granularidade}`],
      ['#bloqueio-dataInicio', `Período: ${M.ordem}`],
    ]);
    const alvo = screen.getByRole('combobox', { name: 'Para quem' });
    expect(alvo.getAttribute('aria-invalid')).toBe('true');
    expect(alvo.getAttribute('aria-describedby')).toBe('bloqueio-alvo-erro');
    const hora = campo('bloqueio-horaInicio');
    expect(hora.getAttribute('aria-invalid')).toBe('true');
    expect(hora.getAttribute('aria-describedby')).toBe('bloqueio-horaInicio-erro bloqueio-ajuda bloqueio-periodo-erro');
    expect(document.getElementById('bloqueio-periodo-erro')!.textContent).toContain(M.ordem);
    expect(screen.getByRole('group', { name: 'Período' }).getAttribute('aria-describedby')).toBe('bloqueio-ajuda bloqueio-periodo-erro');
    expect(campo('bloqueio-dataInicio').getAttribute('aria-invalid')).toBe('true');
    // Valores preservados.
    expect(campo('bloqueio-dataInicio').value).toBe('25/12/2026');
    expect(hora.value).toBe('14:07');
  });

  it('erro de modo: ligado ao grupo de rádios; formulario e mensagem geral em alertas', async () => {
    const acao = async (): Promise<EstadoFormularioBloqueio> => ({
      ...estadoInicial({ ...VALORES_VAZIOS, modo: 'x' }),
      mensagem: M.acessoNegado,
      erros: { modo: M.modo, formulario: M.formulario },
    });
    render(<FormularioBloqueio acao={acao} opcoesAlvo={null} rotuloEnviar="Salvar bloqueio" />);
    enviar();
    await screen.findByText(M.acessoNegado);
    expect(screen.getByText(M.formulario)).toBeTruthy();
    const modos = screen.getByRole('group', { name: 'Tipo de bloqueio' });
    expect(modos.getAttribute('aria-describedby')).toBe('bloqueio-modo-erro');
    expect(screen.getAllByRole('alert')).toHaveLength(3);
  });

  it('salvo: seção com o período e o aviso recebe o foco; na criação os campos voltam vazios', async () => {
    const acao = async (): Promise<EstadoFormularioBloqueio> => ({
      ...estadoInicial(),
      salvo: {
        periodo: '25/12/2026 (dia inteiro)',
        aviso: { total: 1, reservas: [{ id: 'r1', profissionalNome: 'Ana', inicioLocal: '25/12/2026 14:00', fimLocal: '25/12/2026 15:00', cliente: 'Joana' }] },
      },
    });
    render(<FormularioBloqueio acao={acao} opcoesAlvo={OPCOES} rotuloEnviar="Salvar bloqueio" />);
    fireEvent.change(campo('bloqueio-dataInicio'), { target: { value: '25/12/2026' } });
    enviar();
    const secao = await screen.findByRole('region', { name: M.salvo });
    await waitFor(() => expect(document.activeElement).toBe(secao));
    expect(secao.getAttribute('tabindex')).toBe('-1');
    expect(within(secao).getByRole('status').textContent).toContain('Bloqueio salvo: 25/12/2026 (dia inteiro).');
    expect(within(secao).getByText(M.comReservas)).toBeTruthy();
    expect(within(secao).getByRole('listitem').textContent).toBe('25/12/2026 14:00 a 25/12/2026 15:00 — Ana — Joana');
    expect(campo('bloqueio-dataInicio').value).toBe('');
  });
});

describe('estado.ts', () => {
  it('lerFormularioBloqueio: só nomes conhecidos; alvo só na criação, id só na edição; eco cortado em 200', () => {
    const fd = new FormData();
    fd.set('modo', 'horario');
    fd.set('dataInicio', '25/12/2026');
    fd.set('horaInicio', '14:00');
    fd.set('dataFim', '25/12/2026');
    fd.set('horaFim', '16:00');
    fd.set('motivo', 'x'.repeat(250));
    fd.set('alvo', 'salao');
    fd.set('id', 'b1');
    fd.set('salaoId', 'outro');
    const criar = lerFormularioBloqueio(fd, 'criar');
    expect(criar.entrada).toEqual({
      modo: 'horario',
      dataInicio: '25/12/2026',
      horaInicio: '14:00',
      dataFim: '25/12/2026',
      horaFim: '16:00',
      motivo: 'x'.repeat(250),
      alvo: 'salao',
    });
    expect(criar.valores.motivo).toHaveLength(200);
    expect(criar.valores.alvo).toBe('salao');
    const editar = lerFormularioBloqueio(fd, 'editar');
    expect(editar.entrada).toMatchObject({ id: 'b1' });
    expect('alvo' in editar.entrada).toBe(false);
    expect(editar.valores.alvo).toBe('');
  });

  it('lerFormularioBloqueio: ausentes viram "" (alvo e id ausentes não entram); arquivos ignorados', () => {
    const fd = new FormData();
    fd.set('dataInicio', new Blob(['x']));
    const criar = lerFormularioBloqueio(fd, 'criar');
    expect(criar.entrada).toEqual({ modo: '', dataInicio: '', horaInicio: '', dataFim: '', horaFim: '', motivo: '' });
    expect('id' in lerFormularioBloqueio(fd, 'editar').entrada).toBe(false);
    expect(criar.valores).toEqual({ ...VALORES_VAZIOS, modo: '' });
  });

  it('idDoCampo, estadoInicial e rotuloDoAlvo', () => {
    expect(idDoCampo('dataFim')).toBe('bloqueio-dataFim');
    expect(estadoInicial()).toEqual({ mensagem: null, erros: {}, valores: VALORES_VAZIOS, salvo: null });
    expect(rotuloDoAlvo({ tipo: 'salao' })).toBe('Salão inteiro');
    expect(rotuloDoAlvo({ tipo: 'profissional', id: 'p', nome: 'Ana', ativo: true })).toBe('Ana');
    expect(rotuloDoAlvo({ tipo: 'profissional', id: 'p', nome: 'Bia', ativo: false })).toBe('Bia (inativo)');
  });
});
