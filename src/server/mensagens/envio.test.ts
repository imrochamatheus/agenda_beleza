import { describe, expect, it, vi } from 'vitest';

import { ErroEnvioPermanente, ErroEnvioTemporario, validarEnvioModelo } from '@/server/integrations/whatsapp/port';
import type { EnvioModelo, PortaWhatsApp } from '@/server/integrations/whatsapp/port';
import { NaoImplementado } from '@/server/integrations/nao-implementado';
import type { RepoMensagemSistema } from '@/server/repos/mensagem-sistema';
import type { ConclusaoEnvio, ContextoDeEnvio, ResultadoInicio } from '@/server/repos/tipos';

import { decidirNoEnvio, enviarMensagem } from './envio';
import type { CamposDeLog, DependenciasEnvio } from './envio';

const ID = '6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4';
const SALAO = '0b0c5f6e-4a7d-4f0a-9a43-1f7f3c1e2d10';
const RESERVA = '5d2a9b1c-3e4f-4a5b-8c6d-7e8f9a0b1c2d';
const TEL = '+5511987654321';
const AGORA = new Date('2026-11-21T12:00:00Z');
const LINK = 'https://app.exemplo/avaliar/SEGREDO-do-link-123';

const contexto = (o: Partial<ContextoDeEnvio> = {}): ContextoDeEnvio => ({
  tipo: 'confirmacao',
  mensagemRevisao: 0,
  reservaId: RESERVA,
  reserva: { revisao: 0, status: 'confirmado' },
  itens: [
    { inicio: new Date('2026-11-25T13:00:00Z'), fim: new Date('2026-11-25T13:30:00Z'), status: 'confirmado', revisao: 0, servicoNome: 'Corte', profissionalNome: 'Marina' },
    { inicio: new Date('2026-11-25T13:30:00Z'), fim: new Date('2026-11-25T14:00:00Z'), status: 'confirmado', revisao: 0, servicoNome: 'Escova', profissionalNome: 'Bia' },
  ],
  salaoNome: 'Studio Terra',
  fuso: 'America/Sao_Paulo',
  clienteAnonimizada: false,
  telefone: TEL,
  consentimentoMensagens: true,
  consentimentoConvite: true,
  ...o,
});

function montar(opcoes: {
  inicio?: ResultadoInicio;
  tipo?: 'confirmacao' | 'convite_avaliacao';
  porta?: PortaWhatsApp['enviarModelo'];
  gerarLink?: DependenciasEnvio['gerarLink'];
  localizar?: Awaited<ReturnType<RepoMensagemSistema['localizar']>>;
  concluir?: boolean;
}) {
  const tipo = opcoes.tipo ?? 'confirmacao';
  const concluidos: ConclusaoEnvio[] = [];
  const envios: EnvioModelo[] = [];
  const logs: { evento: string; campos: CamposDeLog }[] = [];
  const sistema = {
    localizar: vi.fn(async () => (opcoes.localizar === undefined ? { salaoId: SALAO, estado: 'pendente' as const } : opcoes.localizar)),
    iniciarEnvio: vi.fn(async (): Promise<ResultadoInicio> =>
      opcoes.inicio ?? { resultado: 'enviar', tentativaId: 't1', numero: 1, destinatarioE164: TEL, tipo, revisao: 0, reservaId: RESERVA, contexto: contexto({ tipo }) }),
    concluirEnvio: vi.fn(async (_s: string, _i: string, _t: string, r: ConclusaoEnvio) => {
      concluidos.push(r);
      return opcoes.concluir ?? true;
    }),
    listarPendentesAntigas: vi.fn(),
    expirarEnviandoPresas: vi.fn(),
  } as unknown as RepoMensagemSistema;
  const porta: PortaWhatsApp = {
    enviarModelo:
      opcoes.porta ??
      (async (e) => {
        envios.push(e);
        return { provedorMensagemId: 'wamid.1' };
      }),
  };
  const deps: DependenciasEnvio = {
    whatsapp: () => porta,
    gerarLink: opcoes.gerarLink,
    agora: () => AGORA,
    sistema,
    log: (evento, campos) => logs.push({ evento, campos }),
  };
  return { deps, sistema, concluidos, envios, logs };
}

const tent = (atual: number, maxima = 5) => ({ atual, maxima });

describe('enviarMensagem: caminhos sem envio', () => {
  it('mensagem inexistente → concluida, log mensagem.nao_encontrada, sem reivindicar', async () => {
    const m = montar({ localizar: null });
    expect(await enviarMensagem(ID, tent(1), m.deps)).toBe('concluida');
    expect(m.logs).toEqual([{ evento: 'mensagem.nao_encontrada', campos: { mensagemId: ID } }]);
    expect(m.sistema.iniciarEnvio).not.toHaveBeenCalled();
  });

  it('não reivindicada → concluida sem chamar o adaptador', async () => {
    const m = montar({ inicio: { resultado: 'nao_reivindicada' }, localizar: { salaoId: SALAO, estado: 'enviada' } });
    expect(await enviarMensagem(ID, tent(1), m.deps)).toBe('concluida');
    expect(m.logs).toEqual([{ evento: 'mensagem.nao_reivindicada', campos: { mensagemId: ID, estado: 'enviada' } }]);
    expect(m.envios).toEqual([]);
  });

  it('terminal → concluida, log com estado e código, sem adaptador', async () => {
    const m = montar({ inicio: { resultado: 'terminal', estado: 'nao_enviada', erroCodigo: 'sem_consentimento', tipo: 'confirmacao', revisao: 0 } });
    expect(await enviarMensagem(ID, tent(1), m.deps)).toBe('concluida');
    expect(m.logs[0]).toEqual({ evento: 'mensagem.encerrada', campos: { mensagemId: ID, tipo: 'confirmacao', revisao: 0, estado: 'nao_enviada', erroCodigo: 'sem_consentimento' } });
    expect(m.envios).toEqual([]);
  });

  it('o salão do contexto é o da linha e o relógio injetado é usado', async () => {
    const m = montar({});
    await enviarMensagem(ID, tent(1), m.deps);
    expect(m.sistema.iniciarEnvio).toHaveBeenCalledWith(SALAO, ID, AGORA, decidirNoEnvio);
    expect(m.sistema.concluirEnvio).toHaveBeenCalledWith(SALAO, ID, 't1', expect.anything(), AGORA);
  });
});

describe('enviarMensagem: sucesso (CA-1)', () => {
  it('envia com chave reserva:tipo:revisao e parâmetros do contexto, e fecha como sucesso', async () => {
    const m = montar({});
    expect(await enviarMensagem(ID, tent(1), m.deps)).toBe('concluida');
    expect(m.envios).toEqual([
      {
        destinatarioE164: TEL,
        modelo: 'confirmacao',
        chaveIdempotencia: `${RESERVA}:confirmacao:0`,
        parametros: { salao: 'Studio Terra', data: '25/11/2026', itens: '10:00 Corte com Marina; 10:30 Escova com Bia' },
      },
    ]);
    expect(m.concluidos).toEqual([{ resultado: 'sucesso', provedorMensagemId: 'wamid.1' }]);
    expect(m.logs).toEqual([{ evento: 'mensagem.enviada', campos: { mensagemId: ID, tipo: 'confirmacao', revisao: 0, tentativa: 1, estado: 'enviada' } }]);
  });

  it('sucesso sem escrita (linha mudou de estado) → fechamento_ignorado', async () => {
    const m = montar({ concluir: false });
    expect(await enviarMensagem(ID, tent(1), m.deps)).toBe('concluida');
    expect(m.logs[0].evento).toBe('mensagem.fechamento_ignorado');
  });
});

describe('enviarMensagem: falhas (A-6; CA-2, CA-3, CA-17)', () => {
  const falhando = (erro: unknown) => async () => {
    throw erro;
  };

  it('temporária com retentativas restantes → pendente e reagendar', async () => {
    const m = montar({ porta: falhando(new ErroEnvioTemporario('limite_de_taxa')) });
    expect(await enviarMensagem(ID, tent(2, 5), m.deps)).toBe('reagendar');
    expect(m.concluidos).toEqual([{ resultado: 'falha', estadoFinal: 'pendente', erroCodigo: 'limite_de_taxa', erroDetalhe: 'falha temporária' }]);
    expect(m.logs[0]).toEqual({ evento: 'mensagem.tentativa_falhou', campos: { mensagemId: ID, tipo: 'confirmacao', revisao: 0, tentativa: 1, estado: 'pendente', erroCodigo: 'limite_de_taxa' } });
  });

  it('temporária na última tentativa → falhou e concluida', async () => {
    const m = montar({ porta: falhando(new ErroEnvioTemporario('limite_de_taxa')) });
    expect(await enviarMensagem(ID, tent(5, 5), m.deps)).toBe('concluida');
    expect(m.concluidos).toEqual([{ resultado: 'falha', estadoFinal: 'falhou', erroCodigo: 'limite_de_taxa', erroDetalhe: 'falha temporária' }]);
  });

  it('permanente → falhou imediatamente, mesmo na primeira tentativa', async () => {
    const m = montar({ porta: falhando(new ErroEnvioPermanente('numero_invalido')) });
    expect(await enviarMensagem(ID, tent(1, 5), m.deps)).toBe('concluida');
    expect(m.concluidos).toEqual([{ resultado: 'falha', estadoFinal: 'falhou', erroCodigo: 'numero_invalido', erroDetalhe: 'falha permanente' }]);
  });

  it.each([
    ['erro desconhecido', new Error(`falha com ${TEL} e Cliente Ana`)],
    ['NaoImplementado', new NaoImplementado('E7.2')],
    ['valor lançado que não é Error', 'texto'],
  ])('%s → temporária com erro_desconhecido, sem ecoar a mensagem', async (_n, erro) => {
    const m = montar({ porta: falhando(erro) });
    expect(await enviarMensagem(ID, tent(1), m.deps)).toBe('reagendar');
    expect(m.concluidos).toEqual([{ resultado: 'falha', estadoFinal: 'pendente', erroCodigo: 'erro_desconhecido', erroDetalhe: 'falha temporária' }]);
    expect(JSON.stringify([m.logs, m.concluidos])).not.toContain(TEL);
  });

  it.each(['Com Espaço', '', 'x'.repeat(41), "a'b", 'ÀÉ'])('código fora do conjunto fechado (%j) → erro_desconhecido', async (codigo) => {
    const m = montar({ porta: falhando(new ErroEnvioPermanente(codigo)) });
    await enviarMensagem(ID, tent(1), m.deps);
    expect(m.concluidos[0]).toMatchObject({ erroCodigo: 'erro_desconhecido' });
  });

  it('entrada inválida da porta (telefone fora do padrão) é permanente (CA-17)', async () => {
    const m = montar({
      inicio: { resultado: 'enviar', tentativaId: 't1', numero: 1, destinatarioE164: '+12025550123', tipo: 'confirmacao', revisao: 0, reservaId: RESERVA, contexto: contexto() },
      porta: async (e) => {
        const erro = validarEnvioModelo(e);
        if (erro) throw erro;
        return { provedorMensagemId: 'x' };
      },
    });
    expect(await enviarMensagem(ID, tent(1), m.deps)).toBe('concluida');
    expect(m.concluidos).toEqual([{ resultado: 'falha', estadoFinal: 'falhou', erroCodigo: 'destinatario_invalido', erroDetalhe: 'falha permanente' }]);
  });

  it('falha sem escrita no fechamento → fechamento_ignorado e concluida', async () => {
    const m = montar({ porta: falhando(new ErroEnvioTemporario('x')), concluir: false });
    expect(await enviarMensagem(ID, tent(1), m.deps)).toBe('concluida');
    expect(m.logs[0].evento).toBe('mensagem.fechamento_ignorado');
  });

  it('falha ao fechar a tentativa (banco) propaga: o job é reentregue e não reenvia', async () => {
    const m = montar({});
    (m.sistema.concluirEnvio as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('banco fora'));
    await expect(enviarMensagem(ID, tent(1), m.deps)).rejects.toThrow('banco fora');
    expect(m.envios).toHaveLength(1);
  });
});

describe('enviarMensagem: convite_avaliacao e o link (RN-14, CA-11)', () => {
  it('gera o link no envio, entrega como parâmetro e nunca o registra', async () => {
    const gerar = vi.fn(async () => LINK);
    const m = montar({ tipo: 'convite_avaliacao', gerarLink: gerar });
    expect(await enviarMensagem(ID, tent(1), m.deps)).toBe('concluida');
    expect(gerar).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'sistema', salaoId: SALAO, origem: 'worker-mensagens' }), RESERVA);
    expect(m.envios[0]).toMatchObject({ modelo: 'convite_avaliacao', chaveIdempotencia: `${RESERVA}:convite_avaliacao:0`, parametros: { salao: 'Studio Terra', link: LINK } });
    expect(JSON.stringify([m.logs, m.concluidos, m.sistema.concluirEnvio])).not.toContain('SEGREDO');
  });

  it('sem gerador → falha permanente link_indisponivel, sem chamar o adaptador', async () => {
    const m = montar({ tipo: 'convite_avaliacao' });
    expect(await enviarMensagem(ID, tent(1), m.deps)).toBe('concluida');
    expect(m.envios).toEqual([]);
    expect(m.concluidos).toEqual([{ resultado: 'falha', estadoFinal: 'falhou', erroCodigo: 'link_indisponivel', erroDetalhe: 'falha permanente' }]);
  });

  it.each([
    ['lança com o link na mensagem', async () => { throw new Error(`falha ${LINK}`); }],
    ['devolve vazio', async () => '  '],
    ['devolve não texto', async () => 42 as unknown as string],
  ])('gerador que %s → link_indisponivel sem vazar o link', async (_n, gerar) => {
    const m = montar({ tipo: 'convite_avaliacao', gerarLink: gerar });
    await enviarMensagem(ID, tent(1), m.deps);
    expect(m.envios).toEqual([]);
    expect(m.concluidos[0]).toMatchObject({ erroCodigo: 'link_indisponivel', estadoFinal: 'falhou' });
    expect(JSON.stringify([m.logs, m.concluidos])).not.toContain('SEGREDO');
  });

  it('falha do adaptador no convite não registra o link', async () => {
    const m = montar({ tipo: 'convite_avaliacao', gerarLink: async () => LINK, porta: async () => { throw new Error(`erro ${LINK}`); } });
    await enviarMensagem(ID, tent(1), m.deps);
    expect(JSON.stringify([m.logs, m.concluidos])).not.toContain('SEGREDO');
  });
});

describe('decidirNoEnvio (RN-8, RN-12, RN-16)', () => {
  it('vigente e consentida → enviar', () => {
    expect(decidirNoEnvio(contexto())).toEqual({ acao: 'enviar' });
  });

  it('anonimizada vence a vigência e o consentimento', () => {
    expect(decidirNoEnvio(contexto({ clienteAnonimizada: true, telefone: null, consentimentoMensagens: false, reserva: { revisao: 9, status: 'cancelado' } }))).toEqual({
      acao: 'terminal', estado: 'cancelada_anonimizacao', erroCodigo: null,
    });
  });

  it('obsoleta vence a falta de consentimento', () => {
    expect(decidirNoEnvio(contexto({ tipo: 'remarcacao', consentimentoMensagens: false, mensagemRevisao: 1 }))).toEqual({
      acao: 'terminal', estado: 'substituida', erroCodigo: 'obsoleta',
    });
  });

  it('sem consentimento → nao_enviada', () => {
    expect(decidirNoEnvio(contexto({ consentimentoMensagens: false }))).toEqual({ acao: 'terminal', estado: 'nao_enviada', erroCodigo: 'sem_consentimento' });
  });

  it('convite exige a finalidade do convite e reserva concluída', () => {
    const c = { tipo: 'convite_avaliacao' as const, reserva: { revisao: 0, status: 'concluido' as const } };
    expect(decidirNoEnvio(contexto(c))).toEqual({ acao: 'enviar' });
    expect(decidirNoEnvio(contexto({ ...c, consentimentoConvite: false }))).toMatchObject({ estado: 'nao_enviada' });
    expect(decidirNoEnvio(contexto({ ...c, reserva: { ...c.reserva, status: 'confirmado' } }))).toMatchObject({ estado: 'substituida' });
  });
});
