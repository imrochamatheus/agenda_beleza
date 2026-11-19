import { randomUUID } from 'node:crypto';

import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { criarEmailSimulado } from '@/server/integrations/email/simulado';
import { ErroValidacaoEmail } from '@/server/integrations/email/port';
import type { MensagemEmail } from '@/server/integrations/email/port';
import { criarPrisma } from '@/server/repos/db';
import { repoEmailLog } from '@/server/repos/email-log';
import { emTransacao } from '@/server/repos/transacao';

import { urlDoWorker } from '../../support/db';
import { conectar, emailNovo } from '../../support/sql';

// CA-3 (pelo adaptador) e CA-23 (simulado): o e-mail simulado grava em email_log (RN-2, D-8) e
// recusa entrada inválida sem gravar nada (RN-9). RN-15: grava fora da transação de quem chama.
// A conferência é feita por SQL direto (driver pg), independente do repositório.

const APP_URL = 'http://localhost:3000';

let c: pg.Client;

beforeAll(async () => {
  c = await conectar();
});
afterAll(async () => {
  await c.end();
});

async function linhasDe(destinatario: string) {
  const r = await c.query<{ id: string; destinatario: string; assunto: string; corpo: string }>(
    'SELECT id::text AS id, destinatario, assunto, corpo FROM email_log WHERE destinatario = $1 ORDER BY criado_em, id',
    [destinatario],
  );
  return r.rows;
}

async function totalEmailLog(): Promise<number> {
  const r = await c.query<{ n: number }>('SELECT count(*)::int AS n FROM email_log');
  return r.rows[0].n;
}

describe('CA-3: e-mail simulado grava em email_log', () => {
  it('CA-3: destinatário, assunto e o link do corpo são lidos de email_log iguais aos enviados', async () => {
    const para = emailNovo();
    const token = randomUUID();
    const link = `${APP_URL}/recuperar-senha?token=${token}`;
    const texto = `Olá!\n\nPara criar uma nova senha, acesse:\n${link}\n\nSe não foi você, ignore este e-mail.`;

    const r = await criarEmailSimulado().enviar({
      para,
      assunto: 'Recuperação de senha',
      texto,
      html: '<p>só o real envia html</p>',
    });

    const linhas = await linhasDe(para);
    expect(linhas).toEqual([{ id: r.provedorId, destinatario: para, assunto: 'Recuperação de senha', corpo: texto }]);
    // D-8: o corpo é o texto (o html não é gravado). O link é extraível do corpo, igual ao enviado.
    const extraido = linhas[0].corpo.match(/https?:\/\/\S+/)?.[0];
    expect(extraido).toBe(link);
    expect(new URL(extraido as string).searchParams.get('token')).toBe(token);
  });

  it('CA-3: listarPorDestinatario devolve os e-mails do destinatário, mais recentes primeiro', async () => {
    const para = emailNovo();
    const outro = emailNovo();
    const email = criarEmailSimulado();
    const a = await email.enviar({ para, assunto: 'Primeiro', texto: 'um' });
    await email.enviar({ para: outro, assunto: 'De outra pessoa', texto: 'x' });
    const b = await email.enviar({ para, assunto: 'Segundo', texto: 'dois' });

    const lidos = await repoEmailLog().listarPorDestinatario(para);
    expect(lidos.map((l) => [l.id, l.destinatario, l.assunto, l.corpo])).toEqual([
      [b.provedorId, para, 'Segundo', 'dois'],
      [a.provedorId, para, 'Primeiro', 'um'],
    ]);
    expect(lidos[0].criadoEm).toBeInstanceOf(Date);
    expect(lidos[0].criadoEm.getTime()).toBeGreaterThanOrEqual(lidos[1].criadoEm.getTime());
    expect(await repoEmailLog().listarPorDestinatario(emailNovo())).toEqual([]);
  });

  it('RN-15: grava fora da transação de quem chama (o rollback do chamador não apaga o e-mail)', async () => {
    const para = emailNovo();
    const erro = new Error('falha proposital do chamador');
    await expect(
      emTransacao(async () => {
        await criarEmailSimulado().enviar({ para, assunto: 'Convite', texto: 'Aceite o convite.' });
        throw erro;
      }),
    ).rejects.toBe(erro);
    expect(await linhasDe(para)).toHaveLength(1);
  });

  it('RN-15: o e-mail gravado por uma instância sobre outro cliente de banco é lido pela aplicação', async () => {
    const outroCliente = criarPrisma(urlDoWorker(), { max: 2 });
    try {
      const para = emailNovo();
      const r = await criarEmailSimulado({ repo: repoEmailLog(outroCliente) }).enviar({
        para,
        assunto: 'Confirme seu e-mail',
        texto: 'Link: http://localhost:3000/confirmar?token=abc',
      });
      const lidos = await repoEmailLog().listarPorDestinatario(para);
      expect(lidos.map((l) => l.id)).toEqual([r.provedorId]);
    } finally {
      await outroCliente.$disconnect();
    }
  });
});

describe('CA-23: entrada inválida no e-mail simulado → erro de validação e nenhuma linha em email_log', () => {
  const valida: MensagemEmail = { para: 'gestora@exemplo.com.br', assunto: 'Assunto', texto: 'Texto' };

  it.each<[string, Partial<MensagemEmail>, 'para' | 'assunto' | 'texto']>([
    ['destinatário inválido', { para: 'nao-e-email' }, 'para'],
    ['destinatário vazio', { para: '' }, 'para'],
    ['vários destinatários (vírgula)', { para: 'a@exemplo.com.br,b@exemplo.com.br' }, 'para'],
    ['vários destinatários (ponto e vírgula)', { para: 'a@exemplo.com.br; b@exemplo.com.br' }, 'para'],
    ['destinatário com quebra de linha (injeção de cabeçalho)', { para: 'a@exemplo.com.br\r\nBcc: x@exemplo.com.br' }, 'para'],
    ['assunto com CR/LF (injeção de cabeçalho)', { assunto: 'Oi\r\nBcc: x@exemplo.com.br' }, 'assunto'],
    ['assunto com LF', { assunto: 'Oi\nBcc: x@exemplo.com.br' }, 'assunto'],
    ['assunto vazio', { assunto: '   ' }, 'assunto'],
    ['texto vazio', { texto: '' }, 'texto'],
    ['texto só com espaços', { texto: '  \n ' }, 'texto'],
  ])('CA-23: %s', async (_nome, mudanca, campo) => {
    const antes = await totalEmailLog();
    const p = criarEmailSimulado().enviar({ ...valida, ...mudanca });
    await expect(p).rejects.toBeInstanceOf(ErroValidacaoEmail);
    await expect(p).rejects.toMatchObject({ campo });
    expect(await totalEmailLog()).toBe(antes);
  });

  it('CA-23: a mensagem válida de controle grava (o caso acima não falhou por outro motivo)', async () => {
    const antes = await totalEmailLog();
    await criarEmailSimulado().enviar(valida);
    expect(await totalEmailLog()).toBe(antes + 1);
  });
});
