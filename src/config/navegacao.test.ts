import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// Valor importado só no teste: no código, navegacao.ts usa `import type` (D-16).
import { PAPEIS_DE_SALAO } from '@/server/tenant/context';

import {
  itemAtivo,
  itensDoPainel,
  NAVEGACAO_ADMIN,
  NAVEGACAO_PAINEL,
  ROTAS,
  SEGMENTOS_RESERVADOS,
  type ItemNavegacao,
} from './navegacao';

const semAcento = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

// RN-16: temas fora da v1 (minúsculas, sem acento).
const VETADOS = [
  'caixa',
  'estoque',
  'comiss',
  'relatorio',
  'financeir',
  'fidelidade',
  'pagamento',
  'app',
  'whatsapp',
  'lembrete',
  'promoc',
  'minha-conta',
  'conta-cliente',
  'gestores',
  'preco-por-profissional',
];

const rotasFixas = () =>
  Object.entries(ROTAS)
    .filter(([chave]) => chave !== 'avaliar') // começa pelo slug do salão (D-032)
    .map(([, r]) => r)
    .map((r) => (typeof r === 'function' ? (r as (x: string) => string)('x') : r))
    .filter((r) => typeof r === 'string');

describe('CA-11: navegação por papel', () => {
  const ordem = (itens: readonly ItemNavegacao[]) => itens.map((i) => [i.rotulo, i.href]);

  it('gestor: 7 itens na ordem da RN-16', () => {
    expect(ordem(NAVEGACAO_PAINEL.gestor)).toEqual([
      ['Agenda', '/painel/agenda'],
      ['Clientes', '/painel/clientes'],
      ['Serviços', '/painel/servicos'],
      ['Profissionais', '/painel/profissionais'],
      ['Bloqueios', '/painel/bloqueios'],
      ['Configurações', '/painel/configuracoes'],
      ['Assinatura', '/painel/assinatura'],
    ]);
  });

  it('profissional: só Agenda e Bloqueios', () => {
    expect(ordem(NAVEGACAO_PAINEL.profissional)).toEqual([
      ['Agenda', '/painel/agenda'],
      ['Bloqueios', '/painel/bloqueios'],
    ]);
  });

  it('super admin: Salões, Mensagens e Auditoria', () => {
    expect(ordem(NAVEGACAO_ADMIN)).toEqual([
      ['Salões', '/admin/saloes'],
      ['Mensagens', '/admin/mensagens'],
      ['Auditoria', '/admin/auditoria'],
    ]);
  });

  it('as chaves do painel são exatamente os papéis de salão (D-16)', () => {
    expect(Object.keys(NAVEGACAO_PAINEL).sort()).toEqual([...PAPEIS_DE_SALAO].sort());
  });

  it('todo href está em ROTAS, tem o prefixo do layout e não se repete', () => {
    const v1 = new Set(rotasFixas());
    const grupos: [readonly ItemNavegacao[], string][] = [
      [NAVEGACAO_PAINEL.gestor, '/painel/'],
      [NAVEGACAO_PAINEL.profissional, '/painel/'],
      [NAVEGACAO_ADMIN, '/admin/'],
    ];
    for (const [itens, prefixo] of grupos) {
      const hrefs = itens.map((i) => i.href);
      expect(new Set(hrefs).size).toBe(hrefs.length);
      for (const i of itens) {
        expect(v1.has(i.href), i.href).toBe(true);
        expect(i.href.startsWith(prefixo), i.href).toBe(true);
        expect(ROTAS[i.chave as keyof typeof ROTAS]).toBe(i.href);
      }
    }
  });

  it('nenhum href, rótulo ou chave contém termo fora da v1', () => {
    const textos = [
      ...Object.keys(ROTAS),
      ...rotasFixas(),
      ...[...NAVEGACAO_PAINEL.gestor, ...NAVEGACAO_PAINEL.profissional, ...NAVEGACAO_ADMIN].flatMap(
        (i) => [i.chave, i.rotulo, i.href],
      ),
    ].map(semAcento);
    for (const texto of textos) {
      for (const termo of VETADOS) expect(texto.includes(termo), `${texto} ∋ ${termo}`).toBe(false);
    }
  });

  it('itensDoPainel falha fechada para papel fora do tipo', () => {
    expect(itensDoPainel('gestor')).toBe(NAVEGACAO_PAINEL.gestor);
    expect(itensDoPainel('profissional')).toBe(NAVEGACAO_PAINEL.profissional);
    for (const invalido of ['super_admin', 'toString', '__proto__', undefined, null, 1, 'x' as never]) {
      expect(itensDoPainel(invalido)).toEqual([]);
    }
  });

  it('os itens são imutáveis', () => {
    expect(Object.isFrozen(NAVEGACAO_PAINEL.gestor)).toBe(true);
    expect(Object.isFrozen(NAVEGACAO_ADMIN[0])).toBe(true);
  });
});

describe('CA-12: rotas e segmentos reservados', () => {
  it('lista as rotas da RN-15', () => {
    expect(rotasFixas()).toEqual(
      expect.arrayContaining([
        '/',
        '/entrar',
        '/cadastro',
        '/confirmar-email',
        '/recuperar-senha',
        '/redefinir-senha',
        '/termos',
        '/privacidade',
        '/painel',
        '/painel/agenda',
        '/painel/agenda/nova',
        '/painel/clientes',
        '/painel/servicos',
        '/painel/servicos/novo',
        '/painel/profissionais',
        '/painel/profissionais/novo',
        '/painel/bloqueios',
        '/painel/configuracoes',
        '/painel/assinatura',
        '/painel/assinatura/retorno',
        '/admin',
        '/admin/entrar',
        '/admin/saloes',
        '/admin/mensagens',
        '/admin/auditoria',
        '/dev/componentes',
        '/dev/mp-checkout',
        '/dev/jornada',
        '/dev/bloqueios',
        '/dev/configuracoes',
        '/painel/configuracoes/perfil',
        '/painel/configuracoes/funcionamento',
        '/dev/perfil',
        '/dev/funcionamento',
      ]),
    );
  });

  it('rotas com parâmetro codificam o valor', () => {
    expect(ROTAS.convite('a b/c')).toBe('/convite/a%20b%2Fc');
    expect(ROTAS.jornada('a b/c')).toBe('/painel/profissionais/a%20b%2Fc/jornada');
    expect(ROTAS.profissional('a b/c')).toBe('/painel/profissionais/a%20b%2Fc');
    expect(ROTAS.profissional('../x?y#z')).toBe('/painel/profissionais/..%2Fx%3Fy%23z');
    // D-013: as páginas de profissional ativam o item "Profissionais" do gestor.
    expect(itemAtivo(NAVEGACAO_PAINEL.gestor, ROTAS.novoProfissional)).toBe(ROTAS.profissionais);
    expect(itemAtivo(NAVEGACAO_PAINEL.gestor, ROTAS.profissional('abc'))).toBe(ROTAS.profissionais);
    // D-014: rotas de serviço codificam o id e ativam o item "Serviços" do gestor.
    expect(ROTAS.novoServico).toBe('/painel/servicos/novo');
    expect(ROTAS.servico('a b/c')).toBe('/painel/servicos/a%20b%2Fc');
    expect(ROTAS.servico('../x?y#z')).toBe('/painel/servicos/..%2Fx%3Fy%23z');
    expect(itemAtivo(NAVEGACAO_PAINEL.gestor, ROTAS.novoServico)).toBe(ROTAS.servicos);
    expect(itemAtivo(NAVEGACAO_PAINEL.gestor, ROTAS.servico('abc'))).toBe(ROTAS.servicos);
    // D-015: a jornada ativa "Profissionais"; a demonstração fica sob o segmento reservado "dev".
    expect(itemAtivo(NAVEGACAO_PAINEL.gestor, ROTAS.jornada('abc'))).toBe(ROTAS.profissionais);
    expect(ROTAS.devJornada).toBe('/dev/jornada');
    // D-016: a edição de bloqueio codifica o id e ativa "Bloqueios" (gestor e profissional).
    expect(ROTAS.bloqueio('a b/c')).toBe('/painel/bloqueios/a%20b%2Fc');
    expect(itemAtivo(NAVEGACAO_PAINEL.gestor, ROTAS.bloqueio('abc'))).toBe(ROTAS.bloqueios);
    expect(itemAtivo(NAVEGACAO_PAINEL.profissional, ROTAS.bloqueio('abc'))).toBe(ROTAS.bloqueios);
    expect(ROTAS.devBloqueios).toBe('/dev/bloqueios');
    // D-022: o detalhe da cliente codifica o id e ativa "Clientes"; a demonstração fica sob "dev".
    expect(ROTAS.cliente('a b/c')).toBe('/painel/clientes/a%20b%2Fc');
    expect(ROTAS.excluirCliente('a b/c')).toBe('/painel/clientes/a%20b%2Fc/excluir');
    expect(itemAtivo(NAVEGACAO_PAINEL.gestor, ROTAS.cliente('abc'))).toBe(ROTAS.clientes);
    expect(ROTAS.devClientes).toBe('/dev/clientes');
    // D-023: a demonstração do consentimento fica sob "dev"; termos e privacidade já eram reservados.
    expect(ROTAS.devConsentimento).toBe('/dev/consentimento');
    // D-017: a demonstração das configurações fica sob o segmento reservado "dev" (SEGMENTOS_RESERVADOS não muda).
    expect(ROTAS.devConfiguracoes).toBe('/dev/configuracoes');
    expect(itemAtivo(NAVEGACAO_PAINEL.gestor, ROTAS.configuracoes)).toBe(ROTAS.configuracoes);
    // D-020 (CA-20): as subpáginas de perfil e funcionamento ativam "Configurações"; demonstrações sob "dev".
    expect(ROTAS.configuracoesPerfil).toBe('/painel/configuracoes/perfil');
    expect(ROTAS.configuracoesFuncionamento).toBe('/painel/configuracoes/funcionamento');
    expect(itemAtivo(NAVEGACAO_PAINEL.gestor, ROTAS.configuracoesPerfil)).toBe(ROTAS.configuracoes);
    expect(itemAtivo(NAVEGACAO_PAINEL.gestor, ROTAS.configuracoesFuncionamento)).toBe(ROTAS.configuracoes);
    expect(ROTAS.devPerfil).toBe('/dev/perfil');
    expect(ROTAS.devFuncionamento).toBe('/dev/funcionamento');
    // D-021 (CA-16): fotos do salão; a subpágina ativa "Configurações"; SEGMENTOS_RESERVADOS não muda.
    expect(ROTAS.configuracoesFotos).toBe('/painel/configuracoes/fotos');
    expect(ROTAS.envioFotos).toBe('/api/painel/fotos');
    expect(ROTAS.fotoPublica('a b/c')).toBe('/api/fotos/a%20b%2Fc');
    expect(ROTAS.devFotos).toBe('/dev/fotos');
    expect(ROTAS.devFotosEnvio).toBe('/dev/fotos/enviar');
    expect(itemAtivo(NAVEGACAO_PAINEL.gestor, ROTAS.configuracoesFotos)).toBe(ROTAS.configuracoes);
    expect(ROTAS.salaoPublico('a b/c')).toBe('/a%20b%2Fc');
    expect(ROTAS.adminSalao('a b/c')).toBe('/admin/saloes/a%20b%2Fc');
    expect(ROTAS.adminSalaoAssinatura('a b/c')).toBe('/admin/saloes/a%20b%2Fc/assinatura');
  });

  it('SEGMENTOS_RESERVADOS = 1º segmento de cada rota (sem /[slug]) + api + _next', () => {
    const esperado = new Set<string>(['api', '_next']);
    for (const [chave, rota] of Object.entries(ROTAS)) {
      if (chave === 'salaoPublico' || chave === 'avaliar') continue;
      const caminho = typeof rota === 'function' ? (rota as (x: string) => string)('x') : rota;
      const primeiro = caminho.split('/')[1];
      if (primeiro) esperado.add(primeiro);
    }
    expect([...SEGMENTOS_RESERVADOS].sort()).toEqual([...esperado].sort());
    expect([...SEGMENTOS_RESERVADOS].sort()).toEqual(
      [
        'entrar',
        'cadastro',
        'confirmar-email',
        'recuperar-senha',
        'redefinir-senha',
        'convite',
        'termos',
        'privacidade',
        'painel',
        'admin',
        'dev',
        'api',
        '_next',
      ].sort(),
    );
    expect(SEGMENTOS_RESERVADOS.has('x')).toBe(false);
    expect(SEGMENTOS_RESERVADOS.has('[slug]')).toBe(false);
    expect(SEGMENTOS_RESERVADOS.has('')).toBe(false);
  });

  it('toda pasta de primeiro nível de src/app (fora de (grupo), [dinâmica] e _privada) é reservada', () => {
    const pastas = readdirSync(fileURLToPath(new URL('../app/', import.meta.url)), {
      withFileTypes: true,
    })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((n) => !/^\(.*\)$/.test(n) && !/^\[.*\]$/.test(n) && !n.startsWith('_'));
    expect(pastas).toEqual(expect.arrayContaining(['api', 'dev']));
    for (const pasta of pastas) expect(SEGMENTOS_RESERVADOS.has(pasta), pasta).toBe(true);
  });
});

describe('RN-14: itemAtivo', () => {
  const itens = NAVEGACAO_PAINEL.gestor;

  it('caminho igual ao href', () => {
    expect(itemAtivo(itens, '/painel/agenda')).toBe('/painel/agenda');
  });

  it('prefixo por segmento', () => {
    expect(itemAtivo(itens, '/painel/agenda/nova')).toBe('/painel/agenda');
    expect(itemAtivo(itens, '/painel/profissionais/abc/jornada')).toBe('/painel/profissionais');
  });

  it('/painel/agendamento não ativa /painel/agenda', () => {
    expect(itemAtivo(itens, '/painel/agendamento')).toBeNull();
  });

  it('vence o prefixo mais longo', () => {
    const aninhados: ItemNavegacao[] = [
      { chave: 'agenda', rotulo: 'Agenda', href: '/painel/agenda' },
      { chave: 'novaReserva', rotulo: 'Nova', href: '/painel/agenda/nova' },
      { chave: 'painel', rotulo: 'Início', href: '/painel' },
    ];
    expect(itemAtivo(aninhados, '/painel/agenda/nova/x')).toBe('/painel/agenda/nova');
    expect(itemAtivo(aninhados, '/painel/agenda')).toBe('/painel/agenda');
    expect(itemAtivo(aninhados, '/painel/clientes')).toBe('/painel');
  });

  it('ignora barra final, ? e #', () => {
    expect(itemAtivo(itens, '/painel/agenda/')).toBe('/painel/agenda');
    expect(itemAtivo(itens, '/painel/agenda?dia=2026-03-10')).toBe('/painel/agenda');
    expect(itemAtivo(itens, '/painel/clientes#lista')).toBe('/painel/clientes');
  });

  it('a raiz só ativa um item de raiz', () => {
    const raiz: ItemNavegacao[] = [{ chave: 'inicio', rotulo: 'Início', href: '/' }];
    expect(itemAtivo(raiz, '/')).toBe('/');
    expect(itemAtivo(raiz, '/termos')).toBe('/');
    expect(itemAtivo(itens, '/')).toBeNull();
    expect(itemAtivo(itens, '//')).toBeNull();
  });

  it('null para caminho ausente, vazio ou fora da navegação', () => {
    expect(itemAtivo(itens, null)).toBeNull();
    expect(itemAtivo(itens, undefined)).toBeNull();
    expect(itemAtivo(itens, '')).toBeNull();
    expect(itemAtivo(itens, '/admin/saloes')).toBeNull();
    expect(itemAtivo([], '/painel/agenda')).toBeNull();
  });
});
