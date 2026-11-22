import { formatarDataHora } from '@/lib/format';
import type { MensagemSituacao } from '@/server/mensagens/situacao-tipos';

import estilos from './SituacaoMensagens.module.css';

type Props = { mensagens: readonly MensagemSituacao[]; fuso: string };

export const TEXTO_SEM_MENSAGENS = 'Nenhuma mensagem de WhatsApp para esta reserva.';

/**
 * Situação de envio das mensagens de WhatsApp da reserva (D-043). Somente leitura, sem JavaScript, sem
 * nada interativo: o estado é a frase (texto), nunca só cor ou ícone. Só a falha ganha destaque.
 */
export function SituacaoMensagens({ mensagens, fuso }: Props) {
  return (
    <section aria-labelledby="reserva-mensagens" className={estilos.secao}>
      <h2 id="reserva-mensagens">Mensagens de WhatsApp</h2>
      {mensagens.length === 0 ? (
        <p>{TEXTO_SEM_MENSAGENS}</p>
      ) : (
        <ul className={estilos.lista}>
          {mensagens.map((m) => {
            const detalhes = [
              m.ultimaTentativaEm === null ? null : `Última tentativa: ${formatarDataHora(m.ultimaTentativaEm, fuso)}`,
              m.tentativas >= 2 ? `${m.tentativas} tentativas` : null,
            ].filter((x): x is string => x !== null);
            const classe = m.estado === 'falhou' ? estilos.falha : m.estado === 'enviada' ? estilos.enviada : estilos.neutra;
            return (
              <li key={m.id} className={`${estilos.item} ${classe}`} data-estado={m.estado}>
                <strong className={estilos.rotulo}>
                  {m.estado === 'falhou' ? (
                    <svg className={estilos.icone} viewBox="0 0 18 18" aria-hidden="true" focusable="false">
                      <path d="M9 1.5 17 16H1z" className={estilos.triangulo} />
                      <path d="M9 6.5v4.5" className={estilos.exclamacao} />
                      <circle cx="9" cy="13.4" r="0.9" className={estilos.ponto} />
                    </svg>
                  ) : null}
                  {m.rotulo}
                </strong>
                {detalhes.length > 0 ? <p className={estilos.detalhe}>{detalhes.join(' · ')}</p> : null}
                {m.motivo !== null ? <p className={estilos.detalhe}>{m.motivo}</p> : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
