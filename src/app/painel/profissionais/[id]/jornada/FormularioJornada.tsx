'use client';

import { useActionState, useEffect, useRef } from 'react';

import { CamposDaSemana } from '@/app/painel/_componentes/semana/CamposDaSemana';
import { itensDoResumo } from '@/app/painel/_componentes/semana/formulario';
import { ResumoDeErros } from '@/app/painel/_componentes/semana/ResumoDeErros';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { MENSAGENS_JORNADA } from '@/server/jornadas/tipos';
import type { SemanaJornada } from '@/server/jornadas/tipos';

import { ESTADO_INICIAL_FORMULARIO_JORNADA, PREFIXO_JORNADA, valoresDaSemana } from './estado';
import type { EstadoFormularioJornada } from './estado';
import estilos from './Jornada.module.css';

export type FormularioJornadaProps = {
  /** Ação de servidor (salvarJornadaAcao/demonstrarJornadaAcao) ou, nos testes, uma função equivalente. */
  acao: (anterior: EstadoFormularioJornada, formData: FormData) => Promise<EstadoFormularioJornada>;
  profissionalId: string;
  /** Semana gravada: valores iniciais dos campos e resumo de cada dia. */
  semana: SemanaJornada;
  /** Mensagem de status depois de salvar (PRG `?salva=1`, D-17). */
  aposSalvar?: string;
};

const ID_AJUDA = 'jornada-ajuda';
const ID_RESUMO = 'jornada-resumo-erros';

/**
 * Edição da jornada semanal (D-015 §3.6; RN-2..RN-8, RN-14). Um único formulário HTML para a semana
 * inteira (funciona sem JavaScript): os dias vêm do editor compartilhado (D-020 §3.7, `CamposDaSemana`)
 * com o mesmo DOM de antes. Com erros, um resumo no topo com links para os campos, focado ao chegar
 * (CA-17). Os valores vêm de `estado.valores` depois de um erro (preservados com ou sem JavaScript),
 * senão da semana gravada.
 */
export function FormularioJornada({ acao, profissionalId, semana, aposSalvar }: FormularioJornadaProps) {
  const [estado, enviar, pendente] = useActionState(acao, ESTADO_INICIAL_FORMULARIO_JORNADA);
  const resumo = useRef<HTMLDivElement>(null);
  const valores = estado.valores ?? valoresDaSemana(semana);
  const itens = itensDoResumo(PREFIXO_JORNADA, estado.erros);
  const temErros = itens.length > 0;
  // A mensagem do PRG (`?salva=1`) só vale até o próximo envio: um erro depois dela não convive com "salva".
  const temResultado = estado !== ESTADO_INICIAL_FORMULARIO_JORNADA;

  useEffect(() => {
    if (temErros) resumo.current?.focus();
  }, [estado, temErros]);

  return (
    <form action={enviar} className={estilos.formulario} noValidate>
      {aposSalvar && !temResultado ? <Alert variante="sucesso">{aposSalvar}</Alert> : null}
      {estado.mensagem ? (
        <Alert variante={estado.sucesso === true && !temErros ? 'sucesso' : 'erro'}>{estado.mensagem}</Alert>
      ) : null}
      {estado.erros.formulario ? <Alert variante="erro">{estado.erros.formulario}</Alert> : null}
      {temErros ? <ResumoDeErros ref={resumo} id={ID_RESUMO} titulo={MENSAGENS_JORNADA.resumoErros} itens={itens} /> : null}
      <input type="hidden" name="profissionalId" value={profissionalId} />
      <p id={ID_AJUDA} className={estilos.ajuda}>
        {MENSAGENS_JORNADA.ajudaHorario}
      </p>
      <CamposDaSemana
        prefixoId={PREFIXO_JORNADA}
        idAjuda={ID_AJUDA}
        semana={semana}
        valores={valores}
        erros={estado.erros}
        textoDiaVazio={MENSAGENS_JORNADA.folga}
      />
      <div className={estilos.acoes}>
        <Button type="submit" ocupado={pendente} rotuloOcupado="Salvando…">
          Salvar jornada
        </Button>
      </div>
    </form>
  );
}
