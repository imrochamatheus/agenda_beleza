import type pg from 'pg';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import PaginaPublicaDoSalao from '@/app/(publico)/[slug]/page';
import { lerAvaliacoesPublicas } from '@/server/avaliacoes/leitura';
import { verificarLink } from '@/server/avaliacoes/servico';
import { denunciarAvaliacao } from '@/server/denuncias/denunciar';
import { retirarAvaliacao } from '@/server/denuncias/denuncias.acao';
import { entrar } from '@/server/auth/login';
import { MENSAGENS_LOGIN } from '@/server/auth/login';

import { contarAuditoria } from '../../support/auditoria';
import { criarSuperAdmin } from '../../support/auth';
import { AGORA, criarAvaliacao, entradaDenuncia, linhaDaAvaliacao } from '../../support/denuncias';
import { SENHA_DE_TESTE } from '../../support/factories';
import { aplicarSituacao } from '../../support/politica';
import type { SituacaoDeTeste } from '../../support/politica';
import { ipNovo } from '../../support/reserva-publica';
import { conectar } from '../../support/sql';
import { inserirFoto } from '../fotos/apoio';
import { criarAvaliavel, ctxPublico, emitirLink, enviar, salaoNovo, AGORA as AGORA_AVAL } from '../avaliacoes/apoio';

// D-038 CA-R1, CA-9, RN-9: com o salão somente leitura a página pública segue mostrando perfil, fotos e
// avaliações (200, sem formulário); avaliação por link, denúncia pública, login e a moderação do super admin
// continuam funcionando. Banco real.

vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-for': '192.0.2.77' }) }));

let c: pg.Client;
beforeAll(async () => {
  c = await conectar();
});
afterAll(async () => {
  await c.end();
});
beforeEach(() => {
  vi.stubEnv('TRUSTED_PROXY_HOPS', '1');
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const SITUACOES: SituacaoDeTeste[] = ['suspensa', 'encerrada', 'manual', 'pendente'];

describe.each(SITUACOES)('página pública com o salão %s (CA-R1)', (situacao) => {
  it('200 com perfil, foto e avaliações; aviso e nenhum formulário de reserva', async () => {
    const s = await salaoNovo();
    await c.query("UPDATE salao SET nome = 'Studio Bela', descricao = 'Cuidado com carinho.' WHERE id = $1", [s.salaoId]);
    await inserirFoto(c, s.salaoId, { alt: 'Recepção do salão' });
    await criarAvaliacao(c, s, { nota: 5, comentario: 'Ótimo atendimento' });
    await aplicarSituacao(s.salaoId, situacao);
    const h = renderToStaticMarkup(await PaginaPublicaDoSalao({ params: Promise.resolve({ slug: s.slugAtual }), searchParams: Promise.resolve({}) }));
    expect(h).toContain('Agendamento indisponível');
    expect(h).toContain('Studio Bela');
    expect(h).toContain('alt="Recepção do salão"');
    expect(h).toContain('Ótimo atendimento');
    // Só o formulário de denúncia (RN-8) existe; nada da reserva (telefone, serviços, horários, confirmar).
    expect(h).not.toContain('name="telefone"');
    expect(h).not.toContain('name="nome"');
    expect(h).not.toContain('name="inicio"');
    expect(h).not.toMatch(/Confirmar reserva|Escolha o horário/);
    expect([...h.matchAll(/<form/g)]).toHaveLength(1);
    expect(h).toContain('name="avaliacao_id"');
  });
});

describe('o que segue funcionando com o salão suspenso (CA-9, RN-8)', () => {
  it('envio de avaliação por link', async () => {
    const s = await salaoNovo();
    const k = await criarAvaliavel(c, s, { nome: 'Maria da Silva Souza' });
    const { token } = await emitirLink(s, k.reservaId);
    await aplicarSituacao(s.salaoId, 'suspensa');
    expect(await verificarLink(s.slugAtual, token, ipNovo(), AGORA_AVAL)).toMatchObject({ ok: true });
    expect(await enviar(s, token, { nota: '4', comentario: 'Muito bom' }, AGORA_AVAL)).toEqual({ resultado: 'enviada' });
    expect((await lerAvaliacoesPublicas(ctxPublico(s))).total).toBe(1);
  });

  it('denúncia pública', async () => {
    const s = await salaoNovo();
    const { avaliacaoId } = await criarAvaliacao(c, s);
    await aplicarSituacao(s.salaoId, 'manual');
    expect(await denunciarAvaliacao(ctxPublico(s), entradaDenuncia(avaliacaoId, { ip: ipNovo() }), AGORA)).toEqual({ resultado: 'recebida' });
  });

  it('login do gestor de salão suspenso', async () => {
    const s = await salaoNovo();
    await aplicarSituacao(s.salaoId, 'suspensa');
    const r = await entrar({ email: s.gestor.email, senha: SENHA_DE_TESTE }, { log: () => {} });
    expect(r.ok).toBe(true);
    const errada = await entrar({ email: s.gestor.email, senha: 'outra senha qualquer' }, { log: () => {} });
    expect(errada.ok).toBe(false);
    expect(MENSAGENS_LOGIN).toBeDefined();
  });

  it('RN-9: o super admin modera avaliação de salão suspenso, com auditoria', async () => {
    const s = await salaoNovo();
    const { avaliacaoId } = await criarAvaliacao(c, s);
    await aplicarSituacao(s.salaoId, 'suspensa');
    const adm = await criarSuperAdmin({ totpVerificado: true });
    const antes = await contarAuditoria(c);
    const r = await retirarAvaliacao.executar({ admin: adm.credencial, salao: null }, { avaliacaoId, motivo: 'Conteúdo ofensivo' });
    expect(r).toEqual({ ok: true, dados: { resultado: 'ok' } });
    expect((await linhaDaAvaliacao(c, avaliacaoId)).retirada_em).not.toBeNull();
    expect(await contarAuditoria(c)).toBe(antes + 1);
  });
});
