/**
 * Leitura segura de XML para uma árvore compacta.
 *
 * - Rejeita qualquer DOCTYPE/ENTITY (proteção contra XXE e "billion laughs"):
 *   XMLs do eSocial nunca declaram DTD.
 * - Não resolve entidades externas nem acessa rede ou disco.
 * - Impõe limites de tamanho, profundidade e quantidade de nós.
 */
import { SaxesParser, type SaxesTagNS } from 'saxes';

export interface XNode {
  /** nome local (sem prefixo) */
  n: string;
  /** namespace URI */
  ns?: string;
  /** atributos sem namespace */
  a?: Record<string, string>;
  /** filhos */
  c?: XNode[];
  /** texto (aparado) */
  t?: string;
}

export class XmlRejeitadoError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'XmlRejeitadoError';
  }
}

export interface LimitesXml {
  maxBytes: number;
  maxProfundidade: number;
  maxNos: number;
}

export const LIMITES_XML_PADRAO: LimitesXml = {
  maxBytes: 20 * 1024 * 1024,
  maxProfundidade: 64,
  maxNos: 500_000,
};

export function decodificarXml(buf: Buffer): string {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.subarray(3).toString('utf8');
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buf.subarray(2));
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(buf.subarray(2));
  }
  const cabeca = buf.subarray(0, 256).toString('latin1');
  const m = /encoding\s*=\s*["']([A-Za-z0-9._-]+)["']/.exec(cabeca);
  const enc = (m?.[1] ?? 'utf-8').toLowerCase();
  if (enc === 'utf-8' || enc === 'utf8') return new TextDecoder('utf-8').decode(buf);
  if (['iso-8859-1', 'latin1', 'latin-1', 'windows-1252', 'cp1252'].includes(enc)) {
    return new TextDecoder('windows-1252').decode(buf);
  }
  throw new XmlRejeitadoError(`Codificação de caracteres não suportada: ${enc}`);
}

export function lerXml(buf: Buffer, limites: LimitesXml = LIMITES_XML_PADRAO): XNode {
  if (buf.length > limites.maxBytes) {
    throw new XmlRejeitadoError(
      `Arquivo XML excede o limite de ${Math.round(limites.maxBytes / 1024 / 1024)} MB.`,
    );
  }
  return parseXml(decodificarXml(buf), limites);
}

export function parseXml(texto: string, limites: LimitesXml = LIMITES_XML_PADRAO): XNode {
  if (/<!DOCTYPE/i.test(texto) || /<!ENTITY/i.test(texto)) {
    throw new XmlRejeitadoError(
      'XML com declaração DOCTYPE/ENTITY não é aceito (proteção contra entidades externas).',
    );
  }
  const parser = new SaxesParser({ xmlns: true });
  const pilha: XNode[] = [];
  let raiz: XNode | null = null;
  let nos = 0;
  let erro: Error | null = null;

  parser.on('doctype', () => {
    erro = new XmlRejeitadoError('XML com DOCTYPE não é aceito.');
  });
  parser.on('opentag', (tag: SaxesTagNS) => {
    if (erro) return;
    nos++;
    if (nos > limites.maxNos) {
      erro = new XmlRejeitadoError('XML excede a quantidade máxima de elementos permitida.');
      return;
    }
    if (pilha.length >= limites.maxProfundidade) {
      erro = new XmlRejeitadoError('XML excede a profundidade máxima permitida.');
      return;
    }
    const no: XNode = { n: tag.local };
    if (tag.uri) no.ns = tag.uri;
    for (const chave of Object.keys(tag.attributes)) {
      const at = tag.attributes[chave];
      if (at.prefix === 'xmlns' || at.name === 'xmlns') continue;
      if (at.uri) continue; // atributos com namespace (xsi:*) não são relevantes
      (no.a ??= {})[at.local] = at.value;
    }
    const topo = pilha[pilha.length - 1];
    if (topo) (topo.c ??= []).push(no);
    else raiz = no;
    pilha.push(no);
  });
  const anexarTexto = (t: string) => {
    if (erro) return;
    const topo = pilha[pilha.length - 1];
    if (topo && t) topo.t = (topo.t ?? '') + t;
  };
  parser.on('text', anexarTexto);
  parser.on('cdata', anexarTexto);
  parser.on('closetag', () => {
    const no = pilha.pop();
    if (no && no.t !== undefined) {
      const tt = no.t.trim();
      if (tt) no.t = tt;
      else delete no.t;
    }
  });
  parser.on('error', (e: Error) => {
    if (!erro) erro = new XmlRejeitadoError(`XML malformado: ${e.message}`);
  });
  try {
    parser.write(texto).close();
  } catch (e) {
    if (!erro) erro = new XmlRejeitadoError(`XML malformado: ${(e as Error).message}`);
  }
  if (erro) throw erro;
  if (!raiz) throw new XmlRejeitadoError('XML vazio.');
  return raiz;
}

const escTexto = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAtrib = (s: string) => escTexto(s).replace(/"/g, '&quot;');

/** Serializa um nó (e descendentes) usando declarações de namespace padrão. */
export function serializar(no: XNode, nsPai?: string): string {
  let s = '<' + no.n;
  if ((no.ns ?? '') !== (nsPai ?? '')) s += ` xmlns="${escAtrib(no.ns ?? '')}"`;
  if (no.a) for (const [k, v] of Object.entries(no.a)) s += ` ${k}="${escAtrib(v)}"`;
  if (!no.c?.length && no.t === undefined) return s + '/>';
  s += '>';
  if (no.t !== undefined) s += escTexto(no.t);
  if (no.c) for (const f of no.c) s += serializar(f, no.ns);
  return s + `</${no.n}>`;
}

/** Remove namespaces e Signature para armazenamento compacto. */
export function compactar(no: XNode): XNode {
  const r: XNode = { n: no.n };
  if (no.a) r.a = { ...no.a };
  if (no.t !== undefined) r.t = no.t;
  if (no.c) {
    const filhos = no.c.filter((f) => f.n !== 'Signature').map(compactar);
    if (filhos.length) r.c = filhos;
  }
  return r;
}

// ---------------------------------------------------------------------------
// Navegação com rastreamento do caminho (para indicar a origem de cada campo)
// ---------------------------------------------------------------------------

export interface Ctx {
  no: XNode;
  caminho: string;
}

export function ctx(no: XNode, caminho = no.n): Ctx {
  return { no, caminho };
}

export function filhos(c: Ctx, nome: string): Ctx[] {
  const lista = (c.no.c ?? []).filter((f) => f.n === nome);
  return lista.map((no, i) => ({
    no,
    caminho: `${c.caminho}/${nome}${lista.length > 1 ? `[${i + 1}]` : ''}`,
  }));
}

/** Seleciona por caminho relativo "a/b/c" (todas as ocorrências). */
export function sel(c: Ctx | undefined, caminho: string): Ctx[] {
  if (!c) return [];
  let atual: Ctx[] = [c];
  for (const passo of caminho.split('/').filter(Boolean)) {
    const prox: Ctx[] = [];
    for (const a of atual) prox.push(...filhos(a, passo));
    atual = prox;
    if (!atual.length) break;
  }
  return atual;
}

export function um(c: Ctx | undefined, caminho: string): Ctx | undefined {
  return sel(c, caminho)[0];
}

export function txt(c: Ctx | undefined, caminho?: string): string | undefined {
  const alvo = caminho ? um(c, caminho) : c;
  return alvo?.no.t;
}

/** Todos os descendentes com determinado nome (busca em profundidade). */
export function desc(c: Ctx, nome: string): Ctx[] {
  const out: Ctx[] = [];
  const visitar = (x: Ctx) => {
    const nomes = new Map<string, number>();
    for (const f of x.no.c ?? []) nomes.set(f.n, (nomes.get(f.n) ?? 0) + 1);
    const idx = new Map<string, number>();
    for (const f of x.no.c ?? []) {
      const i = (idx.get(f.n) ?? 0) + 1;
      idx.set(f.n, i);
      const filho: Ctx = {
        no: f,
        caminho: `${x.caminho}/${f.n}${(nomes.get(f.n) ?? 0) > 1 ? `[${i}]` : ''}`,
      };
      if (f.n === nome) out.push(filho);
      visitar(filho);
    }
  };
  visitar(c);
  return out;
}

/** Primeiro descendente (sem caminho) — uso interno na extração. */
export function acharNo(no: XNode, pred: (n: XNode) => boolean): XNode | undefined {
  if (pred(no)) return no;
  for (const f of no.c ?? []) {
    const r = acharNo(f, pred);
    if (r) return r;
  }
  return undefined;
}

export function texto(no: XNode | undefined, caminho: string): string | undefined {
  if (!no) return undefined;
  let atual: XNode | undefined = no;
  for (const passo of caminho.split('/').filter(Boolean)) {
    atual = atual?.c?.find((f) => f.n === passo);
    if (!atual) return undefined;
  }
  return atual?.t;
}
