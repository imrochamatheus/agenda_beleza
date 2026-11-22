/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DetalheSalao, LinhaSalao, ListaSaloes } from '@/server/admin/saloes-tipos';
import { opcoesDeFuso } from '@/server/salao/fusos';

import { estadoEdicaoInicial, estadoExtensaoInicial, estadoSuspensaoInicial, valoresDoDetalhe } from '../estado';
import type { EstadoEdicao, EstadoExtensao, EstadoSuspensao } from '../estado';
import { CabecalhoDoSalao } from './CabecalhoDoSalao';
import { ListaDeSaloes } from './ListaDeSaloes';
import { PainelDoSalao } from './PainelDoSalao';
import { SeloDeEstado, SeloDeSuspensao } from './SeloDeEstado';
import type { AcoesDoSalao } from './PainelDoSalao';

vi.mock('next/navigation', () => ({ usePathname: () => '/admin/saloes' }));
afterEach(cleanup);

const linha = (o: Partial<LinhaSalao> = {}): LinhaSalao => ({ id: 'id-1', nome: 'Studio Aurora', slug: 'aurora', estado: 'em_teste', suspenso: false, gestorEmail: 'ana@exemplo.com.br', ...o });
const lista = (itens: LinhaSalao[], o: Partial<ListaSaloes> = {}): ListaSaloes => ({ itens, total: itens.length, pagina: 1, porPagina: 20, ...o });
const SEM_FILTRO = { q: '', estado: null, suspenso: 'todas', pagina: 1 } as const;

describe('SeloDeEstado e SeloDeSuspensao', () => {
  it('rótulo em texto e ícone decorativo (aria-hidden) em todo selo', () => {
    const { container } = render(
      <>
        {([null, 'ativa', 'em_teste', 'pendente', 'em_carencia', 'suspensa', 'cancelada', 'encerrada'] as const).map((e) => (
          <SeloDeEstado key={String(e)} estado={e} />
        ))}
        <SeloDeSuspensao />
      </>,
    );
    const textos = Array.from(container.querySelectorAll('span')).map((s) => s.textContent);
    expect(textos).toEqual(expect.arrayContaining(['Sem assinatura', 'Assinatura ativa', 'Em período de teste', 'Assinatura pendente', 'Pagamento não confirmado', 'Assinatura suspensa', 'Assinatura cancelada', 'Suspenso manualmente']));
    const svgs = container.querySelectorAll('svg');
    expect(svgs).toHaveLength(9);
    for (const s of svgs) expect(s.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('ListaDeSaloes', () => {
  it('colunas, link "Abrir <nome>", selo de suspensão, contagem no singular e endereço', () => {
    render(<ListaDeSaloes lista={lista([linha(), linha({ id: 'id-2', nome: 'Lume', slug: 'lume', estado: null, suspenso: true, gestorEmail: null })])} filtros={SEM_FILTRO} base="/admin/saloes" hrefDoSalao={(id) => `/admin/saloes/${id}`} />);
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.getByText('Salões da plataforma')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Abrir Studio Aurora' }).getAttribute('href')).toBe('/admin/saloes/id-1');
    expect(screen.getByText('/aurora')).toBeTruthy();
    expect(screen.getByText('Suspenso manualmente')).toBeTruthy();
    expect(within(screen.getByRole('table')).getByText('Sem assinatura')).toBeTruthy();
    expect(screen.getByText('2 salões').getAttribute('aria-live')).toBe('polite');
    expect(screen.queryByRole('link', { name: 'Limpar filtros' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Paginação' })).toBeNull();
  });

  it('formulário GET com 7 estados + todas; valores dos filtros; "Limpar filtros" aparece com filtro ativo', () => {
    render(<ListaDeSaloes lista={lista([linha()])} filtros={{ q: 'ana', estado: 'ativa', suspenso: 'sim', pagina: 1 }} base="/admin/saloes" hrefDoSalao={() => '#'} />);
    const form = document.querySelector('form') as HTMLFormElement;
    expect(form.getAttribute('method')).toBe('get');
    const q = screen.getByRole('textbox', { name: 'Buscar por nome, endereço ou e-mail do gestor' }) as HTMLInputElement;
    expect(q.value).toBe('ana');
    const estado = screen.getByRole('combobox', { name: 'Assinatura' }) as HTMLSelectElement;
    expect(Array.from(estado.options).map((o) => o.textContent)).toEqual([
      'Todas', 'Assinatura pendente', 'Em período de teste', 'Assinatura ativa', 'Pagamento não confirmado', 'Assinatura suspensa', 'Assinatura cancelada', 'Sem assinatura',
    ]);
    expect(estado.value).toBe('ativa');
    expect((screen.getByRole('combobox', { name: 'Suspensão manual' }) as HTMLSelectElement).value).toBe('sim');
    expect(screen.getByRole('link', { name: 'Limpar filtros' }).getAttribute('href')).toBe('/admin/saloes');
    expect(screen.getByRole('button', { name: 'Filtrar' })).toBeTruthy();
    expect(screen.getByText('1 salão')).toBeTruthy();
  });

  it('vazio: EmptyState; paginação preserva os filtros', () => {
    const { unmount } = render(<ListaDeSaloes lista={lista([])} filtros={{ q: 'zzz', estado: null, suspenso: 'todas', pagina: 1 }} base="/admin/saloes" hrefDoSalao={() => '#'} />);
    expect(screen.getByRole('heading', { name: 'Nenhum salão encontrado.' })).toBeTruthy();
    expect(screen.getByText('Tente outro nome ou limpe os filtros.')).toBeTruthy();
    unmount();
    render(<ListaDeSaloes lista={lista([linha()], { total: 45, pagina: 2 })} filtros={{ q: 'ana', estado: 'em_teste', suspenso: 'nao', pagina: 2 }} base="/admin/saloes" hrefDoSalao={() => '#'} />);
    const nav = screen.getByRole('navigation', { name: 'Paginação' });
    expect(within(nav).getByText('Página 2 de 3')).toBeTruthy();
    expect(within(nav).getByRole('link', { name: 'Anterior' }).getAttribute('href')).toBe('/admin/saloes?q=ana&estado=em_teste&suspenso=nao');
    expect(within(nav).getByRole('link', { name: 'Próxima' }).getAttribute('href')).toBe('/admin/saloes?q=ana&estado=em_teste&suspenso=nao&pagina=3');
  });
});

describe('CabecalhoDoSalao', () => {
  it('um único h1, endereço, selos e volta à lista', () => {
    render(<CabecalhoDoSalao salao={{ nome: 'Studio', slug: 'studio', assinatura: { estado: 'ativa', testeFimEm: null, vinculada: true }, suspensoEm: '2030-01-01T00:00:00.000Z' }} hrefLista="/admin/saloes" />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByText('/studio')).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'Situação' })).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Voltar à lista' }).getAttribute('href')).toBe('/admin/saloes');
  });
});

const DETALHE: DetalheSalao = {
  id: 'abc', nome: 'Studio Aurora', slug: 'aurora', fuso: 'America/Sao_Paulo', gradeMin: 15, antecedenciaMin: 120, janelaDias: 60, intervaloMin: 0,
  suspensoEm: null, gestor: { nome: 'Ana Gestora', email: 'ana@exemplo.com.br', confirmado: true },
  assinatura: { estado: 'em_teste', testeFimEm: '2030-11-30T17:00:00.000Z', vinculada: true },
};
const FUSOS = opcoesDeFuso('America/Sao_Paulo');

function acoes(o: Partial<{ editar: EstadoEdicao | null; suspender: EstadoSuspensao | null; reativar: EstadoSuspensao | null; estender: EstadoExtensao | null }> = {}) {
  const chamadas: Record<string, FormData[]> = { editar: [], suspender: [], reativar: [], estender: [] };
  const a: AcoesDoSalao = {
    editar: async (anterior, fd) => (chamadas.editar.push(fd), o.editar ?? anterior),
    suspender: async (anterior, fd) => (chamadas.suspender.push(fd), o.suspender ?? anterior),
    reativar: async (anterior, fd) => (chamadas.reativar.push(fd), o.reativar ?? anterior),
    estender: async (anterior, fd) => (chamadas.estender.push(fd), o.estender ?? anterior),
  };
  return { a, chamadas };
}
const painel = (a: AcoesDoSalao, d: DetalheSalao = DETALHE, recusa: Parameters<typeof PainelDoSalao>[0]['recusaDaExtensao'] = null) =>
  render(<PainelDoSalao salao={d} fusos={FUSOS} acoes={a} recusaDaExtensao={recusa} hrefVoltar="/admin/saloes/abc" />);
const enviarForm = (botao: string) => fireEvent.click(screen.getByRole('button', { name: botao }));

describe('PainelDoSalao: edição', () => {
  it('campos com os valores atuais, aviso do gestor, fuso agrupado e um só "Salvar alterações"', () => {
    painel(acoes().a);
    expect((screen.getByLabelText('Nome') as HTMLInputElement).value).toBe('Studio Aurora');
    expect((screen.getByLabelText(/Endereço do salão/) as HTMLInputElement).value).toBe('aurora');
    expect((screen.getByLabelText('Antecedência mínima (horas)') as HTMLInputElement).value).toBe('2');
    expect((screen.getByLabelText('E-mail do gestor') as HTMLInputElement).value).toBe('ana@exemplo.com.br');
    expect((screen.getByLabelText('E-mail do gestor') as HTMLInputElement).type).toBe('email');
    expect(screen.getByText(/Trocar o e-mail desfaz a confirmação/)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Salvar alterações' })).toHaveLength(1);
    const fuso = screen.getByRole('combobox', { name: 'Fuso horário' }) as HTMLSelectElement;
    expect(fuso.value).toBe('America/Sao_Paulo');
    expect(fuso.querySelectorAll('optgroup')).toHaveLength(2);
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Dados do salão', 'Regras da agenda', 'Gestor', 'Assinatura', 'Suspensão', 'Teste gratuito']);
  });

  it('salão sem gestor: sem a seção do gestor', () => {
    painel(acoes().a, { ...DETALHE, gestor: null });
    expect(screen.queryByRole('heading', { name: 'Gestor' })).toBeNull();
  });

  it('erros de campo: resumo focado com links, aria-invalid, valores digitados preservados', async () => {
    const valores = { ...valoresDoDetalhe(DETALHE), nome: 'x', grade: '7' };
    const { a } = acoes({ editar: { em: 1, mensagem: null, valores, resultado: { resultado: 'invalido', erros: { nome: 'Informe o nome do salão (de 2 a 80 caracteres).', grade: 'Escolha uma grade da lista: 5, 10, 15, 20, 30 ou 60 minutos.' } } } });
    painel(a);
    enviarForm('Salvar alterações');
    const resumo = await screen.findByRole('alert', { name: 'Corrija os campos indicados para salvar.' });
    await waitFor(() => expect(document.activeElement).toBe(resumo));
    expect(within(resumo).getAllByRole('link').map((l) => l.getAttribute('href'))).toEqual(['#salao-nome', '#salao-grade']);
    expect((screen.getByLabelText('Nome') as HTMLInputElement).value).toBe('x');
    expect(screen.getByLabelText('Nome').getAttribute('aria-invalid')).toBe('true');
  });

  it('e-mail em uso e slug em conflito aparecem como erro de campo', async () => {
    const { a } = acoes({ editar: { em: 1, mensagem: null, valores: valoresDoDetalhe(DETALHE), resultado: { resultado: 'email_em_uso', erros: { gestorEmail: 'Este e-mail já é usado por outra conta.' } } } });
    painel(a);
    enviarForm('Salvar alterações');
    expect((await screen.findAllByText(/Este e-mail já é usado por outra conta\./)).length).toBeGreaterThan(0);
    expect(screen.getByLabelText('E-mail do gestor').getAttribute('aria-invalid')).toBe('true');
  });

  it('sucesso: alerta no topo, antes dos formulários, e focado', async () => {
    const { a, chamadas } = acoes({ editar: { em: 1, mensagem: null, valores: valoresDoDetalhe(DETALHE), resultado: { resultado: 'editado' } } });
    const { container } = painel(a);
    enviarForm('Salvar alterações');
    const texto = await screen.findByText('Dados do salão salvos.');
    const topo = texto.closest('[tabindex="-1"]') as HTMLElement;
    expect(container.firstElementChild?.firstElementChild).toBe(topo);
    await waitFor(() => expect(document.activeElement).toBe(topo));
    expect(chamadas.editar[0].get('salaoId')).toBe('abc');
    expect(chamadas.editar[0].get('nome')).toBe('Studio Aurora');
  });
});

describe('PainelDoSalao: suspensão', () => {
  it('etapa 1 pede o motivo (obrigatório) e envia etapa=previa; sem diálogo', () => {
    const { a, chamadas } = acoes();
    painel(a);
    expect(screen.getByRole('textbox', { name: /Motivo/ }).hasAttribute('required')).toBe(true);
    expect(screen.getByText(/O motivo fica só na auditoria/)).toBeTruthy();
    expect(document.querySelector('dialog')).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: /Motivo/ }), { target: { value: 'Pedido do gestor' } });
    enviarForm('Continuar');
    return waitFor(() => {
      expect(chamadas.suspender[0].get('etapa')).toBe('previa');
      expect(chamadas.suspender[0].get('motivo')).toBe('Pedido do gestor');
    });
  });

  it('etapa 2: aviso, motivo em citação, campos ocultos, botão de perigo e "Voltar"', async () => {
    const { a, chamadas } = acoes({ suspender: { em: 1, mensagem: null, valores: { motivo: 'Pedido do gestor' }, resultado: { resultado: 'previa', motivo: 'Pedido do gestor' } } });
    painel(a);
    enviarForm('Continuar');
    const grupo = await screen.findByRole('group', { name: 'Confirmar a suspensão' });
    expect(within(grupo).getByText('Suspender Studio Aurora? Ela deixa de aceitar novas reservas agora.')).toBeTruthy();
    expect(grupo.querySelector('blockquote')?.textContent).toBe('Pedido do gestor');
    expect(within(grupo).getByRole('link', { name: 'Voltar' }).getAttribute('href')).toBe('/admin/saloes/abc');
    expect(screen.queryByRole('button', { name: 'Continuar' })).toBeNull();
    const hidden = Array.from(grupo.querySelectorAll('input[type="hidden"]')).map((i) => `${(i as HTMLInputElement).name}=${(i as HTMLInputElement).value}`);
    expect(hidden).toEqual(['salaoId=abc', 'motivo=Pedido do gestor', 'etapa=confirmar']);
    fireEvent.click(within(grupo).getByRole('button', { name: 'Suspender salão' }));
    await waitFor(() => expect(chamadas.suspender).toHaveLength(2));
    expect(chamadas.suspender[1].get('etapa')).toBe('confirmar');
  });

  it('motivo inválido volta como erro de campo', async () => {
    const { a } = acoes({ suspender: { em: 1, mensagem: null, valores: { motivo: 'x' }, resultado: { resultado: 'invalido', erros: { motivo: 'Informe o motivo (5 a 280 caracteres).' } } } });
    painel(a);
    enviarForm('Continuar');
    expect(await screen.findByText(/Informe o motivo \(5 a 280 caracteres\)\./)).toBeTruthy();
    expect((screen.getByRole('textbox', { name: /Motivo/ }) as HTMLInputElement).value).toBe('x');
  });

  it('salão suspenso: data e hora no fuso, motivo opcional, reativar numa etapa; aviso da assinatura suspensa', async () => {
    const suspenso: DetalheSalao = { ...DETALHE, suspensoEm: '2030-11-20T12:12:00.000Z', assinatura: { estado: 'suspensa', testeFimEm: null, vinculada: true } };
    const { a, chamadas } = acoes();
    painel(a, suspenso);
    expect(screen.getByText('Suspenso manualmente em 20/11/2030 às 09:12.')).toBeTruthy();
    expect(screen.getByText('Reativar o salão não reativa a assinatura.')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Motivo (opcional)' })).toBeTruthy();
    enviarForm('Reativar salão');
    await waitFor(() => expect(chamadas.reativar).toHaveLength(1));
    expect(screen.queryByRole('button', { name: 'Continuar' })).toBeNull();
  });

  it('reativar com motivo inválido mostra o erro no campo', async () => {
    const suspenso: DetalheSalao = { ...DETALHE, suspensoEm: '2030-11-20T12:12:00.000Z' };
    const { a } = acoes({ reativar: { em: 1, mensagem: null, valores: { motivo: 'oi' }, resultado: { resultado: 'invalido', erros: { motivo: 'Informe o motivo (5 a 280 caracteres).' } } } });
    painel(a, suspenso);
    enviarForm('Reativar salão');
    expect(await screen.findByText(/Informe o motivo/)).toBeTruthy();
    expect(screen.queryByText(/Reativar o salão não reativa a assinatura\./)).toBeNull();
  });
});

describe('PainelDoSalao: teste gratuito', () => {
  it('elegível: D no fuso do salão, campo de texto numérico (nunca type=number) e "Ver novo fim"', () => {
    painel(acoes().a);
    expect(screen.getAllByText('30/11/2030 às 14:00').length).toBeGreaterThan(0);
    const dias = screen.getByRole('textbox', { name: 'Dias a acrescentar (1 a 90)' }) as HTMLInputElement;
    expect(dias.type).toBe('text');
    expect(dias.getAttribute('inputmode')).toBe('numeric');
    expect(screen.getByRole('button', { name: 'Ver novo fim' })).toBeTruthy();
  });

  it('etapa 2: D → D+N, o efeito no botão, aviso irreversível, campos ocultos incl. D esperado', async () => {
    const { a, chamadas } = acoes({ estender: { em: 1, mensagem: null, valores: { dias: '10' }, resultado: { resultado: 'previa', de: '2030-11-30T17:00:00.000Z', para: '2030-12-10T17:00:00.000Z', dias: 10 } } });
    painel(a);
    enviarForm('Ver novo fim');
    const grupo = await screen.findByRole('group', { name: 'Confirmar a extensão do teste' });
    expect(within(grupo).getByText('30/11/2030 às 14:00 → 10/12/2030 às 14:00')).toBeTruthy();
    expect(within(grupo).getByText('+10 dias de 24 h')).toBeTruthy();
    expect(within(grupo).getByText(/não pode ser desfeito por aqui/)).toBeTruthy();
    const hidden = Array.from(grupo.querySelectorAll('input[type="hidden"]')).map((i) => `${(i as HTMLInputElement).name}=${(i as HTMLInputElement).value}`);
    expect(hidden).toEqual(['salaoId=abc', 'dias=10', 'testeFimEmEsperado=2030-11-30T17:00:00.000Z', 'etapa=confirmar']);
    fireEvent.click(within(grupo).getByRole('button', { name: 'Estender teste em 10 dias' }));
    await waitFor(() => expect(chamadas.estender).toHaveLength(2));
    expect(chamadas.estender[1].get('etapa')).toBe('confirmar');
  });

  it('um dia só: rótulo no singular', async () => {
    const { a } = acoes({ estender: { em: 1, mensagem: null, valores: { dias: '1' }, resultado: { resultado: 'previa', de: '2030-11-30T17:00:00.000Z', para: '2030-12-01T17:00:00.000Z', dias: 1 } } });
    painel(a);
    enviarForm('Ver novo fim');
    expect(await screen.findByRole('button', { name: 'Estender teste em 1 dia' })).toBeTruthy();
  });

  it('N inválido: erro de campo e valor preservado', async () => {
    const { a } = acoes({ estender: { em: 1, mensagem: null, valores: { dias: '1e1' }, resultado: { resultado: 'invalido', erros: { dias: 'Informe um número inteiro de 1 a 90.' } } } });
    painel(a);
    enviarForm('Ver novo fim');
    expect(await screen.findByText(/Informe um número inteiro de 1 a 90\./)).toBeTruthy();
    expect((screen.getByRole('textbox', { name: /Dias a acrescentar/ }) as HTMLInputElement).value).toBe('1e1');
  });

  it.each([
    ['sem_assinatura', 'Este salão não tem assinatura.'],
    ['estado', 'O teste só pode ser estendido enquanto a assinatura está em período de teste.'],
    ['sem_provedor', 'A assinatura não tem vínculo com o provedor.'],
    ['teste_encerrado', 'O teste já terminou.'],
    ['teste_expirando', 'O teste termina em menos de 5 minutos.'],
  ] as const)('recusa %s no lugar do campo, sem formulário', (motivo, texto) => {
    painel(acoes().a, { ...DETALHE, assinatura: null }, motivo);
    expect(screen.getByText(texto)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ver novo fim' })).toBeNull();
  });

  it('recusa devolvida pela ação aparece no lugar do campo', async () => {
    const { a } = acoes({ estender: { em: 1, mensagem: null, valores: { dias: '5' }, resultado: { resultado: 'recusado', motivo: 'estado' } } });
    painel(a);
    enviarForm('Ver novo fim');
    expect(await screen.findByText('O teste só pode ser estendido enquanto a assinatura está em período de teste.')).toBeTruthy();
  });

  it.each([
    ['provedor_falhou', 'O provedor não refletiu o adiamento; nada foi alterado. Tente novamente mais tarde.', 'alert'],
    ['divergencia', 'O provedor adiou a cobrança, mas a assinatura mudou aqui. Nada foi gravado. Confira a situação com o provedor.', 'alert'],
  ] as const)('%s: alerta de erro no topo', async (resultado, texto, papel) => {
    const { a } = acoes({ estender: { em: 1, mensagem: null, valores: { dias: '5' }, resultado: { resultado } } });
    painel(a);
    enviarForm('Ver novo fim');
    expect((await screen.findByRole(papel)).textContent).toContain(texto);
  });

  it('mensagem geral (acesso negado) aparece como alerta', async () => {
    const { a } = acoes({ estender: { ...estadoExtensaoInicial(), em: 1, mensagem: 'Acesso negado.' } });
    painel(a);
    enviarForm('Ver novo fim');
    expect((await screen.findByRole('alert')).textContent).toContain('Acesso negado.');
  });

  it('seção Assinatura: situação, plano e fim do teste; sem assinatura só a situação', () => {
    const { unmount } = painel(acoes().a);
    const dl = document.querySelector('dl') as HTMLElement;
    expect(dl.textContent).toContain('Em período de teste');
    expect(dl.textContent).toContain('R$');
    expect(dl.textContent).toContain('30/11/2030 às 14:00');
    unmount();
    painel(acoes().a, { ...DETALHE, assinatura: null }, 'sem_assinatura');
    expect((document.querySelector('dl') as HTMLElement).textContent).toBe('SituaçãoSem assinatura');
  });
});

describe('estado inicial das ações de demonstração', () => {
  it('estados iniciais vazios', () => {
    expect(estadoSuspensaoInicial()).toEqual({ em: 0, mensagem: null, resultado: null, valores: { motivo: '' } });
    expect(estadoExtensaoInicial()).toEqual({ em: 0, mensagem: null, resultado: null, valores: { dias: '' } });
    expect(estadoEdicaoInicial(valoresDoDetalhe(DETALHE)).resultado).toBeNull();
  });
});
