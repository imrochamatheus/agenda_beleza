import { ErroDoCampo, Field } from '@/components/ui/Field';
import { formatarDiaDaSemana } from '@/lib/format';
import { LIMITES_SEMANA, ORDEM_EXIBICAO_DIAS } from '@/server/semana/tipos';
import type { DiaSemana, ErrosDia, ErrosSemana, SemanaHoraria } from '@/server/semana/tipos';

import { idDoCampo, idDoErroDaLinha, idDoErroDoDia, nomeDoCampo, resumoDoDia } from './formulario';
import type { ValorLinha, ValoresSemana } from './formulario';
import estilos from './Semana.module.css';

export type CamposDaSemanaProps = {
  /** Prefixo dos ids (`jornada`, `funcionamento`). */
  prefixoId: string;
  /** Id do texto de ajuda dos horários (entra no aria-describedby de cada campo). */
  idAjuda: string;
  /** Semana gravada: resumo de cada dia no `<summary>`. */
  semana: SemanaHoraria;
  /** Valores dos campos (6 linhas por dia). */
  valores: ValoresSemana;
  erros: ErrosSemana;
  /** Texto do dia sem intervalos ("Folga", "Fechado"). */
  textoDiaVazio: string;
};

type LinhasDoDiaProps = { prefixoId: string; idAjuda: string; dia: DiaSemana; erros: ErrosDia | undefined; valores: ValorLinha[] };

function LinhasDoDia({ prefixoId, idAjuda, dia, erros, valores }: LinhasDoDiaProps) {
  return (
    <>
      {Array.from({ length: LIMITES_SEMANA.linhasPorDia }, (_, n) => {
        const erro = erros?.intervalos?.[n];
        const erroDaLinha = erro?.intervalo;
        const descricao = [idAjuda, erroDaLinha ? idDoErroDaLinha(prefixoId, dia, n) : ''].filter(Boolean).join(' ');
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
                id={idDoCampo(prefixoId, dia, n, 'inicio')}
                name={nomeDoCampo(dia, n, 'inicio')}
                defaultValue={valores[n]?.inicio ?? ''}
                erro={erro?.inicio}
              />
              <Field
                {...comuns}
                rotulo={`Fim do intervalo ${n + 1}`}
                id={idDoCampo(prefixoId, dia, n, 'fim')}
                name={nomeDoCampo(dia, n, 'fim')}
                defaultValue={valores[n]?.fim ?? ''}
                erro={erro?.fim}
              />
            </div>
            {erroDaLinha ? <ErroDoCampo id={idDoErroDaLinha(prefixoId, dia, n)} texto={erroDaLinha} /> : null}
          </div>
        );
      })}
    </>
  );
}

/**
 * Os 7 dias da semana (segunda → domingo), cada um num `<details>` (aberto quando tem erro) com 6
 * linhas fixas de início/fim em campos de texto HH:MM (`type="time"` não aceita 24:00). Sem estado:
 * funciona sem JavaScript dentro de um `<form>` de ação de servidor (D-020 §3.7).
 */
export function CamposDaSemana({ prefixoId, idAjuda, semana, valores, erros, textoDiaVazio }: CamposDaSemanaProps) {
  return (
    <div className={estilos.dias}>
      {ORDEM_EXIBICAO_DIAS.map((dia) => {
        const errosDia = erros.dias?.[dia];
        const nome = formatarDiaDaSemana(dia);
        return (
          <details key={dia} className={estilos.dia} open={errosDia ? true : undefined}>
            <summary className={estilos.resumoDia}>
              <span className={estilos.nomeDia}>{nome}</span>
              <span className={estilos.textoDia}>{resumoDoDia(semana[dia], textoDiaVazio)}</span>
            </summary>
            <fieldset className={estilos.intervalos} aria-describedby={errosDia?.dia ? idDoErroDoDia(prefixoId, dia) : undefined}>
              <legend>Intervalos de {nome}</legend>
              {errosDia?.dia ? <ErroDoCampo id={idDoErroDoDia(prefixoId, dia)} texto={errosDia.dia} /> : null}
              <LinhasDoDia prefixoId={prefixoId} idAjuda={idAjuda} dia={dia} erros={errosDia} valores={valores[dia]} />
            </fieldset>
          </details>
        );
      })}
    </div>
  );
}
