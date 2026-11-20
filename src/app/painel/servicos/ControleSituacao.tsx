'use client';

import { useActionState, useState } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';

import { ESTADO_INICIAL_SITUACAO } from './estado';
import type { EstadoSituacao } from './estado';
import estilos from './Servicos.module.css';

type AcaoSituacao = (anterior: EstadoSituacao, formData: FormData) => Promise<EstadoSituacao>;

export type ControleSituacaoProps = {
  id: string;
  ativo: boolean;
  /** desativarServicoAcao (ou função equivalente nos testes). */
  desativar: AcaoSituacao;
  /** reativarServicoAcao (ou função equivalente nos testes). */
  reativar: AcaoSituacao;
};

/**
 * Desativar e reativar o serviço (D-014 RN-2, D-9): um único formulário POST, sem diálogo de
 * confirmação (reversível e sem efeito em reservas), que funciona sem JavaScript. O resultado aparece
 * em Alert: role="status" no sucesso e role="alert" no erro.
 *
 * Um hook por ação, sempre na mesma ordem: sem JavaScript, o React só devolve o estado da ação ao
 * hook que a enviou (mesma posição e mesma ação). Com um hook só, a ação trocaria depois da
 * revalidação (ativo → inativo) e a mensagem se perderia. A mensagem exibida é a da última ação
 * enviada (registrada no onSubmit, com JavaScript); sem JavaScript, só um dos hooks tem estado.
 */
export function ControleSituacao({ id, ativo, desativar, reativar }: ControleSituacaoProps) {
  const [estadoDesativar, enviarDesativar, desativando] = useActionState(desativar, ESTADO_INICIAL_SITUACAO);
  const [estadoReativar, enviarReativar, reativando] = useActionState(reativar, ESTADO_INICIAL_SITUACAO);
  const [ultima, setUltima] = useState<'desativar' | 'reativar' | null>(null);
  const estado =
    ultima === 'desativar' || (ultima === null && estadoDesativar.mensagem !== null) ? estadoDesativar : estadoReativar;
  const enviar = ativo ? enviarDesativar : enviarReativar;
  const pendente = ativo ? desativando : reativando;

  return (
    <form
      action={enviar}
      onSubmit={() => setUltima(ativo ? 'desativar' : 'reativar')}
      className={estilos.secao}
      aria-labelledby="situacao-servico"
    >
      <h2 id="situacao-servico">Situação: {ativo ? 'ativo' : 'inativo'}</h2>
      {estado.mensagem && estado.variante ? <Alert variante={estado.variante}>{estado.mensagem}</Alert> : null}
      <p>
        {ativo
          ? 'Desativar tira o serviço da página pública e de novas reservas. As reservas já feitas não mudam.'
          : 'Reativar devolve o serviço à página pública, se algum profissional ativo o executa.'}
      </p>
      <input type="hidden" name="id" value={id} />
      <div>
        <Button
          type="submit"
          variante={ativo ? 'perigo' : 'secundaria'}
          ocupado={pendente}
          rotuloOcupado={ativo ? 'Desativando…' : 'Reativando…'}
        >
          {ativo ? 'Desativar serviço' : 'Reativar serviço'}
        </Button>
      </div>
    </form>
  );
}
