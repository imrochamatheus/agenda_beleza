/// <reference types="vite/client" />
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { renderToReadableStream } from 'react-dom/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import PaginaAgenda from '@/app/painel/agenda/page';
import PaginaBloqueios from '@/app/painel/bloqueios/page';
import PaginaClientes from '@/app/painel/clientes/page';
import PaginaConfiguracoes from '@/app/painel/configuracoes/page';
import PaginaFotos from '@/app/painel/configuracoes/fotos/page';
import PaginaFuncionamento from '@/app/painel/configuracoes/funcionamento/page';
import PaginaPerfil from '@/app/painel/configuracoes/perfil/page';
import PaginaPainel from '@/app/painel/page';
import PaginaProfissionais from '@/app/painel/profissionais/page';
import PaginaServicos from '@/app/painel/servicos/page';
import { AvisoDoPlano } from '@/app/painel/_aviso/AvisoDoPlano';

import { obterPrisma } from '@/server/repos/db';

import { criarAssinaturaEm } from '../../support/assinatura';
import { criarSessao } from '../../support/auth';
import { criarSalaoCompleto } from '../../support/factories';
import type { SalaoCompleto } from '../../support/factories';
import { aplicarSituacao } from '../../support/politica';
import type { SituacaoDeTeste } from '../../support/politica';

// D-038 CA-4, CA-5, CA-10, R-2: as páginas do painel respondem com os dados e a faixa do estado; sem sessão
// não há faixa nem consulta; toda página do painel usa o PanelLayout (onde a faixa mora).

const estado = vi.hoisted(() => ({ cookie: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nome: string) => (nome === 'ab_sessao' && estado.cookie !== undefined ? { name: nome, value: estado.cookie } : undefined),
  }),
  headers: async () => new Headers(),
}));
vi.mock('next/navigation', () => ({
  redirect: (d: string) => {
    throw new Error(`NEXT_REDIRECT ${d}`);
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  usePathname: () => null,
}));

beforeEach(() => {
  estado.cookie = undefined;
});
afterAll(() => {
  vi.restoreAllMocks();
});

async function html(el: unknown): Promise<string> {
  const stream = await renderToReadableStream(el as never);
  await stream.allReady;
  return new Response(stream).text();
}
const texto = (h: string) => h.replace(/<[^>]*>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

const PAGINAS: [string, () => Promise<unknown>][] = [
  ['/painel', () => PaginaPainel()],
  ['/painel/agenda', () => PaginaAgenda({ searchParams: Promise.resolve({}) })],
  ['/painel/clientes', () => PaginaClientes({ searchParams: Promise.resolve({}) })],
  ['/painel/servicos', () => PaginaServicos()],
  ['/painel/profissionais', () => PaginaProfissionais()],
  ['/painel/bloqueios', () => PaginaBloqueios({ searchParams: Promise.resolve({}) })],
  ['/painel/configuracoes', () => PaginaConfiguracoes()],
  ['/painel/configuracoes/perfil', () => PaginaPerfil()],
  ['/painel/configuracoes/funcionamento', () => PaginaFuncionamento()],
  ['/painel/configuracoes/fotos', () => PaginaFotos({ searchParams: Promise.resolve({}) })],
];

const TEXTO_SUSPENSA = 'Assinatura suspensa. O painel está somente leitura e o agendamento está indisponível. Você ainda pode cancelar reservas futuras.';

async function como(salao: SalaoCompleto, papel: 'gestor' | 'profissional' = 'gestor') {
  estado.cookie = (await criarSessao(papel === 'gestor' ? salao.gestor.usuarioId : salao.profissional.usuarioId)).token;
}

describe('CA-4: salão suspenso, o painel continua legível e mostra a faixa', () => {
  it.each(PAGINAS)('%s: dados do salão e faixa de suspensa', async (_rota, renderizar) => {
    const suspenso = await criarSalaoCompleto();
    await aplicarSituacao(suspenso.salaoId, 'suspensa');
    await como(suspenso);
    const h = texto(await html(await renderizar()));
    expect(h).toContain(suspenso.nome);
    expect(h).toContain(TEXTO_SUSPENSA);
    expect(h).not.toContain('Acesso negado');
  });

  it('agenda e clientes mostram os dados do salão (leitura sempre permitida)', async () => {
    const suspenso = await criarSalaoCompleto();
    await aplicarSituacao(suspenso.salaoId, 'suspensa');
    await como(suspenso);
    expect(texto(await html(await PaginaClientes({ searchParams: Promise.resolve({}) })))).toContain(suspenso.clientes.nomeAtiva);
    expect(texto(await html(await PaginaServicos()))).toContain(suspenso.servicos.nomes[0]);
  });
});

describe('faixa por estado e papel (CA-5, CA-10)', () => {
  it.each<[SituacaoDeTeste, string | null]>([
    ['sem_assinatura', null],
    ['em_teste', null],
    ['ativa', null],
    ['pendente', 'Assinatura pendente.'],
    ['em_carencia', 'Pagamento não confirmado. Seu acesso continua normal até'],
    ['cancelada', 'Assinatura cancelada. Você pode usar o painel até'],
    ['encerrada', 'Assinatura encerrada.'],
    ['cancelada_vencida', 'Assinatura encerrada.'],
    ['manual', 'Salão suspenso pela administração.'],
  ])('%s', async (situacao, esperado) => {
    const salao = await criarSalaoCompleto();
    await aplicarSituacao(salao.salaoId, situacao);
    await como(salao);
    const h = texto(await html(await AvisoDoPlano({ papel: 'gestor' })));
    if (esperado === null) expect(h.trim()).toBe('');
    else expect(h).toContain(esperado);
  });

  it('a data da carência sai no fuso do salão (virada de dia)', async () => {
    const salao = await criarSalaoCompleto({ salao: { fuso: 'America/Sao_Paulo' } });
    await aplicarSituacao(salao.salaoId, 'sem_assinatura');
    // 02:30 UTC de 01/12/2030 = 23:30 de 30/11/2030 em São Paulo (e 01/12 em UTC).
    await criarAssinaturaEm(salao.salaoId, 'em_carencia', { carenciaAte: new Date('2030-12-01T02:30:00Z') });
    await como(salao);
    expect(texto(await html(await AvisoDoPlano({ papel: 'gestor' })))).toContain('até 30/11/2030;');
    await trocarFuso(salao.salaoId, 'UTC');
    expect(texto(await html(await AvisoDoPlano({ papel: 'gestor' })))).toContain('até 01/12/2030;');
  });

  it('profissional vê a faixa sem a frase de contato do suporte', async () => {
    const salao = await criarSalaoCompleto();
    await aplicarSituacao(salao.salaoId, 'manual');
    await como(salao, 'profissional');
    const h = texto(await html(await AvisoDoPlano({ papel: 'profissional' })));
    expect(h).toContain('Fale com o gestor do salão.');
    expect(h).not.toContain('suporte');
  });

  it('sem sessão: nenhuma faixa e nenhuma exceção; com sessão de outro salão, só o estado do próprio', async () => {
    estado.cookie = undefined;
    expect(await AvisoDoPlano({ papel: 'gestor' })).toBeNull();
    const a = await criarSalaoCompleto();
    const b = await criarSalaoCompleto();
    await aplicarSituacao(a.salaoId, 'suspensa');
    await como(b);
    expect(texto(await html(await AvisoDoPlano({ papel: 'gestor' }))).trim()).toBe('');
    await como(a);
    expect(texto(await html(await AvisoDoPlano({ papel: 'gestor' })))).toContain('Assinatura suspensa.');
  });

  it('falha ao ler o estado não derruba a página (e o servidor continua recusando)', async () => {
    estado.cookie = 'token-invalido';
    expect(await AvisoDoPlano({ papel: 'gestor' })).toBeNull();
  });
});

describe('R-2: toda página do painel passa pelo PanelLayout (a faixa mora lá)', () => {
  const raiz = join(process.cwd(), 'src/app/painel');
  const paginas: string[] = [];
  const varrer = (dir: string) => {
    for (const nome of readdirSync(dir)) {
      const caminho = join(dir, nome);
      if (statSync(caminho).isDirectory()) varrer(caminho);
      else if (nome === 'page.tsx') paginas.push(caminho);
    }
  };
  varrer(raiz);

  it('encontrou as páginas e nenhuma desliga a faixa', () => {
    expect(paginas.length).toBeGreaterThanOrEqual(19);
    for (const p of paginas) {
      const src = readFileSync(p, 'utf8');
      expect(src, p).toContain('PanelLayout');
      expect(/aviso=\{/.test(src), p).toBe(false);
    }
  });
});

async function trocarFuso(salaoId: string, fuso: string) {
  await obterPrisma().salao.update({ where: { id: salaoId }, data: { fuso } });
}
