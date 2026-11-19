import { repoEmailLog } from '@/server/repos/email-log';
import type { RepoEmailLog } from '@/server/repos/email-log';

import { validarMensagemEmail } from './port';
import type { PortaEmail } from './port';

/**
 * E-mail simulado (RN-2, D-8): valida a mensagem (RN-9) e grava destinatário, assunto e o TEXTO em
 * `email_log`, fora da transação de quem chama (RN-15). Entrada inválida não grava nada (CA-23).
 * `repo` só é informado pelos testes (outro cliente de banco); o padrão usa o cliente da aplicação.
 */
export function criarEmailSimulado(o: { repo?: RepoEmailLog } = {}): PortaEmail {
  const repo = o.repo ?? repoEmailLog();
  return {
    async enviar(m) {
      validarMensagemEmail(m);
      const { id } = await repo.registrar({ destinatario: m.para, assunto: m.assunto, corpo: m.texto });
      return { provedorId: id };
    },
  };
}
