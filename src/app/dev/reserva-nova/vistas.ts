// Estados iniciais das vistas da vitrine /dev/reserva-nova (D-050 web-design §5.8 e §8): 3 linhas do exemplo
// (Escova com Ana, Hidratação com Bia, Manicure com Carla) com o aviso de encaixe, com o resumo de erros ou
// já registradas (roteiro do resultado). Sem banco; nenhum texto novo (todos vêm de estado.ts ou do serviço).
import { estadoInicial } from '@/app/painel/agenda/nova/estado';
import type { EstadoReservaManual, ValoresReservaManual } from '@/app/painel/agenda/nova/estado';
import { hrefAgenda } from '@/app/painel/agenda/_componentes/links';
import { ROTAS } from '@/config/navegacao';
import { lerData, lerHora, MENSAGENS_FORMULARIO_EQUIPE } from '@/server/reservas/reserva-equipe';
import { instanteDeHoraLocal } from '@/server/tempo/fuso';

import { ANA_DEMO, BIA_DEMO, CARLA_DEMO, FUSO_DEMO, SERVICOS_DEMO } from './demonstracao';

export const VISTAS_RESERVA_NOVA = ['encaixe', 'erros', 'criada'] as const;

const [ESCOVA, HIDRATACAO, MANICURE] = SERVICOS_DEMO;

/** Três linhas do exemplo na data dada; no modo profissional todas são da Ana (a profissional logada). */
function tresLinhas(valores: ValoresReservaManual, proprio: boolean): ValoresReservaManual {
  const prof = (id: string) => (proprio ? ANA_DEMO.id : id);
  return {
    ...valores,
    nome: 'Maria Souza',
    telefone: '(11) 91234-5678',
    itens: [
      { servicoId: ESCOVA.id, profissionalId: prof(ANA_DEMO.id), hora: '09:00' },
      { servicoId: HIDRATACAO.id, profissionalId: prof(BIA_DEMO.id), hora: '19:00' },
      { servicoId: MANICURE.id, profissionalId: prof(CARLA_DEMO.id), hora: '13:00' },
    ],
  };
}

/** Estado inicial da vista pedida (lista fechada; outro valor = formulário de uma linha). */
export function estadoDaVista(vista: unknown, chave: string, valores: ValoresReservaManual, proprio: boolean): EstadoReservaManual {
  if (vista === 'encaixe') {
    return {
      ...estadoInicial(chave, tresLinhas(valores, proprio)),
      encaixe: [
        { indice: 1, motivos: ['fora_da_jornada'] },
        { indice: 2, motivos: ['bloqueado', 'fora_do_funcionamento'] },
      ],
    };
  }
  if (vista === 'erros') {
    const base = tresLinhas(valores, proprio);
    return {
      ...estadoInicial(chave, { ...base, itens: [base.itens[0], { ...base.itens[1], hora: '9h' }, { ...base.itens[2], servicoId: ESCOVA.id }] }),
      errosPorLinha: {
        1: { hora: MENSAGENS_FORMULARIO_EQUIPE.hora },
        2: { servico: MENSAGENS_FORMULARIO_EQUIPE.servicoRepetido(1) },
      },
    };
  }
  if (vista === 'criada') {
    // A data vem de `valoresIniciais` (sempre válida: a da query ou hoje).
    const data = lerData(valores.data)!;
    const itens = tresLinhas(valores, proprio)
      .itens.map((l, k) => {
        const inicio = instanteDeHoraLocal(data, lerHora(l.hora)!, FUSO_DEMO);
        return {
          servicoId: l.servicoId,
          profissionalId: l.profissionalId,
          inicioIso: inicio.toISOString(),
          fimIso: new Date(inicio.getTime() + SERVICOS_DEMO[k].duracaoMin * 60_000).toISOString(),
          duracaoMin: SERVICOS_DEMO[k].duracaoMin,
          encaixe: k > 0,
        };
      })
      .sort((a, b) => a.inicioIso.localeCompare(b.inicioIso));
    return {
      ...estadoInicial(chave, valores),
      criada: { repetida: false, encaixes: itens.filter((i) => i.encaixe).length, hrefAgenda: hrefAgenda(ROTAS.devAgenda, { data: valores.data, visao: 'dia' }), itens },
    };
  }
  return estadoInicial(chave, valores);
}
