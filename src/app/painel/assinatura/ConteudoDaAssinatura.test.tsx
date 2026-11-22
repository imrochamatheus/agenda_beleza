/** @vitest-environment jsdom */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { SituacaoOperacional } from '@/domain/assinatura';
import { acoesDoEstado } from '@/server/assinatura/tela-tipos';
import type { DatasDaTela, PagamentoDaTela, TelaAssinatura } from '@/server/assinatura/tela-tipos';

import { ConteudoDaAssinatura } from './ConteudoDaAssinatura';
import type { AcoesDaTela, EstadoAcaoAssinatura } from './estado';
import { LinkBotao } from './LinkBotao';

// D-042: a tela por estado (CA-1, CA-5, CA-11, CA-12, critérios visuais 1, 2, 7, 8, 9, 10 do web-design).

const DATA = new Date('2027-06-21T02:30:00Z');
const DATAS: Partial<Record<SituacaoOperacional, DatasDaTela>> = {
  em_teste: { testeFimEm: DATA },
  ativa: { periodoPagoAte: DATA },
  em_carencia: { carenciaAte: DATA },
  cancelada: { acessoAte: DATA },
};

const pagamentos = (n: number): PagamentoDaTela[] =>
  Array.from({ length: n }, (_, i) => ({ data: new Date(DATA.getTime() - (i + 1) * 86_400_000), valorCentavos: 7900, situacao: i === 1 ? 'recusado' : 'aprovado' }));

function tela(estado: SituacaoOperacional, n = 0): TelaAssinatura {
  return {
    estado,
    estadoReal: estado === 'sem_assinatura' || estado === 'manual' ? null : estado,
    fuso: 'America/Sao_Paulo',
    datas: DATAS[estado] ?? {},
    acoes: acoesDoEstado(estado),
    pagamentos: pagamentos(n),
  };
}

const resposta = (mensagem: string, variante: EstadoAcaoAssinatura['variante']): EstadoAcaoAssinatura => ({ mensagem, variante, em: 5 });

function acoes(o: Partial<Record<keyof AcoesDaTela, EstadoAcaoAssinatura>> = {}) {
  const f = { assinar: vi.fn(), regularizar: vi.fn(), cancelar: vi.fn() };
  const base = { mensagem: null, variante: 'info', em: 0 } as EstadoAcaoAssinatura;
  f.assinar.mockResolvedValue(o.assinar ?? base);
  f.regularizar.mockResolvedValue(o.regularizar ?? base);
  f.cancelar.mockResolvedValue(o.cancelar ?? base);
  return f;
}

function desenhar(estado: SituacaoOperacional, o: { cancelar?: boolean; n?: number; a?: ReturnType<typeof acoes>; inicial?: EstadoAcaoAssinatura } = {}) {
  const a = o.a ?? acoes();
  render(
    <ConteudoDaAssinatura
      tela={tela(estado, o.n)}
      acoes={a}
      confirmando={o.cancelar === true}
      hrefCancelar="/x?cancelar=1"
      hrefManter="/x"
      {...(o.inicial ? { resultadoInicial: o.inicial } : {})}
    />,
  );
  return a;
}

const botoes = () => screen.queryAllByRole('button').map((b) => b.textContent);
const links = () => screen.queryAllByRole('link').map((l) => l.textContent);

describe('ConteudoDaAssinatura por estado', () => {
  it.each([
    ['sem_assinatura', ['Assinar'], []],
    ['pendente', ['Continuar assinatura'], ['Cancelar assinatura']],
    ['em_teste', [], ['Cancelar assinatura']],
    ['ativa', ['Atualizar meio de pagamento'], ['Cancelar assinatura']],
    ['em_carencia', ['Regularizar pagamento'], ['Cancelar assinatura']],
    ['suspensa', ['Regularizar pagamento'], ['Cancelar assinatura']],
    ['cancelada', [], []],
    ['encerrada', ['Assinar novamente'], []],
    ['manual', [], []],
  ] as const)('%s: botões %j e links %j (CA-5, CA-11, critério 10)', (estado, b, l) => {
    desenhar(estado);
    expect(botoes()).toEqual(b);
    expect(links()).toEqual(l);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Assinatura');
  });

  it('CA-1: em_teste mostra "Período de teste até dd/mm/aaaa" no fuso do salão e o valor mensal', () => {
    desenhar('em_teste');
    expect(screen.getByRole('heading', { level: 2, name: 'Período de teste até 20/06/2027' })).toBeTruthy();
    expect(screen.getAllByText(/R\$\s79,00\/mês/).length).toBeGreaterThan(0);
    expect(document.querySelector('dd strong')?.textContent).toBe('20/06/2027');
    expect(screen.getByText('Situação: Em período de teste')).toBeTruthy();
  });

  it('em em_teste não existe "Atualizar meio de pagamento"; em cancelada e manual não há ação alguma', () => {
    desenhar('em_teste');
    expect(screen.queryByText('Atualizar meio de pagamento')).toBeNull();
  });

  it('etapa 1 é um link GET (não um botão) e não envia nada', () => {
    const a = desenhar('ativa');
    const l = screen.getByRole('link', { name: 'Cancelar assinatura' });
    expect(l.getAttribute('href')).toBe('/x?cancelar=1');
    expect(document.querySelector('input[name="estadoVisto"]')).toBeNull();
    fireEvent.click(l);
    expect(a.cancelar).not.toHaveBeenCalled();
  });

  it('etapa 2: aviso do estado, só "Sim, cancelar assinatura" é submit, "Manter" volta; a etapa 1 sai', () => {
    desenhar('ativa', { cancelar: true });
    expect(screen.getByRole('heading', { level: 2, name: 'Cancelar assinatura?' })).toBeTruthy();
    expect(screen.getByText(/Se cancelar, você mantém o acesso até 20\/06\/2027 \(período já pago\)/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Cancelar assinatura' })).toBeNull();
    const sim = screen.getByRole('button', { name: 'Sim, cancelar assinatura' });
    expect(sim.getAttribute('type')).toBe('submit');
    expect(document.querySelectorAll('button[type="submit"]')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Manter assinatura' }).getAttribute('href')).toBe('/x');
    expect((document.querySelector('input[name="estadoVisto"]') as HTMLInputElement).value).toBe('ativa');
  });

  it.each(['cancelada', 'manual', 'encerrada', 'sem_assinatura'] as const)('?cancelar=1 em %s é ignorado', (estado) => {
    desenhar(estado, { cancelar: true });
    expect(screen.queryByText('Cancelar assinatura?')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sim, cancelar assinatura' })).toBeNull();
  });

  it('confirmar envia a ação de cancelar com o estadoVisto e mostra "Erro de pagamento" (role alert)', async () => {
    const a = acoes({ cancelar: resposta('Não foi possível concluir agora. Nada foi alterado; tente novamente.', 'erro') });
    desenhar('ativa', { cancelar: true, a });
    fireEvent.click(screen.getByRole('button', { name: 'Sim, cancelar assinatura' }));
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toContain('Erro de pagamento:');
    expect(alerta.textContent).toContain('Nada foi alterado');
    expect(a.cancelar).toHaveBeenCalledTimes(1);
    const fd = a.cancelar.mock.calls[0][1] as FormData;
    expect(fd.get('estadoVisto')).toBe('ativa');
    expect(a.assinar).not.toHaveBeenCalled();
    expect(a.regularizar).not.toHaveBeenCalled();
  });

  it('Atualizar meio de pagamento usa a ação regularizar; Assinar novamente e Continuar usam assinar', async () => {
    const a1 = desenhar('ativa');
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar meio de pagamento' }));
    await screen.findByRole('button', { name: 'Atualizar meio de pagamento' });
    expect(a1.regularizar).toHaveBeenCalledTimes(1);
    expect(a1.assinar).not.toHaveBeenCalled();
  });

  it('Assinar novamente chama a ação assinar', async () => {
    const a = desenhar('encerrada');
    fireEvent.click(screen.getByRole('button', { name: 'Assinar novamente' }));
    await screen.findByRole('button', { name: 'Assinar novamente' });
    expect(a.assinar).toHaveBeenCalledTimes(1);
  });

  it('a mensagem mais recente (maior `em`) é a única exibida; sucesso usa o rótulo padrão', async () => {
    const a = acoes({ assinar: { mensagem: 'mais nova', variante: 'aviso', em: 9 } });
    desenhar('encerrada', { a, inicial: resposta('Assinatura cancelada. Acesso até 20/06/2027.', 'sucesso') });
    expect(screen.getByRole('status').textContent).toContain('Sucesso:');
    fireEvent.click(screen.getByRole('button', { name: 'Assinar novamente' }));
    expect(await screen.findByText('Atenção:')).toBeTruthy();
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('CA-12: histórico vazio mostra "Nenhum pagamento registrado."; com 12 mostra 12 linhas sem ids', () => {
    desenhar('ativa', { n: 0 });
    expect(screen.getByText('Nenhum pagamento registrado.')).toBeTruthy();
  });

  it('CA-12: 12 pagamentos, na ordem recebida, com data, valor e situação em texto', () => {
    desenhar('ativa', { n: 12 });
    const linhas = within(screen.getByRole('table')).getAllByRole('row');
    expect(linhas).toHaveLength(13); // cabeçalho + 12
    expect(screen.getByRole('heading', { level: 2, name: 'Pagamentos' })).toBeTruthy();
    expect(within(linhas[1]).getByText('19/06/2027')).toBeTruthy();
    expect(within(linhas[2]).getByText('Recusado')).toBeTruthy();
    expect(screen.getAllByText('Aprovado')).toHaveLength(11);
    expect(screen.getAllByText(/^R\$\s79,00$/)).toHaveLength(12);
  });

  it('manual mostra o histórico (somente leitura) e nenhuma ação', () => {
    desenhar('manual', { n: 2 });
    expect(screen.getByRole('table')).toBeTruthy();
    expect(botoes()).toEqual([]);
  });
});

describe('LinkBotao', () => {
  it('é um <a> com as classes de botão e o href informado', () => {
    render(<LinkBotao href="/a?b=1">Ir</LinkBotao>);
    const a = screen.getByRole('link', { name: 'Ir' });
    expect(a.getAttribute('href')).toBe('/a?b=1');
    expect(a.className).not.toBe('');
  });
});
