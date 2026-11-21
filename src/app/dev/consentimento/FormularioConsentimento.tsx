'use client';

import { useActionState, useEffect, useRef } from 'react';

import { CaixasConsentimento } from '@/components/consentimento/CaixasConsentimento';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';

import { estadoConsentimentoInicial, type EstadoConsentimento } from './estado';

const ID_PREFIXO = 'consentimento';

type Props = { acao: (anterior: EstadoConsentimento, fd: FormData) => Promise<EstadoConsentimento> };

const ROTULO_FINALIDADE = {
  mensagens_reserva: 'mensagens da reserva',
  convite_avaliacao: 'convite de avaliação',
  publicacao_avaliacao: 'publicação da avaliação',
} as const;

/** Formulário da vitrine: as mesmas caixas da reserva pública. Funciona sem JavaScript (sem PRG). */
export function FormularioConsentimento({ acao }: Props) {
  const [estado, enviar, pendente] = useActionState(acao, estadoConsentimentoInicial());
  const resumo = useRef<HTMLDivElement>(null);
  const sucesso = useRef<HTMLDivElement>(null);
  const erro = estado.erros.mensagensReserva;

  useEffect(() => {
    if (erro) resumo.current?.focus();
    else if (estado.gravaria) sucesso.current?.focus();
  }, [estado, erro]);

  return (
    <form action={enviar} noValidate>
      {erro ? (
        <div ref={resumo} tabIndex={-1} role="alert" id="consentimento-resumo">
          <p>
            <a href={`#${ID_PREFIXO}-mensagens`}>{erro}</a>
          </p>
        </div>
      ) : null}
      {estado.gravaria && !erro ? (
        <div ref={sucesso} tabIndex={-1} id="consentimento-sucesso">
          <Alert variante="sucesso">
            Aceite válido. Seriam gravadas: {estado.gravaria.map((f) => ROTULO_FINALIDADE[f]).join(' e ')}.
          </Alert>
        </div>
      ) : null}
      <CaixasConsentimento idPrefixo={ID_PREFIXO} erros={estado.erros} valores={estado.valores} />
      <Button type="submit" ocupado={pendente} rotuloOcupado="Enviando…">
        Reservar
      </Button>
    </form>
  );
}
