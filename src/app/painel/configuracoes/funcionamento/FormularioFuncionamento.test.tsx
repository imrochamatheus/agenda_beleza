/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ROTAS } from '@/config/navegacao';
import { MENSAGENS_FUNCIONAMENTO as M } from '@/server/salao/funcionamento-tipos';
import type { Funcionamento } from '@/server/salao/funcionamento-tipos';
import { montarSemana } from '@/server/semana/montagem';

import { estadoFuncionamentoInicial, lerFormularioFuncionamento, SEMANA_VAZIA, valoresDoFuncionamento } from './estado';
import type { EstadoFuncionamento } from './estado';
import { FormularioFuncionamento } from './FormularioFuncionamento';

// D-020 T-9: rádios e padrão por `definido` (CA-6/CA-7), "Fechado", erros por dia e intervalo, erro de
// `modo` (A-12), link para bloqueios, sucesso focado com a semana canônica.

const NAO_INFORMADO: Funcionamento = { definido: false };
const INFORMADO: Funcionamento = {
  definido: true,
  semana: montarSemana([
    { diaSemana: 1, inicioMin: 540, fimMin: 720 },
    { diaSemana: 1, inicioMin: 780, fimMin: 1080 },
  ]),
};
const semAcao = async (e: EstadoFuncionamento) => e;
const campo = (id: string) => document.getElementById(id) as HTMLInputElement;
const enviar = () => fireEvent.click(screen.getByRole('button', { name: 'Salvar horário' }));
const radio = (nome: string) => screen.getByRole('radio', { name: nome }) as HTMLInputElement;

describe('FormularioFuncionamento: estrutura', () => {
  it('não informado: "Não informar" marcado, dias "Não informado", linhas vazias e habilitadas', () => {
    render(<FormularioFuncionamento acao={semAcao} funcionamento={NAO_INFORMADO} />);
    expect(screen.getByRole('group', { name: 'Horário de funcionamento' })).toBeTruthy();
    expect(radio(M.opcaoNaoInformar).checked).toBe(true);
    expect(radio(M.opcaoInformar).checked).toBe(false);
    expect([radio(M.opcaoNaoInformar).name, radio(M.opcaoNaoInformar).value, radio(M.opcaoInformar).value]).toEqual(['modo', 'nao_informar', 'informar']);
    expect(radio(M.opcaoInformar).getAttribute('aria-describedby')).toBe('funcionamento-modo-ajuda');
    const detalhes = [...document.querySelectorAll('details')];
    expect(detalhes).toHaveLength(7);
    expect(detalhes[0].querySelector('summary')!.textContent).toBe(`Segunda-feira${M.diaNaoInformado}`);
    expect(campo('funcionamento-1-0-inicio').value).toBe('');
    expect(campo('funcionamento-1-0-inicio').disabled).toBe(false);
    expect(screen.getByRole('link', { name: 'Ir para bloqueios' }).getAttribute('href')).toBe(ROTAS.bloqueios);
    expect(screen.getByText(M.ajudaHorario)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('informado: "Informar" marcado, resumo com pausa, "Fechado" nos dias vazios, valores HH:MM', () => {
    render(<FormularioFuncionamento acao={semAcao} funcionamento={INFORMADO} />);
    expect(radio(M.opcaoInformar).checked).toBe(true);
    const detalhes = [...document.querySelectorAll('details')];
    expect(detalhes[0].querySelector('summary')!.textContent).toContain('09:00–12:00, 13:00–18:00 · Pausa 12:00–13:00');
    expect(detalhes[1].querySelector('summary')!.textContent).toContain(M.fechado);
    expect(campo('funcionamento-1-1-fim').value).toBe('18:00');
  });
});

describe('FormularioFuncionamento: envio', () => {
  it('erros por dia/intervalo e de modo: resumo focado com links; valores e modo preservados', async () => {
    const acao = vi.fn(async (_e: EstadoFuncionamento, fd: FormData): Promise<EstadoFuncionamento> => {
      const { modo, valores } = lerFormularioFuncionamento(fd);
      return { mensagem: null, sucesso: null, modo, valores, erros: { modo: M.modo, dias: { 1: { intervalos: { 0: { intervalo: M.ordem } } }, 3: { dia: M.limite } } } };
    });
    render(<FormularioFuncionamento acao={acao} funcionamento={NAO_INFORMADO} />);
    fireEvent.click(radio(M.opcaoInformar));
    fireEvent.change(campo('funcionamento-1-0-inicio'), { target: { value: '22:00' } });
    fireEvent.change(campo('funcionamento-1-0-fim'), { target: { value: '02:00' } });
    enviar();
    const resumo = await screen.findByRole('alert', { name: M.resumoErros });
    await waitFor(() => expect(document.activeElement).toBe(resumo));
    expect(within(resumo).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
      '#funcionamento-modo',
      '#funcionamento-1-0-inicio',
      '#funcionamento-3-0-inicio',
    ]);
    expect(radio(M.opcaoInformar).checked).toBe(true);
    expect(radio(M.opcaoNaoInformar).getAttribute('aria-describedby')).toBe('funcionamento-modo-ajuda funcionamento-modo-erro');
    expect(radio(M.opcaoNaoInformar).getAttribute('aria-invalid')).toBe('true');
    expect(campo('funcionamento-1-0-inicio').value).toBe('22:00');
    expect(campo('funcionamento-1-0-fim').value).toBe('02:00');
    expect(document.getElementById('funcionamento-1-0-erro')!.textContent).toContain(M.ordem);
    expect([...document.querySelectorAll('details')][0].open).toBe(true);
    const fd = acao.mock.calls[0][1];
    expect(fd.get('modo')).toBe('informar');
  });

  it('sucesso: mensagem focada, campos e resumos com a semana canônica', async () => {
    const acao = async (): Promise<EstadoFuncionamento> => ({
      mensagem: null,
      sucesso: M.salvo,
      erros: {},
      modo: 'informar',
      valores: valoresDoFuncionamento(INFORMADO),
      funcionamento: INFORMADO,
    });
    render(<FormularioFuncionamento acao={acao} funcionamento={NAO_INFORMADO} />);
    enviar();
    await screen.findByText(M.salvo);
    const caixa = document.getElementById('funcionamento-sucesso')!;
    expect(caixa.textContent).toContain(M.salvo);
    await waitFor(() => expect(document.activeElement).toBe(caixa));
    expect(campo('funcionamento-1-0-inicio').value).toBe('09:00');
    expect(radio(M.opcaoInformar).checked).toBe(true);
    expect([...document.querySelectorAll('details')][1].querySelector('summary')!.textContent).toContain(M.fechado);
  });

  it('mensagem geral e erro de formulário em alertas', async () => {
    const acao = async (): Promise<EstadoFuncionamento> => ({
      ...estadoFuncionamentoInicial(NAO_INFORMADO),
      mensagem: M.acessoNegado,
      erros: { formulario: M.formulario },
    });
    render(<FormularioFuncionamento acao={acao} funcionamento={NAO_INFORMADO} />);
    enviar();
    expect(await screen.findByText(M.acessoNegado)).toBeTruthy();
    expect(screen.getByText(M.formulario)).toBeTruthy();
  });
});

describe('estado do funcionamento', () => {
  it('inicial por definido; leitura do formulário com modo inválido; semana vazia', () => {
    expect(estadoFuncionamentoInicial(NAO_INFORMADO).modo).toBe('nao_informar');
    expect(estadoFuncionamentoInicial(INFORMADO).modo).toBe('informar');
    expect(estadoFuncionamentoInicial(INFORMADO).valores[1][0]).toEqual({ inicio: '09:00', fim: '12:00' });
    expect(SEMANA_VAZIA).toHaveLength(7);
    const fd = new FormData();
    fd.set('modo', 'talvez');
    fd.set('inicio-2-0', '10:00');
    fd.set('salaoId', 'x');
    const r = lerFormularioFuncionamento(fd);
    expect(r.entrada.modo).toBe('talvez');
    expect(r.modo).toBe('nao_informar');
    expect((r.entrada.dias as { intervalos: unknown[] }[])[2].intervalos[0]).toEqual({ inicio: '10:00', fim: '' });
    expect(Object.keys(r.entrada).sort()).toEqual(['dias', 'modo']);
    const semModo = lerFormularioFuncionamento(new FormData());
    expect(semModo.entrada.modo).toBeUndefined();
  });
});
