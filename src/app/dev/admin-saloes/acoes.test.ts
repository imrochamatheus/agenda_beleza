import { afterEach, describe, expect, it, vi } from 'vitest';

import { estadoEdicaoInicial, estadoExtensaoInicial, estadoSuspensaoInicial, valoresDoDetalhe } from '@/app/admin/saloes/estado';

import { demonstrarEdicaoAcao, demonstrarExtensaoAcao, demonstrarReativacaoAcao, demonstrarSuspensaoAcao } from './acoes';
import { detalheDeDemonstracao } from './demonstracao';

afterEach(() => vi.unstubAllEnvs());
const form = (c: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(c)) f.set(k, v);
  return f;
};
const ligada = () => vi.stubEnv('VITRINE_COMPONENTES', 'true');
const base = valoresDoDetalhe(detalheDeDemonstracao('detalhe'));
const edicao = (m: Record<string, string> = {}) => form({ salaoId: 'x', ...base, ...m });

describe('ações de demonstração dos salões', () => {
  it('desligada a vitrine, devolvem o estado anterior sem processar', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITRINE_COMPONENTES', 'false');
    const e = estadoEdicaoInicial(base);
    expect(await demonstrarEdicaoAcao(e, edicao({ nome: 'A' }))).toBe(e);
    const s = estadoSuspensaoInicial();
    expect(await demonstrarSuspensaoAcao(s, form({ motivo: 'valido ok', etapa: 'confirmar' }))).toBe(s);
    expect(await demonstrarReativacaoAcao(s, form({}))).toBe(s);
    const x = estadoExtensaoInicial();
    expect(await demonstrarExtensaoAcao(x, form({ dias: '5' }))).toBe(x);
  });

  it('edição: inválido, sem mudança, conflitos e sucesso', async () => {
    ligada();
    const e = estadoEdicaoInicial(base);
    expect((await demonstrarEdicaoAcao(e, edicao({ nome: 'A' }))).resultado).toMatchObject({ resultado: 'invalido' });
    expect((await demonstrarEdicaoAcao(e, edicao())).resultado).toEqual({ resultado: 'sem_mudanca' });
    expect((await demonstrarEdicaoAcao(e, edicao({ slug: 'ocupado' }))).resultado).toMatchObject({ resultado: 'conflito_slug' });
    expect((await demonstrarEdicaoAcao(e, edicao({ gestorEmail: 'ocupado@exemplo.com.br' }))).resultado).toMatchObject({ resultado: 'email_em_uso' });
    expect((await demonstrarEdicaoAcao(e, edicao({ nome: 'Novo nome' }))).resultado).toEqual({ resultado: 'editado' });
    expect((await demonstrarEdicaoAcao(e, edicao({ gestorEmail: 'outra@exemplo.com.br' }))).resultado).toEqual({ resultado: 'editado', confirmacao: 'enviado' });
  });

  it('suspensão e reativação', async () => {
    ligada();
    const s = estadoSuspensaoInicial();
    expect((await demonstrarSuspensaoAcao(s, form({ motivo: 'x', etapa: 'previa' }))).resultado).toMatchObject({ resultado: 'invalido' });
    expect((await demonstrarSuspensaoAcao(s, form({ motivo: 'Pedido ok', etapa: 'previa' }))).resultado).toEqual({ resultado: 'previa', motivo: 'Pedido ok' });
    expect((await demonstrarSuspensaoAcao(s, form({ motivo: 'Pedido ok', etapa: 'confirmar' }))).resultado).toEqual({ resultado: 'suspenso' });
    expect((await demonstrarReativacaoAcao(s, form({ motivo: 'oi' }))).resultado).toMatchObject({ resultado: 'invalido' });
    expect((await demonstrarReativacaoAcao(s, form({ motivo: '' }))).resultado).toEqual({ resultado: 'reativado' });
  });

  it('extensão: inválido, prévia e cada resultado do provedor', async () => {
    ligada();
    const x = estadoExtensaoInicial();
    const r = async (dias: string, etapa: string) => (await demonstrarExtensaoAcao(x, form({ dias, etapa }))).resultado;
    expect(await r('1e1', 'previa')).toMatchObject({ resultado: 'invalido' });
    expect(await r('10', 'previa')).toMatchObject({ resultado: 'previa', dias: 10, para: '2030-12-10T17:00:00.000Z' });
    expect(await r('10', 'confirmar')).toMatchObject({ resultado: 'estendido' });
    expect(await r('13', 'confirmar')).toEqual({ resultado: 'provedor_falhou' });
    expect(await r('14', 'confirmar')).toMatchObject({ resultado: 'mudou' });
    expect(await r('15', 'confirmar')).toEqual({ resultado: 'divergencia' });
  });

  it('vistas do detalhe', () => {
    expect(detalheDeDemonstracao('detalhe-suspenso').suspensoEm).not.toBeNull();
    expect(detalheDeDemonstracao('detalhe-sem-assinatura').assinatura).toBeNull();
    expect(detalheDeDemonstracao('detalhe-ativa').assinatura?.estado).toBe('ativa');
  });
});
