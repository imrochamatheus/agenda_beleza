'use client';

import { Button } from '@/components/ui/Button';
import { ErroDoCampo, Field } from '@/components/ui/Field';
import { Select } from '@/components/ui/Select';

import { idDaLinha } from './estado';
import type { CampoDaLinha, ValoresDaLinha } from './estado';
import estilos from './NovaReserva.module.css';

export type OpcaoDeServico = { id: string; nome: string; rotulo: string };

export type LinhaDeItemProps = {
  /** Índice 0-based; a tela mostra "Serviço {indice + 1}". */
  indice: number;
  /** Com 2+ linhas aparece "Remover". */
  total: number;
  valores: ValoresDaLinha;
  erros: Partial<Record<CampoDaLinha, string>>;
  servicos: readonly OpcaoDeServico[];
  /** Gestor: opções do profissional; null = profissional logado (fixo). */
  profissionais: readonly { valor: string; rotulo: string }[] | null;
  /** Profissional logado: id (campo oculto) e nome mostrado. */
  profissionalFixo?: { id: string; nome: string };
  /** Texto dos motivos de encaixe desta linha (aviso pendente), ou null. */
  encaixe: string | null;
};

/**
 * Uma linha "Serviço n" da nova reserva (web-design D-050 §4.4): `fieldset` com Serviço, Profissional (ou o
 * texto fixo do profissional logado) e Hora; "Remover" é um botão de envio do formulário (`linha=remover:n`),
 * que funciona sem JavaScript. Os ids `item-<n>-<campo>` são os alvos do resumo de erros.
 */
export function LinhaDeItem({ indice, total, valores, erros, servicos, profissionais, profissionalFixo, encaixe }: LinhaDeItemProps) {
  const n = indice + 1;
  const idEncaixe = `${idDaLinha(indice, 'hora')}-encaixe`;
  return (
    <fieldset className={estilos.linha}>
      <legend id={idDaLinha(indice, 'legenda')} tabIndex={-1} className={estilos.legendaLinha}>
        Serviço {n}
      </legend>
      <Select
        id={idDaLinha(indice, 'servico')}
        name={`item-${n}-servico`}
        rotulo="Serviço"
        textoVazio="Escolha…"
        opcoes={servicos.map((s) => ({ valor: s.id, rotulo: s.rotulo }))}
        defaultValue={valores.servicoId}
        erro={erros.servico}
        className={estilos.linhaInteira}
        key={`s-${indice}-${valores.servicoId}`}
      />
      {profissionais !== null ? (
        <Select
          id={idDaLinha(indice, 'profissional')}
          name={`item-${n}-profissional`}
          rotulo="Profissional"
          textoVazio="Escolha…"
          opcoes={profissionais}
          defaultValue={valores.profissionalId}
          erro={erros.profissional}
          key={`p-${indice}-${valores.profissionalId}`}
        />
      ) : (
        <div className={estilos.fixo}>
          <input type="hidden" name={`item-${n}-profissional`} value={profissionalFixo?.id ?? ''} />
          <p id={idDaLinha(indice, 'profissional')}>
            <strong>Profissional:</strong> {profissionalFixo?.nome ?? ''} (você)
          </p>
          {erros.profissional ? <ErroDoCampo id={`${idDaLinha(indice, 'profissional')}-erro`} texto={erros.profissional} /> : null}
        </div>
      )}
      <div>
        <Field
          id={idDaLinha(indice, 'hora')}
          name={`item-${n}-hora`}
          rotulo="Hora (HH:MM)"
          autoComplete="off"
          maxLength={5}
          inputMode="numeric"
          pattern="([01]?[0-9]|2[0-3]):[0-5][0-9]"
          defaultValue={valores.hora}
          erro={erros.hora}
          aria-describedby={encaixe ? idEncaixe : undefined}
          key={`h-${indice}-${valores.hora}`}
        />
        {encaixe ? (
          <p id={idEncaixe} className={estilos.encaixeDaLinha}>
            <span className={estilos.etiquetaEncaixe}>Encaixe</span> {encaixe}
          </p>
        ) : null}
      </div>
      {total > 1 ? (
        <div className={estilos.linhaAcoes}>
          <Button type="submit" variante="discreta" name="linha" value={`remover:${n}`} aria-label={`Remover serviço ${n}`}>
            Remover
          </Button>
        </div>
      ) : null}
    </fieldset>
  );
}
