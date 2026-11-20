'use client';

import { useActionState } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';

import { ESTADO_INICIAL_EU_TAMBEM_ATENDO } from './estado';
import type { EstadoEuTambemAtendo } from './estado';
import estilos from './Profissionais.module.css';

export type EuTambemAtendoProps = {
  /** euTambemAtendoAcao (ou função equivalente nos testes). */
  acao: (anterior: EstadoEuTambemAtendo, formData: FormData) => Promise<EstadoEuTambemAtendo>;
};

/**
 * "Eu também atendo" (D-013 RN-3): cria ou reativa o perfil de profissional do gestor. Formulário
 * POST (funciona sem JavaScript); o retorno aparece num Alert (status, ou alert se for erro).
 */
export function EuTambemAtendo({ acao }: EuTambemAtendoProps) {
  const [estado, enviar, pendente] = useActionState(acao, ESTADO_INICIAL_EU_TAMBEM_ATENDO);
  return (
    <form action={enviar} className={estilos.secao} aria-labelledby="eu-tambem-atendo">
      <h2 id="eu-tambem-atendo">Você também atende?</h2>
      <p>Crie seu perfil de profissional para ter agenda própria e receber reservas, sem precisar de convite.</p>
      {estado.variante && estado.mensagem ? <Alert variante={estado.variante}>{estado.mensagem}</Alert> : null}
      <div>
        <Button type="submit" variante="secundaria" ocupado={pendente} rotuloOcupado="Aguarde…">
          Eu também atendo
        </Button>
      </div>
    </form>
  );
}
