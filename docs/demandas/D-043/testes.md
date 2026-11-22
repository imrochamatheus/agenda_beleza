# D-043 (E7.3): testes

## Rodada 1 — veredito: APROVADO
Ambiente: branch feat/d-043-situacao-envio (não commitado), Node 24, PostgreSQL do compose, Chromium 375x812.

Gates (reexecutados pelo tester):
- `npm run lint`: 0. `npm run typecheck`: 0.
- `npm run test:coverage`: 528 arquivos, 6203 testes passando; linhas 98,89% (limiar 90%).
- Unit em `TZ=UTC` e `TZ=America/Sao_Paulo` (mensagens, componentes da agenda, agenda, dev, format): 607 testes passando nos dois.
- `npm run build` em cópia em diretório temporário (porta 3000 é do usuário, não tocada): OK.
- Playwright em cópia, porta 3117: `mensagens-situacao`, `mensagens-situacao-sem-js` e `agenda`: 28 passed (axe 4.14.0, teclado, geometria, sem JS).

CAs (CA-1..CA-15): todos atendidos, com testes lidos e reexecutados (situacao-equipe.test.ts: CA-1/2/3/5/6/11/12/13 e 1 comando SQL sem FOR; falha-mensagem.test.ts: CA-8/9/10, 6 instruções com 1 e 50 reservas, paridade com `conferirVigencia`; paginas.test.ts: CA-1/3/5/7/11/12; rotulos.test.ts: CA-4; sem-next.test.ts: CA-15).

Foco de segurança:
- Vazamento: DTO `MensagemSituacao` só tem id/estado/rótulo/motivo/tentativas/data; `erroCodigo` bruto é descartado no serviço; SQL não projeta destinatário, parâmetros, provedor nem `erro_detalhe`; testes com sentinelas no JSON e no HTML.
- Escopo: um único SQL `reserva LEFT JOIN mensagem` com `salao_id` e `profissional_id`; profissional de outra reserva, id inexistente, malformado e outro salão geram o mesmo NaoEncontrado (teste compara nome e mensagem).
- Grade: predicado do `EXISTS` idêntico a `conferirVigencia`; literais no SQL; sem telefone.
- Guardas: a liberação do CA-26 da D-024 vale só para rotulos, situacao-tipos, tipos e consultar-por-reserva (regex estrita; pipeline, envio, registro e reenvio seguem proibidos em src/app). Não enfraquece de forma relevante. `consultar.test.ts` ignora só a chave `temFalhaDeMensagem`. Nenhuma ação ou botão de reenvio na UI.

## Revisão visual (capturas próprias 375/768/1280 em scratchpad, fora do repo)
- Triângulo na grade: sobreposto no canto, bloco sem mudança de altura/posição (teste de geometria passou); cancelado com marca sem riscado (visto na semana e na grade).
- Só a falha tem fundo de erro; demais estados neutros ou sucesso; estados por texto.
- CSS: sem cor literal (grep), nenhum token novo, um só `@media (min-width: 48rem)`; contraste conforme pares do web-design (tokens existentes).
- Sem rolagem horizontal em dia, semana, detalhe e vitrine nos 3 viewports; sem JS e foco: specs passaram (nenhuma nova parada de Tab).

## Defeitos
Nenhum crítico, alto ou médio.
- Observação (baixa, não bloqueia): a vitrine `/dev/mensagens-reserva` mostra "Cancelamento substituído por remarcação posterior" (combinação tipo x estado que o pipeline não produz); apenas texto de demonstração.
- Desvio aceito: rótulo "Falha ao enviar remarcação 1 por WhatsApp" (inclui a revisão).
