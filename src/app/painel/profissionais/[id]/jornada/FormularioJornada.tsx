'use client';

import { useActionState, useEffect, useRef } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { ErroDoCampo, Field } from '@/components/ui/Field';
import { formatarDiaDaSemana } from '@/lib/format';
import { LIMITES_JORNADA, MENSAGENS_JORNADA, ORDEM_EXIBICAO_DIAS } from '@/server/jornadas/tipos';
import type { DiaSemana, ErrosDia, ErrosJornada, SemanaJornada } from '@/server/jornadas/tipos';

import {
  ESTADO_INICIAL_FORMULARIO_JORNADA,
  idDoCampo,
  idDoErroDaLinha,
  idDoErroDoDia,
  nomeDoCampo,
  resumoDoDia,
  valoresDaSemana,
} from './estado';
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

type ItemDoResumo = { href: string; texto: string };

/** Erros na ordem de exibição (segunda → domingo), cada um com o link para o primeiro campo afetado. */
function itensDoResumo(erros: ErrosJornada): ItemDoResumo[] {
  const itens: ItemDoResumo[] = [];
  for (const dia of ORDEM_EXIBICAO_DIAS) {
    const e = erros.dias?.[dia];
    if (!e) continue;
    const nome = formatarDiaDaSemana(dia);
    if (e.dia) itens.push({ href: `#${idDoCampo(dia, 0, 'inicio')}`, texto: `${nome}: ${e.dia}` });
    const linhas = Object.entries(e.intervalos ?? {}).sort(([x], [y]) => Number(x) - Number(y));
    for (const [n, erro] of linhas) {
      if (!erro) continue;
      const i = Number(n);
      const campo = erro.inicio || erro.intervalo || !erro.fim ? 'inicio' : 'fim';
      const texto = erro.intervalo ?? erro.inicio ?? erro.fim;
      itens.push({ href: `#${idDoCampo(dia, i, campo)}`, texto: `${nome}, intervalo ${i + 1}: ${texto}` });
    }
  }
  return itens;
}

function LinhasDoDia({ dia, erros, valores }: { dia: DiaSemana; erros: ErrosDia | undefined; valores: { inicio: string; fim: string }[] }) {
  return (
    <>
      {Array.from({ length: LIMITES_JORNADA.linhasPorDia }, (_, n) => {
        const erro = erros?.intervalos?.[n];
        const erroDaLinha = erro?.intervalo;
        const descricao = [ID_AJUDA, erroDaLinha ? idDoErroDaLinha(dia, n) : ''].filter(Boolean).join(' ');
        const comuns = {
          autoComplete: 'off',
          maxLength: 5,
          pattern: '([01]?[0-9]|2[0-4]):[0-5][0-9]',
          'aria-describedby': descricao,
          'aria-invalid': erroDaLinha ? true : undefined,
        } as const;
        return (
          <div key={n} className={estilos.linha}>
            <div className={estilos.campos}>
              <Field
                {...comuns}
                rotulo={`Início do intervalo ${n + 1}`}
                id={idDoCampo(dia, n, 'inicio')}
                name={nomeDoCampo(dia, n, 'inicio')}
                defaultValue={valores[n]?.inicio ?? ''}
                erro={erro?.inicio}
              />
              <Field
                {...comuns}
                rotulo={`Fim do intervalo ${n + 1}`}
                id={idDoCampo(dia, n, 'fim')}
                name={nomeDoCampo(dia, n, 'fim')}
                defaultValue={valores[n]?.fim ?? ''}
                erro={erro?.fim}
              />
            </div>
            {erroDaLinha ? <ErroDoCampo id={idDoErroDaLinha(dia, n)} texto={erroDaLinha} /> : null}
          </div>
        );
      })}
    </>
  );
}

/**
 * Edição da jornada semanal (D-015 §3.6; RN-2..RN-8, RN-14). Um único formulário HTML para a semana
 * inteira (funciona sem JavaScript): cada dia num `<details>` (aberto quando tem erro) com 6 linhas
 * fixas de início/fim em campos de texto HH:MM (D-10: `type="time"` não aceita 24:00). Com erros, um
 * resumo no topo com links para os campos, focado ao chegar (CA-17). Os valores vêm de
 * `estado.valores` depois de um erro (preservados com ou sem JavaScript), senão da semana gravada.
 */
export function FormularioJornada({ acao, profissionalId, semana, aposSalvar }: FormularioJornadaProps) {
  const [estado, enviar, pendente] = useActionState(acao, ESTADO_INICIAL_FORMULARIO_JORNADA);
  const resumo = useRef<HTMLDivElement>(null);
  const valores = estado.valores ?? valoresDaSemana(semana);
  const itens = itensDoResumo(estado.erros);
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
      {temErros ? (
        <div ref={resumo} id={ID_RESUMO} tabIndex={-1} className={estilos.resumoErros} role="alert" aria-labelledby={`${ID_RESUMO}-titulo`}>
          <p id={`${ID_RESUMO}-titulo`} className={estilos.resumoTitulo}>
            {MENSAGENS_JORNADA.resumoErros}
          </p>
          <ul>
            {itens.map((item) => (
              <li key={item.href + item.texto}>
                <a href={item.href}>{item.texto}</a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <input type="hidden" name="profissionalId" value={profissionalId} />
      <p id={ID_AJUDA} className={estilos.ajuda}>
        {MENSAGENS_JORNADA.ajudaHorario}
      </p>
      <div className={estilos.dias}>
        {ORDEM_EXIBICAO_DIAS.map((dia) => {
          const erros = estado.erros.dias?.[dia];
          const nome = formatarDiaDaSemana(dia);
          return (
            <details key={dia} className={estilos.dia} open={erros ? true : undefined}>
              <summary className={estilos.resumoDia}>
                <span className={estilos.nomeDia}>{nome}</span>
                <span className={estilos.textoDia}>{resumoDoDia(semana[dia])}</span>
              </summary>
              <fieldset className={estilos.intervalos} aria-describedby={erros?.dia ? idDoErroDoDia(dia) : undefined}>
                <legend>Intervalos de {nome}</legend>
                {erros?.dia ? <ErroDoCampo id={idDoErroDoDia(dia)} texto={erros.dia} /> : null}
                <LinhasDoDia dia={dia} erros={erros} valores={valores[dia]} />
              </fieldset>
            </details>
          );
        })}
      </div>
      <div className={estilos.acoes}>
        <Button type="submit" ocupado={pendente} rotuloOcupado="Salvando…">
          Salvar jornada
        </Button>
      </div>
    </form>
  );
}
