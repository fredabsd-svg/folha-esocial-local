/**
 * Backup portátil protegido por senha (a senha nunca é armazenada), restauração
 * e exclusão completa dos dados locais.
 */
import { randomBytes } from 'node:crypto';
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { Armazenamento } from '../db/armazenamento.js';
import { resolverSituacoes } from '../esocial/resolver.js';
import { chaveDeSenha, cifrar, decifrar } from '../seguranca/cripto.js';

const MAGICO = Buffer.from('FXEBK1');
const TABELAS = [
  'configuracoes',
  'empresas',
  'solicitacoes',
  'importacoes',
  'arquivos_xml',
  'eventos',
  'recibos',
  'ocorrencias',
  'conflitos',
  'complementos',
  'relatorios_gerados',
  'auditoria',
];

export function validarSenhaBackup(senha: unknown): string {
  if (typeof senha !== 'string' || senha.length < 10 || senha.length > 200) {
    throw new Error('A senha do backup deve ter entre 10 e 200 caracteres.');
  }
  return senha;
}

export async function gerarBackup(arm: Armazenamento, senha: string): Promise<Buffer> {
  const db = arm.db;
  const tabelas: Record<string, unknown[]> = {};
  for (const t of TABELAS) tabelas[t] = db.prepare(`SELECT * FROM ${t}`).all();
  const originais: Record<string, string> = {};
  for (const r of db.prepare('SELECT DISTINCT sha256 FROM importacoes').all() as Array<{ sha256: string }>) {
    try {
      originais[r.sha256] = (await arm.lerOriginal(r.sha256)).toString('base64');
    } catch {
      /* original ausente: segue */
    }
  }
  const relatorios: Record<string, string> = {};
  for (const r of db.prepare('SELECT id FROM relatorios_gerados').all() as Array<{ id: number }>) {
    try {
      relatorios[r.id] = (await arm.lerRelatorio(r.id)).toString('base64');
    } catch {
      /* segue */
    }
  }
  const conteudo = gzipSync(Buffer.from(JSON.stringify({ formato: 1, geradoEm: new Date().toISOString(), tabelas, originais, relatorios })));
  const sal = randomBytes(16);
  arm.auditar('backup_gerado');
  return Buffer.concat([MAGICO, sal, cifrar(chaveDeSenha(senha, sal), conteudo)]);
}

export async function restaurarBackup(arm: Armazenamento, arquivo: Buffer, senha: string) {
  if (!arquivo.subarray(0, 6).equals(MAGICO)) throw new Error('Arquivo não é um backup deste sistema.');
  const sal = arquivo.subarray(6, 22);
  let conteudo: { formato: number; tabelas: Record<string, Array<Record<string, unknown>>>; originais: Record<string, string>; relatorios: Record<string, string> };
  try {
    conteudo = JSON.parse(gunzipSync(decifrar(chaveDeSenha(senha, sal), arquivo.subarray(22))).toString('utf8'));
  } catch {
    throw new Error('Senha incorreta ou backup corrompido.');
  }
  if (conteudo.formato !== 1) throw new Error('Versão de backup não suportada.');
  const db = arm.db;
  db.transaction(() => {
    for (const t of [...TABELAS].reverse()) db.prepare(`DELETE FROM ${t}`).run();
    for (const t of TABELAS) {
      const linhas = conteudo.tabelas[t] ?? [];
      if (!linhas.length) continue;
      const cols = Object.keys(linhas[0]).filter((c) => /^\w+$/.test(c));
      const ins = db.prepare(`INSERT INTO ${t} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
      for (const l of linhas) ins.run(...cols.map((c) => l[c] as never));
    }
  })();
  for (const [sha, b64] of Object.entries(conteudo.originais)) await arm.salvarOriginal(sha, Buffer.from(b64, 'base64'));
  for (const [id, b64] of Object.entries(conteudo.relatorios)) await arm.salvarRelatorio(Number(id), Buffer.from(b64, 'base64'));
  resolverSituacoes(db);
  arm.auditar('backup_restaurado');
  return { tabelas: Object.fromEntries(TABELAS.map((t) => [t, conteudo.tabelas[t]?.length ?? 0])) };
}

/** Apaga todo o diretório de dados (banco, originais, relatórios, esquemas e chave). */
export async function excluirTudo(arm: Armazenamento) {
  const dir = arm.dir;
  arm.fechar();
  for (const item of await fs.readdir(dir)) {
    await fs.rm(path.join(dir, item), { recursive: true, force: true });
  }
  return !existsSync(path.join(dir, 'folha.db'));
}

export async function tamanhoDados(dir: string): Promise<{ bytes: number; arquivos: number }> {
  let bytes = 0;
  let arquivos = 0;
  const visitar = async (p: string) => {
    for (const e of await fs.readdir(p, { withFileTypes: true })) {
      const f = path.join(p, e.name);
      if (e.isDirectory()) await visitar(f);
      else {
        bytes += (await fs.stat(f)).size;
        arquivos++;
      }
    }
  };
  if (existsSync(dir)) await visitar(dir);
  return { bytes, arquivos };
}
