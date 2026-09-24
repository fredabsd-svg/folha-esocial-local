/**
 * Pasta monitorada: lista ZIP/XML de uma pasta escolhida pelo usuário (por
 * exemplo, a pasta de Downloads) para importar os arquivos baixados do portal.
 * Os arquivos da pasta nunca são alterados, movidos ou apagados.
 */
import { createHash } from 'node:crypto';
import { promises as fs, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Armazenamento } from '../db/armazenamento.js';

export interface ConfigPasta {
  caminho?: string;
  ativo: boolean;
  autoImportar: boolean;
  ativadoEm?: string;
}

export interface ArquivoPasta {
  nome: string;
  tamanho: number;
  modificadoEm: string;
  jaImportado: boolean;
  importacaoId?: number;
}

export function lerConfigPasta(arm: Armazenamento): ConfigPasta {
  return arm.obterConfig<ConfigPasta>('pasta_monitorada', { ativo: false, autoImportar: false });
}

export function salvarConfigPasta(arm: Armazenamento, c: Partial<ConfigPasta>): ConfigPasta {
  const atual = lerConfigPasta(arm);
  const novo: ConfigPasta = { ...atual };
  if (c.caminho !== undefined) {
    const p = path.resolve(String(c.caminho));
    if (!existsSync(p) || !statSync(p).isDirectory()) throw new Error('A pasta informada não existe.');
    if (path.resolve(p).startsWith(path.resolve(arm.dir))) throw new Error('Escolha uma pasta fora do diretório de dados do sistema.');
    novo.caminho = p;
  }
  if (c.ativo !== undefined) {
    novo.ativo = !!c.ativo;
    if (novo.ativo && !atual.ativo) novo.ativadoEm = new Date().toISOString();
  }
  if (c.autoImportar !== undefined) novo.autoImportar = !!c.autoImportar;
  if (novo.ativo && !novo.caminho) throw new Error('Informe a pasta antes de ativar.');
  arm.salvarConfig('pasta_monitorada', novo);
  return novo;
}

export async function listarPasta(arm: Armazenamento, maxBytes: number): Promise<ArquivoPasta[]> {
  const cfg = lerConfigPasta(arm);
  if (!cfg.caminho || !existsSync(cfg.caminho)) return [];
  const entradas = await fs.readdir(cfg.caminho, { withFileTypes: true });
  const r: ArquivoPasta[] = [];
  const porSha = arm.db.prepare('SELECT id FROM importacoes WHERE sha256 = ? ORDER BY id LIMIT 1');
  for (const e of entradas) {
    if (!e.isFile() || !/\.(zip|xml)$/i.test(e.name)) continue;
    const p = path.join(cfg.caminho, e.name);
    const st = await fs.stat(p);
    if (st.size > maxBytes) continue;
    const sha = createHash('sha256').update(await fs.readFile(p)).digest('hex');
    const imp = porSha.get(sha) as { id: number } | undefined;
    r.push({ nome: e.name, tamanho: st.size, modificadoEm: st.mtime.toISOString(), jaImportado: !!imp, importacaoId: imp?.id });
  }
  return r.sort((a, b) => b.modificadoEm.localeCompare(a.modificadoEm)).slice(0, 300);
}

export async function lerArquivoDaPasta(arm: Armazenamento, nome: string, maxBytes: number): Promise<Buffer> {
  const cfg = lerConfigPasta(arm);
  if (!cfg.caminho) throw new Error('Pasta não configurada.');
  if (nome !== path.basename(nome) || !/\.(zip|xml)$/i.test(nome)) throw new Error('Nome de arquivo inválido.');
  const p = path.join(cfg.caminho, nome);
  if (path.dirname(path.resolve(p)) !== path.resolve(cfg.caminho)) throw new Error('Arquivo fora da pasta monitorada.');
  const st = await fs.stat(p);
  if (st.size > maxBytes) throw new Error('Arquivo excede o tamanho máximo permitido.');
  return fs.readFile(p);
}
