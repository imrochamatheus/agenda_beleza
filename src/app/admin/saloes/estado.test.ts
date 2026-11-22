import { describe, expect, it } from 'vitest';

import type { DetalheSalao } from '@/server/admin/saloes-tipos';

import {
  alertaDoUltimo, dataEHora, estadoEdicaoInicial, estadoExtensaoInicial, estadoSuspensaoInicial, hrefDaLista, idDoCampo, lerEdicao, lerExtensao, lerSuspensao, valoresDoDetalhe,
} from './estado';
import type { EstadoEdicao, EstadoExtensao, EstadoSuspensao } from './estado';

const DETALHE: DetalheSalao = {
  id: 'x', nome: 'Studio', slug: 'studio', fuso: 'America/Sao_Paulo', gradeMin: 15, antecedenciaMin: 180, janelaDias: 60, intervaloMin: 5,
  suspensoEm: null, gestor: { nome: 'Ana', email: 'ana@exemplo.com.br', confirmado: true }, assinatura: null,
};

const FUSO = 'America/Sao_Paulo';
const vazio = () => ({ edicao: estadoEdicaoInicial(valoresDoDetalhe(DETALHE)), suspender: estadoSuspensaoInicial(), reativar: estadoSuspensaoInicial(), estender: estadoExtensaoInicial() });

describe('valores e leitura de formulário', () => {
  it('valoresDoDetalhe: antecedência em horas, gestor ausente vira vazio', () => {
    expect(valoresDoDetalhe(DETALHE)).toMatchObject({ grade: '15', antecedencia: '3', janela: '60', intervalo: '5', gestorEmail: 'ana@exemplo.com.br' });
    expect(valoresDoDetalhe({ ...DETALHE, gestor: null })).toMatchObject({ gestorNome: '', gestorEmail: '' });
  });

  it('lerEdicao: só campos conhecidos; extras e arquivos ignorados; eco cortado em 200', () => {
    const fd = new FormData();
    fd.set('salaoId', 'abc');
    fd.set('nome', 'x'.repeat(300));
    fd.set('senha', 'nunca');
    fd.set('slug', new File(['conteudo'], 'a.txt'));
    const { entrada, valores } = lerEdicao(fd);
    expect(entrada.salaoId).toBe('abc');
    expect(entrada.nome).toHaveLength(300);
    expect(valores.nome).toHaveLength(200);
    expect(entrada.slug).toBe('');
    expect(Object.keys(entrada)).not.toContain('senha');
    expect(entrada.gestorEmail).toBe('');
  });

  it('lerSuspensao e lerExtensao', () => {
    const fd = new FormData();
    fd.set('salaoId', 'abc');
    fd.set('motivo', 'm'.repeat(250));
    fd.set('etapa', 'confirmar');
    fd.set('dias', '10');
    fd.set('testeFimEmEsperado', '2030-01-01T00:00:00.000Z');
    expect(lerSuspensao(fd)).toEqual({ entrada: { salaoId: 'abc', motivo: 'm'.repeat(250), etapa: 'confirmar' }, motivo: 'm'.repeat(200) });
    expect(lerExtensao(fd)).toEqual({ entrada: { salaoId: 'abc', dias: '10', testeFimEmEsperado: '2030-01-01T00:00:00.000Z', etapa: 'confirmar' }, dias: '10' });
    expect(lerExtensao(new FormData()).entrada).toEqual({ salaoId: '', dias: '', testeFimEmEsperado: '', etapa: '' });
  });

  it('idDoCampo e hrefDaLista (só o que difere do padrão entra)', () => {
    expect(idDoCampo('gestorEmail')).toBe('salao-gestorEmail');
    expect(hrefDaLista('/admin/saloes', { q: '', estado: null, suspenso: 'todas' }, 1)).toBe('/admin/saloes');
    expect(hrefDaLista('/admin/saloes', { q: 'ana lima', estado: 'em_teste', suspenso: 'sim' }, 3)).toBe('/admin/saloes?q=ana+lima&estado=em_teste&suspenso=sim&pagina=3');
  });
});

describe('dataEHora', () => {
  it('data e hora no fuso do salão, não do processo', () => {
    expect(dataEHora('2026-11-30T17:00:00.000Z', 'America/Sao_Paulo')).toBe('30/11/2026 às 14:00');
    expect(dataEHora('2026-11-30T17:00:00.000Z', 'America/Manaus')).toBe('30/11/2026 às 13:00');
    expect(dataEHora('2026-12-01T01:30:00.000Z', 'America/Sao_Paulo')).toBe('30/11/2026 às 22:30');
  });
});

describe('alertaDoUltimo', () => {
  it('nada a mostrar no estado inicial, nas etapas 2 e nos erros de campo', () => {
    expect(alertaDoUltimo(vazio(), FUSO)).toBeNull();
    const e = vazio();
    e.suspender = { ...e.suspender, em: 5, resultado: { resultado: 'previa', motivo: 'm' } };
    e.estender = { ...e.estender, em: 6, resultado: { resultado: 'previa', de: '2030-01-01T00:00:00.000Z', para: '2030-01-11T00:00:00.000Z', dias: 10 } };
    e.edicao = { ...e.edicao, em: 7, resultado: { resultado: 'invalido', erros: { nome: 'x' } } };
    e.reativar = { ...e.reativar, em: 8, resultado: { resultado: 'invalido', erros: { motivo: 'x' } } };
    expect(alertaDoUltimo(e, FUSO)).toBeNull();
  });

  it('textos de cada resultado', () => {
    const com = (parte: Partial<ReturnType<typeof vazio>>) => alertaDoUltimo({ ...vazio(), ...parte }, FUSO);
    const ed = (resultado: EstadoEdicao['resultado']): EstadoEdicao => ({ ...estadoEdicaoInicial(valoresDoDetalhe(DETALHE)), em: 1, resultado });
    const su = (resultado: EstadoSuspensao['resultado']): EstadoSuspensao => ({ ...estadoSuspensaoInicial(), em: 1, resultado });
    const ex = (resultado: EstadoExtensao['resultado']): EstadoExtensao => ({ ...estadoExtensaoInicial(), em: 1, resultado });
    expect(com({ edicao: ed({ resultado: 'editado' }) })).toEqual({ variante: 'sucesso', texto: 'Dados do salão salvos.' });
    expect(com({ edicao: ed({ resultado: 'editado', confirmacao: 'enviado' }) })?.texto).toContain('link de confirmação foi enviado');
    expect(com({ edicao: ed({ resultado: 'editado', confirmacao: 'falhou' }) })?.texto).toContain('Não foi possível enviar');
    expect(com({ edicao: ed({ resultado: 'sem_mudanca' }) })).toEqual({ variante: 'info', texto: 'Nada mudou: os valores são os mesmos.' });
    expect(com({ suspender: su({ resultado: 'suspenso' }) })).toEqual({ variante: 'sucesso', texto: 'Salão suspenso.' });
    expect(com({ suspender: su({ resultado: 'sem_efeito' }) })?.texto).toBe('O salão já estava suspenso. Nada foi alterado.');
    expect(com({ reativar: su({ resultado: 'reativado' }) })).toEqual({ variante: 'sucesso', texto: 'Salão reativado.' });
    expect(com({ reativar: su({ resultado: 'sem_efeito' }) })?.texto).toBe('O salão não estava suspenso. Nada foi alterado.');
    expect(com({ estender: ex({ resultado: 'estendido', de: '2026-11-30T17:00:00.000Z', para: '2026-12-10T17:00:00.000Z', dias: 10 }) })).toEqual({
      variante: 'sucesso', texto: 'Teste estendido até 10/12/2026 às 14:00.',
    });
    expect(com({ estender: ex({ resultado: 'provedor_falhou' }) })).toMatchObject({ variante: 'erro', texto: expect.stringContaining('O provedor não refletiu o adiamento') });
    expect(com({ estender: ex({ resultado: 'divergencia' }) })).toMatchObject({ variante: 'erro', texto: expect.stringContaining('Nada foi gravado') });
    expect(com({ estender: ex({ resultado: 'mudou', novoFim: '2026-12-12T17:00:00.000Z' }) })).toEqual({
      variante: 'aviso', texto: 'A assinatura mudou enquanto você decidia. O fim do teste agora é 12/12/2026 às 14:00. Confira e tente de novo.',
    });
    expect(com({ estender: ex({ resultado: 'mudou', novoFim: null }) })?.texto).toBe('A assinatura mudou enquanto você decidia. Confira e tente de novo.');
    // A recusa fica no lugar do campo, não no topo.
    expect(com({ estender: ex({ resultado: 'recusado', motivo: 'estado' }) })).toBeNull();
    expect(com({ estender: { ...estadoExtensaoInicial(), mensagem: 'Acesso negado.' } })).toEqual({ variante: 'erro', texto: 'Acesso negado.' });
  });

  it('com vários resultados, vale o mais recente (maior em)', () => {
    const e = vazio();
    e.suspender = { ...e.suspender, em: 10, resultado: { resultado: 'suspenso' } };
    e.reativar = { ...e.reativar, em: 20, resultado: { resultado: 'reativado' } };
    expect(alertaDoUltimo(e, FUSO)?.texto).toBe('Salão reativado.');
    e.suspender = { ...e.suspender, em: 30 };
    expect(alertaDoUltimo(e, FUSO)?.texto).toBe('Salão suspenso.');
  });
});
