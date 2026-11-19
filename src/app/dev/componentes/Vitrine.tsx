'use client';

import { useState } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DataList, type Coluna } from '@/components/ui/DataList';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Field } from '@/components/ui/Field';
import { Select } from '@/components/ui/Select';
import { SlotGrid } from '@/components/ui/SlotGrid';
import { ROTAS } from '@/config/navegacao';
import { formatarDataHora, formatarMoeda } from '@/lib/format';

import estilos from './Vitrine.module.css';

// Dados fictícios, sem nomes de pessoas (RN-17).
type ServicoExemplo = { id: string; nome: string; duracao: string; precoCentavos: number; contato: string };

const SERVICOS: readonly ServicoExemplo[] = [
  { id: 's1', nome: 'Corte e escova', duracao: '45 min', precoCentavos: 8500, contato: 'agenda@exemplo.com.br' },
  {
    id: 's2',
    nome: 'Coloração com mechas e tratamento de reconstrução capilar completa',
    duracao: '3 h',
    precoCentavos: 42000,
    contato: 'contato.muito.longo.para.testar.quebra@exemplo.com.br',
  },
  { id: 's3', nome: 'Manicure', duracao: '40 min', precoCentavos: 4000, contato: 'unhas@exemplo.com.br' },
];

const COLUNAS: readonly Coluna<ServicoExemplo>[] = [
  { chave: 'nome', rotulo: 'Serviço', renderizar: (s) => s.nome },
  { chave: 'duracao', rotulo: 'Duração', renderizar: (s) => s.duracao },
  { chave: 'preco', rotulo: 'Preço', renderizar: (s) => formatarMoeda(s.precoCentavos) },
  { chave: 'contato', rotulo: 'Contato', renderizar: (s) => s.contato },
];

const FUSO = 'America/Sao_Paulo';
// Terça-feira, 10/03/2026, das 09:00 às 11:30 (de 30 em 30 min) em America/Sao_Paulo.
const HORARIOS_DIA = [
  '2026-03-10T12:00:00Z',
  '2026-03-10T12:30:00Z',
  '2026-03-10T13:00:00Z',
  '2026-03-10T13:30:00Z',
  '2026-03-10T14:00:00Z',
  '2026-03-10T14:30:00Z',
].map((iso) => new Date(iso));
// Fim do horário de verão de 2019: a hora 23 de 16/02/2019 se repetiu.
const HORARIOS_REPETIDOS = ['2019-02-17T01:00:00Z', '2019-02-17T02:00:00Z'].map((iso) => new Date(iso));
const SEM_HORARIOS: readonly Date[] = [];

const OPCOES_PROFISSIONAL = [
  { valor: 'p1', rotulo: 'Profissional 1' },
  { valor: 'p2', rotulo: 'Profissional 2' },
  { valor: 'p3', rotulo: 'Profissional 3 (indisponível)', desabilitada: true },
];

type TipoDialogo = 'simples' | 'perigo' | 'demorada' | 'falha';

/** Espera da "confirmação demorada" (o E2E confere o Esc ignorado durante ela). */
export const ESPERA_DEMORADA_MS = 1500;

/** Conteúdo da vitrine (D-009 §3.10): todos os componentes, variantes e estados. */
export function Vitrine() {
  const [dialogo, setDialogo] = useState<TipoDialogo | null>(null);
  const [confirmados, setConfirmados] = useState(0);
  const [cancelados, setCancelados] = useState(0);
  const [tentativas, setTentativas] = useState(0);
  const [horario, setHorario] = useState<Date | null>(null);

  const fechar = () => setDialogo(null);
  const cancelar = () => setCancelados((n) => n + 1);
  const confirmar = () => setConfirmados((n) => n + 1);

  return (
    <div className={estilos.vitrine}>
      <h1>Vitrine de componentes</h1>
      <p className={estilos.intro}>
        Exemplos dos componentes e layouts da base visual, com dados fictícios. Esta página só existe no
        desenvolvimento e nos testes.
      </p>

      <section aria-labelledby="secao-botoes" className={estilos.secao}>
        <h2 id="secao-botoes">Botões</h2>
        <div className={estilos.linha}>
          <Button>Salvar</Button>
          <Button variante="secundaria">Voltar</Button>
          <Button variante="perigo">Excluir</Button>
          <Button variante="discreta">Ver detalhes</Button>
          <Button disabled>Indisponível</Button>
          <Button ocupado rotuloOcupado="Salvando…">
            Salvar
          </Button>
          <Button desabilitadoFocavel aria-describedby="motivo-bloqueio">
            Agendar
          </Button>
        </div>
        <p id="motivo-bloqueio" className={estilos.nota}>
          O botão “Agendar” continua focável, mas fica bloqueado até a assinatura ser regularizada.
        </p>
      </section>

      <section aria-labelledby="secao-campos" className={estilos.secao}>
        <h2 id="secao-campos">Campos</h2>
        <Field rotulo="Nome do salão" name="nome" autoComplete="organization" obrigatorio />
        <Field rotulo="E-mail" tipo="email" name="email" autoComplete="email" ajuda="Usado para avisos da conta." />
        <Field rotulo="Telefone" tipo="tel" name="telefone" inputMode="tel" autoComplete="tel" />
        <Field rotulo="Senha" tipo="password" name="senha" autoComplete="new-password" />
        <Field rotulo="Duração (minutos)" tipo="number" name="duracao" min={5} step={5} />
        <Field rotulo="Data" tipo="date" name="data" />
        <Field
          rotulo="E-mail de contato"
          tipo="email"
          name="contato"
          defaultValue="contato@"
          erro="Informe um e-mail válido."
        />
      </section>

      <section aria-labelledby="secao-selecao" className={estilos.secao}>
        <h2 id="secao-selecao">Seleção</h2>
        <Select rotulo="Profissional" opcoes={OPCOES_PROFISSIONAL} textoVazio="Qualquer profissional" />
        <Select rotulo="Serviço" opcoes={OPCOES_PROFISSIONAL} textoVazio="Escolha…" erro="Escolha um serviço." obrigatorio />
      </section>

      <section aria-labelledby="secao-caixas" className={estilos.secao}>
        <h2 id="secao-caixas">Caixas de seleção</h2>
        <Checkbox rotulo="Lembrar este dispositivo" name="lembrar" />
        <Checkbox
          name="consentimento"
          obrigatorio
          rotulo={
            <>
              Li e aceito os <a href={ROTAS.termos}>Termos de Uso</a> e a{' '}
              <a href={ROTAS.privacidade}>Política de Privacidade</a>
            </>
          }
        />
      </section>

      <section aria-labelledby="secao-alertas" className={estilos.secao}>
        <h2 id="secao-alertas">Alertas</h2>
        <Alert variante="info">Os horários são mostrados no fuso do salão.</Alert>
        <Alert variante="sucesso" titulo="Reserva confirmada">
          A cliente vai receber a confirmação.
        </Alert>
        <Alert variante="aviso" titulo="Assinatura em atraso">
          Regularize o pagamento para não suspender o salão.
        </Alert>
        <Alert variante="erro">Não foi possível salvar as alterações.</Alert>
      </section>

      <section aria-labelledby="secao-estados" className={estilos.secao}>
        <h2 id="secao-estados">Estados</h2>
        <EmptyState
          nivelTitulo={3}
          titulo="Nenhum serviço cadastrado."
          descricao="Cadastre os serviços para que as clientes possam agendar."
          acao={<Button variante="secundaria">Cadastrar serviço</Button>}
        />
        <ErrorState
          nivelTitulo={3}
          titulo="Não foi possível carregar a agenda."
          descricao="Verifique a conexão e tente de novo."
          onTentarNovamente={() => setTentativas((n) => n + 1)}
        />
        <p data-testid="contador-tentativas">Tentativas: {tentativas}</p>
      </section>

      <section aria-labelledby="secao-lista" className={estilos.secao}>
        <h2 id="secao-lista">Lista de dados</h2>
        <DataList legenda="Serviços do salão" colunas={COLUNAS} linhas={SERVICOS} chaveDaLinha={(s) => s.id} />
        <DataList legenda="Serviços inativos" colunas={COLUNAS} linhas={[]} chaveDaLinha={(s) => s.id} />
      </section>

      <section aria-labelledby="secao-horarios" className={estilos.secao}>
        <h2 id="secao-horarios">Grade de horários</h2>
        <SlotGrid
          rotuloGrupo="Horários de terça-feira, 10/03/2026"
          fuso={FUSO}
          instantes={HORARIOS_DIA}
          selecionado={horario}
          onSelecionar={setHorario}
        />
        <p data-testid="horario-escolhido">
          Horário escolhido: {horario ? formatarDataHora(horario, FUSO) : 'nenhum'}
        </p>
        <SlotGrid rotuloGrupo="Horários de sábado, 16/02/2019" fuso={FUSO} instantes={HORARIOS_REPETIDOS} />
        <SlotGrid rotuloGrupo="Horários de domingo, 15/03/2026" fuso={FUSO} instantes={SEM_HORARIOS} />
      </section>

      <section aria-labelledby="secao-dialogos" className={estilos.secao}>
        <h2 id="secao-dialogos">Diálogos</h2>
        <div className={estilos.linha}>
          <Button variante="secundaria" onClick={() => setDialogo('simples')}>
            Abrir confirmação
          </Button>
          <Button variante="secundaria" onClick={() => setDialogo('perigo')}>
            Abrir confirmação de perigo
          </Button>
          <Button variante="secundaria" onClick={() => setDialogo('demorada')}>
            Abrir confirmação demorada
          </Button>
          <Button variante="secundaria" onClick={() => setDialogo('falha')}>
            Abrir confirmação que falha
          </Button>
        </div>
        <p data-testid="contador-confirmado">Confirmações: {confirmados}</p>
        <p data-testid="contador-cancelado">Cancelamentos: {cancelados}</p>

        <ConfirmDialog
          aberto={dialogo === 'simples'}
          titulo="Confirmar a reserva?"
          descricao="A cliente vai receber a confirmação."
          rotuloConfirmar="Confirmar"
          onConfirmar={confirmar}
          onCancelar={cancelar}
          onFechar={fechar}
        />
        <ConfirmDialog
          aberto={dialogo === 'perigo'}
          variante="perigo"
          titulo="Excluir o serviço?"
          descricao="O serviço deixa de aparecer para as clientes."
          rotuloConfirmar="Excluir"
          onConfirmar={confirmar}
          onCancelar={cancelar}
          onFechar={fechar}
        />
        <ConfirmDialog
          aberto={dialogo === 'demorada'}
          titulo="Cancelar a reserva?"
          descricao="A cliente vai ser avisada do cancelamento."
          rotuloConfirmar="Cancelar reserva"
          rotuloCancelar="Voltar"
          rotuloOcupado="Cancelando…"
          onConfirmar={() =>
            new Promise<void>((resolver) => {
              setTimeout(() => {
                confirmar();
                resolver();
              }, ESPERA_DEMORADA_MS);
            })
          }
          onCancelar={cancelar}
          onFechar={fechar}
        />
        <ConfirmDialog
          aberto={dialogo === 'falha'}
          titulo="Enviar o convite?"
          descricao="Nesta demonstração, o envio sempre falha."
          rotuloConfirmar="Enviar"
          onConfirmar={() => Promise.reject(new Error('falha simulada'))}
          onCancelar={cancelar}
          onFechar={fechar}
        />
      </section>
    </div>
  );
}
