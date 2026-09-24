/**
 * Consultas para a interface: painel, eventos, trabalhadores e importações.
 */
import { ultimoDiaMes } from '../calculo/regras.js';
import type { Tabelas } from '../calculo/tabelas.js';
import type { DB } from '../db/armazenamento.js';
import { afastamentos, cadastro, contrato, descricaoAfastamento, desligamento, vinculos } from '../dominio/cadastros.js';
import { Dados } from '../dominio/dados.js';
import { montarFolha, pagamentos, type TrabalhadorFolha } from '../dominio/folha.js';
import { infoEvento } from '../esocial/catalogo.js';

export function listarEmpresas(db: DB) {
  const empresas = db.prepare('SELECT * FROM empresas ORDER BY coalesce(razao_social, chave)').all() as Array<Record<string, unknown>>;
  const stats = db
    .prepare(
      `SELECT emp_chave, count(*) AS eventos, count(DISTINCT cpf) AS trabalhadores, max(per_apur) AS ultima
         FROM eventos WHERE situacao = 'ativo' GROUP BY emp_chave`,
    )
    .all() as Array<{ emp_chave: string; eventos: number; trabalhadores: number; ultima: string }>;
  const m = new Map(stats.map((s) => [s.emp_chave, s]));
  return empresas.map((e) => ({ ...e, estatisticas: m.get(String(e.chave)) ?? { eventos: 0, trabalhadores: 0, ultima: null } }));
}

export function competencias(db: DB, empresa: string) {
  return new Dados(db, empresa).competencias();
}

export function painel(db: DB, tab: Tabelas, empresa?: string) {
  const geral = {
    empresas: (db.prepare('SELECT count(*) n FROM empresas').get() as { n: number }).n,
    importacoes: (db.prepare('SELECT count(*) n FROM importacoes').get() as { n: number }).n,
    eventos: (db.prepare("SELECT count(*) n FROM eventos WHERE situacao = 'ativo'").get() as { n: number }).n,
    eventosInativos: (db.prepare("SELECT count(*) n FROM eventos WHERE situacao <> 'ativo'").get() as { n: number }).n,
    relatorios: (db.prepare('SELECT count(*) n FROM relatorios_gerados').get() as { n: number }).n,
  };
  const ultimasImportacoes = db
    .prepare('SELECT id, nome_arquivo, importado_em, status, qtd_eventos, qtd_eventos_novos, periodo_inicio, periodo_fim FROM importacoes ORDER BY id DESC LIMIT 6')
    .all();
  if (!empresa) return { geral, ultimasImportacoes };
  const d = new Dados(db, empresa);
  const comps = d.competencias().filter((c) => /^\d{4}-\d{2}$/.test(c));
  const porTipo = db
    .prepare(`SELECT tipo, count(*) n FROM eventos WHERE emp_chave = ? AND situacao = 'ativo' GROUP BY tipo ORDER BY tipo`)
    .all(empresa);
  const resumo = comps.slice(0, 6).map((c) => {
    const f = montarFolha(d, tab, c, '1');
    const fech = [...d.doPeriodo('S-1299', c, '1'), ...d.doPeriodo('S-1298', c, '1')].sort((a, b) => a.ordem.localeCompare(b.ordem)).pop();
    const soma = (k: 'proventos' | 'descontos' | 'liquido' | 'pago') =>
      Math.round(f.reduce((a, t) => a + (typeof t[k].v === 'number' ? (t[k].v as number) * 100 : 0), 0)) / 100;
    return {
      competencia: c,
      trabalhadores: f.length,
      proventos: soma('proventos'),
      descontos: soma('descontos'),
      liquido: soma('liquido'),
      pago: soma('pago'),
      divergencias: f.reduce((a, t) => a + t.pendencias.filter((p) => p.categoria === 'divergencia').length, 0),
      pendencias: f.reduce((a, t) => a + t.pendencias.filter((p) => p.nivel !== 'info').length, 0),
      fechamento: fech ? (fech.tipo === 'S-1299' ? 'fechada' : 'reaberta') : 'sem S-1299',
    };
  });
  return { geral, ultimasImportacoes, empresa: { porTipo, competencias: comps, resumo } };
}

export interface FiltroEventos {
  empresa?: string;
  tipo?: string;
  cpf?: string;
  q?: string;
  rubrica?: string;
  perIni?: string;
  perFim?: string;
  situacao?: string;
  importacao?: string;
  pagina?: string;
}

export function buscarEventos(db: DB, f: FiltroEventos) {
  const cond: string[] = [];
  const args: unknown[] = [];
  if (f.empresa) {
    cond.push('e.emp_chave = ?');
    args.push(f.empresa);
  }
  if (f.tipo) {
    cond.push('e.tipo = ?');
    args.push(f.tipo);
  }
  if (f.cpf) {
    cond.push('e.cpf LIKE ?');
    args.push(`%${f.cpf.replace(/\D/g, '')}%`);
  }
  if (f.situacao) {
    cond.push('e.situacao = ?');
    args.push(f.situacao);
  }
  if (f.perIni) {
    cond.push("coalesce(e.per_apur, substr(e.data_ref,1,7)) >= ?");
    args.push(f.perIni);
  }
  if (f.perFim) {
    cond.push("coalesce(e.per_apur, substr(e.data_ref,1,7)) <= ?");
    args.push(f.perFim);
  }
  if (f.rubrica) {
    cond.push('e.arvore_json LIKE ?');
    args.push(`%{"n":"codRubr","t":"${f.rubrica.replace(/["%_\\]/g, '')}"}%`);
  }
  if (f.importacao) {
    cond.push('e.id IN (SELECT evento_pk FROM ocorrencias WHERE importacao_id = ?)');
    args.push(Number(f.importacao));
  }
  if (f.q) {
    const q = f.q.replace(/["%_\\]/g, '');
    cond.push('(e.evento_id LIKE ? OR e.cpf LIKE ? OR e.matricula LIKE ? OR e.arvore_json LIKE ?)');
    args.push(`%${q}%`, `%${q.replace(/\D/g, '') || q}%`, `%${q}%`, `%"n":"nmTrab","t":"%${q}%`);
  }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  const total = (db.prepare(`SELECT count(*) n FROM eventos e ${where}`).get(...args) as { n: number }).n;
  const pagina = Math.max(1, Number(f.pagina ?? 1) || 1);
  const itens = db
    .prepare(
      `SELECT e.id, e.evento_id, e.tipo, e.tag, e.emp_chave, e.cpf, e.matricula, e.per_apur, e.ind_apuracao, e.data_ref, e.ind_retif,
              e.situacao, e.situacao_motivo, e.versao_leiaute, e.xsd_status, e.origem, r.nr_recibo
         FROM eventos e LEFT JOIN recibos r ON r.evento_id = e.evento_id ${where}
        ORDER BY coalesce(e.per_apur, e.data_ref) DESC, e.tipo, e.id DESC LIMIT 100 OFFSET ?`,
    )
    .all(...args, (pagina - 1) * 100) as Array<Record<string, unknown>>;
  return { total, pagina, itens: itens.map((i) => ({ ...i, nome_evento: infoEvento(String(i.tag ?? '')).nome })) };
}

export function detalheEvento(db: DB, id: number) {
  const e = db.prepare('SELECT * FROM eventos WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!e) return undefined;
  const recibo = db.prepare('SELECT * FROM recibos WHERE evento_id = ?').get(e.evento_id);
  const ocorrencias = db
    .prepare(
      `SELECT o.importacao_id, i.nome_arquivo, i.importado_em, a.caminho FROM ocorrencias o
         JOIN importacoes i ON i.id = o.importacao_id JOIN arquivos_xml a ON a.id = o.arquivo_xml_id
        WHERE o.evento_pk = ? ORDER BY o.importacao_id`,
    )
    .all(id);
  const relacionados = db
    .prepare(
      `SELECT id, evento_id, tipo, situacao, situacao_motivo FROM eventos
        WHERE (substituido_por = ? OR id = ? OR (chave_natural IS NOT NULL AND chave_natural = ?)) AND id <> ? ORDER BY id`,
    )
    .all(id, e.substituido_por ?? -1, e.chave_natural ?? '', id);
  const conflitos = db.prepare('SELECT * FROM conflitos WHERE evento_id = ?').all(e.evento_id);
  const { arvore_json, ...resto } = e;
  return {
    ...resto,
    nome_evento: infoEvento(String(e.tag)).nome,
    arvore: JSON.parse(String(arvore_json)),
    recibo,
    ocorrencias,
    relacionados,
    conflitos,
  };
}

export function listarTrabalhadores(db: DB, tab: Tabelas, empresa: string, competencia?: string, q?: string) {
  const d = new Dados(db, empresa);
  const cpfs = new Set<string>();
  for (const v of vinculos(d)) cpfs.add(v.cpf);
  for (const e of d.todos('S-1200')) if (e.cpf) cpfs.add(e.cpf);
  const refData = competencia ? ultimoDiaMes(competencia) : new Date().toISOString().slice(0, 10);
  const folha = new Map<string, TrabalhadorFolha>(competencia ? montarFolha(d, tab, competencia, '1').map((t) => [t.cpf, t]) : []);
  const r = [];
  for (const cpf of cpfs) {
    const vinc = vinculos(d).filter((v) => v.cpf === cpf);
    const mat = vinc[0]?.matricula ?? d.doTrabalhador('S-1200', cpf)[0]?.matricula;
    const s1200 = d.doTrabalhador('S-1200', cpf)[0];
    const cad = cadastro(d, cpf, refData, s1200 ? { ev: s1200, c: undefined } : undefined);
    const ctr = contrato(d, cpf, mat, refData);
    const desl = desligamento(d, cpf, mat);
    const nome = String(cad.nome.v ?? '');
    if (q) {
      const t = q.toLowerCase();
      if (!nome.toLowerCase().includes(t) && !cpf.includes(q.replace(/\D/g, '') || '§') && (mat ?? '').toLowerCase() !== t) continue;
    }
    const ultimas = d.doTrabalhador('S-1200', cpf).map((e) => e.perApur ?? '').sort();
    const f = folha.get(cpf);
    r.push({
      cpf,
      nome: cad.nome,
      matricula: mat ?? null,
      categoria: ctr.codCateg.v,
      cargo: ctr.cargo.v,
      admissao: ctr.dtAdm.v,
      desligamento: desl?.dataRef ?? null,
      ultimaRemuneracao: ultimas[ultimas.length - 1] ?? null,
      situacao: f?.situacao.v ?? (desl?.dataRef && desl.dataRef <= refData ? 'Desligado' : vinc.length ? 'Com vínculo' : 'Sem vínculo importado'),
      liquido: f?.liquido.v ?? null,
      pendencias: f ? f.pendencias.filter((p) => p.nivel !== 'info').length : null,
    });
  }
  return r.sort((a, b) => String(a.nome.v ?? a.cpf).localeCompare(String(b.nome.v ?? b.cpf), 'pt-BR'));
}

export function detalheTrabalhador(db: DB, tab: Tabelas, empresa: string, cpf: string) {
  const d = new Dados(db, empresa);
  const hoje = new Date().toISOString().slice(0, 10);
  const vinc = vinculos(d).filter((v) => v.cpf === cpf);
  const mat = vinc[0]?.matricula;
  const cad = cadastro(d, cpf, hoje);
  const historicoContratual = [
    ...d.doTrabalhador('S-2200', cpf),
    ...d.doTrabalhador('S-2206', cpf),
    ...d.doTrabalhador('S-2300', cpf),
    ...d.doTrabalhador('S-2306', cpf),
  ]
    .sort((a, b) => (a.dataRef ?? '').localeCompare(b.dataRef ?? ''))
    .map((e) => {
      const c = contrato(d, cpf, e.matricula, e.dataRef ?? hoje);
      return { eventoPk: e.pk, tipo: e.tipo, data: e.dataRef, cargo: c.cargo, salario: c.salario, categoria: c.codCateg };
    });
  const afs = afastamentos(d, cpf, mat).map((a) => ({
    inicio: a.ini ?? null,
    fim: a.fim ?? null,
    motivo: a.codMot ? `${a.codMot} - ${descricaoAfastamento(a.codMot)}` : null,
    periodoAquisitivo: a.perAquisIni ? `${a.perAquisIni} a ${a.perAquisFim}` : null,
    eventoPk: a.evIni?.pk ?? a.evFim?.pk,
  }));
  const desl = desligamento(d, cpf, mat);
  const comps = [...new Set(d.doTrabalhador('S-1200', cpf).map((e) => `${e.perApur}|${e.indApuracao ?? '1'}`))].sort().reverse();
  const remuneracoes = comps.map((k) => {
    const [per, ind] = k.split('|');
    const t = montarFolha(d, tab, per, ind, { cpfs: [cpf] })[0];
    return {
      competencia: per,
      indApuracao: ind,
      proventos: t?.proventos,
      descontos: t?.descontos,
      liquido: t?.liquido,
      pago: t?.pago,
      demonstrativos: t?.dms.map((x) => x.ideDmDev) ?? [],
      divergencias: t?.pendencias.filter((p) => p.categoria === 'divergencia').length ?? 0,
    };
  });
  return {
    cpf,
    nome: cad.nome,
    nascimento: cad.nascimento,
    dependentesIrrf: cad.dependentesVal,
    vinculos: vinc.map((v) => ({ matricula: v.matricula, origem: v.origem, inicio: v.dtInicio, categoria: v.codCateg, eventoPk: v.ev.pk })),
    historicoContratual,
    afastamentos: afs,
    desligamento: desl ? { data: desl.dataRef, tipo: desl.tipo, eventoPk: desl.pk } : null,
    remuneracoes,
    pagamentos: pagamentos(d, cpf).map((p) => ({ dtPgto: p.dtPgto, tpPgto: p.tpPgto, perRef: p.perRef, ideDmDev: p.ideDmDev, vrLiq: p.vrLiq, eventoPk: p.ev.pk })),
    eventos: db
      .prepare(
        `SELECT id, evento_id, tipo, per_apur, data_ref, situacao FROM eventos WHERE emp_chave = ? AND cpf = ? ORDER BY coalesce(per_apur, data_ref) DESC, tipo`,
      )
      .all(empresa, cpf),
  };
}

export function detalheImportacao(db: DB, id: number) {
  const imp = db.prepare('SELECT * FROM importacoes WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!imp) return undefined;
  const arquivos = db.prepare('SELECT id, caminho, tamanho, status, mensagem, qtd_eventos FROM arquivos_xml WHERE importacao_id = ? ORDER BY id').all(id);
  const porTipo = db
    .prepare(
      `SELECT e.tipo, e.situacao, count(*) n FROM ocorrencias o JOIN eventos e ON e.id = o.evento_pk
        WHERE o.importacao_id = ? GROUP BY e.tipo, e.situacao ORDER BY e.tipo`,
    )
    .all(id);
  const xsd = db
    .prepare(
      `SELECT e.xsd_status, count(*) n FROM ocorrencias o JOIN eventos e ON e.id = o.evento_pk WHERE o.importacao_id = ? GROUP BY e.xsd_status`,
    )
    .all(id);
  const competencias = db
    .prepare(
      `SELECT e.emp_chave, e.per_apur, e.tipo, count(DISTINCT e.cpf) trabalhadores, count(*) n FROM ocorrencias o JOIN eventos e ON e.id = o.evento_pk
        WHERE o.importacao_id = ? AND e.tipo IN ('S-1200','S-1210','S-1299','S-5001','S-5003') GROUP BY e.emp_chave, e.per_apur, e.tipo ORDER BY e.per_apur`,
    )
    .all(id);
  const solicitacao = imp.solicitacao_id ? db.prepare('SELECT * FROM solicitacoes WHERE id = ?').get(imp.solicitacao_id) : null;
  const { resumo_json, ...resto } = imp;
  return { ...resto, resumo: resumo_json ? JSON.parse(String(resumo_json)) : null, arquivos, porTipo, xsd, competencias, solicitacao };
}
