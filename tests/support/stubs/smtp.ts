import { createServer, type AddressInfo, type Socket } from 'node:net';

// Stub SMTP local para o adaptador real de e-mail (RN-6; D-007 §1.1, R-3). Escuta em 127.0.0.1
// numa porta efêmera e fala o subconjunto do protocolo que o nodemailer usa sem TLS: EHLO/HELO,
// AUTH PLAIN e AUTH LOGIN, MAIL FROM, RCPT TO, DATA, RSET, NOOP e QUIT, com códigos reais
// (220/250/235/334/354/221/530/535/550/451/503/502). Não anuncia STARTTLS: os testes passam
// `exigirTls: false` de forma explícita.
//
// Modos:
// - `aceitar`: aceita tudo (a autenticação confere com `credenciais`, quando informadas);
// - `recusarAuth`: responde 535 ao AUTH, ECOANDO a credencial recebida na resposta. É de propósito:
//   se o adaptador repassar `response`/`cause` do erro do nodemailer, o teste do CA-12 encontra a
//   senha em base64 na serialização do erro;
// - `recusarRcpt`: 550 em todo RCPT TO; `adiarRcpt`: 451 em todo RCPT TO (falha temporária);
// - `silencioso`: aceita a conexão e nunca envia a saudação (o cliente cai no tempo-limite).

export type ModoSmtp = 'aceitar' | 'recusarAuth' | 'recusarRcpt' | 'adiarRcpt' | 'silencioso';

export type Credenciais = { usuario: string; senha: string };

export type MensagemSmtpRecebida = {
  /** Endereço do `MAIL FROM:<…>`, sem os sinais de menor e maior. */
  mailFrom: string;
  /** Endereços dos `RCPT TO:<…>` aceitos. */
  rcptTo: string[];
  /** Conteúdo bruto do DATA (cabeçalhos + corpo), já sem o ponto final e sem dot-stuffing. */
  dados: string;
  /** Credenciais aceitas na sessão; null quando não houve AUTH. */
  autenticacao: Credenciais | null;
};

export type StubSmtp = {
  readonly host: '127.0.0.1';
  readonly porta: number;
  readonly mensagens: MensagemSmtpRecebida[];
  /** Linhas de comando recebidas fora do DATA, na ordem (inclui as linhas de AUTH). */
  readonly comandos: string[];
  /** Quantas conexões o stub recebeu. */
  conexoes(): number;
  definirModo(modo: ModoSmtp): void;
  fechar(): Promise<void>;
};

type Sessao = {
  autenticacao: Credenciais | null;
  mailFrom: string | null;
  rcptTo: string[];
  estado: 'comando' | 'dados' | 'authPlain' | 'authLoginUsuario' | 'authLoginSenha';
  usuarioLogin: string;
  linhasDados: string[];
};

const decodificar = (b64: string) => Buffer.from(b64, 'base64').toString('utf8');
const enderecoEntre = (linha: string) => /<([^>]*)>/.exec(linha)?.[1] ?? '';

export async function iniciarStubSmtp(
  opcoes: { modo?: ModoSmtp; credenciais?: Credenciais } = {},
): Promise<StubSmtp> {
  let modo: ModoSmtp = opcoes.modo ?? 'aceitar';
  const mensagens: MensagemSmtpRecebida[] = [];
  const comandos: string[] = [];
  const sockets = new Set<Socket>();
  let totalConexoes = 0;

  const servidor = createServer((socket) => {
    totalConexoes += 1;
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => socket.destroy());
    if (modo === 'silencioso') return;

    const sessao: Sessao = {
      autenticacao: null,
      mailFrom: null,
      rcptTo: [],
      estado: 'comando',
      usuarioLogin: '',
      linhasDados: [],
    };
    const responder = (linha: string) => {
      if (!socket.destroyed) socket.write(`${linha}\r\n`);
    };

    const concluirAuth = (credencial: Credenciais, recebido: string) => {
      sessao.estado = 'comando';
      const esperadas = opcoes.credenciais;
      const confere =
        !esperadas ||
        (esperadas.usuario === credencial.usuario && esperadas.senha === credencial.senha);
      if (modo === 'recusarAuth' || !confere) {
        responder(`535 5.7.8 Autenticacao recusada (recebido: ${recebido})`);
        return;
      }
      sessao.autenticacao = credencial;
      responder('235 2.7.0 Autenticado');
    };

    const authPlain = (b64: string) => {
      const [, usuario = '', senha = ''] = decodificar(b64).split('\0');
      concluirAuth({ usuario, senha }, b64);
    };

    const tratarComando = (linha: string) => {
      comandos.push(linha);
      const [verbo = '', ...resto] = linha.split(' ');
      const argumento = resto.join(' ');
      switch (verbo.toUpperCase()) {
        case 'EHLO':
          responder('250-stub.local');
          responder('250-AUTH PLAIN LOGIN');
          responder('250 8BITMIME');
          return;
        case 'HELO':
          responder('250 stub.local');
          return;
        case 'AUTH': {
          const [metodo = '', inicial] = argumento.split(' ');
          if (metodo.toUpperCase() === 'PLAIN') {
            if (inicial) authPlain(inicial);
            else {
              sessao.estado = 'authPlain';
              responder('334 ');
            }
            return;
          }
          if (metodo.toUpperCase() === 'LOGIN') {
            if (inicial) {
              sessao.usuarioLogin = decodificar(inicial);
              sessao.estado = 'authLoginSenha';
              responder('334 UGFzc3dvcmQ6');
            } else {
              sessao.estado = 'authLoginUsuario';
              responder('334 VXNlcm5hbWU6');
            }
            return;
          }
          responder('504 5.5.4 Mecanismo nao suportado');
          return;
        }
        case 'MAIL':
          if (opcoes.credenciais && !sessao.autenticacao) {
            responder('530 5.7.0 Autenticacao exigida');
            return;
          }
          sessao.mailFrom = enderecoEntre(argumento);
          sessao.rcptTo = [];
          responder('250 2.1.0 OK');
          return;
        case 'RCPT':
          if (sessao.mailFrom === null) {
            responder('503 5.5.1 MAIL antes');
            return;
          }
          if (modo === 'recusarRcpt') {
            responder('550 5.1.1 Destinatario recusado');
            return;
          }
          if (modo === 'adiarRcpt') {
            responder('451 4.3.0 Tente mais tarde');
            return;
          }
          sessao.rcptTo.push(enderecoEntre(argumento));
          responder('250 2.1.5 OK');
          return;
        case 'DATA':
          if (sessao.rcptTo.length === 0) {
            responder('503 5.5.1 RCPT antes');
            return;
          }
          sessao.estado = 'dados';
          sessao.linhasDados = [];
          responder('354 Termine com <CRLF>.<CRLF>');
          return;
        case 'RSET':
          sessao.mailFrom = null;
          sessao.rcptTo = [];
          responder('250 2.0.0 OK');
          return;
        case 'NOOP':
          responder('250 2.0.0 OK');
          return;
        case 'QUIT':
          responder('221 2.0.0 Tchau');
          socket.end();
          return;
        default:
          responder('502 5.5.2 Comando nao reconhecido');
      }
    };

    const tratarLinha = (linha: string) => {
      switch (sessao.estado) {
        case 'dados':
          if (linha === '.') {
            mensagens.push({
              mailFrom: sessao.mailFrom ?? '',
              rcptTo: sessao.rcptTo,
              dados: sessao.linhasDados.join('\r\n'),
              autenticacao: sessao.autenticacao,
            });
            sessao.estado = 'comando';
            sessao.mailFrom = null;
            sessao.rcptTo = [];
            responder(`250 2.0.0 OK id=${mensagens.length}`);
          } else {
            sessao.linhasDados.push(linha.startsWith('..') ? linha.slice(1) : linha);
          }
          return;
        case 'authPlain':
          comandos.push(linha);
          authPlain(linha);
          return;
        case 'authLoginUsuario':
          comandos.push(linha);
          sessao.usuarioLogin = decodificar(linha);
          sessao.estado = 'authLoginSenha';
          responder('334 UGFzc3dvcmQ6');
          return;
        case 'authLoginSenha':
          comandos.push(linha);
          concluirAuth({ usuario: sessao.usuarioLogin, senha: decodificar(linha) }, linha);
          return;
        case 'comando':
          tratarComando(linha);
      }
    };

    let pendente = '';
    socket.setEncoding('utf8');
    socket.on('data', (parte: string) => {
      pendente += parte;
      let fim: number;
      while ((fim = pendente.indexOf('\r\n')) !== -1) {
        const linha = pendente.slice(0, fim);
        pendente = pendente.slice(fim + 2);
        tratarLinha(linha);
      }
    });
    responder('220 stub.local ESMTP pronto');
  });

  await new Promise<void>((resolve, reject) => {
    servidor.once('error', reject);
    servidor.listen(0, '127.0.0.1', () => resolve());
  });
  const { port } = servidor.address() as AddressInfo;

  return {
    host: '127.0.0.1',
    porta: port,
    mensagens,
    comandos,
    conexoes: () => totalConexoes,
    definirModo(novo) {
      modo = novo;
    },
    fechar() {
      return new Promise<void>((resolve, reject) => {
        servidor.close((erro) => (erro ? reject(erro) : resolve()));
        for (const socket of sockets) socket.destroy();
      });
    },
  };
}
