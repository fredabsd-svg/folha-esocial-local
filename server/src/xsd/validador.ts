/**
 * Validação dos eventos contra os esquemas XSD oficiais do eSocial.
 *
 * O pacote de esquemas é importado pelo usuário (baixado da Documentação
 * Técnica do eSocial). A validação usa o xmllint compilado em WebAssembly,
 * sem acesso à rede nem ao disco fora do diretório de dados.
 */
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { validateXML } from 'xmllint-wasm';
import type { Armazenamento } from '../db/armazenamento.js';
import { log } from '../util/log.js';
import { lerXml } from '../xml/arvore.js';
import { lerZip, LIMITES_ZIP_PADRAO } from '../xml/zip.js';

export interface PacoteXsd {
  id: string;
  nome: string;
  importadoEm: string;
  arquivos: string[];
  namespaces: Record<string, string>;
}

const dirXsd = (arm: Armazenamento) => path.join(arm.dir, 'xsd');

export async function listarPacotes(arm: Armazenamento): Promise<PacoteXsd[]> {
  const base = dirXsd(arm);
  if (!existsSync(base)) return [];
  const r: PacoteXsd[] = [];
  for (const d of await fs.readdir(base)) {
    const m = path.join(base, d, 'manifesto.json');
    if (existsSync(m)) r.push(JSON.parse(await fs.readFile(m, 'utf8')) as PacoteXsd);
  }
  return r.sort((a, b) => b.importadoEm.localeCompare(a.importadoEm));
}

export async function importarPacoteXsd(arm: Armazenamento, nome: string, dados: Buffer): Promise<PacoteXsd> {
  const id = `pacote-${Date.now()}`;
  const destino = path.join(dirXsd(arm), id);
  await fs.mkdir(destino, { recursive: true });
  const arquivos: string[] = [];
  const namespaces: Record<string, string> = {};
  for await (const item of lerZip(dados, LIMITES_ZIP_PADRAO, ['xsd'])) {
    if (item.erro !== undefined) continue;
    const base = path.basename(item.nome.replace(/\\/g, '/'));
    if (!/^[\w.-]+\.xsd$/i.test(base)) continue;
    await fs.writeFile(path.join(destino, base), item.dados);
    arquivos.push(base);
    try {
      const raiz = lerXml(item.dados);
      const tns = raiz.a?.targetNamespace;
      if (tns && raiz.c?.some((c) => c.n === 'element')) namespaces[tns] = base;
    } catch {
      /* esquema auxiliar ilegível: segue */
    }
  }
  if (!arquivos.length) {
    await fs.rm(destino, { recursive: true, force: true });
    throw new Error('Nenhum arquivo .xsd encontrado no pacote.');
  }
  const pacote: PacoteXsd = { id, nome: nome.slice(0, 200), importadoEm: new Date().toISOString(), arquivos, namespaces };
  await fs.writeFile(path.join(destino, 'manifesto.json'), JSON.stringify(pacote, null, 2));
  arm.auditar('xsd_importado', `${arquivos.length} arquivos`);
  return pacote;
}

export async function removerPacote(arm: Armazenamento, id: string) {
  if (!/^pacote-\d+$/.test(id)) throw new Error('Pacote inválido');
  await fs.rm(path.join(dirXsd(arm), id), { recursive: true, force: true });
}

let emAndamento: Promise<unknown> | null = null;

/** Valida eventos ainda não validados (ou todos, se `todos`). Execução serializada. */
export function validarPendentes(arm: Armazenamento, todos = false): Promise<{ validados: number; invalidos: number; semXsd: number }> {
  const tarefa = (emAndamento ?? Promise.resolve()).then(() => executar(arm, todos));
  emAndamento = tarefa.catch(() => undefined);
  return tarefa;
}

async function executar(arm: Armazenamento, todos: boolean) {
  const pacotes = await listarPacotes(arm);
  const resultado = { validados: 0, invalidos: 0, semXsd: 0 };
  const where = todos ? '' : "WHERE xsd_status IN ('nao_validado','sem_xsd')";
  const linhas = arm.db.prepare(`SELECT id, namespace FROM eventos ${where}`).all() as Array<{ id: number; namespace: string | null }>;
  if (!linhas.length) return resultado;
  const upd = arm.db.prepare('UPDATE eventos SET xsd_status = ?, xsd_mensagem = ? WHERE id = ?');
  const porNs = new Map<string, number[]>();
  for (const l of linhas) {
    const ns = l.namespace ?? '';
    if (!porNs.has(ns)) porNs.set(ns, []);
    porNs.get(ns)!.push(l.id);
  }
  const cacheEsquemas = new Map<string, { schema: { fileName: string; contents: string }; preload: Array<{ fileName: string; contents: string }> }>();
  for (const [ns, ids] of porNs) {
    const pacote = pacotes.find((p) => p.namespaces[ns]);
    if (!pacote) {
      arm.db.transaction(() => {
        for (const id of ids) upd.run('sem_xsd', `Nenhum esquema XSD importado para ${ns || 'namespace desconhecido'}.`, id);
      })();
      resultado.semXsd += ids.length;
      continue;
    }
    let esq = cacheEsquemas.get(pacote.id + ns);
    if (!esq) {
      const dir = path.join(dirXsd(arm), pacote.id);
      const principal = pacote.namespaces[ns];
      const todosArquivos = await Promise.all(
        pacote.arquivos.map(async (f) => ({ fileName: f, contents: await fs.readFile(path.join(dir, f), 'utf8') })),
      );
      esq = { schema: todosArquivos.find((f) => f.fileName === principal)!, preload: todosArquivos.filter((f) => f.fileName !== principal) };
      cacheEsquemas.set(pacote.id + ns, esq);
    }
    for (let i = 0; i < ids.length; i += 100) {
      const lote = ids.slice(i, i + 100);
      const xmls = lote.map((id) => {
        const r = arm.db.prepare('SELECT xml FROM eventos WHERE id = ?').get(id) as { xml: string };
        return { fileName: `evento-${id}.xml`, contents: `<?xml version="1.0" encoding="UTF-8"?>${r.xml}` };
      });
      try {
        const res = await validateXML({ xml: xmls, schema: esq.schema, preload: esq.preload, maxMemoryPages: 16384 });
        const erros = new Map<string, string[]>();
        for (const e of res.errors) {
          const f = e.loc?.fileName ?? '';
          if (!erros.has(f)) erros.set(f, []);
          erros.get(f)!.push(e.message);
        }
        arm.db.transaction(() => {
          for (const x of xmls) {
            const id = Number(x.fileName.replace(/\D/g, ''));
            const e = erros.get(x.fileName);
            if (e?.length) {
              resultado.invalidos++;
              upd.run('invalido', `${pacote.nome}: ${e.slice(0, 3).join(' | ')}`.slice(0, 1000), id);
            } else {
              resultado.validados++;
              upd.run('valido', `Válido conforme ${pacote.nome}`, id);
            }
          }
        })();
      } catch (e) {
        log.aviso('Falha na validação XSD', { erro: (e as Error).message.slice(0, 120) });
        arm.db.transaction(() => {
          for (const id of lote) upd.run('erro_validacao', `Falha ao executar a validação: ${(e as Error).message}`.slice(0, 500), id);
        })();
      }
    }
  }
  return resultado;
}
