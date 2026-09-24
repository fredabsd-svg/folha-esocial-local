import type { Tabelas } from '../calculo/tabelas.js';
import {
  AVISO_PREVIA,
  type Campo,
  type Celula,
  type Coluna,
  type Documento,
  type Linha,
  type Marca,
  type Pendencia,
  type Val,
} from '../compartilhado/tipos.js';
import { empregador, type InfoEmpregador } from '../dominio/cadastros.js';
import { Dados } from '../dominio/dados.js';
import type { DB } from '../db/armazenamento.js';
import { IND_APURACAO } from '../esocial/catalogo.js';
import type { TrabalhadorFolha } from '../dominio/folha.js';

export interface Parametros {
  empresa: string;
  competencia?: string;
  indApuracao?: string;
  perIni?: string;
  perFim?: string;
  trabalhador?: string;
  agrupar?: string;
  ordenar?: string;
  mascararCpf?: boolean;
  incluirInformativas?: boolean;
  fonteLiquido?: string;
  [k: string]: unknown;
}

export interface ModeloRelatorio {
  titulo?: string;
  colunasOcultas?: string[];
  rodape?: string;
  opcoes?: Record<string, unknown>;
}

export interface Contexto {
  db: DB;
  d: Dados;
  tab: Tabelas;
  p: Parametros;
  emp: InfoEmpregador;
  marca?: Marca;
  modelo?: ModeloRelatorio;
}

export function criarContexto(db: DB, tab: Tabelas, p: Parametros, marca?: Marca, modelo?: ModeloRelatorio): Contexto {
  const d = new Dados(db, p.empresa);
  const per = p.competencia ?? p.perFim ?? new Date().toISOString().slice(0, 7);
  return { db, d, tab, p, emp: empregador(d, per.length === 4 ? `${per}-12` : per), marca, modelo };
}

export function competenciaBr(c?: string) {
  if (!c) return '';
  if (c.length === 4) return c;
  const [a, m] = c.split('-');
  return `${m}/${a}`;
}

export function documentoBase(
  cx: Contexto,
  tipo: string,
  tituloPadrao: string,
  extras: Campo[] = [],
  orientacao: Documento['orientacao'] = 'retrato',
): Documento {
  const p = cx.p;
  const cab: Campo[] = [
    { rotulo: 'Empresa', val: cx.emp.nome },
    { rotulo: 'Inscrição', val: cx.emp.documento },
  ];
  if (p.competencia) {
    cab.push({ rotulo: 'Competência', val: competenciaBr(p.competencia) });
    cab.push({ rotulo: 'Apuração', val: IND_APURACAO[p.indApuracao ?? '1'] ?? p.indApuracao ?? '' });
  }
  if (p.perIni || p.perFim) cab.push({ rotulo: 'Período', val: `${competenciaBr(p.perIni)} a ${competenciaBr(p.perFim)}` });
  cab.push(...extras);
  return {
    tipo,
    titulo: cx.modelo?.titulo?.trim() || tituloPadrao,
    empresa: { chave: p.empresa, nome: cx.emp.nome, documento: cx.emp.documento },
    competencia: p.competencia,
    cabecalho: cab,
    blocos: [],
    pendencias: [],
    geradoEm: new Date().toISOString(),
    aviso: AVISO_PREVIA,
    parametros: { ...p },
    marca: cx.marca,
    orientacao,
  };
}

/** Aplica a configuração do modelo (colunas ocultas) às tabelas do documento. */
export function aplicarModelo(doc: Documento, modelo?: ModeloRelatorio) {
  const ocultas = new Set(modelo?.colunasOcultas ?? []);
  if (ocultas.size) {
    for (const b of doc.blocos) {
      if (b.tabela) b.tabela.colunas = b.tabela.colunas.filter((c) => !ocultas.has(c.id));
    }
  }
  if (modelo?.rodape) doc.subtitulo = [doc.subtitulo, modelo.rodape].filter(Boolean).join(' — ');
  return doc;
}

export function mascararCpf(v: Val, mascarar?: boolean): Val {
  if (!mascarar || typeof v.v !== 'string') return v;
  const s = v.v.replace(/\D/g, '');
  return s.length === 11 ? { ...v, v: `***.${s.slice(3, 6)}.${s.slice(6, 9)}-**` } : v;
}

export function grupoDe(t: TrabalhadorFolha, agrupar?: string): string {
  switch (agrupar) {
    case 'estabelecimento':
      return t.estab ? `Estabelecimento ${t.estab}` : 'Estabelecimento não informado';
    case 'lotacao':
      return t.lotacao ? `Lotação ${t.lotacao}` : 'Lotação não informada';
    case 'categoria':
      return t.categoria ? `Categoria ${t.categoria}` : 'Categoria não informada';
    default:
      return '';
  }
}

export function ordenar(lista: TrabalhadorFolha[], criterio?: string) {
  const nome = (t: TrabalhadorFolha) => String(t.nome.v ?? t.cpf);
  const cmp: Record<string, (a: TrabalhadorFolha, b: TrabalhadorFolha) => number> = {
    nome: (a, b) => nome(a).localeCompare(nome(b), 'pt-BR'),
    matricula: (a, b) => (a.matricula ?? '').localeCompare(b.matricula ?? '', 'pt-BR', { numeric: true }),
    cpf: (a, b) => a.cpf.localeCompare(b.cpf),
    valor: (a, b) => Number(b.liquido.v ?? 0) - Number(a.liquido.v ?? 0),
  };
  return [...lista].sort(cmp[criterio ?? 'nome'] ?? cmp.nome);
}

export function filtrarTrabalhador(lista: TrabalhadorFolha[], termo?: string) {
  if (!termo?.trim()) return lista;
  const t = termo.trim().toLowerCase();
  const dig = t.replace(/\D/g, '');
  return lista.filter(
    (x) =>
      (dig.length >= 3 && x.cpf.includes(dig)) ||
      String(x.nome.v ?? '').toLowerCase().includes(t) ||
      (x.matricula ?? '').toLowerCase() === t,
  );
}

export const col = (id: string, rotulo: string, tipo?: Coluna['tipo'], alinhar?: Coluna['alinhar']): Coluna => ({
  id,
  rotulo,
  tipo,
  alinhar: alinhar ?? (tipo === 'moeda' || tipo === 'numero' || tipo === 'quantidade' || tipo === 'inteiro' ? 'dir' : 'esq'),
});

export const linha = (c: Record<string, Celula>, tipo?: Linha['tipo']): Linha => ({ c, tipo });

export function contarPendencias(doc: Documento, pend: Pendencia[]) {
  const vistos = new Set(doc.pendencias.map((p) => `${p.categoria}|${p.cpf}|${p.mensagem}`));
  for (const p of pend) {
    const k = `${p.categoria}|${p.cpf}|${p.mensagem}`;
    if (!vistos.has(k)) {
      vistos.add(k);
      doc.pendencias.push(p);
    }
  }
}

export function exigir(p: Parametros, ...campos: Array<keyof Parametros>) {
  for (const c of campos) {
    if (!p[c]) throw new ErroParametro(`Parâmetro obrigatório: ${String(c)}`);
  }
}

export class ErroParametro extends Error {}
