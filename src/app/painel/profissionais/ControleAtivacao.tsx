'use client';

import { useState } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { MENSAGENS_PROFISSIONAL } from '@/server/profissionais/tipos';

import { ESTADO_INICIAL_DESATIVACAO } from './estado';
import type { EstadoDesativacao } from './estado';
import estilos from './Profissionais.module.css';

export type ControleAtivacaoProps = {
  id: string;
  nome: string;
  ativo: boolean;
  /** desativarProfissionalAcao (ou função equivalente nos testes). */
  desativar: (id: string) => Promise<EstadoDesativacao>;
  /** reativarProfissionalAcao: formulário POST, funciona sem JavaScript. */
  reativar: (formData: FormData) => Promise<void>;
};

/**
 * Desativar (com confirmação) e reativar (D-013 RN-2, RN-10, RN-11). A recusa por reservas futuras
 * confirmadas fecha o diálogo e aparece num Alert de erro (role="alert") com a lista das reservas
 * (data e hora já formatadas no fuso do salão pelo servidor). O sucesso atualiza a página pela
 * revalidação feita na ação de servidor.
 */
export function ControleAtivacao({ id, nome, ativo, desativar, reativar }: ControleAtivacaoProps) {
  const [aberto, setAberto] = useState(false);
  const [estado, setEstado] = useState<EstadoDesativacao>(ESTADO_INICIAL_DESATIVACAO);

  if (!ativo) {
    return (
      <form action={reativar} className={estilos.secao}>
        <h2>Situação: inativo</h2>
        <p>Reativar devolve {nome} à página pública e permite novas reservas. Convites e sessões antigos não voltam.</p>
        <input type="hidden" name="id" value={id} />
        <div>
          <Button type="submit" variante="secundaria">
            Reativar
          </Button>
        </div>
      </form>
    );
  }

  async function confirmar() {
    const r = await desativar(id);
    setEstado(r);
  }

  return (
    <section className={estilos.secao} aria-labelledby="situacao-profissional">
      <h2 id="situacao-profissional">Situação: ativo</h2>
      {estado.status === 'recusado' ? (
        <Alert variante="erro">
          <p>{MENSAGENS_PROFISSIONAL.recusaDesativacao}</p>
          <ul className={estilos.reservas}>
            {estado.reservas.map((r) => (
              <li key={r.itemId}>
                {r.inicioLocal} — {r.servicos.join(', ')} — {r.cliente}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}
      {estado.status === 'erro' ? <Alert variante="erro">{estado.mensagem}</Alert> : null}
      <div>
        <Button variante="perigo" onClick={() => setAberto(true)}>
          Desativar
        </Button>
      </div>
      <ConfirmDialog
        aberto={aberto}
        titulo={`Desativar ${nome}?`}
        descricao={
          <p>
            Deixa de aparecer na página pública e de receber novas reservas, e perde o acesso ao painel. O histórico
            de reservas é mantido.
          </p>
        }
        rotuloConfirmar="Desativar"
        variante="perigo"
        rotuloOcupado="Desativando…"
        onConfirmar={confirmar}
        onFechar={() => setAberto(false)}
      />
    </section>
  );
}
