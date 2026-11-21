// Seed de demonstração (D-036 E9.2): dois salões completos e um super admin, idempotente e sem apagar nada.
// Único arquivo desta pasta com acesso ao banco (allowlist `ACESSO_AO_BANCO` do eslint); os dados e o
// planejamento de datas ficam em prisma/seed/*.ts (puros). Roda por `npm run db:seed`, por
// `docker compose exec app node dist/prisma/seed.js` e, como função, nos testes e no E2E.
//
// NUNCA use em produção: as credenciais são públicas. O CLI recusa NODE_ENV=production sem
// SEED_PERMITIR_PRODUCAO=true e nunca faz DELETE/TRUNCATE.
import { pathToFileURL } from 'node:url';

import type { PrismaClient } from '@/generated/prisma/client';
import { VERSAO_TERMOS } from '@/config/termos';
import { DIAS_TESTE } from '@/config/plano';
import { garantirSuperAdmin } from '@/server/auth/admin/garantir-super-admin';
import { gerarHashSenha } from '@/server/auth/senha';
import { detectarTipo } from '@/server/imagem/detectar';
import { processarImagem } from '@/server/imagem/processar';
import type { PortaArmazenamento } from '@/server/integrations/armazenamento/port';
import { integracoes } from '@/server/integrations/registry';
import { encerrarPrisma, obterPrisma } from '@/server/repos/db';

import { CREDENCIAIS_DEMO, type SalaoSpec } from './seed/dados';
import { ALT_DA_FOTO, chaveDaFotoDeDemonstracao, gerarPngDeDemonstracao } from './seed/fotos';
import { SALAO_A } from './seed/salao-a';
import { SALAO_B } from './seed/salao-b';
import { SALOES_E2E_RESERVAS, salaoE2eReservas, salaoE2eSuspenso, SLUG_E2E_SUSPENSO } from './seed/complemento-e2e';
import { ids, planejar } from './seed/plano';

export { CREDENCIAIS_DEMO } from './seed/dados';

const DIA_MS = 24 * 60 * 60 * 1000;

export type DepsSemente = {
  prisma?: PrismaClient;
  agora?: Date;
  armazenamento: PortaArmazenamento;
  env?: NodeJS.ProcessEnv;
};

/** NODE_ENV=production sem SEED_PERMITIR_PRODUCAO=true é recusado (RN-2). Lança antes de abrir conexão. */
export function recusarProducao(env: Readonly<Record<string, string | undefined>>): void {
  if (env.NODE_ENV === 'production' && env.SEED_PERMITIR_PRODUCAO !== 'true') {
    throw new Error(
      'O seed de demonstração não roda com NODE_ENV=production (as credenciais são públicas). ' +
        'Para forçar, defina SEED_PERMITIR_PRODUCAO=true.',
    );
  }
}

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

type FotoPronta = { chave: string; alt: string; largura: number; altura: number; bytes: number };

/** Gera, converte e grava (chave determinística: regravar é idempotente) as fotos do salão. */
async function prepararFotos(spec: SalaoSpec, salaoId: string, armazenamento: PortaArmazenamento): Promise<FotoPronta[]> {
  const fotos: FotoPronta[] = [];
  for (let n = 1; n <= spec.fotos; n += 1) {
    const png = gerarPngDeDemonstracao(n - 1);
    if (detectarTipo(png) !== 'png') throw new Error('foto de demonstração gerada não é PNG');
    const r = await processarImagem(png, 'png');
    if (!r.ok) throw new Error(`foto de demonstração recusada: ${r.erro}`);
    const chave = chaveDaFotoDeDemonstracao(salaoId, n);
    await armazenamento.gravar(chave, r.imagem.bytes, 'image/webp');
    fotos.push({ chave, alt: ALT_DA_FOTO(spec.nome, n), largura: r.imagem.largura, altura: r.imagem.altura, bytes: r.imagem.bytes.length });
  }
  return fotos;
}

async function inserirSalao(
  prisma: PrismaClient,
  spec: SalaoSpec,
  agora: Date,
  senhaHash: string,
  fotos: readonly FotoPronta[],
): Promise<'criado' | 'existente'> {
  const id = ids(spec);
  const plano = planejar(spec, agora);
  const p = spec.perfil;

  return prisma.$transaction(
    async (tx: Tx) => {
      // O salão é a âncora da idempotência: já existe (ou outra execução o criou) → nada mais é tocado.
      const salao = await tx.salao.createMany({
        data: [
          {
            id: id.salao,
            nome: spec.nome,
            fuso: spec.fuso,
            gradeMin: spec.gradeMin,
            intervaloMin: spec.intervaloMin,
            suspensoManualEm: spec.suspenso ? agora : null,
            descricao: p.descricao,
            enderecoLogradouro: p.logradouro,
            enderecoNumero: p.numero,
            enderecoComplemento: p.complemento ?? null,
            enderecoBairro: p.bairro,
            enderecoCidade: p.cidade,
            enderecoUf: p.uf,
            enderecoCep: p.cep,
            telefoneE164: p.telefone,
            whatsappE164: p.whatsapp,
            instagram: p.instagram,
            meiosPagamento: [...p.meiosPagamento],
            comodidades: [...p.comodidades],
            funcionamentoDefinido: spec.funcionamento !== null,
            criadoEm: agora,
          },
        ],
        skipDuplicates: true,
      });
      if (salao.count === 0) return 'existente';

      await tx.salaoSlug.createMany({ data: [{ slug: spec.slug, salaoId: id.salao, atual: true, criadoEm: agora }], skipDuplicates: true });

      const confirmado = agora;
      await tx.usuario.createMany({
        data: [
          { id: id.gestor, salaoId: id.salao, papel: 'gestor', email: spec.gestor.email, nome: spec.gestor.nome, senhaHash, emailConfirmadoEm: confirmado },
          ...spec.profissionais
            .filter((x) => x.usuarioEmail !== undefined)
            .map((x) => ({
              id: id.usuarioProfissional(x.chave),
              salaoId: id.salao,
              papel: 'profissional' as const,
              email: x.usuarioEmail!,
              nome: x.nome,
              senhaHash,
              emailConfirmadoEm: confirmado,
            })),
        ],
        skipDuplicates: true,
      });

      await tx.profissional.createMany({
        data: spec.profissionais.map((x) => ({
          id: id.profissional(x.chave),
          salaoId: id.salao,
          usuarioId: x.gestor ? id.gestor : x.usuarioEmail !== undefined ? id.usuarioProfissional(x.chave) : null,
          nome: x.nome,
          email: x.gestor ? spec.gestor.email : (x.usuarioEmail ?? null),
        })),
        skipDuplicates: true,
      });

      await tx.servico.createMany({
        data: spec.servicos.map((s) => ({
          id: id.servico(s.chave),
          salaoId: id.salao,
          nome: s.nome,
          precoCentavos: s.precoCentavos,
          duracaoMin: s.duracaoMin,
        })),
        skipDuplicates: true,
      });
      await tx.servicoProfissional.createMany({
        data: spec.profissionais.flatMap((x) =>
          x.servicos.map((s) => ({ salaoId: id.salao, servicoId: id.servico(s), profissionalId: id.profissional(x.chave) })),
        ),
        skipDuplicates: true,
      });

      await tx.jornada.createMany({
        data: spec.profissionais.flatMap((x) =>
          x.jornada.flatMap((d) =>
            d.faixas.map(([inicioMin, fimMin], i) => ({
              id: id.jornada(x.chave, d.dia, i),
              salaoId: id.salao,
              profissionalId: id.profissional(x.chave),
              diaSemana: d.dia,
              inicioMin,
              fimMin,
            })),
          ),
        ),
        skipDuplicates: true,
      });
      if (spec.funcionamento !== null) {
        await tx.salaoFuncionamento.createMany({
          data: spec.funcionamento.flatMap((d) =>
            d.faixas.map(([inicioMin, fimMin], i) => ({ id: id.funcionamento(d.dia, i), salaoId: id.salao, diaSemana: d.dia, inicioMin, fimMin })),
          ),
          skipDuplicates: true,
        });
      }

      await tx.bloqueio.createMany({
        data: plano.bloqueios.map((b) => ({
          id: b.id,
          salaoId: id.salao,
          profissionalId: b.profissionalId,
          inicio: b.inicio,
          fim: b.fim,
          motivo: b.motivo,
        })),
        skipDuplicates: true,
      });

      await tx.cliente.createMany({
        data: spec.clientes.map((c) => ({
          id: id.cliente(c.chave),
          salaoId: id.salao,
          nome: c.nome,
          telefoneE164: c.telefone,
          anonimizadaEm: c.nome === null ? agora : null,
          criadoEm: agora,
        })),
        skipDuplicates: true,
      });

      // Consentimentos: mensagens da reserva para toda cliente identificada; publicação para quem avaliou.
      const avaliaram = new Set(plano.avaliacoes.map((a) => a.clienteId));
      await tx.consentimento.createMany({
        data: spec.clientes
          .filter((c) => c.nome !== null)
          .flatMap((c) => {
            const base = { salaoId: id.salao, clienteId: id.cliente(c.chave), origem: 'publico' as const, versaoTermos: VERSAO_TERMOS, criadoEm: agora };
            return [
              { id: id.consentimento(c.chave, 'mensagens_reserva'), finalidade: 'mensagens_reserva' as const, ...base },
              ...(avaliaram.has(id.cliente(c.chave))
                ? [{ id: id.consentimento(c.chave, 'publicacao_avaliacao'), finalidade: 'publicacao_avaliacao' as const, ...base }]
                : []),
            ];
          }),
        skipDuplicates: true,
      });

      await tx.reserva.createMany({
        data: plano.reservas.map((r, i) => ({
          id: r.id,
          salaoId: id.salao,
          profissionalId: r.profissionalId,
          clienteId: r.clienteId,
          inicio: r.inicio,
          fim: r.fim,
          ocupadoAte: r.ocupadoAte,
          status: r.status,
          origem: i % 2 === 0 ? ('equipe' as const) : ('publico' as const),
          canceladaEm: r.canceladaEm,
          criadoEm: new Date(Math.min(agora.getTime(), r.inicio.getTime() - 2 * DIA_MS)),
        })),
        skipDuplicates: true,
      });
      await tx.reservaItem.createMany({
        data: plano.reservas.flatMap((r) =>
          r.itens.map((it) => ({
            id: it.id,
            salaoId: id.salao,
            reservaId: r.id,
            servicoId: it.servicoId,
            ordem: it.ordem,
            precoCentavos: it.precoCentavos,
            duracaoMin: it.duracaoMin,
          })),
        ),
        skipDuplicates: true,
      });

      if (fotos.length > 0) {
        // Sem skipDuplicates: salao_foto_posicao_unica é DEFERRABLE e não pode ser árbitro de ON CONFLICT.
        // O salão acabou de ser criado nesta transação, então não há foto anterior.
        await tx.salaoFoto.createMany({
          data: fotos.map((f, i) => ({
            id: id.foto(i + 1),
            salaoId: id.salao,
            chave: f.chave,
            alt: f.alt,
            posicao: i + 1,
            largura: f.largura,
            altura: f.altura,
            bytes: f.bytes,
            envio: id.envioFoto(i + 1),
            criadoEm: agora,
          })),
        });
      }

      await tx.avaliacao.createMany({
        data: plano.avaliacoes.map((a) => ({
          id: a.id,
          salaoId: id.salao,
          reservaId: a.reservaId,
          clienteId: a.clienteId,
          nota: a.nota,
          comentario: a.comentario,
          nomeExibicao: a.nomeExibicao,
          publicacaoAceitaEm: a.criadoEm,
          versaoTermos: VERSAO_TERMOS,
          criadoEm: a.criadoEm,
        })),
        skipDuplicates: true,
      });

      // Assinatura gravada direto (a E6.3, com o Mercado Pago, ainda não existe): sem CHECK que exija campo extra.
      if (spec.assinatura !== null) {
        await tx.assinatura.createMany({
          data: [
            {
              id: id.assinatura,
              salaoId: id.salao,
              estado: spec.assinatura,
              ...(spec.assinatura === 'em_teste'
                ? { testeFimEm: new Date(agora.getTime() + DIAS_TESTE * DIA_MS) }
                : { periodoPagoAte: new Date(agora.getTime() + 30 * DIA_MS) }),
              criadoEm: agora,
            },
          ],
          skipDuplicates: true,
        });
      }
      return 'criado';
    },
    { timeout: 60_000, maxWait: 30_000 },
  );
}

async function semearSaloes(deps: DepsSemente, specs: readonly SalaoSpec[]): Promise<string[]> {
  const prisma = deps.prisma ?? obterPrisma();
  const agora = deps.agora ?? new Date();
  const senhaHash = await gerarHashSenha(CREDENCIAIS_DEMO.senha);
  const salaoIds: string[] = [];
  for (const spec of specs) {
    const salaoId = ids(spec).salao;
    const fotos = await prepararFotos(spec, salaoId, deps.armazenamento);
    await inserirSalao(prisma, spec, agora, senhaHash, fotos);
    salaoIds.push(salaoId);
  }
  return salaoIds;
}

/**
 * Semeia os dois salões de demonstração e o super admin. Idempotente: um salão já existente é pulado
 * por inteiro (as datas relativas partem da primeira execução e nunca se movem) e nada é apagado.
 * O super admin vem de SUPERADMIN_EMAIL/SUPERADMIN_PASSWORD (em `deps.env`) ou do par de demonstração;
 * o seed NÃO cadastra TOTP (o primeiro login do admin faz o cadastro).
 */
export async function semear(
  deps: DepsSemente,
  opcoes: { admin?: { email: string; senha: string } } = {},
): Promise<{ salaoIds: string[] }> {
  const env = deps.env ?? process.env;
  const salaoIds = await semearSaloes(deps, [SALAO_A, SALAO_B]);
  const doEnv = env.SUPERADMIN_EMAIL && env.SUPERADMIN_PASSWORD ? { email: env.SUPERADMIN_EMAIL, senha: env.SUPERADMIN_PASSWORD } : undefined;
  const admin = opcoes.admin ?? doEnv ?? CREDENCIAIS_DEMO.admin;
  await garantirSuperAdmin({ email: admin.email, senha: admin.senha }, { agora: deps.agora });
  return { salaoIds };
}

/**
 * Complemento só do E2E (nunca chamado pelo CLI): salões de reserva isolados por spec e um salão
 * suspenso manualmente, para que os testes que mutam não toquem nos salões A e B.
 */
export async function semearComplementoE2E(deps: DepsSemente): Promise<{ salaoSuspensoSlug: string; slugsReservas: string[] }> {
  const reservas = Array.from({ length: SALOES_E2E_RESERVAS }, (_, i) => salaoE2eReservas(i + 1));
  await semearSaloes(deps, [...reservas, salaoE2eSuspenso()]);
  return { salaoSuspensoSlug: SLUG_E2E_SUSPENSO, slugsReservas: reservas.map((s) => s.slug) };
}

async function main(): Promise<void> {
  recusarProducao(process.env);
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não definida');
  try {
    const { salaoIds } = await semear({ armazenamento: integracoes().armazenamento });
    console.log(`seed: ok (${salaoIds.length} salões; credenciais de demonstração no README)`);
  } finally {
    await encerrarPrisma();
  }
}

// Casca CLI: só roda quando este arquivo é o ponto de entrada (não ao ser importado por testes).
// O nome do arquivo também é conferido: o preparar-banco do E2E embute este módulo no seu bundle, onde
// `import.meta.url` coincidiria com o ponto de entrada dele.
const entrada = process.argv[1];
if (entrada && /(^|[\\/])seed\.[cm]?[jt]s$/.test(entrada) && import.meta.url === pathToFileURL(entrada).href) {
  main().catch((erro: unknown) => {
    console.error(`seed: falhou: ${erro instanceof Error ? erro.message : String(erro)}`);
    process.exit(1);
  });
}
