/**
 * Localiza eventos e recibos dentro de um documento XML do eSocial.
 *
 * Formatos reconhecidos (independentes de versão de leiaute):
 * - evento isolado: <eSocial><evtXxx Id="...">...</evtXxx><Signature/></eSocial>
 * - arquivo do eSocial Download: <eSocial><retornoProcessamentoDownload>
 *     <evento><eSocial><evtXxx/></eSocial></evento>
 *     <recibo><eSocial><retornoEvento>...<recibo><nrRecibo/></recibo></retornoEvento></eSocial></recibo>
 *   </retornoProcessamentoDownload></eSocial>
 * - lotes de envio/retorno (<evento Id="..."> com o evento ou com o retornoEvento)
 * - totalizadores (S-5xxx) isolados ou embutidos no retorno (<tot>)
 */
import { createHash } from 'node:crypto';
import { compactar, serializar, texto, type XNode } from '../xml/arvore.js';
import { EVENTOS, infoEvento, versaoDoNamespace } from './catalogo.js';

export interface EventoExtraido {
  eventoId: string;
  tag: string;
  tipo: string;
  namespace?: string;
  versaoLeiaute?: string;
  empTp?: string;
  empNr?: string;
  empChave?: string;
  cpf?: string;
  matricula?: string;
  perApur?: string;
  indApuracao?: string;
  dataRef?: string;
  indRetif?: string;
  /** recibo do evento retificado (indRetif=2) ou excluído (S-3000) */
  nrReciboRetificado?: string;
  tpAmb?: string;
  chaveNatural?: string;
  operacao?: string;
  nrRecArqBase?: string;
  origem: 'evento' | 'totalizador_no_recibo';
  arvore: XNode;
  xml: string;
  hash: string;
}

export interface ReciboExtraido {
  eventoId: string;
  nrRecibo: string;
  cdResposta?: string;
  descResposta?: string;
  dhProcessamento?: string;
  dhRecepcao?: string;
  protocolo?: string;
  empChave?: string;
  /** Rubricas informadas pelo eSocial no recibo (retornoEvento/recibo/rubricas/rubrica). */
  rubricas: RubricaRecibo[];
}

export interface RubricaRecibo {
  codRubr: string;
  ideTabRubr: string;
  perApur?: string;
  natRubr?: string;
  tpRubr?: string;
  codIncCP?: string;
  codIncIRRF?: string;
  codIncFGTS?: string;
  codIncPIS?: string;
  nrReciboTabela?: string;
  idEventoTabela?: string;
}

/**
 * O recibo informa as incidências sem zero à esquerda (ex.: "0", "9"), enquanto o
 * S-1010 usa "00", "09". Normaliza para o formato de dois dígitos do leiaute.
 */
export function normalizarIncidencia(v?: string): string | undefined {
  if (v === undefined || v === '') return undefined;
  const s = v.trim();
  return /^\d$/.test(s) ? `0${s}` : s;
}

/** Lê os atributos (abreviados ou por extenso) de cada <rubrica> do recibo. */
function rubricasDoRecibo(ret: XNode): RubricaRecibo[] {
  const bloco = ret.c?.find((f) => f.n === 'recibo')?.c?.find((f) => f.n === 'rubricas');
  const r: RubricaRecibo[] = [];
  for (const rub of bloco?.c ?? []) {
    if (rub.n !== 'rubrica') continue;
    // atributos e, por robustez, também filhos com o mesmo nome
    const v: Record<string, string> = { ...(rub.a ?? {}) };
    for (const f of rub.c ?? []) if (f.t !== undefined) v[f.n] = f.t;
    const pega = (...nomes: string[]) => nomes.map((n) => v[n]).find((x) => x !== undefined && x !== '');
    const codRubr = pega('cdR', 'codRubr');
    if (!codRubr) continue;
    r.push({
      codRubr,
      ideTabRubr: pega('idT', 'ideTabRubr') ?? '',
      perApur: pega('prA', 'perApur', 'iniValid'),
      natRubr: pega('ntR', 'natRubr'),
      tpRubr: pega('tpR', 'tpRubr'),
      codIncCP: normalizarIncidencia(pega('inCP', 'codIncCP')),
      codIncIRRF: normalizarIncidencia(pega('inIR', 'codIncIRRF')),
      codIncFGTS: normalizarIncidencia(pega('inFGTS', 'codIncFGTS')),
      codIncPIS: normalizarIncidencia(pega('inPIS', 'codIncPisPasep')),
      nrReciboTabela: pega('nrR'),
      idEventoTabela: pega('idE'),
    });
  }
  return r;
}

export interface ResultadoExtracao {
  eventos: EventoExtraido[];
  recibos: ReciboExtraido[];
  avisos: string[];
}

const RE_EVT = /^evt[A-Z]/;

interface Achado {
  no: XNode;
  ancestrais: XNode[];
}

function percorrer(raiz: XNode) {
  const eventos: Achado[] = [];
  const retornos: Achado[] = [];
  const visitar = (no: XNode, anc: XNode[]) => {
    if (RE_EVT.test(no.n) && (no.a?.Id || EVENTOS[no.n])) {
      eventos.push({ no, ancestrais: anc });
      return;
    }
    if (no.n === 'retornoEvento' && no.c?.some((f) => f.n === 'recibo' || f.n === 'processamento')) {
      retornos.push({ no, ancestrais: anc });
    }
    const prox = [...anc, no];
    for (const f of no.c ?? []) visitar(f, prox);
  };
  visitar(raiz, []);
  return { eventos, retornos };
}

/** Normaliza o empregador: CNPJ com 14 posições é agrupado pela raiz (8 posições). */
export function chaveEmpregador(tp?: string, nr?: string): string | undefined {
  if (!tp || !nr) return undefined;
  const n = nr.trim().toUpperCase();
  if (tp === '1' && n.length === 14) return `1:${n.slice(0, 8)}`;
  return `${tp}:${n}`;
}

function primeiroDesc(no: XNode, nome: string): XNode | undefined {
  for (const f of no.c ?? []) {
    if (f.n === nome) return f;
    const r = primeiroDesc(f, nome);
    if (r) return r;
  }
  return undefined;
}

const OPERACOES = ['inclusao', 'alteracao', 'exclusao'];

function operacaoTabela(evt: XNode, grupo: string): { op?: string; no?: XNode } {
  const info = evt.c?.find((f) => f.n === grupo);
  const opNo = info?.c?.find((f) => OPERACOES.includes(f.n));
  return { op: opNo?.n, no: opNo };
}

function camposEspecificos(tag: string, evt: XNode, e: Partial<EventoExtraido>) {
  const t = (c: string) => texto(evt, c);
  const emp = e.empChave ?? '?';
  switch (tag) {
    case 'evtRemun': {
      e.cpf = t('ideTrabalhador/cpfTrab');
      e.matricula = primeiroDesc(evt, 'matricula')?.t;
      e.chaveNatural = `${emp}|S-1200|${e.cpf}|${e.indApuracao}|${e.perApur}`;
      break;
    }
    case 'evtPgtos':
      e.cpf = t('ideBenef/cpfBenef');
      e.chaveNatural = `${emp}|S-1210|${e.cpf}|${e.perApur}`;
      break;
    case 'evtBasesTrab':
    case 'evtBasesFGTS':
      e.cpf = t('ideTrabalhador/cpfTrab');
      e.nrRecArqBase = t('ideEvento/nrRecArqBase');
      e.matricula = primeiroDesc(evt, 'matricula')?.t;
      e.chaveNatural = `${emp}|${infoEvento(tag).codigo}|${e.cpf}|${e.indApuracao ?? ''}|${e.perApur}|${e.nrRecArqBase ?? ''}`;
      break;
    case 'evtIrrfBenef':
      e.cpf = t('ideTrabalhador/cpfBenef') ?? t('ideTrabalhador/cpfTrab');
      e.nrRecArqBase = t('ideEvento/nrRecArqBase');
      e.chaveNatural = `${emp}|S-5002|${e.cpf}|${e.perApur}|${e.nrRecArqBase ?? ''}`;
      break;
    case 'evtCS':
    case 'evtIrrf':
    case 'evtFGTS':
      e.nrRecArqBase = t('ideEvento/nrRecArqBase');
      e.chaveNatural = `${emp}|${infoEvento(tag).codigo}|${e.indApuracao ?? ''}|${e.perApur}`;
      break;
    case 'evtFechaEvPer':
    case 'evtReabreEvPer':
      e.chaveNatural = undefined; // a situação da competência considera todos, em ordem
      break;
    case 'evtAdmissao':
      e.cpf = t('trabalhador/cpfTrab');
      e.matricula = t('vinculo/matricula');
      e.dataRef =
        t('vinculo/infoRegimeTrab/infoCeletista/dtAdm') ?? t('vinculo/infoRegimeTrab/infoEstatutario/dtExercicio');
      e.chaveNatural = `${emp}|S-2200|${e.cpf}|${e.matricula}`;
      break;
    case 'evtAltCadastral':
      e.cpf = t('ideTrabalhador/cpfTrab');
      e.dataRef = t('alteracao/dtAlteracao');
      e.chaveNatural = `${emp}|S-2205|${e.cpf}|${e.dataRef}`;
      break;
    case 'evtAltContratual':
      e.cpf = t('ideVinculo/cpfTrab');
      e.matricula = t('ideVinculo/matricula');
      e.dataRef = t('altContratual/dtAlteracao');
      e.chaveNatural = `${emp}|S-2206|${e.cpf}|${e.matricula}|${e.dataRef}`;
      break;
    case 'evtAfastTemp': {
      e.cpf = t('ideVinculo/cpfTrab');
      e.matricula = t('ideVinculo/matricula');
      const ini = t('infoAfastamento/iniAfastamento/dtIniAfast');
      const fim = t('infoAfastamento/fimAfastamento/dtTermAfast');
      e.dataRef = ini ?? fim;
      e.chaveNatural = `${emp}|S-2230|${e.cpf}|${e.matricula}|${ini ? 'ini' : 'fim'}:${e.dataRef}`;
      break;
    }
    case 'evtDeslig':
      e.cpf = t('ideVinculo/cpfTrab');
      e.matricula = t('ideVinculo/matricula');
      e.dataRef = t('infoDeslig/dtDeslig');
      e.chaveNatural = `${emp}|S-2299|${e.cpf}|${e.matricula}`;
      break;
    case 'evtTSVInicio':
      e.cpf = t('trabalhador/cpfTrab');
      e.matricula = t('infoTSVInicio/matricula');
      e.dataRef = t('infoTSVInicio/dtInicio');
      e.chaveNatural = `${emp}|S-2300|${e.cpf}|${e.matricula ?? ''}|${t('infoTSVInicio/codCateg')}|${e.dataRef}`;
      break;
    case 'evtTSVAltContr':
      e.cpf = t('ideTrabSemVinculo/cpfTrab');
      e.matricula = t('ideTrabSemVinculo/matricula');
      e.dataRef = t('infoTSVAlteracao/dtAlteracao');
      e.chaveNatural = `${emp}|S-2306|${e.cpf}|${e.matricula ?? ''}|${e.dataRef}`;
      break;
    case 'evtTSVTermino':
      e.cpf = t('ideTrabSemVinculo/cpfTrab');
      e.matricula = t('ideTrabSemVinculo/matricula');
      e.dataRef = t('infoTSVTermino/dtTerm');
      e.chaveNatural = `${emp}|S-2399|${e.cpf}|${e.matricula ?? ''}|${t('ideTrabSemVinculo/codCateg') ?? ''}`;
      break;
    case 'evtExclusao':
      e.nrReciboRetificado = t('infoExclusao/nrRecEvt');
      e.cpf = t('infoExclusao/ideTrabalhador/cpfTrab');
      e.perApur = t('infoExclusao/ideFolhaPagto/perApur') ?? e.perApur;
      e.indApuracao = t('infoExclusao/ideFolhaPagto/indApuracao') ?? e.indApuracao;
      e.chaveNatural = undefined;
      break;
    case 'evtInfoEmpregador': {
      const { op, no } = operacaoTabela(evt, 'infoEmpregador');
      e.operacao = op;
      e.perApur = texto(no, 'idePeriodo/iniValid');
      e.chaveNatural = `${emp}|S-1000|${e.perApur}`;
      break;
    }
    case 'evtTabEstab': {
      const { op, no } = operacaoTabela(evt, 'infoEstab');
      e.operacao = op;
      e.perApur = texto(no, 'ideEstab/iniValid');
      e.chaveNatural = `${emp}|S-1005|${texto(no, 'ideEstab/tpInsc')}|${texto(no, 'ideEstab/nrInsc')}|${e.perApur}`;
      break;
    }
    case 'evtTabRubrica': {
      const { op, no } = operacaoTabela(evt, 'infoRubrica');
      e.operacao = op;
      e.perApur = texto(no, 'ideRubrica/iniValid');
      e.chaveNatural = `${emp}|S-1010|${texto(no, 'ideRubrica/codRubr')}|${texto(no, 'ideRubrica/ideTabRubr')}|${e.perApur}`;
      break;
    }
    case 'evtTabLotacao': {
      const { op, no } = operacaoTabela(evt, 'infoLotacao');
      e.operacao = op;
      e.perApur = texto(no, 'ideLotacao/iniValid');
      e.chaveNatural = `${emp}|S-1020|${texto(no, 'ideLotacao/codLotacao')}|${e.perApur}`;
      break;
    }
    case 'evtTabProcesso': {
      const { op, no } = operacaoTabela(evt, 'infoProcesso');
      e.operacao = op;
      e.perApur = texto(no, 'ideProcesso/iniValid');
      e.chaveNatural = `${emp}|S-1070|${texto(no, 'ideProcesso/tpProc')}|${texto(no, 'ideProcesso/nrProc')}|${e.perApur}`;
      break;
    }
    default:
      e.cpf = primeiroDesc(evt, 'cpfTrab')?.t ?? primeiroDesc(evt, 'cpfBenef')?.t;
      e.chaveNatural = undefined;
  }
}

function extrairEvento(achado: Achado, origem: EventoExtraido['origem']): EventoExtraido | null {
  const evt = achado.no;
  const id = evt.a?.Id;
  if (!id) return null;
  const pai = achado.ancestrais[achado.ancestrais.length - 1];
  const envelope: XNode = pai && pai.n === 'eSocial' ? pai : evt;
  const info = infoEvento(evt.n);
  const e: Partial<EventoExtraido> = {
    eventoId: id,
    tag: evt.n,
    tipo: info.codigo,
    namespace: evt.ns ?? envelope.ns,
    origem,
  };
  e.versaoLeiaute = versaoDoNamespace(e.namespace);
  e.empTp = texto(evt, 'ideEmpregador/tpInsc');
  e.empNr = texto(evt, 'ideEmpregador/nrInsc');
  e.empChave = chaveEmpregador(e.empTp, e.empNr);
  e.indRetif = texto(evt, 'ideEvento/indRetif');
  if (e.indRetif === '2') e.nrReciboRetificado = texto(evt, 'ideEvento/nrRecibo');
  e.indApuracao = texto(evt, 'ideEvento/indApuracao');
  e.perApur = texto(evt, 'ideEvento/perApur');
  e.tpAmb = texto(evt, 'ideEvento/tpAmb');
  camposEspecificos(evt.n, evt, e);
  const xml = serializar(envelope);
  e.xml = xml;
  e.arvore = compactar(evt);
  e.hash = createHash('sha256').update(xml).digest('hex');
  return e as EventoExtraido;
}

function extrairRecibo(ret: XNode, eventoId: string): ReciboExtraido | null {
  const nr = texto(ret, 'recibo/nrRecibo');
  if (!nr) return null;
  return {
    eventoId,
    nrRecibo: nr,
    cdResposta: texto(ret, 'processamento/cdResposta'),
    descResposta: texto(ret, 'processamento/descResposta'),
    dhProcessamento: texto(ret, 'processamento/dhProcessamento'),
    dhRecepcao: texto(ret, 'recepcao/dhRecepcao'),
    protocolo: texto(ret, 'recepcao/protocoloEnvioLote'),
    empChave: chaveEmpregador(texto(ret, 'ideEmpregador/tpInsc'), texto(ret, 'ideEmpregador/nrInsc')),
    rubricas: rubricasDoRecibo(ret),
  };
}

export function extrairDoDocumento(raiz: XNode): ResultadoExtracao {
  const { eventos: achados, retornos } = percorrer(raiz);
  const avisos: string[] = [];
  const eventos: EventoExtraido[] = [];
  const recibos: ReciboExtraido[] = [];

  for (const a of achados) {
    const dentroDeTot = a.ancestrais.some((x) => x.n === 'tot');
    const ev = extrairEvento(a, dentroDeTot ? 'totalizador_no_recibo' : 'evento');
    if (ev) eventos.push(ev);
    else avisos.push(`Elemento ${a.no.n} sem atributo Id foi ignorado.`);
  }

  // Associa cada retornoEvento ao evento correspondente
  for (const r of retornos) {
    let eventoId: string | undefined;
    const download = [...r.ancestrais].reverse().find((x) => x.n === 'retornoProcessamentoDownload');
    if (download) {
      const evNo = download.c?.find((f) => f.n === 'evento');
      const evt = evNo ? primeiroEvt(evNo) : undefined;
      eventoId = evt?.a?.Id;
    }
    if (!eventoId) {
      const evAnc = [...r.ancestrais].reverse().find((x) => x.n === 'evento' && x.a?.Id);
      eventoId = evAnc?.a?.Id;
    }
    if (!eventoId) {
      avisos.push('Recibo (retornoEvento) sem evento associado foi ignorado.');
      continue;
    }
    const rec = extrairRecibo(r.no, eventoId);
    if (rec) recibos.push(rec);
  }
  return { eventos, recibos, avisos };
}

function primeiroEvt(no: XNode): XNode | undefined {
  if (RE_EVT.test(no.n) && no.a?.Id) return no;
  for (const f of no.c ?? []) {
    const r = primeiroEvt(f);
    if (r) return r;
  }
  return undefined;
}

/** Ordem cronológica aproximada pelo Id do evento (ID + tpInsc + nrInsc(14) + AAAAMMDDHHMMSS + seq). */
export function carimboDoId(id: string): string {
  if (/^ID\w{15}\d{19}$/.test(id)) return id.slice(17, 36);
  return '';
}
