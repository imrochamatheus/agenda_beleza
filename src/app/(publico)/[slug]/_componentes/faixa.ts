// Textos e links da régua da semana do passo do serviço 0 (D-051 §3.6, web-design §4.1, §6). Puro e
// client-safe (o `FormularioDados`, cliente, importa `rotuloDoDia` por `./Passos`): só monta texto com o
// `src/lib/format.ts` e os links com `passos.ts`; a `FaixaDeDias` só recebe o resultado.
import type { FaixaDeDiasProps } from '@/components/ui/FaixaDeDias';
import { diaDaSemana } from '@/domain/disponibilidade';
import {
  formatarDataCivil,
  formatarDiaDaSemana,
  formatarDiaDaSemanaCurto,
  formatarDiaEMesCurtos,
} from '@/lib/format';
import { hrefDaSemana, hrefDoDia, lerData } from '@/server/reserva-publica/passos';
import { MENSAGENS_PASSO } from '@/server/reserva-publica/tipos';
import type { FaixaDaSemana } from '@/server/reserva-publica/tipos';

/** `id` do `h3` "Escolha o dia" (o do período é `${ID_TITULO_FAIXA}-periodo`). */
export const ID_TITULO_FAIXA = 'reservar-dia';

/** 'Terça-feira, 01/12/2026' a partir de 'AAAA-MM-DD' (dia civil do salão, sem fuso). */
export function rotuloDoDia(chave: string): string {
  const d = lerData(chave);
  if (d === null) return chave;
  return `${formatarDiaDaSemana(diaDaSemana(d))}, ${formatarDataCivil(chave)}`;
}

/**
 * Props da `FaixaDeDias` para a semana `faixa` (RN-2, RN-4, RN-10): o nome acessível de cada dia começa pelo
 * rótulo completo, com ", hoje" e ", sem horários" nessa ordem (C4); só os dias com horário são links.
 */
export function propsDaFaixa(base: string, s: readonly string[], faixa: FaixaDaSemana): FaixaDeDiasProps {
  return {
    idTitulo: ID_TITULO_FAIXA,
    titulo: MENSAGENS_PASSO.escolhaODia,
    periodo: `${formatarDataCivil(faixa.inicio)} a ${formatarDataCivil(faixa.fim)}`,
    dias: faixa.dias.map((d) => {
      // Datas da faixa vêm do servidor, sempre 'AAAA-MM-DD' válidas (formatarDiaEMesCurtos lançaria antes).
      const civil = lerData(d.data)!;
      const ehHoje = d.data === faixa.hoje;
      const { dia, mes } = formatarDiaEMesCurtos(d.data);
      return {
        chave: d.data,
        semana: ehHoje ? MENSAGENS_PASSO.hoje : formatarDiaDaSemanaCurto(diaDaSemana(civil)),
        dia,
        mes,
        rotulo:
          rotuloDoDia(d.data) +
          (ehHoje ? MENSAGENS_PASSO.sufixoHoje : '') +
          (d.temHorarios ? '' : MENSAGENS_PASSO.sufixoSemHorarios),
        href: d.temHorarios ? hrefDoDia(base, s, d.data) : null,
        atual: d.data === faixa.selecionado,
      };
    }),
    anterior: faixa.anterior === null ? null : { href: hrefDaSemana(base, s, faixa.anterior), rotulo: MENSAGENS_PASSO.semanaAnterior },
    proxima: faixa.proxima === null ? null : { href: hrefDaSemana(base, s, faixa.proxima), rotulo: MENSAGENS_PASSO.proximaSemana },
    rotuloNavegacao: MENSAGENS_PASSO.navegacaoSemanas,
    apoio: MENSAGENS_PASSO.diaComHorarios,
  };
}

/**
 * Estado vazio do bloco de horários sem dia (RN-7, RN-9; web-design §6): "escolha um dia" quando a semana tem
 * algum dia com horário; senão, "nenhum dia desta semana", conforme exista próxima ou anterior.
 */
export function estadoSemDia(faixa: FaixaDaSemana, servico: string): { titulo: string; texto: string } {
  if (faixa.dias.some((d) => d.temHorarios)) {
    return { titulo: MENSAGENS_PASSO.semDiaTitulo, texto: MENSAGENS_PASSO.semDiaTexto(servico) };
  }
  const texto =
    faixa.proxima !== null
      ? MENSAGENS_PASSO.semanaVaziaComProxima
      : faixa.anterior !== null
        ? MENSAGENS_PASSO.semanaVaziaUltima
        : MENSAGENS_PASSO.semanaVaziaUnica;
  return { titulo: MENSAGENS_PASSO.semanaVaziaTitulo, texto };
}
