/**
 * 7. Funcionamento local sem Docker; 8. ausência de armazenamento de
 * credenciais e de envio externo de dados; proteção dos dados em disco,
 * logs sem dados pessoais, backup e exclusão.
 */
import dns from 'node:dns';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp, criarEstado } from '../src/app.js';
import { dpapiAbrir, dpapiProteger } from '../src/seguranca/cripto.js';
import { gerarBackup, restaurarBackup } from '../src/servicos/backup.js';
import { gerarZipSintetico, TRABALHADORES_SINTETICOS } from '../src/demo/sinteticos.js';
import { configurarLog } from '../src/util/log.js';
import { cfgTeste, EMPRESA } from './apoio.js';

const H = { 'x-folha-local': '1', host: '127.0.0.1:5178' };

async function montar() {
  const cfg = { ...cfgTeste(), porta: 5178 };
  const estado = await criarEstado(cfg);
  const app = await criarApp(estado);
  return { cfg, estado, app };
}

function arquivosDe(dir: string): string[] {
  const r: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) r.push(...arquivosDe(p));
    else r.push(p);
  }
  return r;
}

describe('funcionamento local', () => {
  it('escuta somente em 127.0.0.1 e responde à verificação de saúde (sem Docker)', async () => {
    const porta = 20000 + Math.floor(Math.random() * 20000);
    const cfg = { ...cfgTeste(), porta };
    const estado = await criarEstado(cfg);
    const app = await criarApp(estado);
    await app.listen({ host: cfg.host, port: porta });
    const end = app.server.address() as net.AddressInfo;
    expect(end.address).toBe('127.0.0.1');
    const r = await fetch(`http://127.0.0.1:${porta}/api/saude`);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, local: true });
    await app.close();
    estado.arm.fechar();
  });

  it('recusa Host estranho (DNS rebinding), origem externa e requisição sem o cabeçalho próprio', async () => {
    const { app, estado } = await montar();
    expect((await app.inject({ method: 'GET', url: '/api/saude', headers: { host: '127.0.0.1:5178' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/saude', headers: { host: 'site-malicioso.com' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/demonstracao', headers: { host: '127.0.0.1:5178' } })).statusCode).toBe(403);
    expect(
      (await app.inject({ method: 'POST', url: '/api/demonstracao', headers: { ...H, origin: 'https://site-malicioso.com' } })).statusCode,
    ).toBe(403);
    const ok = await app.inject({ method: 'GET', url: '/api/saude', headers: { host: '127.0.0.1:5178' } });
    expect(ok.headers['content-security-policy']).toMatch(/default-src 'self'/);
    expect(ok.headers['access-control-allow-origin']).toBeUndefined();
    await app.close();
    estado.arm.fechar();
  });
});

describe('sem envio externo e sem credenciais', () => {
  const chamadas: string[] = [];
  const originais = {
    httpReq: http.request,
    httpsReq: https.request,
    netConnect: net.connect,
    fetch: globalThis.fetch,
    lookup: dns.lookup,
  };
  beforeAll(() => {
    const registrar = (nome: string) =>
      ((...a: unknown[]) => {
        chamadas.push(`${nome} ${JSON.stringify(a[0])?.slice(0, 80)}`);
        throw new Error('rede bloqueada no teste');
      }) as never;
    http.request = registrar('http.request');
    https.request = registrar('https.request');
    net.connect = registrar('net.connect');
    globalThis.fetch = registrar('fetch');
    dns.lookup = registrar('dns.lookup');
  });
  afterAll(() => {
    http.request = originais.httpReq;
    https.request = originais.httpsReq;
    net.connect = originais.netConnect;
    globalThis.fetch = originais.fetch;
    dns.lookup = originais.lookup;
  });

  it('importa, gera relatórios e exporta sem nenhuma conexão de rede', async () => {
    const linhasLog: string[] = [];
    configurarLog({ silencioso: false, saida: (l) => linhasLog.push(l) });
    const { app, estado } = await montar();
    const r = await app.inject({ method: 'POST', url: '/api/demonstracao', headers: H });
    expect(r.statusCode).toBe(200);
    for (const tipo of ['extrato', 'recibo', 'rescisao']) {
      for (const formato of ['pdf', 'xlsx', 'csv']) {
        const e = await app.inject({
          method: 'POST',
          url: '/api/relatorios/exportar',
          headers: { ...H, 'content-type': 'application/json' },
          payload: { tipo, formato, parametros: { empresa: EMPRESA, competencia: '2026-08' } },
        });
        expect(e.statusCode).toBe(200);
      }
    }
    await app.inject({ method: 'GET', url: `/api/trabalhadores/${TRABALHADORES_SINTETICOS[0].cpf}?empresa=${EMPRESA}`, headers: H });
    expect(chamadas).toEqual([]);

    // logs sem CPF, nomes ou valores de trabalhadores
    configurarLog({ silencioso: true });
    const log = linhasLog.join('\n');
    expect(log.length).toBeGreaterThan(0);
    for (const t of TRABALHADORES_SINTETICOS) {
      expect(log).not.toContain(t.cpf);
      expect(log).not.toContain(t.nome);
    }
    expect(log).not.toContain('3200.00');
    expect(log).not.toContain('<eSocial');

    // dados em disco cifrados: nenhum CPF, nome ou trecho de XML legível
    const dir = estado.arm.dir;
    await app.close();
    estado.arm.fechar();
    for (const arq of arquivosDe(dir)) {
      const bruto = readFileSync(arq);
      for (const t of TRABALHADORES_SINTETICOS) {
        expect(bruto.includes(Buffer.from(t.cpf)), `${path.basename(arq)} contém CPF`).toBe(false);
        expect(bruto.includes(Buffer.from(t.nome)), `${path.basename(arq)} contém nome`).toBe(false);
      }
      expect(bruto.includes(Buffer.from('evtRemun')), `${path.basename(arq)} contém XML`).toBe(false);
    }
  });

  it('o banco não tem campos de senha/token/cookie e a API não aceita credenciais', async () => {
    const { app, estado } = await montar();
    const colunas = estado.arm.db
      .prepare("SELECT m.name AS tabela, p.name AS coluna FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type = 'table'")
      .all() as Array<{ tabela: string; coluna: string }>;
    const suspeitas = colunas.filter((c) => /senha|password|token|cookie|certific|credencial|gov\.?br/i.test(c.coluna));
    expect(suspeitas).toEqual([]);
    const segredo = 'SenhaGovBr#123';
    await app.inject({
      method: 'POST',
      url: '/api/empresas',
      headers: { ...H, 'content-type': 'application/json' },
      payload: { tpInsc: '1', documento: '98765432000198', razaoSocial: 'X', senha: segredo, token: segredo, cookie: segredo },
    });
    const comp = await app.inject({
      method: 'POST',
      url: '/api/complementos',
      headers: { ...H, 'content-type': 'application/json' },
      payload: { empresa: EMPRESA, escopo: 'empresa', referencia: EMPRESA, campo: 'senha', valor: segredo, origem: 'teste' },
    });
    expect(comp.statusCode).toBe(400);
    const tabelas = colunas.map((c) => c.tabela).filter((t, i, a) => a.indexOf(t) === i);
    for (const t of tabelas) {
      const linhas = JSON.stringify(estado.arm.db.prepare(`SELECT * FROM ${t}`).all());
      expect(linhas, `tabela ${t}`).not.toContain(segredo);
    }
    await app.close();
    estado.arm.fechar();
  });
});

describe('fluxo assistido do eSocial Download', () => {
  it('exige confirmação do CPF/CNPJ e da autorização e só aceita portal .gov.br', async () => {
    const { app, estado } = await montar();
    await app.inject({ method: 'POST', url: '/api/demonstracao', headers: H });
    const post = (payload: object) =>
      app.inject({ method: 'POST', url: '/api/solicitacoes', headers: { ...H, 'content-type': 'application/json' }, payload });
    const base = { empresa: EMPRESA, perfil: 'Titular', tipoSolicitacao: 'Todos os eventos entregues no período', periodoInicio: '2026-06-01', periodoFim: '2026-06-30' };
    expect((await post({ ...base, documentoConfirmado: '11.111.111/0001-11', confirmado: true })).statusCode).toBe(400);
    expect((await post({ ...base, documentoConfirmado: '98.765.432/0001-98', confirmado: false })).statusCode).toBe(400);
    const ok = await post({ ...base, documentoConfirmado: '98.765.432/0001-98', confirmado: true });
    expect(ok.statusCode).toBe(200);
    const url = (u: string) => app.inject({ method: 'PUT', url: '/api/portal', headers: { ...H, 'content-type': 'application/json' }, payload: { urlLogin: u } });
    expect((await url('https://login.esocial.gov.br.site-falso.com/')).statusCode).toBe(400);
    expect((await url('http://login.esocial.gov.br/')).statusCode).toBe(400);
    expect((await url('https://login.esocial.gov.br/login.aspx')).statusCode).toBe(200);
    await app.close();
    estado.arm.fechar();
  });
});

describe('backup, restauração e exclusão', () => {
  it('backup exige senha, restaura os dados e recusa senha errada', async () => {
    const { app, estado } = await montar();
    await app.inject({ method: 'POST', url: '/api/demonstracao', headers: H });
    const curta = await app.inject({ method: 'POST', url: '/api/dados/backup', headers: { ...H, 'content-type': 'application/json' }, payload: { senha: '123' } });
    expect(curta.statusCode).toBe(400);
    const bk = await gerarBackup(estado.arm, 'senha-forte-de-teste');
    expect(bk.includes(Buffer.from(TRABALHADORES_SINTETICOS[0].cpf))).toBe(false);
    const excl = await app.inject({ method: 'POST', url: '/api/dados/excluir-tudo', headers: { ...H, 'content-type': 'application/json' }, payload: { confirmacao: 'EXCLUIR TODOS OS DADOS' } });
    expect(excl.statusCode).toBe(200);
    expect((estado.arm.db.prepare('SELECT count(*) n FROM eventos').get() as { n: number }).n).toBe(0);
    await expect(restaurarBackup(estado.arm, bk, 'senha-errada-errada')).rejects.toThrow(/Senha incorreta/);
    await restaurarBackup(estado.arm, bk, 'senha-forte-de-teste');
    expect((estado.arm.db.prepare('SELECT count(*) n FROM eventos').get() as { n: number }).n).toBe(79);
    const imp = estado.arm.db.prepare('SELECT sha256 FROM importacoes').get() as { sha256: string };
    const original = await estado.arm.lerOriginal(imp.sha256);
    expect(original.equals(await gerarZipSintetico())).toBe(true);
    await app.close();
    estado.arm.fechar();
  });

  it.runIf(process.platform === 'win32')('protege a chave-mestra com a DPAPI do Windows', async () => {
    const segredo = Buffer.from('0123456789abcdef0123456789abcdef');
    const protegido = await dpapiProteger(segredo);
    expect(protegido.equals(segredo)).toBe(false);
    expect((await dpapiAbrir(protegido)).equals(segredo)).toBe(true);
  });
});
