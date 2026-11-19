/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Alert } from './Alert';

describe('Alert (CA-17, RN-18)', () => {
  it('erro usa role="alert" com "Erro:" visível', () => {
    render(<Alert variante="erro">Não foi possível salvar.</Alert>);
    const alerta = screen.getByRole('alert');
    expect(alerta.textContent).toBe('Erro:Não foi possível salvar.');
    expect(alerta.className).toContain('erro');
  });

  it.each([
    ['info', 'Informação:'],
    ['sucesso', 'Sucesso:'],
    ['aviso', 'Atenção:'],
  ] as const)('%s usa role="status" e o rótulo "%s"', (variante, rotulo) => {
    render(<Alert variante={variante}>Texto</Alert>);
    const alerta = screen.getByRole('status');
    expect(alerta.querySelector('strong')!.textContent).toBe(rotulo);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('título opcional e rótulo de variante sobrescrevível', () => {
    render(
      <Alert variante="aviso" titulo="Assinatura suspensa" rotulosVariante={{ aviso: 'Aviso' }}>
        <p>Regularize para voltar a agendar.</p>
      </Alert>,
    );
    const alerta = screen.getByRole('status');
    expect(alerta.textContent).toBe('Aviso: Assinatura suspensaRegularize para voltar a agendar.');
  });
});
