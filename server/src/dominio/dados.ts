/**
 * Acesso aos eventos ativos de um empregador e construção de valores com
 * origem rastreável (Val).
 */
import type { Formato, RefCalculo, Val } from '../compartilhado/tipos.js';
import type { DB } from '../db/armazenamento.js';
import { carimboDoId } from '../esocial/extrair.js';
import { ctx, type Ctx, type XNode } from '../xml/arvore.js';

export interface EvCarregado {
  pk: number;
  eventoId: string;
  tipo: string;
  tag: string;
  recibo?: string;
  dhProcessamento?: string;
  arquivo?: string;
  importacaoId?: number;
  perApur?: string;
  cpf?: string;
  matricula?: string;
  dataRef?: string;
  indApuracao?: string;
  operacao?: string;
  nrRecArqBase?: string;
  ordem: string;
  raiz: Ctx;
}

interface LinhaEvento {
  id: number;
  evento_id: string;
  tipo: string;
  tag: string;
  per_apur: string | null;
  cpf: string | null;
  matricula: string | null;
  data_ref: string | null;
  ind_apuracao: string | null;
  operacao: string | null;
  nr_rec_arq_base: string | null;
  arvore_json: string;
  nr_recibo: string | null;
  dh_processamento: string | null;
  arquivo: string | null;
  importacao_id: number | null;
}

export interface Complemento {
  id: number;
  escopo: string;
  referencia: string;
  campo: string;
  valor: string;
  origem: string;
  informado_em: string;
}

export class Dados {
  private cache = new Map<string, EvCarregado[]>();
  private complementos: Complemento[] | null = null;

  constructor(
    readonly db: DB,
    readonly empChave: string,
  ) {}

  private carregar(tipo: string): EvCarregado[] {
    const chave = tipo;
    const c = this.cache.get(chave);
    if (c) return c;
    const linhas = this.db
      .prepare(
        `SELECT e.id, e.evento_id, e.tipo, e.tag, e.per_apur, e.cpf, e.matricula, e.data_ref, e.ind_apuracao,
                e.operacao, e.nr_rec_arq_base, e.arvore_json, r.nr_recibo, r.dh_processamento,
                (SELECT i.nome_arquivo || ' › ' || a.caminho FROM ocorrencias o
                   JOIN arquivos_xml a ON a.id = o.arquivo_xml_id JOIN importacoes i ON i.id = o.importacao_id
                  WHERE o.evento_pk = e.id ORDER BY o.importacao_id LIMIT 1) AS arquivo,
                (SELECT min(o.importacao_id) FROM ocorrencias o WHERE o.evento_pk = e.id) AS importacao_id
           FROM eventos e LEFT JOIN recibos r ON r.evento_id = e.evento_id
          WHERE e.emp_chave = ? AND e.tipo = ? AND e.situacao = 'ativo'`,
      )
      .all(this.empChave, tipo) as LinhaEvento[];
    const evs = linhas.map((l) => this.converter(l));
    evs.sort((a, b) => a.ordem.localeCompare(b.ordem));
    this.cache.set(chave, evs);
    return evs;
  }

  private converter(l: LinhaEvento): EvCarregado {
    const arvore = JSON.parse(l.arvore_json) as XNode;
    const dh = l.dh_processamento ? l.dh_processamento.replace(/\D/g, '').padEnd(19, '0').slice(0, 19) : '';
    return {
      pk: l.id,
      eventoId: l.evento_id,
      tipo: l.tipo,
      tag: l.tag,
      recibo: l.nr_recibo ?? undefined,
      dhProcessamento: l.dh_processamento ?? undefined,
      arquivo: l.arquivo ?? undefined,
      importacaoId: l.importacao_id ?? undefined,
      perApur: l.per_apur ?? undefined,
      cpf: l.cpf ?? undefined,
      matricula: l.matricula ?? undefined,
      dataRef: l.data_ref ?? undefined,
      indApuracao: l.ind_apuracao ?? undefined,
      operacao: l.operacao ?? undefined,
      nrRecArqBase: l.nr_rec_arq_base ?? undefined,
      ordem: `${dh || carimboDoId(l.evento_id) || '0'}|${carimboDoId(l.evento_id)}|${String(l.id).padStart(12, '0')}`,
      raiz: ctx(arvore, arvore.n),
    };
  }

  /** Eventos ativos do tipo, em ordem cronológica. */
  todos(tipo: string): EvCarregado[] {
    return this.carregar(tipo);
  }

  doPeriodo(tipo: string, perApur: string, indApuracao?: string): EvCarregado[] {
    return this.carregar(tipo).filter(
      (e) => e.perApur === perApur && (indApuracao === undefined || (e.indApuracao ?? '1') === indApuracao),
    );
  }

  doTrabalhador(tipo: string, cpf: string): EvCarregado[] {
    return this.carregar(tipo).filter((e) => e.cpf === cpf);
  }

  competencias(): string[] {
    const r = this.db
      .prepare(
        `SELECT DISTINCT c AS per_apur FROM (
           SELECT per_apur AS c FROM eventos WHERE emp_chave = ? AND situacao = 'ativo'
              AND tipo IN ('S-1200','S-1299','S-5001','S-5003') AND per_apur IS NOT NULL
           UNION
           SELECT substr(data_ref, 1, 7) FROM eventos WHERE emp_chave = ? AND situacao = 'ativo'
              AND tipo IN ('S-2299','S-2399') AND data_ref IS NOT NULL
         ) ORDER BY c DESC`,
      )
      .all(this.empChave, this.empChave) as Array<{ per_apur: string }>;
    return r.map((x) => x.per_apur);
  }

  // ---------------------------------------------------------- complementos
  private carregarComplementos(): Complemento[] {
    if (!this.complementos) {
      this.complementos = this.db
        .prepare(
          `SELECT id, escopo, referencia, campo, valor, origem, informado_em FROM complementos
            WHERE emp_chave = ? AND ativo = 1 ORDER BY id DESC`,
        )
        .all(this.empChave) as Complemento[];
    }
    return this.complementos;
  }

  complemento(escopo: string, referencia: string, campo: string): Complemento | undefined {
    return this.carregarComplementos().find((c) => c.escopo === escopo && c.referencia === referencia && c.campo === campo);
  }

  empresaCadastro(): { razao_social: string | null; documento_completo: string | null; nome_fantasia: string | null } | undefined {
    return this.db
      .prepare('SELECT razao_social, documento_completo, nome_fantasia FROM empresas WHERE chave = ?')
      .get(this.empChave) as { razao_social: string | null; documento_completo: string | null; nome_fantasia: string | null } | undefined;
  }
}

// ------------------------------------------------------------------ Val
const NUMERICOS: Formato[] = ['moeda', 'numero', 'quantidade', 'percentual'];

export function converter(bruto: string, f?: Formato): string | number {
  if (f && NUMERICOS.includes(f)) {
    const n = Number(bruto.replace(',', '.'));
    return Number.isFinite(n) ? n : bruto;
  }
  if (f === 'inteiro') {
    const n = parseInt(bruto, 10);
    return Number.isFinite(n) ? n : bruto;
  }
  return bruto;
}

/** Valor vindo do XML (ou ausente, se o campo não existir). */
export function vx(ev: EvCarregado | undefined, c: Ctx | undefined, f?: Formato, obsAusente?: string): Val {
  if (!ev) return va(obsAusente ?? 'Evento não encontrado nos arquivos importados', f);
  if (!c || c.no.t === undefined) {
    return va(obsAusente ?? `Campo não informado no ${ev.tipo} (${ev.eventoId})`, f);
  }
  return {
    v: converter(c.no.t, f),
    o: 'xml',
    f,
    x: {
      arquivo: ev.arquivo,
      importacaoId: ev.importacaoId,
      tipoEvento: ev.tipo,
      eventoId: ev.eventoId,
      recibo: ev.recibo,
      campo: c.caminho,
    },
  };
}

export function va(obs: string, f?: Formato, comp?: Val['comp']): Val {
  return { v: null, o: 'ausente', f, obs, comp };
}

export function vc(valor: number | string | null, ref: RefCalculo, f?: Formato): Val {
  if (valor === null) {
    return {
      v: null,
      o: 'ausente',
      f,
      c: ref,
      obs: `Não calculado: ${(ref.incompleto ?? ['dados insuficientes']).join('; ')}`,
    };
  }
  return { v: valor, o: 'calculado', f, c: ref };
}

export function vm(comp: Complemento, f?: Formato): Val {
  return {
    v: converter(comp.valor, f),
    o: 'complementado',
    f,
    m: { complementoId: comp.id, origem: comp.origem, informadoEm: comp.informado_em },
  };
}

/** Valor do XML; se ausente, tenta complemento; se não houver, ausente complementável. */
export function vxOuComp(
  d: Dados,
  ev: EvCarregado | undefined,
  c: Ctx | undefined,
  comp: { escopo: string; referencia: string; campo: string; rotulo: string },
  f?: Formato,
  obsAusente?: string,
): Val {
  const x = vx(ev, c, f, obsAusente);
  if (x.o === 'xml') return x;
  const m = d.complemento(comp.escopo, comp.referencia, comp.campo);
  if (m) return vm(m, f);
  return { ...x, comp };
}

export const num = (v: Val | undefined): number | null => (v && typeof v.v === 'number' ? v.v : null);
export const str = (v: Val | undefined): string | undefined =>
  v && v.v !== null && v.v !== undefined ? String(v.v) : undefined;
