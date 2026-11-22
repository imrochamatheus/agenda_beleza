import { DIAS_CARENCIA, DIAS_TESTE } from '@/config/plano';

import { somarUmMesCivilUtc } from './mes-civil';
import { ESTADOS_ASSINATURA } from './tipos';
import type { AssinaturaBruta, Decisao, EstadoAssinatura, EventoDominio, Passo } from './tipos';

// Máquina de estados pura da assinatura (D-037 §3). Sem relógio: `agora` e as datas dos eventos são
// entrada. Todo cálculo em UTC. Nunca lança: estado ou evento desconhecido vira `ignorado`.

const DIA_MS = 86_400_000;
const LIMPA_FALHA = { primeiraFalhaEm: null, carenciaAte: null } as const;

function ehEstado(v: string): v is EstadoAssinatura {
  return (ESTADOS_ASSINATURA as readonly string[]).includes(v);
}
function ehData(v: unknown): v is Date {
  return v instanceof Date && !Number.isNaN(v.getTime());
}
const maior = (a: Date, b: Date) => (a.getTime() >= b.getTime() ? a : b);
const transicao = (passo: Passo): Decisao => ({ tipo: 'transicoes', passos: [passo] });

function aprovada(a: AssinaturaBruta, estado: EstadoAssinatura, pagoEm: Date): Decisao {
  switch (estado) {
    case 'em_teste': {
      const base = maior(a.periodoPagoAte ?? a.testeFimEm ?? pagoEm, pagoEm);
      return transicao({
        de: 'em_teste',
        para: 'ativa',
        origem: 'pagamento_aprovado',
        campos: { periodoPagoAte: somarUmMesCivilUtc(base) },
      });
    }
    case 'ativa':
      return { tipo: 'atualiza', campos: { periodoPagoAte: somarUmMesCivilUtc(maior(a.periodoPagoAte ?? pagoEm, pagoEm)) } };
    case 'em_carencia':
    case 'suspensa':
      return transicao({
        de: estado,
        para: 'ativa',
        origem: 'pagamento_aprovado',
        campos: { periodoPagoAte: somarUmMesCivilUtc(pagoEm), ...LIMPA_FALHA },
      });
    case 'pendente':
      return { tipo: 'ignorado', motivo: 'assinatura_pendente' };
    default:
      return { tipo: 'ignorado', motivo: 'assinatura_encerrada' };
  }
}

function falhou(estado: EstadoAssinatura, falhouEm: Date): Decisao {
  switch (estado) {
    case 'ativa':
    case 'em_teste':
      return transicao({
        de: estado,
        para: 'em_carencia',
        origem: 'pagamento_recusado',
        campos: { primeiraFalhaEm: falhouEm, carenciaAte: new Date(falhouEm.getTime() + DIAS_CARENCIA * DIA_MS) },
      });
    case 'em_carencia':
    case 'suspensa':
    case 'encerrada':
      return { tipo: 'sem_efeito' };
    default:
      return { tipo: 'ignorado', motivo: 'estado_incompativel' };
  }
}

function cancelamento(a: AssinaturaBruta, estado: EstadoAssinatura, agora: Date): Decisao {
  switch (estado) {
    case 'em_teste':
      return transicao({
        de: 'em_teste',
        para: 'cancelada',
        origem: 'cancelamento_gestor',
        campos: { canceladaEm: agora, acessoAte: a.testeFimEm ?? agora },
      });
    case 'ativa':
      return transicao({
        de: 'ativa',
        para: 'cancelada',
        origem: 'cancelamento_gestor',
        campos: { canceladaEm: agora, acessoAte: a.periodoPagoAte ?? agora },
      });
    case 'pendente':
    case 'em_carencia':
    case 'suspensa':
      return transicao({ de: estado, para: 'encerrada', origem: 'cancelamento_gestor', campos: { canceladaEm: agora } });
    default:
      return { tipo: 'sem_efeito' };
  }
}

function prazo(a: AssinaturaBruta, estado: EstadoAssinatura, agora: Date): Decisao {
  const passos: Passo[] = [];
  let estadoAtual = estado;
  let carenciaAte = a.carenciaAte;
  const t = agora.getTime();
  if (estadoAtual === 'em_teste' && ehData(a.testeFimEm) && a.testeFimEm.getTime() <= t) {
    const fim = a.testeFimEm;
    carenciaAte = new Date(fim.getTime() + DIAS_CARENCIA * DIA_MS);
    passos.push({
      de: 'em_teste',
      para: 'em_carencia',
      origem: 'prazo_teste',
      campos: { primeiraFalhaEm: fim, carenciaAte },
    });
    estadoAtual = 'em_carencia';
  }
  if (estadoAtual === 'em_carencia' && ehData(carenciaAte) && carenciaAte.getTime() <= t) {
    passos.push({ de: 'em_carencia', para: 'suspensa', origem: 'prazo_carencia', campos: {} });
  } else if (estadoAtual === 'cancelada' && (!ehData(a.acessoAte) || a.acessoAte.getTime() <= t)) {
    passos.push({ de: 'cancelada', para: 'encerrada', origem: 'prazo_acesso', campos: {} });
  }
  return passos.length > 0 ? { tipo: 'transicoes', passos } : { tipo: 'sem_efeito' };
}

/** Decide o efeito de um evento sobre a assinatura. Pura e total. */
export function decidir(a: AssinaturaBruta, ev: EventoDominio, agora: Date): Decisao {
  const estado = a?.estado;
  if (typeof estado !== 'string' || !ehEstado(estado) || !ehData(agora) || typeof ev !== 'object' || ev === null) {
    return { tipo: 'ignorado', motivo: 'desconhecido' };
  }
  switch (ev.tipo) {
    case 'teste_iniciado':
      if (estado === 'pendente') {
        return transicao({
          de: 'pendente',
          para: 'em_teste',
          origem: 'teste_iniciado',
          campos: { testeFimEm: new Date((ehData(ev.iniciadoEm) ? ev.iniciadoEm : agora).getTime() + DIAS_TESTE * DIA_MS) },
        });
      }
      return estado === 'em_teste' ? { tipo: 'sem_efeito' } : { tipo: 'ignorado', motivo: 'estado_incompativel' };
    case 'cobranca_aprovada':
      return ehData(ev.pagoEm) ? aprovada(a, estado, ev.pagoEm) : { tipo: 'ignorado', motivo: 'desconhecido' };
    case 'cobranca_falhou':
      return ehData(ev.falhouEm) ? falhou(estado, ev.falhouEm) : { tipo: 'ignorado', motivo: 'desconhecido' };
    case 'cancelamento':
      return cancelamento(a, estado, agora);
    case 'prazo':
      return prazo(a, estado, agora);
    default:
      return { tipo: 'ignorado', motivo: 'desconhecido' };
  }
}
