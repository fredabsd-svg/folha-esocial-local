/**
 * Monta a folha de uma competência a partir dos eventos ativos:
 * demonstrativos (S-1200 e verbas do S-2299), pagamentos (S-1210),
 * totalizadores (S-5001/S-5003) e conferências determinísticas.
 */
import {
  arred,
  basePorIncidencia,
  calcularFgts,
  calcularInss,
  calcularIrrf,
  comparar,
  competenciaSeguinte,
  type Comparacao,
  liquido,
  type Resultado,
  cent,
  somar,
  totalPorTipo,
  ultimoDiaMes,
  type TipoIrrf,
} from '../calculo/regras.js';
import type { Tabelas } from '../calculo/tabelas.js';
import type { Pendencia, RefXml, Val } from '../compartilhado/tipos.js';
import { descrever, COD_CATEG, ehEmpregado, TP_PGTO } from '../esocial/catalogo.js';
import { desc, sel, txt, um, type Ctx } from '../xml/arvore.js';
import {
  afastamentos,
  cadastro,
  contrato,
  desligamento,
  descricaoAfastamento,
  type Contrato,
  type InfoRubrica,
  rubrica,
  vinculoDe,
} from './cadastros.js';
import { type Dados, type EvCarregado, num, va, vc, vx } from './dados.js';

export interface ItemRem {
  codRubr: string;
  ideTabRubr: string;
  rub: InfoRubrica;
  qtd: Val;
  fator: Val;
  valor: Val;
  vNum: number | null;
  estab?: string;
  lotacao?: string;
  matricula?: string;
  perRef?: string;
}

export interface Demonstrativo {
  ideDmDev: string;
  origem: 'S-1200' | 'S-2299' | 'S-2399';
  codCateg: Val;
  categ?: string;
  ev: EvCarregado;
  itens: ItemRem[];
  proventos: Val;
  descontos: Val;
  informativas: Val;
  liquido: Val;
  liquidoNum: number | null;
  pagamento?: Pagamento;
  pago: Val;
  dtPgto: Val;
  conferenciaLiquido: Conferencia;
}

export interface Pagamento {
  dtPgto: Val;
  tpPgto: string;
  perRef: string;
  ideDmDev: string;
  vrLiq: Val;
  vNum: number | null;
  ev: EvCarregado;
}

export interface Conferencia {
  id: string;
  titulo: string;
  calculado: Val;
  referencias: Array<{ rotulo: string; val: Val }>;
  status: Comparacao['status'] | 'nao_aplicavel';
  diferenca: Val | null;
  obs?: string;
}

export interface TrabalhadorFolha {
  cpf: string;
  matricula?: string;
  nome: Val;
  cpfVal: Val;
  matriculaVal: Val;
  contrato: Contrato;
  categoria: string;
  situacao: Val;
  estab?: string;
  lotacao?: string;
  dms: Demonstrativo[];
  proventos: Val;
  descontos: Val;
  liquido: Val;
  pago: Val;
  bases: Record<string, Val>;
  conferencias: Conferencia[];
  pendencias: Pendencia[];
  dependentes: Val;
  eventosS1200: EvCarregado[];
}

// ------------------------------------------------------------------ demonstrativos
function itemDe(d: Dados, ev: EvCarregado, it: Ctx, per: string, extra: Partial<ItemRem>): ItemRem {
  const codRubr = txt(it, 'codRubr') ?? '';
  const ideTabRubr = txt(it, 'ideTabRubr') ?? '';
  const valor = vx(ev, um(it, 'vrRubr'), 'moeda');
  return {
    codRubr,
    ideTabRubr,
    rub: rubrica(d, codRubr, ideTabRubr, per),
    qtd: vx(ev, um(it, 'qtdRubr'), 'quantidade', 'Quantidade não informada'),
    fator: vx(ev, um(it, 'fatorRubr'), 'numero', 'Fator não informado'),
    valor,
    vNum: num(valor),
    ...extra,
  };
}

function coletarItens(d: Dados, ev: EvCarregado, dm: Ctx, per: string, tagItem: string, grupoPerApur: string, grupoPerAnt: string): ItemRem[] {
  const itens: ItemRem[] = [];
  for (const est of sel(dm, 'infoPerApur/ideEstabLot')) {
    const estab = txt(est, 'nrInsc');
    const lotacao = txt(est, 'codLotacao');
    if (grupoPerApur) {
      for (const rp of sel(est, grupoPerApur)) {
        const matricula = txt(rp, 'matricula');
        for (const it of sel(rp, tagItem)) itens.push(itemDe(d, ev, it, per, { estab, lotacao, matricula }));
      }
    } else {
      for (const it of sel(est, tagItem)) itens.push(itemDe(d, ev, it, per, { estab, lotacao }));
    }
  }
  for (const periodo of desc(dm, 'idePeriodo')) {
    const perRef = txt(periodo, 'perRef');
    for (const est of sel(periodo, 'ideEstabLot')) {
      const estab = txt(est, 'nrInsc');
      const lotacao = txt(est, 'codLotacao');
      const grupos = grupoPerAnt ? sel(est, grupoPerAnt) : [est];
      for (const rp of grupos) {
        const matricula = txt(rp, 'matricula');
        for (const it of sel(rp, tagItem)) itens.push(itemDe(d, ev, it, per, { estab, lotacao, matricula, perRef }));
      }
    }
  }
  return itens;
}

export function pagamentos(d: Dados, cpf: string): Pagamento[] {
  const r: Pagamento[] = [];
  for (const ev of d.doTrabalhador('S-1210', cpf)) {
    for (const ip of sel(ev.raiz, 'ideBenef/infoPgto')) {
      const vrLiq = vx(ev, um(ip, 'vrLiq'), 'moeda');
      r.push({
        dtPgto: vx(ev, um(ip, 'dtPgto'), 'data'),
        tpPgto: txt(ip, 'tpPgto') ?? '',
        perRef: txt(ip, 'perRef') ?? '',
        ideDmDev: txt(ip, 'ideDmDev') ?? '',
        vrLiq,
        vNum: num(vrLiq),
        ev,
      });
    }
  }
  return r;
}

function montarDm(
  d: Dados,
  tab: Tabelas,
  ev: EvCarregado,
  dm: Ctx,
  origem: Demonstrativo['origem'],
  per: string,
  pgtos: Pagamento[],
  categPadrao?: string,
): Demonstrativo {
  const ideDmDev = txt(dm, 'ideDmDev') ?? '';
  const itens =
    origem === 'S-1200'
      ? coletarItens(d, ev, dm, per, 'itensRemun', 'remunPerApur', 'remunPerAnt')
      : coletarItens(d, ev, dm, per, 'detVerbas', '', '');
  const codCategCtx = um(dm, 'codCateg');
  const codCateg = codCategCtx ? vx(ev, codCategCtx, 'texto') : categPadrao ? { v: categPadrao, o: 'xml' as const, f: 'texto' as const } : va('Categoria não informada', 'texto');
  const base = itens.map((i) => ({ valor: i.vNum, tpRubr: i.rub.tp }));
  const p = totalPorTipo(base, '1');
  const dsc = totalPorTipo(base, '2');
  const inf = totalPorTipo(base, '3');
  const liq = liquido(p, dsc);
  const tpPgtoEsperado = origem === 'S-1200' ? '1' : origem === 'S-2299' ? '2' : '3';
  const candidatos = pgtos.filter((x) => x.ideDmDev === ideDmDev && x.perRef === per);
  const pagamento = candidatos.find((x) => x.tpPgto === tpPgtoEsperado) ?? candidatos[0];
  const pago = pagamento?.vrLiq ?? va(`S-1210 com o pagamento do demonstrativo ${ideDmDev} não encontrado`, 'moeda');
  const cmp = comparar(liq.valor, pagamento?.vNum ?? null, tab.tolerancia, !!liq.ref.incompleto);
  return {
    ideDmDev,
    origem,
    codCateg,
    categ: codCateg.v as string | undefined,
    ev,
    itens,
    proventos: vc(p.valor, p.ref, 'moeda'),
    descontos: vc(dsc.valor, dsc.ref, 'moeda'),
    informativas: vc(inf.valor, inf.ref, 'moeda'),
    liquido: vc(liq.valor, liq.ref, 'moeda'),
    liquidoNum: liq.valor,
    pagamento,
    pago,
    dtPgto: pagamento?.dtPgto ?? va('Data de pagamento não encontrada (S-1210)', 'data'),
    conferenciaLiquido: {
      id: `liquido:${ideDmDev}`,
      titulo: `Líquido do demonstrativo ${ideDmDev}`,
      calculado: vc(liq.valor, liq.ref, 'moeda'),
      referencias: [{ rotulo: `Líquido pago (S-1210, ${descrever(TP_PGTO, pagamento?.tpPgto)})`, val: pago }],
      status: cmp.status,
      diferenca: cmp.diferenca === null ? null : vc(cmp.diferenca, { regra: 'DIFERENCA', versao: '1', formula: 'Valor informado no XML − valor calculado' }, 'moeda'),
    },
  };
}

// ------------------------------------------------------------------ totalizadores
function bases5001(evs: EvCarregado[], ind13: string) {
  let total = 0;
  const fontes: RefXml[] = [];
  for (const ev of evs) {
    for (const b of desc(ev.raiz, 'infoBaseCS')) {
      if (txt(b, 'ind13') !== ind13 || txt(b, 'tpValor') !== '11') continue;
      total += Number(txt(b, 'valor') ?? 0) * 100;
      fontes.push({ tipoEvento: ev.tipo, eventoId: ev.eventoId, recibo: ev.recibo, arquivo: ev.arquivo, campo: `${b.caminho}/valor` });
    }
  }
  return { valor: Math.round(total) / 100, fontes };
}

function somaCampo(evs: EvCarregado[], nome: string) {
  let total = 0;
  const fontes: RefXml[] = [];
  for (const ev of evs) {
    for (const c of desc(ev.raiz, nome)) {
      total += Math.round(Number(c.no.t ?? 0) * 100);
      fontes.push({ tipoEvento: ev.tipo, eventoId: ev.eventoId, recibo: ev.recibo, arquivo: ev.arquivo, campo: c.caminho });
    }
  }
  return { valor: total / 100, fontes };
}

/** Valor somado de campos do XML (origem XML com várias fontes). */
function vxSoma(soma: { valor: number; fontes: RefXml[] }, descricao: string, obsAusente: string): Val {
  if (!soma.fontes.length) return va(obsAusente, 'moeda');
  if (soma.fontes.length === 1) return { v: soma.valor, o: 'xml', f: 'moeda', x: soma.fontes[0] };
  return {
    v: soma.valor,
    o: 'calculado',
    f: 'moeda',
    c: { regra: 'SOMA_XML', versao: '1', formula: `Soma de ${soma.fontes.length} valores do XML: ${descricao}`, fontes: soma.fontes },
  };
}

// ------------------------------------------------------------------ conferências
function conferir(
  id: string,
  titulo: string,
  calc: Resultado,
  refs: Array<{ rotulo: string; val: Val }>,
  tolerancia: number,
): Conferencia {
  const calculado = vc(calc.valor, calc.ref, 'moeda');
  const principal = refs.find((r) => r.val.v !== null);
  const cmp = comparar(calc.valor, principal ? num(principal.val) : null, tolerancia, !!calc.ref.incompleto?.length);
  return {
    id,
    titulo,
    calculado,
    referencias: refs,
    status: cmp.status,
    diferenca:
      cmp.diferenca === null
        ? null
        : vc(cmp.diferenca, { regra: 'DIFERENCA', versao: '1', formula: `${principal?.rotulo} − valor calculado` }, 'moeda'),
  };
}

/**
 * Valor retido (INSS ou IRRF) pelas rubricas: descontos somam e proventos subtraem;
 * rubricas informativas (tpRubr 3 e 4) não entram — mesmo critério do vrDescSeg (S-5001).
 */
export function vxRubricas(itens: ItemRem[], codigos: string[], campo: 'cp' | 'ir' | 'fgts', rotulo: string): Val {
  const comInc = itens.filter((i) => i.rub[campo] && codigos.includes(i.rub[campo]!));
  const sel2 = comInc.filter((i) => i.rub.tp !== '3' && i.rub.tp !== '4');
  const informativas = comInc.length - sel2.length;
  if (!sel2.length) return va(`Nenhuma rubrica de desconto com incidência ${codigos.join('/')} (${rotulo})`, 'moeda');
  if (sel2.length === 1 && sel2[0].rub.tp !== '1' && !informativas) return sel2[0].valor;
  return {
    v: sel2.reduce((s, i) => s + (i.rub.tp === '1' ? -1 : 1) * cent(i.vNum ?? 0), 0) / 100,
    o: 'calculado',
    f: 'moeda',
    c: {
      regra: 'SOMA_RUBRICAS',
      versao: '2',
      formula: `Σ descontos − Σ proventos das rubricas com incidência ${codigos.join('/')} (${rotulo}); rubricas informativas (tipos 3 e 4) não entram`,
      parametros: informativas ? { rubricasInformativasIgnoradas: informativas } : undefined,
      fontes: sel2.map((i) => i.valor.x!).filter(Boolean),
    },
  };
}

// ------------------------------------------------------------------ situação
function situacaoNaCompetencia(d: Dados, cpf: string, matricula: string | undefined, per: string, dtAdm?: string): Val {
  const fimMes = ultimoDiaMes(per);
  const iniMes = `${per}-01`;
  const deslig = desligamento(d, cpf, matricula);
  const dtDeslig = deslig?.dataRef;
  const afs = afastamentos(d, cpf, matricula).filter((a) => (a.ini ?? '') <= fimMes && (!a.fim || a.fim >= iniMes));
  let texto = 'Ativo';
  if (dtDeslig && dtDeslig <= fimMes) texto = dtDeslig >= iniMes ? `Desligado em ${dtBr(dtDeslig)}` : `Desligado (${dtBr(dtDeslig)})`;
  else if (afs.length) {
    const a = afs[afs.length - 1];
    texto = `Afastado: ${descricaoAfastamento(a.codMot)} (${dtBr(a.ini)}${a.fim ? ` a ${dtBr(a.fim)}` : ', sem término informado'})`;
  } else if (dtAdm && dtAdm >= iniMes && dtAdm <= fimMes) texto = `Admitido em ${dtBr(dtAdm)}`;
  const fontes: RefXml[] = [];
  if (deslig) fontes.push({ tipoEvento: deslig.tipo, eventoId: deslig.eventoId, recibo: deslig.recibo, arquivo: deslig.arquivo, campo: 'dtDeslig' });
  for (const a of afs) if (a.evIni) fontes.push({ tipoEvento: 'S-2230', eventoId: a.evIni.eventoId, recibo: a.evIni.recibo, arquivo: a.evIni.arquivo, campo: a.ctxIni?.caminho ?? '' });
  return vc(texto, {
    regra: 'SITUACAO_COMPETENCIA',
    versao: '1',
    formula: 'Desligamento (S-2299/S-2399) até o fim da competência; senão afastamento (S-2230) no período; senão admissão no mês; senão ativo',
    parametros: { competencia: per },
    fontes,
    incompleto: vinculoDe(d, cpf, matricula) ? undefined : ['Vínculo (S-2200/S-2300) não importado'],
  }, 'texto');
}

export function dtBr(s?: string | null) {
  if (!s) return '';
  const [a, m, dd] = s.slice(0, 10).split('-');
  return dd ? `${dd}/${m}/${a}` : `${m}/${a}`;
}

// ------------------------------------------------------------------ folha
export interface FiltroFolha {
  cpfs?: string[];
  incluirRescisoes?: boolean;
}

export function montarFolha(d: Dados, tab: Tabelas, per: string, indApuracao = '1', filtro: FiltroFolha = {}): TrabalhadorFolha[] {
  const incluirResc = filtro.incluirRescisoes !== false && indApuracao === '1';
  const s1200 = d.doPeriodo('S-1200', per, indApuracao);
  const s2299 = incluirResc ? d.todos('S-2299').filter((e) => (e.dataRef ?? '').slice(0, 7) === per) : [];
  const s2399 = incluirResc ? d.todos('S-2399').filter((e) => (e.dataRef ?? '').slice(0, 7) === per) : [];
  const cpfs = new Set<string>([...s1200, ...s2299, ...s2399].map((e) => e.cpf!).filter(Boolean));
  const resultado: TrabalhadorFolha[] = [];
  const fimMes = per.length === 7 ? ultimoDiaMes(per) : `${per}-12-31`;

  for (const cpf of cpfs) {
    if (filtro.cpfs?.length && !filtro.cpfs.includes(cpf)) continue;
    const pgtos = pagamentos(d, cpf);
    const pend: Pendencia[] = [];
    const dms: Demonstrativo[] = [];
    const evs1200 = s1200.filter((e) => e.cpf === cpf);
    for (const ev of evs1200) {
      for (const dm of sel(ev.raiz, 'dmDev')) dms.push(montarDm(d, tab, ev, dm, 'S-1200', per, pgtos));
    }
    for (const ev of [...s2299, ...s2399].filter((e) => e.cpf === cpf)) {
      const grupo = ev.tipo === 'S-2299' ? 'infoDeslig/verbasResc/dmDev' : 'infoTSVTermino/verbasResc/dmDev';
      const categ = ev.tipo === 'S-2299' ? contrato(d, cpf, ev.matricula, ev.dataRef ?? fimMes).codCateg.v as string | undefined : txt(ev.raiz, 'ideTrabSemVinculo/codCateg');
      for (const dm of sel(ev.raiz, grupo)) dms.push(montarDm(d, tab, ev, dm, ev.tipo as 'S-2299', per, pgtos, categ));
    }
    const matricula = dms.flatMap((x) => x.itens).find((i) => i.matricula)?.matricula ?? evs1200[0]?.matricula ?? s2299.find((e) => e.cpf === cpf)?.matricula;
    const infoComplem = evs1200[0] ? um(evs1200[0].raiz, 'ideTrabalhador/infoComplem/nmTrab') : undefined;
    const cad = cadastro(d, cpf, fimMes, evs1200[0] ? { ev: evs1200[0], c: infoComplem } : undefined);
    const ctr = contrato(d, cpf, matricula, fimMes);
    const categoria = (dms[0]?.categ ?? (ctr.codCateg.v as string | undefined)) ?? '';
    const primeiroEv = evs1200[0] ?? dms[0]?.ev;

    // totais do trabalhador
    const todosItens = dms.flatMap((x) => x.itens);
    const base = todosItens.map((i) => ({ valor: i.vNum, tpRubr: i.rub.tp }));
    const tp = totalPorTipo(base, '1');
    const td = totalPorTipo(base, '2');
    const tl = liquido(tp, td);
    const pagos = dms.map((x) => x.pagamento).filter(Boolean) as Pagamento[];
    const pagoTotal: Val = pagos.length === 0
      ? va('Nenhum pagamento (S-1210) encontrado para os demonstrativos', 'moeda')
      : pagos.length === 1
        ? pagos[0].vrLiq
        : { v: somar(pagos.map((p) => p.vNum)), o: 'calculado', f: 'moeda', c: { regra: 'SOMA_XML', versao: '1', formula: 'Σ vrLiq dos pagamentos (S-1210) dos demonstrativos', fontes: pagos.map((p) => p.vrLiq.x!).filter(Boolean) } };

    // rubricas sem S-1010
    const semTabela = [...new Set(todosItens.filter((i) => !i.rub.encontrada).map((i) => i.codRubr))];
    if (semTabela.length) {
      pend.push({ nivel: 'alerta', categoria: 'ausente', mensagem: `Rubrica(s) sem S-1010 importado: ${semTabela.join(', ')} — tipo e incidências desconhecidos.`, cpf, competencia: per });
    }
    if (!vinculoDe(d, cpf, matricula)) {
      pend.push({
        nivel: ehEmpregado(categoria) ? 'alerta' : 'info',
        categoria: 'evento_ausente',
        mensagem: `Vínculo do trabalhador (S-2200/S-2300) não consta nos arquivos importados${ehEmpregado(categoria) ? '' : ' (categoria sem vínculo pode não exigir S-2300)'}.`,
        cpf,
        competencia: per,
      });
    }
    for (const dm of dms) {
      if (!dm.pagamento) {
        // a folha mensal costuma ser paga (e informada no S-1210) no mês seguinte
        const seguinte = per.length === 7 ? competenciaSeguinte(per) : undefined;
        const temS1210Seguinte = !!seguinte && d.doPeriodo('S-1210', seguinte).length > 0;
        const mensagem =
          dm.origem === 'S-1200' && seguinte && !temS1210Seguinte
            ? `Pagamento (S-1210) do demonstrativo ${dm.ideDmDev} não encontrado. A folha de ${compBr(per)} normalmente é paga e informada no S-1210 de ${compBr(seguinte)}, que ainda não foi importado.`
            : `Pagamento (S-1210) do demonstrativo ${dm.ideDmDev} (${dm.origem}) não encontrado.`;
        pend.push({ nivel: dm.origem === 'S-1200' && !temS1210Seguinte ? 'info' : 'alerta', categoria: 'evento_ausente', mensagem, cpf, competencia: per, eventoId: dm.ev.eventoId });
      }
      if (dm.conferenciaLiquido.status === 'divergente') {
        pend.push({ nivel: 'erro', categoria: 'divergencia', mensagem: `Líquido pago (S-1210) difere do líquido calculado no demonstrativo ${dm.ideDmDev} em R$ ${fmt(num(dm.conferenciaLiquido.diferenca!))}.`, cpf, competencia: per, eventoId: dm.ev.eventoId });
      }
    }

    // ---- conferências de bases e tributos
    const conf: Conferencia[] = dms.map((x) => x.conferenciaLiquido);
    const bases: Record<string, Val> = {};
    const inc = (campo: 'cp' | 'ir' | 'fgts') => todosItens.map((i) => ({ valor: i.vNum, tpRubr: i.rub.tp, codInc: i.rub[campo] }));
    const s5001 = d.doPeriodo('S-5001', per, indApuracao).filter((e) => e.cpf === cpf);
    const s5003 = d.doPeriodo('S-5003', per).filter((e) => e.cpf === cpf);
    const infoMV = evs1200.some((e) => !!um(e.raiz, 'ideTrabalhador/infoMV'));

    // INSS mensal
    const baseCP = basePorIncidencia(inc('cp'), ['11', '15', '21'], 'salário de contribuição mensal do segurado', 'BASE_INSS_RUBRICAS');
    bases.cpRubricas = vc(baseCP.valor, baseCP.ref, 'moeda');
    const b5001 = bases5001(s5001, '0');
    bases.cpXml = vxSoma(b5001, 'infoBaseCS com ind13=0 e tpValor=11 (S-5001)', 'S-5001 (totalizador) não importado');
    bases.cpCalcESocial = vxSoma(somaCampo(s5001, 'vrCpSeg'), 'vrCpSeg (S-5001)', 'S-5001 não importado');
    bases.cpDescSeg = vxSoma(somaCampo(s5001, 'vrDescSeg'), 'vrDescSeg (S-5001)', 'S-5001 não importado');
    bases.inssRubricas = vxRubricas(todosItens, ['31'], 'cp', 'contribuição descontada mensal');
    if (s5001.length === 0 && evs1200.length) {
      pend.push({ nivel: 'info', categoria: 'evento_ausente', mensagem: 'Totalizador S-5001 não consta nos arquivos importados; bases do eSocial indisponíveis.', cpf, competencia: per });
    }
    if (indApuracao === '1') {
      conf.push(conferir('base_inss', 'Base do INSS (rubricas × S-5001)', baseCP, [{ rotulo: 'Base no S-5001', val: bases.cpXml }], tab.tolerancia));
      const base13 = basePorIncidencia(inc('cp'), ['12', '16', '22'], '13º salário', 'BASE_INSS_13');
      const tem13 = (base13.valor ?? 0) > 0;
      if (!ehEmpregado(categoria) || infoMV) {
        const motivo = infoMV ? 'trabalhador com múltiplos vínculos (infoMV)' : `categoria ${categoria || 'desconhecida'} fora da regra progressiva do empregado`;
        bases.inssCalc = va(`Recálculo não aplicável: ${motivo}`, 'moeda');
        conf.push({ id: 'inss', titulo: 'INSS do segurado', calculado: bases.inssCalc, referencias: [], status: 'nao_aplicavel', diferenca: null, obs: motivo });
      } else {
        const r = calcularInss(baseCP.valor ?? 0, per, tab);
        if (baseCP.ref.incompleto) r.ref.incompleto = [...(r.ref.incompleto ?? []), ...baseCP.ref.incompleto];
        bases.inssCalc = vc(r.valor, r.ref, 'moeda');
        // Com 13º no mesmo mês (rescisão), o S-5001 soma as duas contribuições:
        // o mensal é conferido com as rubricas e o total com o S-5001.
        const refsMensal = tem13
          ? [{ rotulo: 'Rubricas de desconto (codIncCP 31)', val: bases.inssRubricas }]
          : [
              { rotulo: 'INSS calculado pelo eSocial (vrCpSeg)', val: bases.cpCalcESocial },
              { rotulo: 'INSS descontado (vrDescSeg)', val: bases.cpDescSeg },
              { rotulo: 'Rubricas de desconto (codIncCP 31)', val: bases.inssRubricas },
            ];
        conf.push(conferir('inss', 'INSS do segurado - mensal (recálculo × XML)', r, refsMensal, tab.tolerancia));
        if (tem13) {
          const r13 = calcularInss(base13.valor!, per, tab);
          conf.push(
            conferir('inss13', 'INSS sobre 13º salário (recálculo × rubricas)', r13, [
              { rotulo: 'Rubricas de desconto (codIncCP 32)', val: vxRubricas(todosItens, ['32'], 'cp', 'contribuição descontada 13º') },
            ], tab.tolerancia),
          );
          const total: Resultado = {
            valor: r.valor == null || r13.valor == null ? null : somar([r.valor, r13.valor]),
            ref: { regra: 'INSS_MENSAL_MAIS_13', versao: '1', formula: 'INSS mensal recalculado + INSS do 13º recalculado', parametros: { mensal: r.valor, decimo: r13.valor } },
          };
          conf.push(
            conferir('inss_total', 'INSS total do mês (recálculo × S-5001)', total, [
              { rotulo: 'INSS calculado pelo eSocial (vrCpSeg)', val: bases.cpCalcESocial },
              { rotulo: 'INSS descontado (vrDescSeg)', val: bases.cpDescSeg },
            ], tab.tolerancia),
          );
        }
      }
      if (tem13) {
        bases.cp13Xml = vxSoma(bases5001(s5001, '1'), 'infoBaseCS com ind13=1 (S-5001)', 'S-5001 não importado');
        conf.push(conferir('base_inss13', 'Base do INSS 13º (rubricas × S-5001)', base13, [{ rotulo: 'Base 13º no S-5001', val: bases.cp13Xml }], tab.tolerancia));
      }
    }

    // FGTS
    const baseF = basePorIncidencia(inc('fgts'), indApuracao === '2' ? ['12'] : ['11', '12', '21'], 'base do FGTS', 'BASE_FGTS_RUBRICAS');
    bases.fgtsBaseCalc = vc(baseF.valor, baseF.ref, 'moeda');
    bases.fgtsBaseXml = vxSoma(somaCampo(s5003, 'remFGTS'), 'remFGTS (S-5003)', 'S-5003 (totalizador do FGTS) não importado');
    bases.fgtsDepXml = vxSoma(somaCampo(s5003, 'dpsFGTS'), 'dpsFGTS (S-5003)', 'S-5003 não importado');
    const rF = calcularFgts(baseF.valor ?? 0, categoria, per, tab);
    // base incompleta (incidências desconhecidas) torna o depósito recalculado incompleto,
    // em vez de gerar divergência falsa com o S-5003
    if (baseF.ref.incompleto?.length) rF.ref.incompleto = [...(rF.ref.incompleto ?? []), ...baseF.ref.incompleto];
    bases.fgtsCalc = vc(rF.valor, rF.ref, 'moeda');
    if (indApuracao === '1') {
      conf.push(conferir('base_fgts', 'Base do FGTS (rubricas × S-5003)', baseF, [{ rotulo: 'remFGTS no S-5003', val: bases.fgtsBaseXml }], tab.tolerancia));
      conf.push(conferir('fgts', 'Depósito do FGTS (recálculo × S-5003)', rF, [{ rotulo: 'dpsFGTS no S-5003', val: bases.fgtsDepXml }], tab.tolerancia));
    }

    // IRRF (conferência por competência). Como no totalizador S-5002 do leiaute S-1.3,
    // as férias (incidências 13/33/43/48/53) são somadas à remuneração mensal;
    // o 13º salário (12/32/42/47/52) é apurado em separado.
    const tipos: Array<{ tipo: TipoIrrf; rend: string[]; ret: string[]; prev: string[]; pens: string[]; priv: string[]; titulo: string }> = [
      { tipo: 'mensal', rend: ['11', '13'], ret: ['31', '33'], prev: ['41', '43'], pens: ['51', '53'], priv: ['46', '48'], titulo: 'IRRF do mês (remuneração + férias)' },
      { tipo: '13', rend: ['12'], ret: ['32'], prev: ['42'], pens: ['52'], priv: ['47'], titulo: 'IRRF sobre 13º salário' },
    ];
    const irItens = inc('ir');
    // S-5002: IRRF apurado pelo eSocial, por demonstrativo pago (perRef + ideDmDev)
    const idesDm = new Set(dms.map((x) => x.ideDmDev));
    const dmS5002 = d
      .doTrabalhador('S-5002', cpf)
      .flatMap((ev) => sel(ev.raiz, 'ideTrabalhador/dmDev').map((c) => ({ ev, c })))
      .filter(({ c }) => txt(c, 'perRef') === per && idesDm.has(txt(c, 'ideDmDev') ?? ''));
    const s5002Soma = (campo: string): Val => {
      const fontes: RefXml[] = [];
      let total = 0;
      for (const { ev, c } of dmS5002) {
        const alvo = um(c, `totApurMen/${campo}`);
        if (alvo?.no.t === undefined) continue;
        total += Math.round(Number(alvo.no.t) * 100);
        fontes.push({ tipoEvento: ev.tipo, eventoId: ev.eventoId, recibo: ev.recibo, arquivo: ev.arquivo, campo: alvo.caminho });
      }
      return vxSoma({ valor: total / 100, fontes }, `${campo} (S-5002)`, 'S-5002 (IRRF por trabalhador) deste pagamento não importado');
    };
    if (dmS5002.length) {
      bases.irrfRendS5002 = s5002Soma('vlrRendTrib');
      bases.irrfS5002 = s5002Soma('vlrCRMen');
      const rendMensal = basePorIncidencia(irItens, ['11', '13'], 'rendimentos tributáveis do mês (remuneração + férias)', 'RENDIMENTOS_IRRF');
      conf.push(conferir('rend_irrf', 'Rendimentos tributáveis (rubricas × S-5002)', rendMensal, [{ rotulo: 'vlrRendTrib no S-5002', val: bases.irrfRendS5002 }], tab.tolerancia));
    }
    for (const t of tipos) {
      const rend = basePorIncidencia(irItens, t.rend, `rendimentos tributáveis (${t.tipo})`, 'RENDIMENTOS_IRRF');
      const retido = vxRubricas(todosItens, t.ret, 'ir', `retenção ${t.tipo}`);
      if ((rend.valor ?? 0) <= 0 && retido.v === null) continue;
      const soma = (cods: string[]) => somar(todosItens.filter((i) => i.rub.ir && cods.includes(i.rub.ir)).map((i) => i.vNum));
      const r = calcularIrrf(
        { competencia: per, tipo: t.tipo, rendimentos: rend.valor ?? 0, previdenciaOficial: soma(t.prev), pensao: soma(t.pens), previdenciaPrivada: soma(t.priv), dependentes: cad.dependentesIrrf },
        tab,
      );
      r.ref.incompleto = [
        ...(r.ref.incompleto ?? []),
        ...(rend.ref.incompleto ?? []),
        'IRRF segue o regime de caixa (data do S-1210); a conferência por competência é aproximada',
      ];
      const refsIr = [{ rotulo: `Retido (codIncIRRF ${t.ret.join('/')})`, val: retido }];
      if (t.tipo === 'mensal') refsIr.push({ rotulo: 'IRRF apurado pelo eSocial (S-5002, vlrCRMen)', val: s5002Soma('vlrCRMen') });
      const c = conferir(`irrf_${t.tipo}`, `${t.titulo} (recálculo × rubricas × S-5002)`, r, refsIr, tab.tolerancia);
      if (retido.v === null && r.valor === 0) {
        c.status = 'ok';
        c.obs = 'Sem rubrica de retenção; o recálculo também resulta em imposto zero.';
      }
      conf.push(c);
      const bcIr = r.ref.parametros?.baseCalculo;
      bases[`irrf_${t.tipo}_base`] = vc(typeof bcIr === 'number' ? bcIr : null, { ...r.ref, formula: 'Base de cálculo do IRRF (ver memória)' }, 'moeda');
      bases[`irrf_${t.tipo}_calc`] = vc(r.valor, r.ref, 'moeda');
      bases[`irrf_${t.tipo}_retido`] = retido;
    }

    for (const c of conf) {
      if (c.id.startsWith('liquido:')) continue;
      if (c.status === 'divergente') {
        pend.push({ nivel: 'alerta', categoria: 'divergencia', mensagem: `${c.titulo}: diferença de R$ ${fmt(num(c.diferenca ?? undefined))} entre o XML e o recálculo.`, cpf, competencia: per });
      } else if (c.status === 'incompleto') {
        pend.push({ nivel: 'info', categoria: 'calculo_incompleto', mensagem: `${c.titulo}: conferência incompleta — ${(c.calculado.c?.incompleto ?? []).join('; ') || 'dados insuficientes'}.`, cpf, competencia: per });
      }
    }

    const nomeTxt = typeof cad.nome.v === 'string' ? cad.nome.v : undefined;
    for (const p of pend) p.nome ??= nomeTxt;
    resultado.push({
      cpf,
      matricula,
      nome: cad.nome,
      cpfVal: primeiroEv ? vx(primeiroEv, um(primeiroEv.raiz, primeiroEv.tipo === 'S-1200' ? 'ideTrabalhador/cpfTrab' : 'ideVinculo/cpfTrab'), 'cpf') : { v: cpf, o: 'xml', f: 'cpf' },
      matriculaVal:
        matricula && primeiroEv
          ? vx(primeiroEv, desc(primeiroEv.raiz, 'matricula')[0], 'texto')
          : va('Matrícula não informada (TSVE ou categoria sem matrícula)', 'texto'),
      contrato: ctr,
      categoria,
      situacao: situacaoNaCompetencia(d, cpf, matricula, per.length === 7 ? per : `${per}-12`, ctr.dtAdm.v as string | undefined),
      estab: todosItens[0]?.estab,
      lotacao: todosItens[0]?.lotacao,
      dms,
      proventos: vc(tp.valor, tp.ref, 'moeda'),
      descontos: vc(td.valor, td.ref, 'moeda'),
      liquido: vc(tl.valor, tl.ref, 'moeda'),
      pago: pagoTotal,
      bases,
      conferencias: conf,
      pendencias: pend,
      dependentes: cad.dependentesVal,
      eventosS1200: evs1200,
    });
  }
  return resultado;
}

export const fmt = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function descricaoCategoria(c?: string) {
  return c ? descrever(COD_CATEG, c) : '';
}

export { arred };

function compBr(c: string) {
  const [a, m] = c.split('-');
  return m ? `${m}/${a}` : c;
}
