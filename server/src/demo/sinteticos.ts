/**
 * Gerador de XMLs SINTÉTICOS no formato do eSocial (leiaute S-1.3), usados
 * nos testes automatizados e no modo de demonstração.
 *
 * Nenhum dado real: nomes, CPFs e CNPJ são fictícios (gerados com dígitos
 * verificadores válidos apenas para exercitar as validações).
 *
 * Cenário: 1 empresa, 4 trabalhadores, competências 06 a 08/2026, com
 * retificação de S-1200, exclusão de S-2230 via S-3000, férias, rescisão sem
 * justa causa com aviso indenizado, aprendiz (FGTS 2%), reajuste via S-2206,
 * totalizadores S-5001/S-5003 no recibo e UMA divergência proposital
 * (líquido pago no S-1210 do trabalhador 1 em 08/2026 com R$ 10,00 a mais).
 */
import yazl from 'yazl';
import { arred, calcularFgts, calcularInss, calcularIrrf, somar, somarDias } from '../calculo/regras.js';
import { TABELAS_PADRAO, Tabelas } from '../calculo/tabelas.js';

const tabelas = new Tabelas(TABELAS_PADRAO);

// ------------------------------------------------------------------ documentos fictícios
function dvCpf(base9: string): string {
  const calc = (s: string, pesoIni: number) => {
    let soma = 0;
    for (let i = 0; i < s.length; i++) soma += Number(s[i]) * (pesoIni - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = calc(base9, 10);
  const d2 = calc(base9 + d1, 11);
  return `${base9}${d1}${d2}`;
}

function dvCnpj(base12: string): string {
  const pesos1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const pesos2 = [6, ...pesos1];
  const calc = (s: string, p: number[]) => {
    const soma = s.split('').reduce((a, c, i) => a + (c.charCodeAt(0) - 48) * p[i], 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc(base12, pesos1);
  const d2 = calc(base12 + d1, pesos2);
  return `${base12}${d1}${d2}`;
}

export const EMPRESA_SINTETICA = {
  raiz: '98765432',
  cnpj: dvCnpj('987654320001'),
  razaoSocial: 'Empresa Sintética de Demonstração Ltda',
};

// ------------------------------------------------------------------ XML
type Filho = string | number | null | undefined | false | Filho[];
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function el(nome: string, conteudo?: Filho, attrs?: Record<string, string>): string {
  const a = attrs ? Object.entries(attrs).map(([k, v]) => ` ${k}="${esc(v)}"`).join('') : '';
  const corpo = (Array.isArray(conteudo) ? conteudo.flat(10) : [conteudo])
    .filter((x) => x !== null && x !== undefined && x !== false)
    .map((x) => (typeof x === 'number' ? String(x) : (x as string)))
    .join('');
  return `<${nome}${a}>${corpo}</${nome}>`;
}
const v2 = (n: number) => n.toFixed(2);

const NS_EVT = (tag: string) => `http://www.esocial.gov.br/schema/evt/${tag}/v_S_01_03_00`;
const NS_DOWNLOAD = 'http://www.esocial.gov.br/schema/download/retornoProcessamento/v1_0_0';
const NS_RETORNO = 'http://www.esocial.gov.br/schema/evt/retornoEvento/v1_2_1';

let seqId = 0;
let seqRecibo = 0;
function novoId(dataHora: string): string {
  seqId++;
  const dh = dataHora.replace(/\D/g, '').padEnd(14, '0').slice(0, 14);
  return `ID1${EMPRESA_SINTETICA.raiz}000000${dh}${String(seqId).padStart(5, '0')}`;
}
function novoRecibo(): string {
  seqRecibo++;
  return `1.1.${String(9_000_000_000_000_000_000n + BigInt(seqRecibo)).slice(-19)}`;
}

const ideEmpregador = () => el('ideEmpregador', [el('tpInsc', 1), el('nrInsc', EMPRESA_SINTETICA.raiz)]);
const ideEventoBase = (extra: Filho = []) =>
  el('ideEvento', [extra, el('tpAmb', 1), el('procEmi', 1), el('verProc', 'SINTETICO-1.0')]);

interface EventoGerado {
  tag: string;
  id: string;
  xml: string; // <eSocial>...</eSocial>
  recibo: string;
  dh: string;
  totalizadores: string[];
  /** Rubricas que o eSocial devolve no recibo (S-1200/S-2299: INSS/FGTS; S-1210: IRRF). */
  rubricasRecibo?: { cods: string[]; modo: 'cp' | 'ir'; per: string };
}

// incidências no recibo vêm sem zero à esquerda, como no arquivo real do eSocial Download
const semZero = (c: string) => String(Number(c));

function rubricasXml(r: NonNullable<EventoGerado['rubricasRecibo']>) {
  return el(
    'rubricas',
    r.cods.map((cod) => {
      const rb = RUB[cod];
      const attrs: Record<string, string> = {
        nrR: `1.1.${String(8_000_000_000_000_000_000n + BigInt(Number(cod))).slice(-19)}`,
        idE: `ID1${EMPRESA_SINTETICA.raiz}000000202401100900${String(Number(cod) % 100000).padStart(5, '0')}`,
        prA: r.per,
        idT: 'TAB01',
        cdR: cod,
        ntR: rb.nat,
        tpR: rb.tp,
      };
      if (r.modo === 'cp') Object.assign(attrs, { inCP: semZero(rb.cp), inFGTS: semZero(rb.fgts) });
      else attrs.inIR = semZero(rb.ir);
      return el('rubrica', '', attrs);
    }),
  );
}

function evento(tag: string, corpo: Filho, dh: string): EventoGerado {
  const id = novoId(dh);
  const xml = `<eSocial xmlns="${NS_EVT(tag)}">${el(tag, corpo, { Id: id })}</eSocial>`;
  return { tag, id, xml, recibo: novoRecibo(), dh, totalizadores: [] };
}

function envelopeDownload(ev: EventoGerado): string {
  const tot = ev.totalizadores.map((t) => {
    const tipo = t.includes('evtBasesTrab') ? 'S5001' : t.includes('evtBasesFGTS') ? 'S5003' : 'S5002';
    return el('tot', t, { tipo });
  });
  const retorno =
    `<eSocial xmlns="${NS_RETORNO}">` +
    el(
      'retornoEvento',
      [
        ideEmpregador(),
        el('recepcao', [
          el('tpAmb', 1),
          el('dhRecepcao', ev.dh),
          el('versaoAppRecepcao', 'SINTETICO'),
          el('protocoloEnvioLote', `1.1.${ev.dh.replace(/\D/g, '').slice(0, 8)}.0000000000000000${String(seqRecibo).padStart(3, '0')}`),
        ]),
        el('processamento', [
          el('cdResposta', 201),
          el('descResposta', 'Sucesso.'),
          el('versaoAppProcessamento', 'SINTETICO'),
          el('dhProcessamento', ev.dh),
        ]),
        el('recibo', [el('nrRecibo', ev.recibo), el('hash', 'SINTETICO'), ev.rubricasRecibo ? rubricasXml(ev.rubricasRecibo) : null]),
        tot,
      ],
      { Id: `ID${ev.id.slice(2)}R` },
    ) +
    '</eSocial>';
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<eSocial xmlns="${NS_DOWNLOAD}">` +
    el('retornoProcessamentoDownload', [el('evento', ev.xml), el('recibo', retorno)]) +
    `</eSocial>`
  );
}

// ------------------------------------------------------------------ cadastros
interface Rubrica {
  cod: string;
  dsc: string;
  nat: string;
  tp: '1' | '2' | '3';
  cp: string;
  ir: string;
  fgts: string;
}
const RUBRICAS: Rubrica[] = [
  { cod: '1000', dsc: 'Salário base', nat: '1000', tp: '1', cp: '11', ir: '11', fgts: '11' },
  { cod: '1010', dsc: 'Horas extras 50%', nat: '1003', tp: '1', cp: '11', ir: '11', fgts: '11' },
  { cod: '1020', dsc: 'DSR sobre horas extras', nat: '1002', tp: '1', cp: '11', ir: '11', fgts: '11' },
  { cod: '1100', dsc: 'Férias gozadas', nat: '1016', tp: '1', cp: '11', ir: '13', fgts: '11' },
  { cod: '1101', dsc: 'Terço constitucional de férias', nat: '1017', tp: '1', cp: '11', ir: '13', fgts: '11' },
  { cod: '2000', dsc: 'Saldo de salário', nat: '6000', tp: '1', cp: '11', ir: '11', fgts: '11' },
  { cod: '2010', dsc: 'Aviso prévio indenizado', nat: '6003', tp: '1', cp: '00', ir: '09', fgts: '21' },
  { cod: '2020', dsc: '13º salário proporcional', nat: '5001', tp: '1', cp: '12', ir: '12', fgts: '12' },
  { cod: '2030', dsc: 'Férias proporcionais com 1/3', nat: '6006', tp: '1', cp: '00', ir: '09', fgts: '00' },
  { cod: '5000', dsc: 'INSS', nat: '9201', tp: '2', cp: '31', ir: '41', fgts: '00' },
  { cod: '5001', dsc: 'INSS sobre 13º salário', nat: '9201', tp: '2', cp: '32', ir: '42', fgts: '00' },
  { cod: '5003', dsc: 'INSS sobre férias', nat: '9201', tp: '2', cp: '31', ir: '43', fgts: '00' },
  { cod: '5010', dsc: 'IRRF', nat: '9203', tp: '2', cp: '00', ir: '31', fgts: '00' },
  { cod: '5011', dsc: 'IRRF sobre férias', nat: '9203', tp: '2', cp: '00', ir: '33', fgts: '00' },
  { cod: '5012', dsc: 'IRRF sobre 13º salário', nat: '9203', tp: '2', cp: '00', ir: '32', fgts: '00' },
  { cod: '5020', dsc: 'Vale-transporte', nat: '9216', tp: '2', cp: '00', ir: '09', fgts: '00' },
  { cod: '9000', dsc: 'Base de cálculo do INSS (informativa)', nat: '9901', tp: '3', cp: '00', ir: '09', fgts: '00' },
];
const RUB = Object.fromEntries(RUBRICAS.map((r) => [r.cod, r]));

interface Trab {
  cpf: string;
  nome: string;
  mat: string;
  adm: string;
  cargo: string;
  cbo: string;
  sal: number;
  categ: string;
  deps: number;
  vt: boolean;
  nasc: string;
}

export const TRABALHADORES_SINTETICOS: Trab[] = [
  { cpf: dvCpf('999000001'), nome: 'Trabalhador Sintético Um', mat: 'M001', adm: '2024-03-01', cargo: 'Assistente administrativo', cbo: '411010', sal: 3000, categ: '101', deps: 0, vt: true, nasc: '1992-04-10' },
  { cpf: dvCpf('999000002'), nome: 'Trabalhadora Sintética Dois', mat: 'M002', adm: '2023-08-15', cargo: 'Analista contábil', cbo: '252210', sal: 5500, categ: '101', deps: 1, vt: false, nasc: '1988-11-02' },
  { cpf: dvCpf('999000003'), nome: 'Trabalhador Sintético Três', mat: 'M003', adm: '2022-02-01', cargo: 'Auxiliar de escritório', cbo: '411005', sal: 2200, categ: '101', deps: 0, vt: true, nasc: '1999-07-21' },
  { cpf: dvCpf('999000004'), nome: 'Aprendiz Sintético Quatro', mat: 'M004', adm: '2026-06-10', cargo: 'Aprendiz auxiliar administrativo', cbo: '411010', sal: 1100, categ: '103', deps: 0, vt: false, nasc: '2008-01-15' },
];

const cnpj = EMPRESA_SINTETICA.cnpj;
const LOT = 'LOT001';

function localTrabalho() {
  return el('localTrabalho', el('localTrabGeral', [el('tpInsc', 1), el('nrInsc', cnpj)]));
}
function horContratual() {
  return el('horContratual', [el('qtdHrsSem', 44), el('tpJornada', 2), el('tmpParc', 0), el('horNoturno', 'N'), el('dscJorn', 'Segunda a sexta, 8h às 17h48')]);
}
function infoContrato(t: Trab, sal: number) {
  return el('infoContrato', [
    el('nmCargo', t.cargo),
    el('CBOCargo', t.cbo),
    el('acumCargo', 'N'),
    el('codCateg', t.categ),
    el('remuneracao', [el('vrSalFx', v2(sal)), el('undSalFixo', 5)]),
    el('duracao', t.categ === '103' ? [el('tpContr', 2), el('dtTerm', '2028-06-09')] : el('tpContr', 1)),
    localTrabalho(),
    horContratual(),
  ]);
}

// ------------------------------------------------------------------ folha
interface Item {
  cod: string;
  valor: number;
  qtd?: number;
  fator?: number;
}

function itensXml(itens: Item[], tag = 'itensRemun') {
  return itens
    .filter((i) => i.valor > 0)
    .map((i) =>
      el(tag, [
        el('codRubr', i.cod),
        el('ideTabRubr', 'TAB01'),
        i.qtd !== undefined ? el('qtdRubr', i.qtd.toFixed(2)) : null,
        i.fator !== undefined ? el('fatorRubr', i.fator.toFixed(2)) : null,
        el('vrRubr', v2(i.valor)),
        el('indApurIR', 0),
      ]),
    );
}

const somaTipo = (itens: Item[], tp: string) => somar(itens.filter((i) => RUB[i.cod].tp === tp).map((i) => i.valor));
const somaInc = (itens: Item[], campo: 'cp' | 'ir' | 'fgts', cods: string[]) =>
  somar(itens.map((i) => (cods.includes(RUB[i.cod][campo]) ? (RUB[i.cod].tp === '2' ? -i.valor : RUB[i.cod].tp === '1' ? i.valor : 0) : 0)));

interface Demonstrativo {
  ide: string;
  itens: Item[];
}

/** Monta demonstrativo mensal com INSS, IRRF e VT calculados pelas regras do próprio sistema. */
/**
 * Demonstrativo mensal com INSS, IRRF e VT calculados pelas regras do próprio sistema.
 * Como no S-5002 (S-1.3), o IRRF do mês considera também as férias pagas na competência
 * (rendOutros/prevOutros).
 */
function mensal(t: Trab, comp: string, proventos: Item[], inssJaDescontado = 0, baseInssOutros = 0, rendOutros = 0, prevOutros = 0): Item[] {
  const itens = [...proventos];
  const base = somaInc(itens, 'cp', ['11']) + baseInssOutros;
  const inssTotal = calcularInss(base, comp, tabelas).valor!;
  const inss = arred(inssTotal - inssJaDescontado);
  if (t.categ !== '901') itens.push({ cod: '5000', valor: inss });
  const rend = somaInc(itens, 'ir', ['11']) + rendOutros;
  const irrf = calcularIrrf(
    { competencia: comp, tipo: 'mensal', rendimentos: rend, previdenciaOficial: inss + prevOutros, pensao: 0, previdenciaPrivada: 0, dependentes: t.deps },
    tabelas,
  ).valor!;
  if (irrf > 0) itens.push({ cod: '5010', valor: irrf });
  if (t.vt) itens.push({ cod: '5020', valor: arred(t.sal * 0.06), fator: 6 });
  itens.push({ cod: '9000', valor: arred(base) });
  return itens;
}

function liquidoDe(itens: Item[]) {
  return arred(somaTipo(itens, '1') - somaTipo(itens, '2'));
}

function totalizadorCP(evBase: EventoGerado, t: Trab, comp: string, bases: Array<{ ind13: number; valor: number }>, vrCpSeg: number, vrDescSeg: number, dh: string, indApuracao = 1) {
  const id = novoId(dh);
  return (
    `<eSocial xmlns="${NS_EVT('evtBasesTrab')}">` +
    el(
      'evtBasesTrab',
      [
        el('ideEvento', [el('nrRecArqBase', evBase.recibo), el('indApuracao', indApuracao), el('perApur', comp)]),
        ideEmpregador(),
        el('ideTrabalhador', el('cpfTrab', t.cpf)),
        el('infoCpCalc', [el('tpCR', '108201'), el('vrCpSeg', v2(vrCpSeg)), el('vrDescSeg', v2(vrDescSeg))]),
        el(
          'infoCp',
          [
            el('classTrib', '99'),
            el(
              'ideEstabLot',
              [
                el('tpInsc', 1),
                el('nrInsc', cnpj),
                el('codLotacao', LOT),
                el('infoCategIncid', [
                  el('matricula', t.mat),
                  el('codCateg', t.categ),
                  bases.map((b) => el('infoBaseCS', [el('ind13', b.ind13), el('tpValor', 11), el('valor', v2(b.valor))])),
                ]),
              ],
            ),
          ],
        ),
      ],
      { Id: id },
    ) +
    '</eSocial>'
  );
}

function totalizadorFGTS(evBase: EventoGerado, t: Trab, comp: string, bases: Array<{ tpValor: string; base: number }>, dh: string) {
  const id = novoId(dh);
  const aliq = t.categ === '103' ? 0.02 : 0.08;
  return (
    `<eSocial xmlns="${NS_EVT('evtBasesFGTS')}">` +
    el(
      'evtBasesFGTS',
      [
        el('ideEvento', [el('nrRecArqBase', evBase.recibo), el('perApur', comp)]),
        ideEmpregador(),
        el('ideTrabalhador', el('cpfTrab', t.cpf)),
        el(
          'infoFGTS',
          el('ideEstab', [
            el('tpInsc', 1),
            el('nrInsc', cnpj),
            el(
              'ideLotacao',
              [
                el('codLotacao', LOT),
                el('infoTrabFGTS', [
                  el('matricula', t.mat),
                  el('codCateg', t.categ),
                  el('dtAdm', t.adm),
                  el(
                    'infoBaseFGTS',
                    bases.map((b) =>
                      el('basePerApur', [el('tpValor', b.tpValor), el('remFGTS', v2(b.base)), el('dpsFGTS', v2(arred(b.base * aliq)))]),
                    ),
                  ),
                ]),
              ],
            ),
          ]),
        ),
      ],
      { Id: id },
    ) +
    '</eSocial>'
  );
}

function s1200(t: Trab, comp: string, dms: Demonstrativo[], dh: string, retificaRecibo?: string, tag = 'itensRemun'): EventoGerado {
  const ev = evento(
    'evtRemun',
    [
      ideEventoBase([
        el('indRetif', retificaRecibo ? 2 : 1),
        retificaRecibo ? el('nrRecibo', retificaRecibo) : null,
        el('indApuracao', 1),
        el('perApur', comp),
      ]),
      ideEmpregador(),
      el('ideTrabalhador', el('cpfTrab', t.cpf)),
      dms.map((d) =>
        el('dmDev', [
          el('ideDmDev', d.ide),
          el('codCateg', t.categ),
          el(
            'infoPerApur',
            el('ideEstabLot', [
              el('tpInsc', 1),
              el('nrInsc', cnpj),
              el('codLotacao', LOT),
              el('remunPerApur', [el('matricula', t.mat), itensXml(d.itens, tag)]),
            ]),
          ),
        ]),
      ),
    ],
    dh,
  );
  // totalizadores gerados "pelo eSocial" (valores pelas mesmas regras)
  const todos = dms.flatMap((d) => d.itens);
  const base = somaInc(todos, 'cp', ['11']);
  const vrCpSeg = calcularInss(base, comp, tabelas).valor!;
  const vrDescSeg = somar(todos.filter((i) => RUB[i.cod].cp === '31').map((i) => i.valor));
  ev.totalizadores.push(totalizadorCP(ev, t, comp, [{ ind13: 0, valor: base }], vrCpSeg, vrDescSeg, dh));
  ev.totalizadores.push(totalizadorFGTS(ev, t, comp, [{ tpValor: '11', base: somaInc(todos, 'fgts', ['11']) }], dh));
  for (const d of dms) itensPorDm.set(`${t.cpf}|${d.ide}`, d.itens);
  ev.rubricasRecibo = { cods: [...new Set(todos.map((i) => i.cod))], modo: 'cp', per: comp };
  return ev;
}

/** Itens de cada demonstrativo (para o recibo do S-1210 e o S-5002). */
const itensPorDm = new Map<string, Item[]>();

/** S-5002 (IRRF por trabalhador) como o eSocial gera a partir do S-1210: férias somadas ao mês. */
function totalizadorIRRF(evBase: EventoGerado, t: Trab, perApur: string, pagamentos: Array<{ dt: string; tp: number; perRef: string; ide: string }>, dh: string) {
  const id = novoId(dh);
  const dmXml = pagamentos.map((p) => {
    const itens = itensPorDm.get(`${t.cpf}|${p.ide}`) ?? [];
    const rend = somaInc(itens, 'ir', ['11', '13']);
    const prev = somar(itens.filter((i) => ['41', '43'].includes(RUB[i.cod].ir)).map((i) => i.valor));
    const ir = somar(itens.filter((i) => ['31', '33'].includes(RUB[i.cod].ir)).map((i) => i.valor));
    return el('dmDev', [
      el('perRef', p.perRef),
      el('ideDmDev', p.ide),
      el('tpPgto', p.tp),
      el('dtPgto', p.dt),
      el('codCateg', t.categ),
      rend ? el('infoIR', [el('tpInfoIR', 11), el('valor', v2(rend))]) : null,
      prev ? el('infoIR', [el('tpInfoIR', 41), el('valor', v2(prev))]) : null,
      ir ? el('infoIR', [el('tpInfoIR', 31), el('valor', v2(ir))]) : null,
      el('totApurMen', [el('CRMen', '056107'), el('vlrRendTrib', v2(rend)), el('vlrPrevOficial', v2(prev)), el('vlrCRMen', v2(ir))]),
    ]);
  });
  return (
    `<eSocial xmlns="${NS_EVT('evtIrrfBenef')}">` +
    el(
      'evtIrrfBenef',
      [
        el('ideEvento', [el('nrRecArqBase', evBase.recibo), el('perApur', perApur)]),
        ideEmpregador(),
        el('ideTrabalhador', [el('cpfBenef', t.cpf), dmXml]),
      ],
      { Id: id },
    ) +
    '</eSocial>'
  );
}

function s1210(t: Trab, perApur: string, pagamentos: Array<{ dt: string; tp: number; perRef: string; ide: string; liq: number }>, dh: string) {
  const ev = s1210Evento(t, perApur, pagamentos, dh);
  const cods = [...new Set(pagamentos.flatMap((p) => (itensPorDm.get(`${t.cpf}|${p.ide}`) ?? []).map((i) => i.cod)))];
  if (cods.length) ev.rubricasRecibo = { cods, modo: 'ir', per: perApur };
  ev.totalizadores.push(totalizadorIRRF(ev, t, perApur, pagamentos, dh));
  return ev;
}

function s1210Evento(t: Trab, perApur: string, pagamentos: Array<{ dt: string; tp: number; perRef: string; ide: string; liq: number }>, dh: string) {
  return evento(
    'evtPgtos',
    [
      ideEventoBase([el('indRetif', 1), el('perApur', perApur)]),
      ideEmpregador(),
      el('ideBenef', [
        el('cpfBenef', t.cpf),
        pagamentos.map((p) =>
          el('infoPgto', [el('dtPgto', p.dt), el('tpPgto', p.tp), el('perRef', p.perRef), el('ideDmDev', p.ide), el('vrLiq', v2(p.liq))]),
        ),
      ]),
    ],
    dh,
  );
}

// ------------------------------------------------------------------ cenário completo
export interface ArquivoSintetico {
  nome: string;
  conteudo: string;
}

export function gerarEventosSinteticos(): { eventos: EventoGerado[]; descricao: string[] } {
  seqId = 0;
  itensPorDm.clear();
  seqRecibo = 0;
  const evs: EventoGerado[] = [];
  const [w1, w2, w3, w4] = TRABALHADORES_SINTETICOS;

  // Tabelas
  evs.push(
    evento(
      'evtInfoEmpregador',
      [
        ideEventoBase(),
        ideEmpregador(),
        el(
          'infoEmpregador',
          el('inclusao', [
            el('idePeriodo', el('iniValid', '2024-01')),
            el('infoCadastro', [el('classTrib', '99'), el('indCoop', 0), el('indConstr', 0), el('indDesFolha', 0), el('indOptRegEletron', 0), el('indEntEd', 'N'), el('indEtt', 'N')]),
          ]),
        ),
      ],
      '2024-01-10T09:00:00',
    ),
  );
  evs.push(
    evento(
      'evtTabEstab',
      [
        ideEventoBase(),
        ideEmpregador(),
        el(
          'infoEstab',
          el('inclusao', [
            el('ideEstab', [el('tpInsc', 1), el('nrInsc', cnpj), el('iniValid', '2024-01')]),
            el('dadosEstab', [el('cnaePrep', '6920601'), el('aliqGilrat', [el('aliqRat', 1), el('fap', '1.0000')])]),
          ]),
        ),
      ],
      '2024-01-10T09:01:00',
    ),
  );
  evs.push(
    evento(
      'evtTabLotacao',
      [
        ideEventoBase(),
        ideEmpregador(),
        el(
          'infoLotacao',
          el('inclusao', [
            el('ideLotacao', [el('codLotacao', LOT), el('iniValid', '2024-01')]),
            el('dadosLotacao', [el('tpLotacao', '01'), el('fpasLotacao', [el('fpas', '515'), el('codTercs', '0115')])]),
          ]),
        ),
      ],
      '2024-01-10T09:02:00',
    ),
  );
  RUBRICAS.forEach((r, i) =>
    evs.push(
      evento(
        'evtTabRubrica',
        [
          ideEventoBase(),
          ideEmpregador(),
          el(
            'infoRubrica',
            el('inclusao', [
              el('ideRubrica', [el('codRubr', r.cod), el('ideTabRubr', 'TAB01'), el('iniValid', '2024-01')]),
              el('dadosRubrica', [
                el('dscRubr', r.dsc),
                el('natRubr', r.nat),
                el('tpRubr', r.tp),
                el('codIncCP', r.cp),
                el('codIncIRRF', r.ir),
                el('codIncFGTS', r.fgts),
              ]),
            ]),
          ),
        ],
        `2024-01-10T09:${String(10 + i).padStart(2, '0')}:00`,
      ),
    ),
  );

  // Admissões
  for (const t of TRABALHADORES_SINTETICOS) {
    evs.push(
      evento(
        'evtAdmissao',
        [
          ideEventoBase(el('indRetif', 1)),
          ideEmpregador(),
          el('trabalhador', [
            el('cpfTrab', t.cpf),
            el('nmTrab', t.nome),
            el('sexo', t.nome.startsWith('Trabalhadora') ? 'F' : 'M'),
            el('racaCor', 6),
            el('estCiv', 1),
            el('grauInstr', '07'),
            el('nascimento', [el('dtNascto', t.nasc), el('paisNascto', '105'), el('paisNac', '105')]),
            el(
              'endereco',
              el('brasil', [el('tpLograd', 'R'), el('dscLograd', 'Rua Fictícia'), el('nrLograd', '100'), el('bairro', 'Centro'), el('cep', '77000000'), el('codMunic', '1721000'), el('uf', 'TO')]),
            ),
            t.deps
              ? el('dependente', [el('tpDep', '03'), el('nmDep', 'Dependente Sintético'), el('dtNascto', '2016-05-10'), el('depIRRF', 'S'), el('depSF', 'N'), el('incTrab', 'N')])
              : null,
          ]),
          el('vinculo', [
            el('matricula', t.mat),
            el('tpRegTrab', 1),
            el('tpRegPrev', 1),
            el('cadIni', 'N'),
            el(
              'infoRegimeTrab',
              el('infoCeletista', [el('dtAdm', t.adm), el('tpAdmissao', 1), el('indAdmissao', 1), el('tpRegJor', 1), el('natAtividade', 1), el('dtBase', 5), el('cnpjSindCategProf', dvCnpj('111111110001'))]),
            ),
            infoContrato(t, t.sal),
          ]),
        ],
        `${somarDias(t.adm, -1)}T10:00:00`,
      ),
    );
  }

  // S-2206: reajuste do trabalhador 1 a partir de 08/2026
  evs.push(
    evento(
      'evtAltContratual',
      [
        ideEventoBase(el('indRetif', 1)),
        ideEmpregador(),
        el('ideVinculo', [el('cpfTrab', w1.cpf), el('matricula', w1.mat)]),
        el('altContratual', [
          el('dtAlteracao', '2026-08-01'),
          el('dtEf', '2026-08-01'),
          el('dscAlt', 'Reajuste salarial (dados sintéticos)'),
          el('vinculo', el('tpRegPrev', 1)),
          el('infoRegimeTrab', el('infoCeletista', [el('tpRegJor', 1), el('natAtividade', 1), el('dtBase', 5), el('cnpjSindCategProf', dvCnpj('111111110001'))])),
          infoContrato(w1, 3200),
        ]),
      ],
      '2026-08-02T08:00:00',
    ),
  );

  // Afastamento enviado por engano e excluído por S-3000
  const afastErrado = evento(
    'evtAfastTemp',
    [
      ideEventoBase(el('indRetif', 1)),
      ideEmpregador(),
      el('ideVinculo', [el('cpfTrab', w1.cpf), el('matricula', w1.mat)]),
      el('infoAfastamento', el('iniAfastamento', [el('dtIniAfast', '2026-06-15'), el('codMotAfast', '03')])),
    ],
    '2026-06-16T08:00:00',
  );
  evs.push(afastErrado);
  evs.push(
    evento(
      'evtExclusao',
      [
        ideEventoBase(),
        ideEmpregador(),
        el('infoExclusao', [el('tpEvento', 'S-2230'), el('nrRecEvt', afastErrado.recibo), el('ideTrabalhador', el('cpfTrab', w1.cpf))]),
      ],
      '2026-06-17T08:00:00',
    ),
  );

  // Férias da trabalhadora 2 (06 a 25/07/2026)
  evs.push(
    evento(
      'evtAfastTemp',
      [
        ideEventoBase(el('indRetif', 1)),
        ideEmpregador(),
        el('ideVinculo', [el('cpfTrab', w2.cpf), el('matricula', w2.mat)]),
        el('infoAfastamento', [
          el('iniAfastamento', [
            el('dtIniAfast', '2026-07-06'),
            el('codMotAfast', '15'),
            el('perAquis', [el('dtInicio', '2024-08-15'), el('dtFim', '2025-08-14')]),
          ]),
          el('fimAfastamento', el('dtTermAfast', '2026-07-25')),
        ]),
      ],
      '2026-07-01T08:00:00',
    ),
  );

  // ---- Folhas mensais
  const pag: Record<string, Array<{ dt: string; tp: number; perRef: string; ide: string; liq: number; perApur: string }>> = {};
  const addPag = (t: Trab, perApur: string, p: { dt: string; tp: number; perRef: string; ide: string; liq: number }) => {
    (pag[t.cpf] ??= []).push({ ...p, perApur });
  };

  const he = (sal: number, horas: number) => arred((sal / 220) * 1.5 * horas);
  const dsr = (v: number) => arred((v / 25) * 5);

  // 06/2026
  {
    const comp = '2026-06';
    // W1
    let itens = mensal(w1, comp, [{ cod: '1000', valor: 3000, qtd: 30 }]);
    evs.push(s1200(w1, comp, [{ ide: 'FOL202606', itens }], '2026-07-03T10:00:00'));
    addPag(w1, '2026-07', { dt: '2026-07-06', tp: 1, perRef: comp, ide: 'FOL202606', liq: liquidoDe(itens) });
    // W2 com horas extras
    const h2 = he(5500, 10);
    itens = mensal(w2, comp, [{ cod: '1000', valor: 5500, qtd: 30 }, { cod: '1010', valor: h2, qtd: 10, fator: 50 }, { cod: '1020', valor: dsr(h2) }]);
    evs.push(s1200(w2, comp, [{ ide: 'FOL202606', itens }], '2026-07-03T10:01:00'));
    addPag(w2, '2026-07', { dt: '2026-07-06', tp: 1, perRef: comp, ide: 'FOL202606', liq: liquidoDe(itens) });
    // W3
    itens = mensal(w3, comp, [{ cod: '1000', valor: 2200, qtd: 30 }]);
    evs.push(s1200(w3, comp, [{ ide: 'FOL202606', itens }], '2026-07-03T10:02:00'));
    addPag(w3, '2026-07', { dt: '2026-07-06', tp: 1, perRef: comp, ide: 'FOL202606', liq: liquidoDe(itens) });
    // W4 aprendiz admitido em 10/06 (21 dias)
    itens = mensal(w4, comp, [{ cod: '1000', valor: arred((1100 / 30) * 21), qtd: 21 }]);
    const ev4 = s1200(w4, comp, [{ ide: 'FOL202606', itens }], '2026-07-03T10:03:00');
    evs.push(ev4);
    addPag(w4, '2026-07', { dt: '2026-07-06', tp: 1, perRef: comp, ide: 'FOL202606', liq: liquidoDe(itens) });
  }

  // 07/2026
  {
    const comp = '2026-07';
    // W1: original com 5h extras, depois retificado para 8h
    const hOrig = he(3000, 5);
    const itensOrig = mensal(w1, comp, [{ cod: '1000', valor: 3000, qtd: 30 }, { cod: '1010', valor: hOrig, qtd: 5, fator: 50 }, { cod: '1020', valor: dsr(hOrig) }]);
    const orig = s1200(w1, comp, [{ ide: 'FOL202607', itens: itensOrig }], '2026-08-03T10:00:00');
    evs.push(orig);
    const hRet = he(3000, 8);
    const itensRet = mensal(w1, comp, [{ cod: '1000', valor: 3000, qtd: 30 }, { cod: '1010', valor: hRet, qtd: 8, fator: 50 }, { cod: '1020', valor: dsr(hRet) }]);
    evs.push(s1200(w1, comp, [{ ide: 'FOL202607', itens: itensRet }], '2026-08-04T15:00:00', orig.recibo));
    addPag(w1, '2026-08', { dt: '2026-08-05', tp: 1, perRef: comp, ide: 'FOL202607', liq: liquidoDe(itensRet) });

    // W2: férias (20 dias) em demonstrativo próprio + 10 dias de salário
    const vFer = arred((5500 / 30) * 20);
    const vTerco = arred(vFer / 3);
    const baseFer = somar([vFer, vTerco]);
    const inssFer = calcularInss(baseFer, comp, tabelas).valor!;
    // férias: INSS descontado no recibo de férias; o IRRF do mês (férias + salário) é
    // retido no demonstrativo mensal, como o eSocial apura no S-5002
    const itensFer: Item[] = [
      { cod: '1100', valor: vFer, qtd: 20 },
      { cod: '1101', valor: vTerco },
      { cod: '5003', valor: inssFer },
    ];
    const itensMes = mensal(w2, comp, [{ cod: '1000', valor: arred((5500 / 30) * 10), qtd: 10 }], inssFer, baseFer, baseFer, inssFer);
    evs.push(
      s1200(w2, comp, [{ ide: 'FER202607', itens: itensFer }, { ide: 'FOL202607', itens: itensMes }], '2026-08-03T10:01:00'),
    );
    addPag(w2, '2026-07', { dt: '2026-07-03', tp: 1, perRef: comp, ide: 'FER202607', liq: liquidoDe(itensFer) });
    addPag(w2, '2026-08', { dt: '2026-08-05', tp: 1, perRef: comp, ide: 'FOL202607', liq: liquidoDe(itensMes) });

    let itens = mensal(w3, comp, [{ cod: '1000', valor: 2200, qtd: 30 }]);
    evs.push(s1200(w3, comp, [{ ide: 'FOL202607', itens }], '2026-08-03T10:02:00'));
    addPag(w3, '2026-08', { dt: '2026-08-05', tp: 1, perRef: comp, ide: 'FOL202607', liq: liquidoDe(itens) });

    itens = mensal(w4, comp, [{ cod: '1000', valor: 1100, qtd: 30 }]);
    evs.push(s1200(w4, comp, [{ ide: 'FOL202607', itens }], '2026-08-03T10:03:00'));
    addPag(w4, '2026-08', { dt: '2026-08-05', tp: 1, perRef: comp, ide: 'FOL202607', liq: liquidoDe(itens) });
  }

  // 08/2026
  {
    const comp = '2026-08';
    let itens = mensal(w1, comp, [{ cod: '1000', valor: 3200, qtd: 30 }]);
    evs.push(s1200(w1, comp, [{ ide: 'FOL202608', itens }], '2026-09-03T10:00:00'));
    // DIVERGÊNCIA PROPOSITAL: líquido pago com R$ 10,00 a mais
    addPag(w1, '2026-09', { dt: '2026-09-04', tp: 1, perRef: comp, ide: 'FOL202608', liq: arred(liquidoDe(itens) + 10) });

    const h2 = he(5500, 6);
    itens = mensal(w2, comp, [{ cod: '1000', valor: 5500, qtd: 30 }, { cod: '1010', valor: h2, qtd: 6, fator: 50 }, { cod: '1020', valor: dsr(h2) }]);
    evs.push(s1200(w2, comp, [{ ide: 'FOL202608', itens }], '2026-09-03T10:01:00'));
    addPag(w2, '2026-09', { dt: '2026-09-04', tp: 1, perRef: comp, ide: 'FOL202608', liq: liquidoDe(itens) });

    // W4 sem S-1210 em 08/2026 (evento ausente proposital)
    itens = mensal(w4, comp, [{ cod: '1000', valor: 1100, qtd: 30 }]);
    evs.push(s1200(w4, comp, [{ ide: 'FOL202608', itens }], '2026-09-03T10:03:00'));

    // W3: desligamento sem justa causa em 20/08/2026, aviso indenizado (4 anos → 42 dias)
    const dtDeslig = '2026-08-20';
    const diasAviso = 42;
    const saldo = arred((2200 / 30) * 20);
    const aviso = arred((2200 / 30) * diasAviso);
    const decimo = arred((2200 / 12) * 9);
    const feriasProp = arred((2200 / 12) * 8 * (4 / 3));
    const inssSaldo = calcularInss(saldo, comp, tabelas).valor!;
    const inss13 = calcularInss(decimo, comp, tabelas).valor!;
    const verbas: Item[] = [
      { cod: '2000', valor: saldo, qtd: 20 },
      { cod: '2010', valor: aviso, qtd: diasAviso },
      { cod: '2020', valor: decimo, qtd: 9 },
      { cod: '2030', valor: feriasProp, qtd: 8 },
      { cod: '5000', valor: inssSaldo },
      { cod: '5001', valor: inss13 },
    ];
    const ev2299 = evento(
      'evtDeslig',
      [
        ideEventoBase(el('indRetif', 1)),
        ideEmpregador(),
        el('ideVinculo', [el('cpfTrab', w3.cpf), el('matricula', w3.mat)]),
        el('infoDeslig', [
          el('mtvDeslig', '02'),
          el('dtDeslig', dtDeslig),
          el('dtAvPrv', dtDeslig),
          el('indPagtoAPI', 'S'),
          el('dtProjFimAPI', somarDias(dtDeslig, diasAviso)),
          el('pensAlim', 0),
          el('indCumprParc', 4),
          el(
            'verbasResc',
            el('dmDev', [
              el('ideDmDev', 'RESC202608'),
              el(
                'infoPerApur',
                el('ideEstabLot', [el('tpInsc', 1), el('nrInsc', cnpj), el('codLotacao', LOT), itensXml(verbas, 'detVerbas')]),
              ),
            ]),
          ),
        ]),
      ],
      '2026-08-25T09:00:00',
    );
    ev2299.totalizadores.push(
      totalizadorCP(ev2299, w3, comp, [{ ind13: 0, valor: saldo }, { ind13: 1, valor: decimo }], somar([inssSaldo, inss13]), somar([inssSaldo, inss13]), '2026-08-25T09:00:00'),
    );
    ev2299.totalizadores.push(
      totalizadorFGTS(ev2299, w3, comp, [{ tpValor: '11', base: saldo }, { tpValor: '12', base: decimo }, { tpValor: '21', base: aviso }], '2026-08-25T09:00:00'),
    );
    evs.push(ev2299);
    itensPorDm.set(`${w3.cpf}|RESC202608`, verbas);
    ev2299.rubricasRecibo = { cods: verbas.map((i) => i.cod), modo: 'cp', per: comp };
    addPag(w3, '2026-08', { dt: '2026-08-28', tp: 2, perRef: comp, ide: 'RESC202608', liq: liquidoDe(verbas) });
  }

  // S-1210 agrupados por período de pagamento
  const porChave = new Map<string, { t: Trab; perApur: string; itens: Array<{ dt: string; tp: number; perRef: string; ide: string; liq: number }> }>();
  for (const t of TRABALHADORES_SINTETICOS) {
    for (const p of pag[t.cpf] ?? []) {
      const k = `${t.cpf}|${p.perApur}`;
      if (!porChave.has(k)) porChave.set(k, { t, perApur: p.perApur, itens: [] });
      porChave.get(k)!.itens.push(p);
    }
  }
  for (const { t, perApur, itens } of porChave.values()) {
    evs.push(s1210(t, perApur, itens, `${perApur}-${itens[0].dt.slice(8, 10)}T12:00:00`));
  }

  // Fechamentos de 06 e 07 (08 fica sem S-1299 de propósito)
  for (const comp of ['2026-06', '2026-07']) {
    evs.push(
      evento(
        'evtFechaEvPer',
        [
          ideEventoBase([el('indApuracao', 1), el('perApur', comp)]),
          ideEmpregador(),
          el('infoFech', [el('evtRemun', 'S'), el('evtPgtos', 'S'), el('evtComProd', 'N'), el('evtContratAvNP', 'N'), el('evtInfoComplPer', 'N')]),
        ],
        `${comp === '2026-06' ? '2026-07-10' : '2026-08-10'}T18:00:00`,
      ),
    );
  }

  return {
    eventos: evs,
    descricao: [
      '1 empresa fictícia, 4 trabalhadores fictícios, competências 06 a 08/2026',
      'S-1200 de 07/2026 do trabalhador 1 retificado (o original fica como "retificado")',
      'S-2230 enviado por engano e excluído por S-3000',
      'Férias da trabalhadora 2 em 07/2026 (demonstrativo próprio)',
      'Rescisão sem justa causa do trabalhador 3 em 20/08/2026 com aviso indenizado',
      'Aprendiz (FGTS 2%) admitido em 10/06/2026',
      'Divergência proposital: líquido pago (S-1210) do trabalhador 1 em 08/2026 com R$ 10,00 a mais',
      'Evento ausente proposital: aprendiz sem S-1210 da folha de 08/2026; competência 08/2026 sem S-1299',
    ],
  };
}

/** Arquivos no formato do eSocial Download (evento + recibo no mesmo XML). */
const TAGS_CADASTRO = new Set(['evtInfoEmpregador', 'evtTabEstab', 'evtTabRubrica', 'evtTabLotacao', 'evtAdmissao']);

/**
 * Arquivos no formato do eSocial Download (evento + recibo no mesmo XML).
 * `semTabelas` imita um pedido "eventos do período": sem S-1000/S-1005/S-1010/S-1020/S-2200.
 */
export function gerarArquivosSinteticos(opcoes: { semTabelas?: boolean } = {}): ArquivoSintetico[] {
  const { eventos: todos } = gerarEventosSinteticos();
  const eventos = opcoes.semTabelas ? todos.filter((e) => !TAGS_CADASTRO.has(e.tag)) : todos;
  return eventos.map((ev, i) => ({
    nome: `${String(i + 1).padStart(4, '0')}_${ev.tag}_${ev.id}.xml`,
    conteudo: envelopeDownload(ev),
  }));
}

/** Evento isolado, sem recibo (como gerado por um sistema de folha antes do envio). */
export function gerarXmlIsolado(): ArquivoSintetico {
  const { eventos } = gerarEventosSinteticos();
  const ev = eventos.find((e) => e.tag === 'evtRemun')!;
  return { nome: 'evento-isolado.xml', conteudo: `<?xml version="1.0" encoding="UTF-8"?>${ev.xml}` };
}

export function zipar(arquivos: Array<{ nome: string; conteudo: string | Buffer }>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const z = new yazl.ZipFile();
    // data fixa: o mesmo conteúdo gera sempre o mesmo ZIP (mesmo hash)
    const mtime = new Date(Date.UTC(2026, 0, 1));
    for (const a of arquivos) z.addBuffer(Buffer.isBuffer(a.conteudo) ? a.conteudo : Buffer.from(a.conteudo, 'utf8'), a.nome, { mtime });
    z.end();
    const partes: Buffer[] = [];
    z.outputStream.on('data', (c: Buffer) => partes.push(c));
    z.outputStream.on('end', () => resolve(Buffer.concat(partes)));
    z.outputStream.on('error', reject);
  });
}

export async function gerarZipSintetico(opcoes: { semTabelas?: boolean } = {}): Promise<Buffer> {
  return zipar(gerarArquivosSinteticos(opcoes).map((a) => ({ nome: `download/${a.nome}`, conteudo: a.conteudo })));
}

export { calcularFgts };
