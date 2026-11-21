/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MENSAGENS_FOTO } from '@/server/fotos/tipos';

import { FormularioEnvio } from './FormularioEnvio';
import { ResultadoFotos } from './Resultado';

// D-021 T-9: CA-15/CA-16 na apresentação do formulário de envio.

const TOKEN = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

describe('FormularioEnvio', () => {
  it('é um formulário nativo multipart com token, arquivo e descrição rotulados', () => {
    const { container } = render(<FormularioEnvio action="/api/painel/fotos" token={TOKEN} total={3} />);
    const form = container.querySelector('form')!;
    expect(form.getAttribute('method')).toBe('post');
    expect(form.getAttribute('enctype')).toBe('multipart/form-data');
    expect(form.getAttribute('action')).toBe('/api/painel/fotos');
    expect((container.querySelector('input[name="envio"]') as HTMLInputElement).value).toBe(TOKEN);
    const arquivo = screen.getByLabelText(/^Foto/) as HTMLInputElement;
    expect(arquivo.type).toBe('file');
    expect(arquivo.accept).toBe('image/jpeg,image/png,image/webp');
    expect(arquivo.required).toBe(true);
    const alt = screen.getByLabelText(/Descrição da foto/) as HTMLInputElement;
    expect(alt.name).toBe('alt');
    expect(alt.maxLength).toBe(150);
    expect(alt.getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Enviar foto' }).getAttribute('type')).toBe('submit');
    expect(screen.getByText(/metadados da imagem, inclusive a localização/)).toBeTruthy();
  });

  it('erro de arquivo fica ligado ao campo da foto; erro de texto, ao campo da descrição', () => {
    const { rerender } = render(<FormularioEnvio action="/x" token={TOKEN} total={0} codigo="tipo" />);
    const arquivo = screen.getByLabelText(/^Foto/);
    expect(arquivo.getAttribute('aria-invalid')).toBe('true');
    const idErro = arquivo.getAttribute('aria-describedby')!.split(' ').pop()!;
    expect(document.getElementById(idErro)!.textContent).toContain(MENSAGENS_FOTO.tipo);

    rerender(<FormularioEnvio action="/x" token={TOKEN} total={0} codigo="alt_longo" />);
    const alt = screen.getByLabelText(/Descrição da foto/);
    expect(alt.getAttribute('aria-invalid')).toBe('true');
    const ids = alt.getAttribute('aria-describedby')!.split(' ');
    expect(ids.map((i) => document.getElementById(i)?.textContent ?? '').join(' ')).toContain(MENSAGENS_FOTO.alt_longo);
    expect(screen.getByLabelText(/^Foto/).getAttribute('aria-invalid')).toBeNull();
  });

  it('com 12 fotos o formulário é substituído pelo aviso do limite', () => {
    const { container } = render(<FormularioEnvio action="/x" token={TOKEN} total={12} />);
    expect(container.querySelector('form')).toBeNull();
    expect(screen.getByText(MENSAGENS_FOTO.limite)).toBeTruthy();
  });
});

describe('ResultadoFotos', () => {
  it('é anunciado pelo papel do alerta e recebe o foco', () => {
    render(<ResultadoFotos variante="erro" texto="Algo deu errado." />);
    expect(screen.getByRole('alert').textContent).toContain('Algo deu errado.');
    expect(document.activeElement?.id).toBe('resultado-fotos');
    render(<ResultadoFotos variante="sucesso" texto="Foto enviada." />);
    expect(screen.getAllByRole('status')[0].textContent).toContain('Foto enviada.');
  });
});
