/**
 * Servidor HTTP local.
 *
 * Proteções: escuta apenas em 127.0.0.1; valida o cabeçalho Host (contra DNS
 * rebinding); requisições que alteram dados exigem o cabeçalho X-Folha-Local
 * e origem própria (contra CSRF); sem CORS; CSP restritiva; sem cache de API;
 * logs sem conteúdo de requisições.
 */
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import type { Config } from './config.js';
import { Armazenamento } from './db/armazenamento.js';
import { reprocessarRubricasDosRecibos } from './importacao/importador.js';
import { registrarRotas } from './rotas.js';
import { log } from './util/log.js';

export interface Estado {
  cfg: Config;
  arm: Armazenamento;
  reabrir(): Promise<void>;
}

export async function criarEstado(cfg: Config): Promise<Estado> {
  const estado: Estado = {
    cfg,
    arm: await Armazenamento.abrir(cfg),
    async reabrir() {
      estado.arm = await Armazenamento.abrir(cfg);
    },
  };
  await atualizarDadosAntigos(estado);
  return estado;
}

/** Ajustes únicos em bancos criados por versões anteriores (idempotentes). */
async function atualizarDadosAntigos(estado: Estado) {
  const arm = estado.arm;
  if (!arm.obterConfig<boolean>('reprocessado:rubricas_recibo_v1', false)) {
    const r = await reprocessarRubricasDosRecibos(arm, estado.cfg);
    arm.salvarConfig('reprocessado:rubricas_recibo_v1', true);
    if (r.rubricas) log.info('Rubricas dos recibos extraídas das importações existentes', { rubricas: r.rubricas });
  }
}

const CSP = [
  "default-src 'self'",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export async function criarApp(estado: Estado): Promise<FastifyInstance> {
  const { cfg } = estado;
  const app = Fastify({ logger: false, bodyLimit: 20 * 1024 * 1024, trustProxy: false });

  const hosts = new Set([`127.0.0.1:${cfg.porta}`, `localhost:${cfg.porta}`]);
  if (cfg.dev) for (const p of [5173, 5174]) for (const h of ['127.0.0.1', 'localhost']) hosts.add(`${h}:${p}`);
  const origens = new Set([...hosts].map((h) => `http://${h}`));

  app.addHook('onRequest', async (req, reply) => {
    const host = String(req.headers.host ?? '');
    if (!hosts.has(host)) {
      return reply.code(403).send({ erro: 'Acesso permitido somente pelo endereço local deste computador.' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.url.startsWith('/api/')) {
      const origem = req.headers.origin;
      const site = req.headers['sec-fetch-site'];
      if ((origem && !origens.has(origem)) || (site && site !== 'same-origin' && site !== 'none')) {
        return reply.code(403).send({ erro: 'Origem não permitida.' });
      }
      if (req.headers['x-folha-local'] !== '1') {
        return reply.code(403).send({ erro: 'Requisição sem o cabeçalho de segurança da aplicação.' });
      }
    }
  });

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('Content-Security-Policy', CSP);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    reply.header('Cross-Origin-Resource-Policy', 'same-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    else if (!req.url.startsWith('/assets/')) reply.header('Cache-Control', 'no-cache');
    return payload;
  });

  app.addHook('onResponse', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    const rota = req.routeOptions?.url ?? req.url.split('?')[0];
    log.info(`${req.method} ${rota}`, { status: reply.statusCode, ms: Math.round(reply.elapsedTime) });
  });

  app.setErrorHandler((err, _req, reply) => {
    const e = err as Error & { statusCode?: number };
    const status = e.statusCode && e.statusCode >= 400 && e.statusCode < 600 ? e.statusCode : 400;
    if (status >= 500) log.erro('Erro interno', { tipo: e.name });
    reply.code(status).send({ erro: e.message || 'Erro ao processar a solicitação.' });
  });

  await app.register(fastifyMultipart, {
    limits: { fileSize: cfg.maxUploadBytes, files: 50, fields: 20, fieldSize: 1024 * 64 },
  });

  await registrarRotas(app, estado);

  if (existsSync(cfg.webDir)) {
    await app.register(fastifyStatic, { root: cfg.webDir, index: ['index.html'], cacheControl: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ erro: 'Rota não encontrada.' });
      return reply.type('text/html').sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ erro: 'Rota não encontrada.' });
      return reply
        .type('text/html; charset=utf-8')
        .send('<p>Interface não compilada. Execute <code>npm run build</code> na pasta do projeto.</p>');
    });
  }
  return app;
}
