/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MENSAGENS_SERVICO } from '@/server/servicos/tipos';
import type { ProfissionalOpcao } from '@/server/servicos/tipos';

import { ESTADO_INICIAL_FORMULARIO_SERVICO, ESTADO_INICIAL_SITUACAO } from './estado';
import type { EstadoFormularioServico } from './estado';
import { FormularioServico } from './FormularioServico';

// D-014 T-5: CA-5 e CA-14 no formulário de serviço. A ação é uma função de teste.

const M = MENSAGENS_SERVICO;
const semAcao = async (e: EstadoFormularioServico) => e;
const estado = (p: Partial<EstadoFormularioServico>): EstadoFormularioServico => ({ ...ESTADO_INICIAL_FORMULARIO_SERVICO, ...p });

const PROFISSIONAIS: ProfissionalOpcao[] = [
  { id: 'p1', nome: 'Ana', ativo: true, vinculado: true },
  { id: 'p2', nome: 'Bia', ativo: true, vinculado: false },
  { id: 'p3', nome: 'Carla', ativo: false, vinculado: true },
];

const caixa = (nome: string) => screen.getByRole('checkbox', { name: nome }) as HTMLInputElement;

describe('FormularioServico', () => {
  it('criar: campos rotulados, preço com inputMode decimal e ajuda "Ex.: 80,00", duração numérica, sem id oculto', () => {
    render(<FormularioServico modo="criar" acao={semAcao} profissionais={[{ ...PROFISSIONAIS[1] }]} />);
    const nome = screen.getByLabelText(/^Nome/) as HTMLInputElement;
    const preco = screen.getByLabelText(/^Preço \(R\$\)/) as HTMLInputElement;
    const duracao = screen.getByLabelText(/^Duração \(minutos\)/) as HTMLInputElement;
    expect([nome.name, nome.type, nome.required, nome.value, nome.maxLength]).toEqual(['nome', 'text', true, '', 100]);
    expect([preco.name, preco.type, preco.inputMode, preco.maxLength]).toEqual(['preco', 'text', 'decimal', 20]);
    expect(preco.getAttribute('aria-describedby')).toContain(screen.getByText(M.ajudaPreco).id);
    expect([duracao.name, duracao.type, duracao.inputMode, duracao.min, duracao.max, duracao.step]).toEqual([
      'duracao',
      'number',
      'numeric',
      '5',
      '720',
      '5',
    ]);
    expect(caixa('Bia').checked).toBe(false);
    expect(caixa('Bia').value).toBe('p2');
    const botao = screen.getByRole('button', { name: 'Cadastrar serviço' }) as HTMLButtonElement;
    expect(botao.type).toBe('submit');
    expect(botao.form!.noValidate).toBe(true);
    expect(document.querySelector('input[name="id"]')).toBeNull();
    expect(screen.getByRole('link', { name: 'Voltar para a lista' }).getAttribute('href')).toBe('/painel/servicos');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('CA-14: profissionais num fieldset com legend; ativos como caixas rotuladas pelo nome; inativo vinculado sem caixa', () => {
    render(
      <FormularioServico
        modo="editar"
        acao={semAcao}
        profissionais={PROFISSIONAIS}
        servico={{ id: 's-1', nome: 'Corte', precoCentavos: 123456, duracaoMin: 45 }}
      />,
    );
    const grupo = screen.getByRole('group', { name: 'Profissionais que executam' });
    expect(grupo.tagName).toBe('FIELDSET');
    expect(within(grupo).getAllByRole('checkbox').map((c) => (c as HTMLInputElement).name)).toEqual(['profissionais', 'profissionais']);
    expect(caixa('Ana').checked).toBe(true);
    expect(caixa('Bia').checked).toBe(false);
    expect(screen.queryByRole('checkbox', { name: /Carla/ })).toBeNull();
    expect(within(grupo).getByText(/Carla: Inativo, vínculo mantido/)).toBeTruthy();
    expect((screen.getByLabelText(/^Nome/) as HTMLInputElement).value).toBe('Corte');
    expect((screen.getByLabelText(/^Preço/) as HTMLInputElement).value).toBe('1.234,56');
    expect((screen.getByLabelText(/^Duração/) as HTMLInputElement).value).toBe('45');
    expect((document.querySelector('input[name="id"]') as HTMLInputElement).value).toBe('s-1');
    expect(screen.getByRole('button', { name: 'Salvar alterações' })).toBeTruthy();
  });

  it('sem profissionais ativos: texto com link para cadastrar profissional', () => {
    render(<FormularioServico modo="criar" acao={semAcao} profissionais={[]} />);
    expect(screen.getByText(/Nenhum profissional ativo/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Cadastrar profissional' }).getAttribute('href')).toBe('/painel/profissionais/novo');
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('CA-5: erros por campo com aria-invalid/aria-describedby; erro de profissionais ligado ao fieldset; valores e caixas preservados', async () => {
    const recebidos: Record<string, unknown>[] = [];
    const acao = vi.fn(async (_a: EstadoFormularioServico, f: FormData) => {
      recebidos.push({ nome: f.get('nome'), preco: f.get('preco'), duracao: f.get('duracao'), profissionais: f.getAll('profissionais') });
      return estado({
        erros: { nome: M.nome, preco: M.preco, duracao: M.duracao, profissionais: M.profissionais },
        valores: { nome: 'A', preco: '80.00', duracao: '7', profissionais: ['p2'] },
      });
    });
    render(<FormularioServico modo="criar" acao={acao} profissionais={PROFISSIONAIS} />);
    fireEvent.change(screen.getByLabelText(/^Nome/), { target: { value: 'A' } });
    fireEvent.change(screen.getByLabelText(/^Preço/), { target: { value: '80.00' } });
    fireEvent.change(screen.getByLabelText(/^Duração/), { target: { value: '7' } });
    fireEvent.click(caixa('Bia'));
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar serviço' }));

    await screen.findByText(M.nome);
    expect(recebidos).toEqual([{ nome: 'A', preco: '80.00', duracao: '7', profissionais: ['p2'] }]);
    for (const [rotulo, texto] of [
      [/^Nome/, M.nome],
      [/^Preço/, M.preco],
      [/^Duração/, M.duracao],
    ] as const) {
      const campo = screen.getByLabelText(rotulo);
      expect(campo.getAttribute('aria-invalid')).toBe('true');
      expect(campo.getAttribute('aria-describedby')).toContain(screen.getByText(texto).closest('p')!.id);
    }
    const grupo = screen.getByRole('group', { name: 'Profissionais que executam' });
    expect(grupo.getAttribute('aria-describedby')).toBe(screen.getByText(M.profissionais).closest('p')!.id);
    await waitFor(() => expect((screen.getByLabelText(/^Nome/) as HTMLInputElement).value).toBe('A'));
    expect((screen.getByLabelText(/^Preço/) as HTMLInputElement).value).toBe('80.00');
    expect((screen.getByLabelText(/^Duração/) as HTMLInputElement).value).toBe('7');
    expect(caixa('Bia').checked).toBe(true);
    expect(caixa('Ana').checked).toBe(false);
  });

  it('erro geral e erro de formulário aparecem em Alert (role="alert")', async () => {
    const acao = async () => estado({ mensagem: M.naoEncontrado, erros: { formulario: M.formulario } });
    render(<FormularioServico modo="criar" acao={acao} profissionais={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar serviço' }));
    const alertas = await screen.findAllByRole('alert');
    expect(alertas.map((a) => a.textContent)).toEqual([expect.stringContaining(M.naoEncontrado), expect.stringContaining(M.formulario)]);
  });

  it('estado.ts e os componentes não importam @/server em tempo de execução, exceto servicos/tipos', () => {
    expect(ESTADO_INICIAL_FORMULARIO_SERVICO).toEqual({
      mensagem: null,
      erros: {},
      valores: { nome: '', preco: '', duracao: '', profissionais: [] },
    });
    expect(Object.isFrozen(ESTADO_INICIAL_FORMULARIO_SERVICO)).toBe(true);
    expect(ESTADO_INICIAL_SITUACAO).toEqual({ variante: null, mensagem: null });
    for (const nome of ['./estado.ts', './FormularioServico.tsx', './ListaServicos.tsx', './ControleSituacao.tsx']) {
      const fonte = readFileSync(fileURLToPath(new URL(nome, import.meta.url)), 'utf8');
      const runtime = [...fonte.matchAll(/^import\s+(?!type\b)[^;]*from\s+['"](@\/server\/[^'"]+)['"]/gm)].map((m) => m[1]);
      expect(runtime.filter((m) => m !== '@/server/servicos/tipos'), nome).toEqual([]);
    }
  });
});
