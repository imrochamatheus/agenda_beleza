import { Alert } from '@/components/ui/Alert';
import { MENSAGENS_FUNCIONAMENTO as M } from '@/server/salao/funcionamento-tipos';
import type { Funcionamento } from '@/server/salao/funcionamento-tipos';

/** Avisos do estado gravado (D-020 RN-13): não informado, ou informado com todos os dias fechados (CA-7). */
export function AvisoDoFuncionamento({ funcionamento }: { funcionamento: Funcionamento }) {
  if (!funcionamento.definido) {
    return <Alert variante="info">{M.naoInformado}</Alert>;
  }
  if (funcionamento.semana.every((d) => d.intervalos.length === 0)) {
    return <Alert variante="aviso">{M.todosFechados}</Alert>;
  }
  return null;
}
