'use client';

import { useActionState } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { MENSAGENS_CONVITE } from '@/server/convites/tipos';
import type { EstadoConviteVisao } from '@/server/convites/tipos';

import { ESTADO_INICIAL_CONVITE_PROFISSIONAL } from './estado';
import type { EstadoConviteProfissional } from './estado';
import estilos from './Profissionais.module.css';

export type ConviteProfissionalProps = {
  id: string;
  ativo: boolean;
  /** E-mail do perfil, como salvo (a edição não salva do formulário acima não conta). */
  email: string | null;
  convite: EstadoConviteVisao;
  /** convidarAcao (ou função equivalente nos testes): formulário POST, funciona sem JavaScript. */
  acao: (anterior: EstadoConviteProfissional, formData: FormData) => Promise<EstadoConviteProfissional>;
};

/** Texto do estado do convite (CA-16); nunca token nem hash. */
export function descreverConvite(c: EstadoConviteVisao): string {
  switch (c.estado) {
    case 'pendente':
      return `Convite pendente, válido até ${c.ate}.`;
    case 'expirado':
      return `Convite expirado em ${c.ate}.`;
    case 'aceito':
      return 'Convite aceito.';
    default:
      return 'Nenhum convite enviado.';
  }
}

/**
 * Convite do profissional sem acesso (D-039 RN-2..RN-6, CA-16): estado, botão "Enviar convite" ou
 * "Reenviar convite" e o retorno da ação num Alert. Funciona sem JavaScript (formulário POST; o estado
 * da ação volta no novo render). Inativo ou sem e-mail: explica o que falta, sem botão.
 */
export function ConviteProfissional({ id, ativo, email, convite, acao }: ConviteProfissionalProps) {
  const [estado, enviar, pendente] = useActionState(acao, ESTADO_INICIAL_CONVITE_PROFISSIONAL);
  const reenvio = convite.estado !== 'sem_convite';
  const podeConvidar = ativo && email !== null && email !== '';
  return (
    <form action={enviar} className={estilos.secao} aria-labelledby="convite-profissional">
      <h3 id="convite-profissional">Convite por e-mail</h3>
      <p>{descreverConvite(convite)}</p>
      {estado.variante && estado.mensagem ? <Alert variante={estado.variante}>{estado.mensagem}</Alert> : null}
      {!ativo ? (
        <p>{MENSAGENS_CONVITE.inativo}</p>
      ) : !podeConvidar ? (
        <p>{MENSAGENS_CONVITE.semEmail}</p>
      ) : (
        <>
          <p>O convite vai para {email} e vale por 7 dias. Reenviar cancela o link anterior.</p>
          <input type="hidden" name="id" value={id} />
          <div>
            <Button type="submit" variante="secundaria" ocupado={pendente} rotuloOcupado="Enviando…">
              {reenvio ? 'Reenviar convite' : 'Enviar convite'}
            </Button>
          </div>
        </>
      )}
    </form>
  );
}
