/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { montarSemana } from '@/server/jornadas/semana';
import { MENSAGENS_JORNADA } from '@/server/jornadas/tipos';

import {
  ESTADO_INICIAL_FORMULARIO_JORNADA,
  idDoCampo,
  lerFormularioJornada,
  nomeDoCampo,
  resumoDoDia,
  valoresDaSemana,
} from './estado';
import type { EstadoFormularioJornada } from './estado';
import { FormularioJornada } from './FormularioJornada';

// D-015 T-5: CA-1 (resumo e pausa), CA-17 (estrutura acessível, resumo de erros focado) e R-7 (valores
// preservados). A ação é uma função de teste.

const M = MENSAGENS_JORNADA;
const ID = '5d2a9b1c-3e4f-4a5b-8c6d-7e8f9a0b1c2d';
const semAcao = async (e: EstadoFormularioJornada) => e;

/** Segunda 09–12 e 13–18; sábado 08–12; demais folga. */
const SEMANA = montarSemana([
  { diaSemana: 1, inicioMin: 540, fimMin: 720 },
  { diaSemana: 1, inicioMin: 780, fimMin: 1080 },
  { diaSemana: 6, inicioMin: 480, fimMin: 720 },
]);

const campo = (id: string) => document.getElementById(id) as HTMLInputElement;

describe('FormularioJornada', () => {
  it('7 details de segunda a domingo, resumo com pausa ou "Folga", fechados sem erro', () => {
    render(<FormularioJornada acao={semAcao} profissionalId={ID} semana={SEMANA} />);
    const detalhes = [...document.querySelectorAll('details')];
    expect(detalhes).toHaveLength(7);
    expect(detalhes.map((d) => d.querySelector('summary')!.firstChild!.textContent)).toEqual([
      'Segunda-feira',
      'Terça-feira',
      'Quarta-feira',
      'Quinta-feira',
      'Sexta-feira',
      'Sábado',
      'Domingo',
    ]);
    expect(detalhes[0].querySelector('summary')!.textContent).toContain('09:00–12:00, 13:00–18:00 · Pausa 12:00–13:00');
    expect(detalhes[1].querySelector('summary')!.textContent).toContain('Folga');
    expect(detalhes[5].querySelector('summary')!.textContent).toContain('08:00–12:00');
    expect(detalhes.every((d) => !d.open)).toBe(true);
    expect((document.querySelector('input[name="profissionalId"]') as HTMLInputElement).value).toBe(ID);
    const botao = screen.getByRole('button', { name: 'Salvar jornada' }) as HTMLButtonElement;
    expect(botao.type).toBe('submit');
    expect(botao.form!.noValidate).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('CA-17: fieldset/legend por dia, 6×2 campos rotulados, texto HH:MM com pattern e ajuda em aria-describedby', () => {
    render(<FormularioJornada acao={semAcao} profissionalId={ID} semana={SEMANA} />);
    const grupo = screen.getByRole('group', { name: 'Intervalos de Segunda-feira', hidden: true });
    expect(grupo.tagName).toBe('FIELDSET');
    const campos = within(grupo).getAllByRole('textbox', { hidden: true }) as HTMLInputElement[];
    expect(campos).toHaveLength(12);
    expect(campos.map((c) => c.name).slice(0, 4)).toEqual(['inicio-1-0', 'fim-1-0', 'inicio-1-1', 'fim-1-1']);
    const primeiro = campos[0];
    expect(document.querySelector(`label[for="${primeiro.id}"]`)!.textContent).toBe('Início do intervalo 1');
    expect(document.querySelector(`label[for="${campos[11].id}"]`)!.textContent).toBe('Fim do intervalo 6');
    expect([primeiro.type, primeiro.maxLength, primeiro.autocomplete, primeiro.pattern]).toEqual(['text', 5, 'off', '([01]?[0-9]|2[0-4]):[0-5][0-9]']);
    expect(primeiro.inputMode).toBe('');
    expect(primeiro.getAttribute('aria-describedby')).toBe('jornada-ajuda');
    expect(document.getElementById('jornada-ajuda')!.textContent).toBe(M.ajudaHorario);
    // Valores da semana gravada; linhas restantes vazias.
    expect(campos.map((c) => c.value).slice(0, 6)).toEqual(['09:00', '12:00', '13:00', '18:00', '', '']);
    expect(document.querySelectorAll('input[type="text"]')).toHaveLength(84);
  });

  it('CA-17/R-7: erros → resumo focado com links, details aberto, aria-invalid/aria-describedby e valores preservados', async () => {
    const recebidos: FormData[] = [];
    const valores = valoresDaSemana(SEMANA);
    valores[3] = [{ inicio: '22:00', fim: '02:00' }, { inicio: '9h', fim: '' }, ...valores[3].slice(2)];
    const acao = vi.fn(async (_a: EstadoFormularioJornada, f: FormData) => {
      recebidos.push(f);
      return {
        mensagem: null,
        erros: {
          dias: {
            3: { intervalos: { 0: { intervalo: M.ordem }, 1: { inicio: M.formato, fim: M.faltaFim } } },
            0: { dia: M.limite },
          },
        },
        valores,
      } satisfies EstadoFormularioJornada;
    });
    render(<FormularioJornada acao={acao} profissionalId={ID} semana={SEMANA} />);
    fireEvent.change(campo(idDoCampo(3, 0, 'inicio')), { target: { value: '22:00' } });
    fireEvent.change(campo(idDoCampo(3, 0, 'fim')), { target: { value: '02:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar jornada' }));

    const resumo = await screen.findByText(M.resumoErros);
    const caixa = resumo.closest('div')!;
    await waitFor(() => expect(document.activeElement).toBe(caixa));
    expect(caixa.tabIndex).toBe(-1);
    expect(recebidos[0].get(nomeDoCampo(3, 0, 'inicio'))).toBe('22:00');
    expect(recebidos[0].get('profissionalId')).toBe(ID);
    // Links na ordem de exibição (quarta antes de domingo), para o primeiro campo afetado.
    const links = within(caixa).getAllByRole('link');
    expect(links.map((l) => [l.getAttribute('href'), l.textContent])).toEqual([
      ['#jornada-3-0-inicio', `Quarta-feira, intervalo 1: ${M.ordem}`],
      ['#jornada-3-1-inicio', `Quarta-feira, intervalo 2: ${M.formato}`],
      ['#jornada-0-0-inicio', `Domingo: ${M.limite}`],
    ]);
    const detalhes = [...document.querySelectorAll('details')];
    expect(detalhes.map((d) => d.open)).toEqual([false, false, true, false, false, false, true]);
    // Erro da linha (intervalo): nos dois campos, por aria-describedby, com aria-invalid.
    for (const lado of ['inicio', 'fim'] as const) {
      const c = campo(idDoCampo(3, 0, lado));
      expect(c.getAttribute('aria-invalid')).toBe('true');
      expect(c.getAttribute('aria-describedby')).toBe('jornada-ajuda jornada-3-0-erro');
    }
    expect(document.getElementById('jornada-3-0-erro')!.textContent).toContain(M.ordem);
    // Erro de campo: no próprio campo.
    const inicio2 = campo(idDoCampo(3, 1, 'inicio'));
    expect(inicio2.getAttribute('aria-invalid')).toBe('true');
    expect(inicio2.getAttribute('aria-describedby')).toContain(`${inicio2.id}-erro`);
    expect(document.getElementById(`${inicio2.id}-erro`)!.textContent).toContain(M.formato);
    expect(campo(idDoCampo(3, 1, 'fim')).getAttribute('aria-describedby')).toContain('jornada-3-1-fim-erro');
    // Erro do dia ligado ao fieldset.
    const domingo = screen.getByRole('group', { name: 'Intervalos de Domingo' });
    expect(domingo.getAttribute('aria-describedby')).toBe('jornada-0-erro');
    expect(document.getElementById('jornada-0-erro')!.textContent).toContain(M.limite);
    await waitFor(() => expect(campo(idDoCampo(3, 1, 'inicio')).value).toBe('9h'));
    expect(campo(idDoCampo(3, 0, 'fim')).value).toBe('02:00');
  });

  it('link do resumo para o fim quando só o fim tem erro', async () => {
    const acao = async () =>
      ({ mensagem: null, erros: { dias: { 2: { intervalos: { 4: { fim: M.faltaFim } } } } }, valores: null }) satisfies EstadoFormularioJornada;
    render(<FormularioJornada acao={acao} profissionalId={ID} semana={SEMANA} />);
    fireEvent.click(screen.getByRole('button', { name: 'Salvar jornada' }));
    const link = await screen.findByRole('link', { name: `Terça-feira, intervalo 5: ${M.faltaFim}` });
    expect(link.getAttribute('href')).toBe('#jornada-2-4-fim');
  });

  it('mensagem de erro (403/404) e erro de formulário em Alert role="alert"; sucesso só com `sucesso`', async () => {
    const acao = vi
      .fn<(a: EstadoFormularioJornada, f: FormData) => Promise<EstadoFormularioJornada>>()
      .mockResolvedValueOnce({ mensagem: M.naoEncontrado, erros: { formulario: M.formulario }, valores: null })
      .mockResolvedValueOnce({ mensagem: 'Tudo certo.', sucesso: true, erros: {}, valores: null });
    render(<FormularioJornada acao={acao} profissionalId={ID} semana={SEMANA} />);
    fireEvent.click(screen.getByRole('button', { name: 'Salvar jornada' }));
    const alertas = await screen.findAllByRole('alert');
    expect(alertas.map((a) => a.textContent)).toEqual([expect.stringContaining(M.naoEncontrado), expect.stringContaining(M.formulario)]);
    fireEvent.click(screen.getByRole('button', { name: 'Salvar jornada' }));
    const status = await screen.findByRole('status');
    expect(status.textContent).toContain('Tudo certo.');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('aposSalvar → Alert de sucesso (role="status") até o próximo envio, que o substitui', async () => {
    const acao = async () =>
      ({ mensagem: null, erros: { dias: { 1: { intervalos: { 0: { intervalo: M.ordem } } } } }, valores: null }) satisfies EstadoFormularioJornada;
    render(<FormularioJornada acao={acao} profissionalId={ID} semana={SEMANA} aposSalvar={M.salva} />);
    expect(screen.getByRole('status').textContent).toContain(M.salva);
    fireEvent.click(screen.getByRole('button', { name: 'Salvar jornada' }));
    await screen.findByText(M.resumoErros);
    expect(screen.queryByText(M.salva)).toBeNull();
  });
});

describe('estado.ts', () => {
  it('valoresDaSemana: HH:MM, 24:00 e 6 linhas por dia', () => {
    const v = valoresDaSemana(montarSemana([{ diaSemana: 5, inicioMin: 1320, fimMin: 1440 }]));
    expect(v[5][0]).toEqual({ inicio: '22:00', fim: '24:00' });
    expect(Object.values(v).every((linhas) => linhas.length === 6)).toBe(true);
    expect(v[0].every((l) => l.inicio === '' && l.fim === '')).toBe(true);
  });

  it('lerFormularioJornada: só os nomes conhecidos, 7 dias × 6 linhas; arquivos e extras ignorados; valores cortados', () => {
    const fd = new FormData();
    fd.set('profissionalId', ID);
    fd.set('inicio-1-0', '09:00');
    fd.set('fim-1-0', '12:00');
    fd.set('inicio-0-5', '0'.repeat(50));
    fd.set('fim-0-5', new Blob(['x']), 'x.txt');
    fd.set('inicio-1-6', '13:00');
    fd.set('salaoId', 'outro');
    const { entrada, valores } = lerFormularioJornada(fd);
    expect(entrada.profissionalId).toBe(ID);
    expect(entrada.dias.map((d) => d.diaSemana)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(entrada.dias.every((d) => d.intervalos.length === 6)).toBe(true);
    expect(entrada.dias[1].intervalos[0]).toEqual({ inicio: '09:00', fim: '12:00' });
    expect(entrada.dias[0].intervalos[5]).toEqual({ inicio: '0'.repeat(50), fim: '' });
    expect(valores[0][5]).toEqual({ inicio: '0'.repeat(10), fim: '' });
    expect(JSON.stringify(entrada)).not.toContain('13:00');
    expect(JSON.stringify(entrada)).not.toContain('outro');
    expect(lerFormularioJornada(new FormData()).entrada.profissionalId).toBeUndefined();
  });

  it('resumoDoDia: várias pausas no plural; estado inicial congelado', () => {
    const s = montarSemana([
      { diaSemana: 2, inicioMin: 480, fimMin: 600 },
      { diaSemana: 2, inicioMin: 630, fimMin: 720 },
      { diaSemana: 2, inicioMin: 780, fimMin: 840 },
    ]);
    expect(resumoDoDia(s[2])).toBe('08:00–10:00, 10:30–12:00, 13:00–14:00 · Pausas 10:00–10:30, 12:00–13:00');
    expect(resumoDoDia(s[3])).toBe('Folga');
    expect(ESTADO_INICIAL_FORMULARIO_JORNADA).toEqual({ mensagem: null, erros: {}, valores: null });
    expect(Object.isFrozen(ESTADO_INICIAL_FORMULARIO_JORNADA)).toBe(true);
  });

  it('estado.ts e os componentes não importam @/server em tempo de execução, exceto jornadas/tipos', () => {
    for (const nome of ['./estado.ts', './FormularioJornada.tsx', './VisaoJornada.tsx']) {
      const fonte = readFileSync(fileURLToPath(new URL(nome, import.meta.url)), 'utf8');
      const runtime = [...fonte.matchAll(/^import\s+(?!type\b)[^;]*from\s+['"](@\/server\/[^'"]+)['"]/gm)].map((m) => m[1]);
      expect(runtime.filter((m) => m !== '@/server/jornadas/tipos'), nome).toEqual([]);
    }
  });
});
