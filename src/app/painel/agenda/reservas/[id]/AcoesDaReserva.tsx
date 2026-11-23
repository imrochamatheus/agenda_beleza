'use client';

import { useActionState, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

import { idDoItem, ROTULO_DO_ROTEIRO } from '@/app/painel/agenda/_componentes/roteiro';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import botao from '@/components/ui/Button.module.css';
import { classes } from '@/components/ui/campo';
import { Checkbox } from '@/components/ui/Checkbox';
import { ErroDoCampo, Field } from '@/components/ui/Field';
import { RoteiroDoDia } from '@/components/ui/RoteiroDoDia';
import type { ParadaDoRoteiro } from '@/components/ui/RoteiroDoDia';
import { Select } from '@/components/ui/Select';
import type { Opcao } from '@/components/ui/Select';
import { MENSAGENS_AGENDA } from '@/server/agenda/tipos';
import type { AcoesDoItem } from '@/server/agenda/tipos';
import { MENSAGENS_MOTIVO_ENCAIXE } from '@/server/reservas/tipos';

import estilos from './AcoesDaReserva.module.css';
import {
  ANCORA_CANCELAR,
  ANCORA_CANCELAR_TODOS,
  ANCORA_REMARCAR,
  estadoCancelarTodosInicial,
  estadoDoItemInicial,
  estadoRemarcarInicial,
  hrefCancelar,
  hrefCancelarTodos,
  hrefRemarcar,
  idDoCampoRemarcar,
  MENSAGENS_FORMULARIO_ALTERACAO,
} from './estado';
import type { Abertura, CampoRemarcar, EstadoCancelarTodos, EstadoDoItem, EstadoRemarcar, ValoresRemarcar } from './estado';

/** Dados de cada item para as ações (mesma ordem das paradas). Só texto e booleanos: o cliente não recebe função. */
export type ItemDasAcoes = { id: string; servico: string; hora: string; acoes: AcoesDoItem };

export type AcoesDaReservaProps = {
  reservaId: string;
  /** Página sem parâmetros de abertura (real ou vitrine); "Fechar"/"Manter" voltam para ela. */
  hrefBase: string;
  /** Paradas do roteiro, sem ações (o componente acrescenta as de cada item). */
  paradas: ParadaDoRoteiro[];
  itens: ItemDasAcoes[];
  /** Formulário aberto pela URL, já conferido contra os itens e as ações permitidas. */
  abrir: Abertura;
  /** Formulário de remarcar do item `abrir.remarcar` (null quando nenhum está aberto). */
  remarcar: {
    valores: ValoresRemarcar;
    servicos: Opcao[];
    /** Gestor: opções; null = profissional (agenda própria, fixa). */
    profissionais: Opcao[] | null;
    profissionalFixo: string;
    /** Gestor: nome do profissional ATUAL quando inativo (o select começa vazio, DEF-1); null nos demais casos. */
    profissionalInativo: string | null;
    /** Data como texto quando há outro serviço não cancelado (RN-22); null = campo de data. */
    dataFixa: string | null;
  } | null;
  /** Textos das confirmações (montados no servidor): do item em `abrir.cancelar` e de "Cancelar todos". */
  textos: { cancelarItem: string | null; cancelarTodos: string | null };
  /** "Cancelar todos os serviços" só para o gestor e com 2+ canceláveis (ND-3). */
  podeCancelarTodos: boolean;
  /** Total e nota (servidor). */
  rodape: ReactNode;
  /** Ações de servidor (as reais ou as da vitrine) ou, nos testes, funções equivalentes. */
  acaoRemarcar: (anterior: EstadoRemarcar, fd: FormData) => Promise<EstadoRemarcar>;
  acaoCancelar: (anterior: EstadoDoItem, fd: FormData) => Promise<EstadoDoItem>;
  acaoMarcar: (anterior: EstadoDoItem, fd: FormData) => Promise<EstadoDoItem>;
  acaoCancelarTodos: (anterior: EstadoCancelarTodos, fd: FormData) => Promise<EstadoCancelarTodos>;
};

const ORDEM: readonly CampoRemarcar[] = ['servico', 'profissional', 'data', 'hora'];
const ROTULOS: Record<CampoRemarcar, string> = { servico: 'Serviço', profissional: 'Profissional', data: 'Data', hora: 'Hora' };

const VALORES_VAZIOS: ValoresRemarcar = { servicoId: '', profissionalId: '', data: '', hora: '', confirmarEncaixe: false };

function LinkBotao({ href, variante, children }: { href: string; variante: 'secundaria' | 'perigo'; children: ReactNode }) {
  return (
    <a href={href} className={classes(botao.botao, botao[variante], estilos.linkBotao)}>
      {children}
    </a>
  );
}

/**
 * Roteiro da reserva com as ações POR ITEM (D-050 web-design §5.10; design §1.3 C2), sem diálogo e sem JS
 * obrigatório: situação (POST), Remarcar e Cancelar abertos por GET (`?remarcar=`, `?cancelar=`) logo abaixo
 * da parada, e "Cancelar todos" (GET + POST) sob o total. QUATRO `useActionState`, SEMPRE na mesma ordem
 * (remarcar, cancelar, marcar situação, cancelar todos), para a resposta do POST sem JS não perder o estado;
 * cada estado carrega o `itemId` para a mensagem aparecer na parada certa.
 */
export function AcoesDaReserva({
  reservaId,
  hrefBase,
  paradas,
  itens,
  abrir,
  remarcar,
  textos,
  podeCancelarTodos,
  rodape,
  acaoRemarcar,
  acaoCancelar,
  acaoMarcar,
  acaoCancelarTodos,
}: AcoesDaReservaProps) {
  const [remarcarEstado, remarcarEnviar, remarcando] = useActionState(acaoRemarcar, estadoRemarcarInicial(abrir.remarcar, remarcar?.valores ?? VALORES_VAZIOS));
  const [cancelarEstado, cancelarEnviar, cancelando] = useActionState(acaoCancelar, estadoDoItemInicial);
  const [marcarEstado, marcarEnviar, marcando] = useActionState(acaoMarcar, estadoDoItemInicial);
  const [todosEstado, todosEnviar, cancelandoTodos] = useActionState(acaoCancelarTodos, estadoCancelarTodosInicial);
  const aviso = useRef<HTMLDivElement>(null);
  const resumo = useRef<HTMLDivElement>(null);

  const { erros, valores, motivos } = remarcarEstado;
  const itensErro = ORDEM.filter((c) => erros[c]).map((c) => ({ href: `#${idDoCampoRemarcar(c)}`, texto: `${ROTULOS[c]}: ${erros[c]}` }));
  const pedeConfirmacao = motivos !== null && motivos.length > 0;

  useEffect(() => {
    if (itensErro.length > 0) resumo.current?.focus();
    else if (pedeConfirmacao) aviso.current?.focus();
  }, [remarcarEstado, itensErro.length, pedeConfirmacao]);

  const formularioRemarcar = (item: ItemDasAcoes) =>
    remarcar === null ? null : (
      <form action={remarcarEnviar} className={estilos.formulario} noValidate>
        <h3 id={ANCORA_REMARCAR} tabIndex={-1}>
          Remarcar {item.servico}
        </h3>
        <input type="hidden" name="reservaId" value={reservaId} />
        <input type="hidden" name="itemId" value={item.id} />
        <input type="hidden" name="de" value={item.hora} />
        {remarcarEstado.mensagem && !pedeConfirmacao ? <Alert variante="erro">{remarcarEstado.mensagem}</Alert> : null}
        {itensErro.length > 0 ? (
          <div ref={resumo} id="remarcar-resumo-erros" tabIndex={-1} className={estilos.resumoErros} role="alert" aria-labelledby="remarcar-resumo-erros-titulo">
            <p id="remarcar-resumo-erros-titulo" className={estilos.titulo}>
              {MENSAGENS_FORMULARIO_ALTERACAO.resumoErros}
            </p>
            <ul>
              {itensErro.map((i) => (
                <li key={i.texto}>
                  <a href={i.href}>{i.texto}</a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {pedeConfirmacao ? (
          <div ref={aviso} id="remarcar-aviso-encaixe" tabIndex={-1} className={estilos.aviso} role="alert" aria-labelledby="remarcar-aviso-encaixe-titulo">
            <p id="remarcar-aviso-encaixe-titulo" className={estilos.titulo}>
              Atenção: encaixe
            </p>
            <p>{remarcarEstado.mensagem}</p>
            <ul>
              {motivos.map((m) => (
                <li key={m}>{MENSAGENS_MOTIVO_ENCAIXE[m]}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <Select
          id={idDoCampoRemarcar('servico')}
          name="servicoId"
          rotulo={ROTULOS.servico}
          opcoes={remarcar.servicos}
          defaultValue={valores.servicoId}
          erro={erros.servico}
          key={`s-${valores.servicoId}`}
        />

        {remarcar.profissionais !== null ? (
          <Select
            id={idDoCampoRemarcar('profissional')}
            name="profissionalId"
            rotulo={ROTULOS.profissional}
            opcoes={remarcar.profissionais}
            {...(remarcar.profissionalInativo !== null && {
              textoVazio: MENSAGENS_FORMULARIO_ALTERACAO.escolhaProfissional,
              ajuda: `Atual: ${remarcar.profissionalInativo} (${MENSAGENS_AGENDA.inativo}).`,
            })}
            defaultValue={valores.profissionalId}
            erro={erros.profissional}
            key={`p-${valores.profissionalId}`}
          />
        ) : (
          <div>
            <p className={estilos.fixo} id={idDoCampoRemarcar('profissional')}>
              <strong>{ROTULOS.profissional}:</strong> {remarcar.profissionalFixo}
            </p>
            {erros.profissional ? <ErroDoCampo id={`${idDoCampoRemarcar('profissional')}-erro`} texto={erros.profissional} /> : null}
          </div>
        )}

        {remarcar.dataFixa !== null ? (
          <div>
            <p className={estilos.fixo} id={idDoCampoRemarcar('data')}>
              <strong>{ROTULOS.data}:</strong> {remarcar.dataFixa} — a mesma dos outros serviços.
            </p>
            {erros.data ? <ErroDoCampo id={`${idDoCampoRemarcar('data')}-erro`} texto={erros.data} /> : null}
          </div>
        ) : (
          <Field id={idDoCampoRemarcar('data')} name="data" tipo="date" rotulo={ROTULOS.data} defaultValue={valores.data} erro={erros.data} key={`d-${valores.data}`} />
        )}

        <Field
          id={idDoCampoRemarcar('hora')}
          name="hora"
          rotulo={`${ROTULOS.hora} (HH:MM)`}
          autoComplete="off"
          maxLength={5}
          inputMode="numeric"
          pattern="([01]?[0-9]|2[0-3]):[0-5][0-9]"
          defaultValue={valores.hora}
          erro={erros.hora}
          key={`h-${valores.hora}`}
        />

        {pedeConfirmacao ? (
          <Checkbox id="remarcar-confirmar-encaixe" name="confirmarEncaixe" rotulo="Confirmo o encaixe" defaultChecked={valores.confirmarEncaixe} key={`c-${valores.confirmarEncaixe}`} />
        ) : null}

        <div className={estilos.linha}>
          <Button type="submit" ocupado={remarcando} rotuloOcupado="Remarcando…">
            Remarcar serviço
          </Button>
          <LinkBotao href={`${hrefBase}#${idDoItem(item.id)}`} variante="secundaria">
            Fechar
          </LinkBotao>
        </div>
      </form>
    );

  const confirmacaoCancelar = (item: ItemDasAcoes) => (
    <div id={ANCORA_CANCELAR} tabIndex={-1} className={estilos.confirmacao} role="group" aria-labelledby={`${ANCORA_CANCELAR}-texto`}>
      <p id={`${ANCORA_CANCELAR}-texto`}>{textos.cancelarItem}</p>
      <form action={cancelarEnviar} className={estilos.linha}>
        <input type="hidden" name="reservaId" value={reservaId} />
        <input type="hidden" name="itemId" value={item.id} />
        <Button type="submit" variante="perigo" ocupado={cancelando} rotuloOcupado="Cancelando…">
          Sim, cancelar este serviço
        </Button>
        <LinkBotao href={`${hrefBase}#${idDoItem(item.id)}`} variante="secundaria">
          Manter serviço
        </LinkBotao>
      </form>
    </div>
  );

  const acoesDoItem = (item: ItemDasAcoes): ReactNode => {
    const { acoes } = item;
    const erroMarcar = marcarEstado.itemId === item.id ? marcarEstado.mensagem : null;
    const erroCancelar = cancelarEstado.itemId === item.id ? cancelarEstado.mensagem : null;
    const remarcarAberto = abrir.remarcar === item.id && acoes.remarcar;
    const cancelarAberto = abrir.cancelar === item.id && acoes.cancelar && textos.cancelarItem !== null;
    const temAlgo = acoes.concluir || acoes.naoCompareceu || acoes.remarcar || acoes.cancelar || erroMarcar || erroCancelar;
    if (!temAlgo) return undefined;
    return (
      <>
        {erroMarcar ? (
          <div className={estilos.painel}>
            <Alert variante="erro">{erroMarcar}</Alert>
          </div>
        ) : null}
        {erroCancelar ? (
          <div className={estilos.painel}>
            <Alert variante="erro">{erroCancelar}</Alert>
          </div>
        ) : null}
        {acoes.concluir || acoes.naoCompareceu ? (
          <form action={marcarEnviar} className={estilos.linha}>
            <input type="hidden" name="reservaId" value={reservaId} />
            <input type="hidden" name="itemId" value={item.id} />
            {acoes.concluir ? (
              <Button type="submit" name="destino" value="concluido" aria-label={`Marcar ${item.servico} como concluído`} ocupado={marcando} rotuloOcupado="Salvando…">
                Concluído
              </Button>
            ) : null}
            {acoes.naoCompareceu ? (
              <Button
                type="submit"
                name="destino"
                value="nao_compareceu"
                variante="secundaria"
                aria-label={`Marcar ${item.servico} como não compareceu`}
                ocupado={marcando}
                rotuloOcupado="Salvando…"
              >
                Não compareceu
              </Button>
            ) : null}
          </form>
        ) : null}
        {acoes.remarcar || acoes.cancelar ? (
          <p className={estilos.linha}>
            {acoes.remarcar ? (
              <a className={estilos.linkAcao} href={hrefRemarcar(hrefBase, item.id)}>
                Remarcar{' '}
                <span className={estilos.somenteLeitor}>
                  {item.servico} ({item.hora})
                </span>
              </a>
            ) : null}
            {acoes.cancelar ? (
              <a className={estilos.linkAcao} href={hrefCancelar(hrefBase, item.id)}>
                Cancelar{' '}
                <span className={estilos.somenteLeitor}>
                  {item.servico} ({item.hora})
                </span>
              </a>
            ) : null}
          </p>
        ) : null}
        {remarcarAberto ? <div className={estilos.painel}>{formularioRemarcar(item)}</div> : null}
        {cancelarAberto ? <div className={estilos.painel}>{confirmacaoCancelar(item)}</div> : null}
      </>
    );
  };

  const porId = new Map(itens.map((i) => [i.id, i]));
  const comAcoes: ParadaDoRoteiro[] = paradas.map((p) => {
    const item = porId.get(p.chave);
    return item ? { ...p, acoes: acoesDoItem(item) } : p;
  });

  const cancelarTodos = podeCancelarTodos ? (
    <div className={estilos.cancelarTodos}>
      {todosEstado.mensagem ? <Alert variante="erro">{todosEstado.mensagem}</Alert> : null}
      {abrir.cancelarTodos && textos.cancelarTodos !== null ? (
        <div id={ANCORA_CANCELAR_TODOS} tabIndex={-1} className={estilos.confirmacao} role="group" aria-labelledby={`${ANCORA_CANCELAR_TODOS}-texto`}>
          <p id={`${ANCORA_CANCELAR_TODOS}-texto`}>{textos.cancelarTodos}</p>
          <form action={todosEnviar} className={estilos.linha}>
            <input type="hidden" name="reservaId" value={reservaId} />
            <Button type="submit" variante="perigo" ocupado={cancelandoTodos} rotuloOcupado="Cancelando…">
              Sim, cancelar todos
            </Button>
            <LinkBotao href={hrefBase} variante="secundaria">
              Manter serviços
            </LinkBotao>
          </form>
        </div>
      ) : (
        <p className={estilos.linha}>
          <LinkBotao href={hrefCancelarTodos(hrefBase)} variante="perigo">
            Cancelar todos os serviços
          </LinkBotao>
        </p>
      )}
    </div>
  ) : null;

  return (
    <RoteiroDoDia
      rotulo={ROTULO_DO_ROTEIRO}
      paradas={comAcoes}
      rodape={
        <>
          {rodape}
          {cancelarTodos}
        </>
      }
    />
  );
}
