'use client';

import { useActionState } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';

import estilos from './Assinatura.module.css';
import { ESTADO_ASSINAR_INICIAL } from './estado';
import type { EstadoAssinar } from './estado';

type Props = {
  acao: (anterior: EstadoAssinar, formData: FormData) => Promise<EstadoAssinar>;
  /** Texto, nunca função, vindo da página servidora (preço e prazo do plano). */
  resumo: string;
};

/** Formulário POST "Assinar": funciona sem JavaScript (a ação redireciona ao checkout do provedor). */
export function FormularioAssinar({ acao, resumo }: Props) {
  const [estado, enviar, pendente] = useActionState(acao, ESTADO_ASSINAR_INICIAL);
  return (
    <form action={enviar} className={estilos.formulario}>
      <p>{resumo}</p>
      {estado.mensagem ? <Alert variante={estado.sucesso ? 'sucesso' : 'aviso'}>{estado.mensagem}</Alert> : null}
      <Button type="submit" ocupado={pendente} rotuloOcupado="Abrindo o checkout…">
        Assinar
      </Button>
    </form>
  );
}
