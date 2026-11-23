import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cancelarAcao, cancelarTodosDaReservaAcao, marcarAcao, remarcarAcao } from '@/app/painel/agenda/reservas/[id]/acoes';
import { estadoCancelarTodosInicial, estadoDoItemInicial, estadoRemarcarInicial } from '@/app/painel/agenda/reservas/[id]/estado';
import PaginaReserva from '@/app/painel/agenda/reservas/[id]/page';
import { ROTAS } from '@/config/navegacao';

import { criarSessao } from '../../../support/auth';
import { inserirReservaDireta } from '../../../support/reservas';

import { conferirDerivados, criarCenario, criarComItens, db, itemDe, mensagensDe, reservaDe } from './apoio';
import type { Cenario } from './apoio';

// D-030 CA-13; D-050 web-design §5.10, CA-30, CA-36 (componente) e critérios 19–22: a página do detalhe com as
// ações POR ITEM e a casca das ações, com sessões reais no PostgreSQL. next/headers (cookies) e next/navigation
// (redirect) são substituídos; o banco é real. O relógio da página é o real: as reservas ficam em 2035.

class Redirecionado extends Error {
  constructor(readonly destino: string) {
    super(`NEXT_REDIRECT ${destino}`);
  }
}

const estadoNext = vi.hoisted(() => ({ cookie: undefined as string | undefined }));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nome: string) => (nome === 'ab_sessao' && estadoNext.cookie !== undefined ? { name: nome, value: estadoNext.cookie } : undefined),
  }),
}));
vi.mock('next/navigation', () => ({
  redirect: (destino: string) => {
    throw new Redirecionado(destino);
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  usePathname: () => null,
}));

/** Terça-feira no futuro distante: as ações dependem do relógio real. */
const DATA = { ano: 2035, mes: 3, dia: 6 } as const;

beforeEach(() => {
  estadoNext.cookie = undefined;
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

const comoGestor = async (c: Cenario) => {
  estadoNext.cookie = (await criarSessao(c.s.gestor.usuarioId)).token;
};
/** Usuário de papel profissional, vinculado à Ana. */
const comoProfissional = async (c: Cenario) => {
  estadoNext.cookie = (await criarSessao(c.s.profissional.usuarioId)).token;
};
const pagina = async (id: string, busca: Record<string, string> = {}) =>
  renderToStaticMarkup(await PaginaReserva({ params: Promise.resolve({ id }), searchParams: Promise.resolve(busca) }));
const destinoDe = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof Redirecionado) return e.destino;
    throw e;
  }
  throw new Error('esperava um redirect');
};
const form = (campos: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.append(k, v);
  return fd;
};

/** A (Ana) 10:00–10:30, C (Bia) 10:30–10:50 e B (Ana) 11:00–11:45, em 2035. Devolve [reserva, itens A, C, B]. */
async function tresItens(c: Cenario) {
  const r = await criarComItens(c, [
    { servicoId: c.A, profissionalId: c.ana, hora: '10:00', data: DATA },
    { servicoId: c.C, profissionalId: c.bia, hora: '10:30', data: DATA },
    { servicoId: c.B, profissionalId: c.ana, hora: '11:00', data: DATA },
  ]);
  const [a, cc, b] = r.itens;
  return { id: r.id, a, c: cc, b };
}

const formulariosDeRemarcar = (html: string) => (html.match(/<h3 id="remarcar"/g) ?? []).length;

describe('página do detalhe com ações por item', () => {
  it('gestor: roteiro com id por item, ações por item, "Cancelar todos" e Data na dl (critérios 19 e 21)', async () => {
    const c = await criarCenario();
    const r = await tresItens(c);
    await comoGestor(c);
    const html = await pagina(r.id);
    for (const item of [r.a, r.c, r.b]) {
      expect(html).toContain(`id="item-${item}"`);
      expect(html).toContain(`href="${ROTAS.agendaReserva(r.id)}?remarcar=${item}#remarcar"`);
      expect(html).toContain(`href="${ROTAS.agendaReserva(r.id)}?cancelar=${item}#cancelar"`);
    }
    expect(html).toContain(`href="${ROTAS.agendaReserva(r.id)}?cancelar=todos#cancelar-todos"`);
    expect(html).toContain('Cancelar todos os serviços');
    expect(html).toContain('<dt>Data</dt><dd>Terça-feira, 06/03/2035</dd>');
    expect(html).not.toMatch(/<dt>(Profissional|Início|Fim)<\/dt>/);
    expect(html).toMatch(/<span>Total<\/span> <strong>R\$\s*160,00<\/strong> · 3 serviços/);
    expect(html).not.toContain('Concluído');
    expect(formulariosDeRemarcar(html)).toBe(0);
    expect(html).not.toContain('<dialog');
  });

  it('?remarcar=<item>: um único formulário, com profissionais e a data como texto (critério 22)', async () => {
    const c = await criarCenario();
    const r = await tresItens(c);
    await comoGestor(c);
    const html = await pagina(r.id, { remarcar: r.c });
    expect(formulariosDeRemarcar(html)).toBe(1);
    expect(html).toContain('Remarcar C</h3>');
    expect(html).toMatch(/<option[^>]*value="[0-9a-f-]+"[^>]*>Bia<\/option>/);
    expect(html).toContain('06/03/2035');
    expect(html).toContain('a mesma dos outros serviços.');
    expect(html).not.toContain('type="date"');
    expect(html).toContain('value="10:30"');
    // O formulário fica DENTRO da parada do item.
    const parada = html.slice(html.indexOf(`id="item-${r.c}"`), html.indexOf(`id="item-${r.b}"`));
    expect(parada).toContain('<h3 id="remarcar"');
    // Id desconhecido, malformado ou de item cancelado não abre nada.
    for (const remarcar of ['lixo', '00000000-0000-4000-8000-000000000000']) expect(formulariosDeRemarcar(await pagina(r.id, { remarcar }))).toBe(0);
  });

  it('?cancelar=<item> e ?cancelar=todos abrem as confirmações sob a parada e sob o total', async () => {
    const c = await criarCenario();
    const r = await tresItens(c);
    await comoGestor(c);
    const um = await pagina(r.id, { cancelar: r.a });
    expect(um).toContain('Cancelar A (10:00 com Ana)? O horário será liberado');
    expect(um).toContain('Sim, cancelar este serviço');
    const todos = await pagina(r.id, { cancelar: 'todos' });
    expect(todos).toContain('Cancelar os 3 serviços que ainda podem ser cancelados (A 10:00, C 10:30, B 11:00)?');
    expect(todos).toContain('Sim, cancelar todos');
  });

  it('profissional: só os próprios itens, a frase do ND-2 e o total dos seus serviços; sem "Cancelar todos" (CA-33)', async () => {
    const c = await criarCenario();
    const r = await tresItens(c);
    await comoProfissional(c);
    const html = await pagina(r.id, { cancelar: 'todos' });
    expect(html).toContain('Você vê apenas os seus serviços nesta reserva.');
    expect(html).toContain(`id="item-${r.a}"`);
    expect(html).toContain(`id="item-${r.b}"`);
    expect(html).not.toContain(r.c);
    expect(html).not.toContain('com Bia');
    expect(html).toMatch(/<span>Total dos seus serviços<\/span> <strong>R\$\s*120,00<\/strong> · 2 serviços/);
    expect(html).not.toContain('Cancelar todos');
    // Remarcar sem seletor de profissional nem campo de profissional.
    const remarcar = await pagina(r.id, { remarcar: r.a });
    expect(formulariosDeRemarcar(remarcar)).toBe(1);
    expect(remarcar).not.toContain('name="profissionalId"');
  });

  it('resultado do PRG: texto do item lido na página; fora da lista fechada é ignorado', async () => {
    const c = await criarCenario();
    const r = await tresItens(c);
    await comoGestor(c);
    expect(await pagina(r.id, { resultado: 'cancelado', item: r.a })).toContain('A (10:00) foi cancelado. A cliente será avisada se tiver aceitado as mensagens.');
    expect(await pagina(r.id, { resultado: 'remarcado', item: r.c, de: '09:00' })).toContain('C (09:00) foi remarcado para 10:30 com Bia.');
    expect(await pagina(r.id, { resultado: 'todos_cancelados', n: '2' })).toContain('2 serviços cancelados. A cliente receberá uma única mensagem.');
    expect(await pagina(r.id, { resultado: '<b>x</b>' })).not.toContain('<b>x</b>');
  });

  it('reserva toda cancelada: nenhuma ação e "Total (cancelada)"', async () => {
    const c = await criarCenario();
    const r = await tresItens(c);
    await comoGestor(c);
    await destinoDe(cancelarTodosDaReservaAcao(estadoCancelarTodosInicial, form({ reservaId: r.id })));
    const html = await pagina(r.id);
    expect(html).not.toMatch(/\?remarcar=|\?cancelar=/);
    expect(html).toContain('Total (cancelada)');
    expect(html).toContain('<dt>Situação</dt><dd>Cancelada</dd>');
  });
});

describe('casca das ações', () => {
  it('cancelar um item: PRG com o item e #resultado; o outro continua; clique duplo é recusado', async () => {
    const c = await criarCenario();
    const r = await tresItens(c);
    await comoGestor(c);
    expect(await destinoDe(cancelarAcao(estadoDoItemInicial, form({ reservaId: r.id, itemId: r.a })))).toBe(
      `${ROTAS.agendaReserva(r.id)}?resultado=cancelado&item=${r.a}#resultado`,
    );
    expect((await itemDe(r.a)).status).toBe('cancelado');
    expect((await itemDe(r.c)).status).toBe('confirmado');
    await conferirDerivados(r.id);
    const duplo = await cancelarAcao(estadoDoItemInicial, form({ reservaId: r.id, itemId: r.a }));
    expect(duplo.itemId).toBe(r.a);
    expect(duplo.mensagem).toBeTruthy();
  });

  it('remarcar: sem sessão vai para /entrar; encaixe volta na resposta com o item; sucesso é PRG com a hora anterior', async () => {
    const c = await criarCenario();
    const r = await tresItens(c);
    const estado = estadoRemarcarInicial(r.b, { servicoId: c.B, profissionalId: c.ana, data: '', hora: '11:00', confirmarEncaixe: false });
    const base = { reservaId: r.id, itemId: r.b, servicoId: c.B, profissionalId: c.ana, de: '11:00' };
    expect(await destinoDe(remarcarAcao(estado, form({ ...base, hora: '14:00' })))).toContain(ROTAS.entrar);
    await comoGestor(c);
    const aviso = await remarcarAcao(estado, form({ ...base, hora: '20:00' }));
    expect(aviso).toMatchObject({ itemId: r.b, motivos: ['fora_da_jornada'], valores: { hora: '20:00' } });
    const cruzado = await remarcarAcao(estado, form({ ...base, hora: '10:15' }));
    expect(cruzado.mensagem).toBe('O novo horário coincide com outro serviço desta reserva.');
    expect(await destinoDe(remarcarAcao(estado, form({ ...base, hora: '14:00' })))).toBe(
      `${ROTAS.agendaReserva(r.id)}?resultado=remarcado&item=${r.b}&de=11%3A00#resultado`,
    );
    expect((await reservaDe(r.id)).revisao).toBe(1);
    expect((await mensagensDe(r.id)).some((m) => m.tipo === 'remarcacao' && m.revisao === 1 && m.reservaItemId === r.b)).toBe(true);
    await conferirDerivados(r.id);
  });

  it('DEF-1: item de profissional inativo — o select começa vazio; enviar vazio é erro de campo e nada é gravado', async () => {
    const c = await criarCenario();
    const r = await tresItens(c);
    await db().profissional.update({ where: { id: c.bia }, data: { ativo: false } });
    await comoGestor(c);
    const html = await pagina(r.id, { remarcar: r.c });
    expect(html).toMatch(/<option value="" selected="">Escolha a profissional<\/option>/);
    expect(html).toContain('Atual: Bia (inativo).');
    const selectProf = html.slice(html.indexOf('name="profissionalId"'), html.indexOf('</select>', html.indexOf('name="profissionalId"')));
    expect(selectProf).toContain('<option value="" selected="">');
    expect(selectProf).not.toMatch(/<option value="[0-9a-f-]+" selected="">/);
    const itemAntes = await itemDe(r.c);
    const mensagensAntes = await mensagensDe(r.id);
    const estado = estadoRemarcarInicial(r.c, { servicoId: c.C, profissionalId: '', data: '', hora: '10:30', confirmarEncaixe: false });
    // Vazio (o que o formulário envia) e ausente (cliente adulterado) dão o mesmo erro, validado no servidor.
    for (const campos of [{ profissionalId: '' }, {}] as Record<string, string>[]) {
      const resposta = await remarcarAcao(estado, form({ reservaId: r.id, itemId: r.c, servicoId: c.C, hora: '11:15', de: '10:30', ...campos }));
      expect(resposta).toMatchObject({ itemId: r.c, erros: { profissional: 'Escolha a profissional.' }, mensagem: null });
    }
    expect(await itemDe(r.c)).toEqual(itemAntes);
    expect((await reservaDe(r.id)).revisao).toBe(0);
    expect(await mensagensDe(r.id)).toEqual(mensagensAntes);
    expect(mensagensAntes.map((m) => m.tipo)).toEqual(['confirmacao']);
    // Escolhendo uma ativa, a remarcação segue normalmente.
    expect(await destinoDe(remarcarAcao(estado, form({ reservaId: r.id, itemId: r.c, servicoId: c.C, profissionalId: c.ana, hora: '11:45', de: '10:30' })))).toBe(
      `${ROTAS.agendaReserva(r.id)}?resultado=remarcado&item=${r.c}&de=10%3A30#resultado`,
    );
    expect((await itemDe(r.c)).profissionalId).toBe(c.ana);
    await conferirDerivados(r.id);
  });

  it('marcar antes do início recusa na parada; outro salão e item alheio têm mensagens uniformes (CA-30)', async () => {
    const c = await criarCenario();
    const outro = await criarCenario();
    const r = await tresItens(c);
    const alheia = await tresItens(outro);
    await comoGestor(c);
    expect(await marcarAcao(estadoDoItemInicial, form({ reservaId: r.id, itemId: r.a, destino: 'concluido' }))).toEqual({
      itemId: r.a,
      mensagem: 'Só é possível marcar o resultado depois do início do serviço.',
    });
    expect((await marcarAcao(estadoDoItemInicial, form({ reservaId: alheia.id, itemId: alheia.a, destino: 'concluido' }))).mensagem).toBe('Reserva não encontrada.');
    expect((await itemDe(alheia.a)).status).toBe('confirmado');
    await comoProfissional(c);
    expect((await marcarAcao(estadoDoItemInicial, form({ reservaId: r.id, itemId: r.c, destino: 'concluido' }))).mensagem).toBe('Acesso negado.');
    expect((await cancelarAcao(estadoDoItemInicial, form({ reservaId: r.id, itemId: r.c }))).mensagem).toBe('Acesso negado.');
    const estado = estadoRemarcarInicial(r.c, { servicoId: c.C, profissionalId: '', data: '', hora: '10:30', confirmarEncaixe: false });
    expect((await remarcarAcao(estado, form({ reservaId: r.id, itemId: r.c, hora: '15:00' }))).mensagem).toBe('Acesso negado.');
    expect((await cancelarTodosDaReservaAcao(estadoCancelarTodosInicial, form({ reservaId: r.id }))).mensagem).toBe('Acesso negado.');
    expect((await reservaDe(r.id)).revisao).toBe(0);
    expect((await itemDe(r.c)).status).toBe('confirmado');
  });

  it('marcar com sessão e item já iniciado: PRG de sucesso', async () => {
    const c = await criarCenario();
    // Item no passado só existe por inserção direta (a criação recusa o passado).
    const direta = await inserirReservaDireta(c, { inicio: new Date('2020-03-03T13:00:00Z'), fim: new Date('2020-03-03T13:30:00Z') });
    const [item] = (await reservaDe(direta)).itens;
    await comoGestor(c);
    expect(await destinoDe(marcarAcao(estadoDoItemInicial, form({ reservaId: direta, itemId: item.id, destino: 'nao_compareceu' })))).toBe(
      `${ROTAS.agendaReserva(direta)}?resultado=nao_compareceu&item=${item.id}#resultado`,
    );
    expect((await reservaDe(direta)).status).toBe('nao_compareceu');
    expect(await pagina(direta, { resultado: 'nao_compareceu', item: item.id })).toContain('A marcado como não compareceu.');
  });

  it('cancelar todos (gestor): PRG com a quantidade; depois, sem cancelável, a ação recusa', async () => {
    const c = await criarCenario();
    const r = await tresItens(c);
    await comoGestor(c);
    expect(await destinoDe(cancelarTodosDaReservaAcao(estadoCancelarTodosInicial, form({ reservaId: r.id })))).toBe(
      `${ROTAS.agendaReserva(r.id)}?resultado=todos_cancelados&n=3#resultado`,
    );
    expect((await reservaDe(r.id)).status).toBe('cancelado');
    expect(await cancelarTodosDaReservaAcao(estadoCancelarTodosInicial, form({ reservaId: r.id }))).toEqual({
      mensagem: 'Nenhum serviço desta reserva pode ser cancelado agora.',
    });
    await conferirDerivados(r.id);
  });
});
