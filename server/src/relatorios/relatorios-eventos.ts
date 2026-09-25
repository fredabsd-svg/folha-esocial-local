/**
 * Relatórios de férias, rescisão e relatórios por período.
 */
import {
  anosCompletos,
  arred,
  avisoPrevioProporcional,
  avos13,
  avosFerias,
  calcularIrrf,
  comparar,
  competenciaSeguinte,
  diasEntre,
  proporcional,
  type Resultado,
  saldoSalario,
  somar,
  somarDias,
  somarMeses,
  ultimoDiaMes,
} from '../calculo/regras.js';
import type { Campo, Documento, Linha, Pendencia, RefCalculo, Val } from '../compartilhado/tipos.js';
import {
  afastamentos,
  cadastro,
  contrato,
  descricaoAfastamento,
  descricaoTipo,
  ehFerias,
  vinculos,
} from '../dominio/cadastros.js';
import { type EvCarregado, num, va, vc, vm, vx, vxOuComp } from '../dominio/dados.js';
import { type Demonstrativo, dtBr, fmt, montarFolha, type TrabalhadorFolha } from '../dominio/folha.js';
import { COD_CATEG, descrever, MTV_DESLIG, NAT_FERIAS } from '../esocial/catalogo.js';
import { desc, txt, um } from '../xml/arvore.js';
import { col, competenciaBr, contarPendencias, type Contexto, documentoBase, exigir, linha, mascararCpf } from './base.js';

const STATUS: Record<string, string> = {
  ok: 'Confere',
  arredondamento: 'Arredondamento',
  divergente: 'DIVERGENTE',
  incompleto: 'Incompleto',
  sem_referencia: 'Sem valor no XML',
  nao_aplicavel: 'Não aplicável',
};

function listaCompetencias(ini: string, fim: string, max = 60): string[] {
  const r: string[] = [];
  let c = ini;
  while (c <= fim && r.length < max) {
    r.push(c);
    c = competenciaSeguinte(c);
  }
  return r;
}

function correspondeTrabalhador(termo: string | undefined, cpf: string, nome?: unknown, matricula?: string) {
  if (!termo?.trim()) return true;
  const t = termo.trim().toLowerCase();
  const dig = t.replace(/\D/g, '');
  return (dig.length >= 3 && cpf.includes(dig)) || String(nome ?? '').toLowerCase().includes(t) || (matricula ?? '').toLowerCase() === t;
}

function tabelaItens(dm: Demonstrativo, incluirInformativas?: boolean) {
  const comInfo = !!incluirInformativas || dm.itens.some((i) => !i.rub.tp);
  const linhas: Linha[] = dm.itens
    .filter((i) => incluirInformativas || (i.rub.tp !== '3' && i.rub.tp !== '4'))
    .map((i) =>
      linha({
        cod: i.codRubr,
        dsc: i.rub.dsc,
        nat: i.rub.natRubr,
        ref: i.qtd.v !== null ? i.qtd : i.fator.v !== null ? i.fator : null,
        prov: i.rub.tp === '1' ? i.valor : null,
        desc: i.rub.tp === '2' ? i.valor : null,
        info: i.rub.tp !== '1' && i.rub.tp !== '2' ? i.valor : null,
      }),
    );
  linhas.push(linha({ dsc: 'Totais', prov: dm.proventos, desc: dm.descontos, info: incluirInformativas ? dm.informativas : null }, 'total'));
  return {
    colunas: [
      col('cod', 'Cód.'),
      col('dsc', 'Descrição'),
      col('nat', 'Natureza'),
      col('ref', 'Referência', 'quantidade'),
      col('prov', 'Proventos', 'moeda'),
      col('desc', 'Descontos', 'moeda'),
      ...(comInfo ? [col('info', 'Informativas / sem tipo', 'moeda')] : []),
    ],
    linhas,
  };
}

// ------------------------------------------------------------------ Férias
export function avisoReciboFerias(cx: Contexto): Documento {
  exigir(cx.p, 'competencia');
  const per = cx.p.competencia!;
  const doc = documentoBase(cx, 'ferias', 'Aviso e recibo de férias');
  const iniMes = `${per}-01`;
  const fimMes = ultimoDiaMes(per);
  const cpfs = new Set(cx.d.todos('S-2230').map((e) => e.cpf!).filter(Boolean));
  let n = 0;
  for (const cpf of cpfs) {
    for (const a of afastamentos(cx.d, cpf)) {
      if (!ehFerias(a) || !a.ini) continue;
      const fimGozo = a.fim;
      if (a.ini > fimMes || (fimGozo && fimGozo < iniMes)) continue;
      const evIni = a.evIni!;
      const mat = evIni.matricula;
      const cad = cadastro(cx.d, cpf, a.ini);
      if (!correspondeTrabalhador(cx.p.trabalhador, cpf, cad.nome.v, mat)) continue;
      const ctr = contrato(cx.d, cpf, mat, a.ini);
      const pend: Pendencia[] = [];
      const ref = `${cpf}|${a.ini}`;
      const perAquis: Val = a.perAquisIni
        ? { ...vx(evIni, um(a.ctxIni, 'perAquis/dtInicio'), 'texto'), v: `${dtBr(a.perAquisIni)} a ${dtBr(a.perAquisFim)}` }
        : va('Período aquisitivo (perAquis) não informado no S-2230', 'texto');
      if (!a.perAquisIni) pend.push({ nivel: 'alerta', categoria: 'ausente', mensagem: 'Período aquisitivo não informado no S-2230 de férias.', cpf });
      const dias = fimGozo
        ? vc(diasEntre(a.ini, fimGozo) + 1, { regra: 'DIAS_GOZO', versao: '1', formula: 'Término − início + 1', parametros: { inicio: a.ini, termino: fimGozo } }, 'inteiro')
        : va('Término das férias não informado (fimAfastamento)', 'inteiro');
      const retorno = fimGozo
        ? vc(somarDias(fimGozo, 1), { regra: 'DATA_RETORNO', versao: '1', formula: 'Dia seguinte ao término do afastamento', parametros: { termino: fimGozo } }, 'data')
        : va('Término não informado', 'data');
      const dataAviso = vxOuComp(cx.d, undefined, undefined, { escopo: 'ferias', referencia: ref, campo: 'data_aviso', rotulo: 'Data do aviso de férias' }, 'data', 'A data do aviso de férias não é transmitida ao eSocial');
      const abono = vxOuComp(cx.d, undefined, undefined, { escopo: 'ferias', referencia: ref, campo: 'dias_abono', rotulo: 'Dias de abono pecuniário' }, 'inteiro', 'Dias de abono pecuniário não constam no S-2230');
      const medias = vxOuComp(cx.d, undefined, undefined, { escopo: 'ferias', referencia: ref, campo: 'medias', rotulo: 'Médias de variáveis (R$)' }, 'moeda', 'Médias de verbas variáveis não constam nos XMLs');

      doc.blocos.push({
        titulo: 'Aviso de férias',
        quebraPagina: n++ > 0,
        colunasCampos: 3,
        campos: [
          { rotulo: 'Empregador', val: cx.emp.nome },
          { rotulo: 'Inscrição', val: cx.emp.documento },
          { rotulo: 'Trabalhador', val: cad.nome },
          { rotulo: 'CPF', val: mascararCpf(vx(evIni, um(evIni.raiz, 'ideVinculo/cpfTrab'), 'cpf'), cx.p.mascararCpf) },
          { rotulo: 'Matrícula', val: vx(evIni, um(evIni.raiz, 'ideVinculo/matricula'), 'texto') },
          { rotulo: 'Cargo', val: ctr.cargo },
          { rotulo: 'Admissão', val: ctr.dtAdm },
          { rotulo: 'Período aquisitivo', val: perAquis },
          { rotulo: 'Início do gozo', val: vx(evIni, um(a.ctxIni, 'dtIniAfast'), 'data') },
          { rotulo: 'Término do gozo', val: a.evFim ? vx(a.evFim, um(a.ctxFim, 'dtTermAfast'), 'data') : va('Término não informado', 'data') },
          { rotulo: 'Dias de gozo', val: dias },
          { rotulo: 'Retorno ao trabalho', val: retorno },
          { rotulo: 'Dias de abono pecuniário', val: abono },
          { rotulo: 'Data do aviso', val: dataAviso },
        ],
        assinaturas: ['Ciente do aviso de férias', 'Assinatura do trabalhador', 'Assinatura do empregador'],
      });

      // demonstrativo de férias: competências tocadas pelo gozo
      const comps = new Set([a.ini.slice(0, 7), (fimGozo ?? a.ini).slice(0, 7)]);
      let dmFerias: { t: TrabalhadorFolha; dm: Demonstrativo } | undefined;
      for (const c of comps) {
        for (const t of montarFolha(cx.d, cx.tab, c, '1', { cpfs: [cpf], incluirRescisoes: false })) {
          for (const dm of t.dms) {
            if (!dmFerias && dm.itens.some((i) => (i.rub.nat && NAT_FERIAS.has(i.rub.nat)) || i.rub.ir === '13')) dmFerias = { t, dm };
          }
        }
      }
      if (!dmFerias) {
        pend.push({ nivel: 'alerta', categoria: 'evento_ausente', mensagem: 'Demonstrativo com rubricas de férias não encontrado no S-1200 das competências do gozo.', cpf });
        doc.blocos.push({ titulo: 'Recibo de férias', notas: ['Demonstrativo de férias não encontrado nos S-1200 importados (rubricas de natureza 1016/1017 ou incidência de IRRF 13).'] });
      } else {
        const { t, dm } = dmFerias;
        const itens = dm.itens;
        const soma = (f: (i: (typeof itens)[number]) => boolean) => somar(itens.filter(f).map((i) => i.vNum));
        const baseInss = soma((i) => i.rub.tp === '1' && i.rub.cp === '11') - soma((i) => i.rub.tp === '2' && i.rub.cp === '11');
        const rendIr = soma((i) => i.rub.tp === '1' && i.rub.ir === '13') - soma((i) => i.rub.tp === '2' && i.rub.ir === '13');
        const retido = soma((i) => i.rub.ir === '33');
        const confIr = t.conferencias.find((c) => c.id === 'irrf_mensal');
        doc.blocos.push({
          titulo: `Recibo de férias — demonstrativo ${dm.ideDmDev} (competência ${competenciaBr(dm.ev.perApur)})`,
          tabela: tabelaItens(dm, cx.p.incluirInformativas),
        });
        doc.blocos.push({
          colunasCampos: 3,
          campos: [
            { rotulo: 'Total de proventos', val: dm.proventos },
            { rotulo: 'Total de descontos', val: dm.descontos },
            { rotulo: 'Líquido calculado', val: dm.liquido },
            { rotulo: 'Líquido pago (S-1210)', val: dm.pago },
            { rotulo: 'Data do pagamento', val: dm.dtPgto },
            { rotulo: 'Médias consideradas', val: medias },
            {
              rotulo: 'Base do INSS das férias (rubricas)',
              val: vc(arred(baseInss), { regra: 'BASE_INSS_FERIAS', versao: '1', formula: 'Σ proventos − Σ descontos com codIncCP 11 no demonstrativo de férias' }, 'moeda'),
            },
            {
              rotulo: 'Rendimentos tributáveis das férias',
              val: vc(arred(rendIr), { regra: 'RENDIMENTOS_FERIAS', versao: '1', formula: 'Σ proventos − Σ descontos com codIncIRRF 13 no demonstrativo de férias' }, 'moeda'),
            },
            { rotulo: 'IRRF retido nas férias (codIncIRRF 33)', val: itens.some((i) => i.rub.ir === '33') ? vc(retido, { regra: 'SOMA_RUBRICAS', versao: '1', formula: 'Σ rubricas com codIncIRRF 33' }, 'moeda') : 'Sem retenção nas férias' },
            { rotulo: 'Conferência do IRRF do mês (com as férias)', val: confIr ? STATUS[confIr.status] : 'Sem IRRF a conferir' },
          ],
          notas: ['Como no totalizador S-5002, o eSocial apura o IRRF das férias junto com a remuneração do mês; a conferência completa está no extrato mensal.'],
          assinaturas: ['Recebi a importância líquida discriminada neste recibo de férias.', 'Data: ____/____/________', 'Assinatura do trabalhador'],
        });
        if (!dm.pagamento) pend.push({ nivel: 'alerta', categoria: 'evento_ausente', mensagem: `Pagamento (S-1210) do demonstrativo de férias ${dm.ideDmDev} não encontrado.`, cpf });
      }
      if (dataAviso.o === 'ausente') pend.push({ nivel: 'info', categoria: 'ausente', mensagem: 'Data do aviso de férias não consta nos XMLs (pode ser complementada).', cpf });
      for (const p of pend) p.nome = String(cad.nome.v ?? '');
      contarPendencias(doc, pend);
    }
  }
  if (!n) doc.blocos.push({ notas: [`Nenhum afastamento por férias (S-2230, motivo 15) com gozo em ${competenciaBr(per)}.`] });
  doc.estatisticas = { ferias: n };
  return doc;
}

// ------------------------------------------------------------------ Rescisão
interface RegraMotivo {
  aviso: 'proporcional' | 'metade' | 'nao';
  decimo: number; // fração devida
  ferias: number;
  multa: number | null;
  obs?: string;
}

/** RESC_VERBAS_POR_MOTIVO v1 — verbas devidas por motivo (conferência de prévia). */
const REGRAS_MOTIVO: Record<string, RegraMotivo> = {
  '01': { aviso: 'nao', decimo: 0, ferias: 0, multa: null, obs: 'Justa causa: sem aviso, 13º e férias proporcionais (CLT art. 146, parágrafo único; Súmula 171 TST).' },
  '02': { aviso: 'proporcional', decimo: 1, ferias: 1, multa: 0.4 },
  '03': { aviso: 'nao', decimo: 1, ferias: 1, multa: 0.4, obs: 'Indenização do art. 479 da CLT não é calculada automaticamente.' },
  '04': { aviso: 'nao', decimo: 1, ferias: 1, multa: null, obs: 'Eventual indenização do art. 480 da CLT não é calculada automaticamente.' },
  '05': { aviso: 'metade', decimo: 0.5, ferias: 0.5, multa: 0.2, obs: 'Culpa recíproca: 50% do aviso, 13º e férias proporcionais (Súmula 14 TST).' },
  '06': { aviso: 'nao', decimo: 1, ferias: 1, multa: null },
  '07': { aviso: 'nao', decimo: 1, ferias: 1, multa: null, obs: 'Pedido de demissão: aviso trabalhado ou descontado do empregado (não calculado).' },
  '10': { aviso: 'nao', decimo: 1, ferias: 1, multa: null },
  '33': { aviso: 'metade', decimo: 1, ferias: 1, multa: 0.2, obs: 'Acordo (art. 484-A): aviso indenizado e multa do FGTS pela metade.' },
};

function refRegra(regra: string, formula: string, parametros?: RefCalculo['parametros'], incompleto?: string[]): RefCalculo {
  return { regra, versao: '1', formula, parametros, incompleto };
}

export function relatorioRescisao(cx: Contexto): Documento {
  exigir(cx.p, 'competencia');
  const per = cx.p.competencia!;
  const doc = documentoBase(cx, 'rescisao', 'Relatório de rescisão (prévia para conferência)', [], 'paisagem');
  const evs = cx.d.todos('S-2299').filter((e) => (e.dataRef ?? '').slice(0, 7) === per);
  let n = 0;
  for (const ev of evs) {
    const cpf = ev.cpf!;
    const mat = ev.matricula;
    const dtDeslig = ev.dataRef!;
    const cad = cadastro(cx.d, cpf, dtDeslig);
    if (!correspondeTrabalhador(cx.p.trabalhador, cpf, cad.nome.v, mat)) continue;
    const ctr = contrato(cx.d, cpf, mat, dtDeslig);
    const info = um(ev.raiz, 'infoDeslig');
    const mtv = txt(info, 'mtvDeslig') ?? '';
    const indAPI = txt(info, 'indPagtoAPI');
    const dtProj = txt(info, 'dtProjFimAPI');
    const pend: Pendencia[] = [];
    const folhaT = montarFolha(cx.d, cx.tab, per, '1', { cpfs: [cpf] })[0];
    const dms = folhaT?.dms.filter((x) => x.origem === 'S-2299' && x.ev.pk === ev.pk) ?? [];

    doc.blocos.push({
      titulo: `Desligamento — ${cad.nome.v ?? cpf}`,
      quebraPagina: n++ > 0,
      colunasCampos: 4,
      campos: [
        { rotulo: 'Trabalhador', val: cad.nome },
        { rotulo: 'CPF', val: mascararCpf(vx(ev, um(ev.raiz, 'ideVinculo/cpfTrab'), 'cpf'), cx.p.mascararCpf) },
        { rotulo: 'Matrícula', val: vx(ev, um(ev.raiz, 'ideVinculo/matricula'), 'texto') },
        { rotulo: 'Categoria', val: ctr.codCateg.v ? { ...ctr.codCateg, v: descrever(COD_CATEG, String(ctr.codCateg.v)) } : ctr.codCateg },
        { rotulo: 'Cargo', val: ctr.cargo },
        { rotulo: 'Admissão', val: ctr.dtAdm },
        { rotulo: 'Salário contratual', val: ctr.salario },
        { rotulo: 'Data do desligamento', val: vx(ev, um(info, 'dtDeslig'), 'data') },
        { rotulo: 'Motivo', val: { ...vx(ev, um(info, 'mtvDeslig'), 'texto'), v: descrever(MTV_DESLIG, mtv) } },
        { rotulo: 'Data do aviso prévio', val: vx(ev, um(info, 'dtAvPrv'), 'data', 'Data do aviso não informada') },
        { rotulo: 'Aviso prévio indenizado', val: { ...vx(ev, um(info, 'indPagtoAPI'), 'texto'), v: indAPI === 'S' ? 'Sim' : indAPI === 'N' ? 'Não' : null } },
        { rotulo: 'Projeção do aviso indenizado', val: vx(ev, um(info, 'dtProjFimAPI'), 'data', 'Sem projeção informada') },
        { rotulo: 'Pensão alimentícia', val: vx(ev, um(info, 'pensAlim'), 'texto') },
        { rotulo: '% pensão / valor', val: [txt(info, 'percAliment'), txt(info, 'vrAlim')].filter(Boolean).join(' / ') || '—' },
      ],
    });
    for (const dm of dms) {
      doc.blocos.push({ titulo: `Verbas rescisórias — demonstrativo ${dm.ideDmDev}`, tabela: tabelaItens(dm, cx.p.incluirInformativas) });
      const prazo =
        dm.pagamento && typeof dm.dtPgto.v === 'string'
          ? vc(`${diasEntre(dtDeslig, dm.dtPgto.v)} dia(s) após o desligamento`, refRegra('PRAZO_PAGAMENTO_RESCISAO', 'Data do pagamento (S-1210) − data do desligamento; prazo legal de 10 dias (CLT, art. 477, § 6º)', { desligamento: dtDeslig, pagamento: dm.dtPgto.v }), 'texto')
          : va('Pagamento (S-1210) não encontrado', 'texto');
      if (dm.pagamento && typeof dm.dtPgto.v === 'string' && diasEntre(dtDeslig, dm.dtPgto.v) > 10) {
        pend.push({ nivel: 'alerta', categoria: 'divergencia', mensagem: `Pagamento da rescisão ${diasEntre(dtDeslig, dm.dtPgto.v)} dias após o desligamento (prazo de 10 dias — CLT, art. 477, § 6º).`, cpf });
      }
      if (!dm.pagamento) pend.push({ nivel: 'alerta', categoria: 'evento_ausente', mensagem: `Pagamento (S-1210, tpPgto 2) do demonstrativo ${dm.ideDmDev} não encontrado.`, cpf });
      doc.blocos.push({
        colunasCampos: 3,
        campos: [
          { rotulo: 'Total de proventos', val: dm.proventos },
          { rotulo: 'Total de descontos', val: dm.descontos },
          { rotulo: 'Líquido calculado', val: dm.liquido },
          { rotulo: 'Líquido pago (S-1210)', val: dm.pago },
          { rotulo: 'Data do pagamento', val: dm.dtPgto },
          { rotulo: 'Prazo de pagamento', val: prazo },
        ],
      });
    }
    if (!dms.length) pend.push({ nivel: 'alerta', categoria: 'ausente', mensagem: 'S-2299 sem verbas rescisórias (verbasResc) informadas.', cpf });
    if (folhaT) {
      doc.blocos.push({
        titulo: 'Bases (totalizadores do eSocial × recálculo)',
        colunasCampos: 3,
        campos: [
          { rotulo: 'Base do INSS mensal (S-5001)', val: folhaT.bases.cpXml },
          { rotulo: 'Base do INSS 13º (S-5001)', val: folhaT.bases.cp13Xml ?? va('Sem base de 13º no S-5001', 'moeda') },
          { rotulo: 'INSS descontado (S-5001)', val: folhaT.bases.cpDescSeg },
          { rotulo: 'Base do FGTS rescisório (S-5003)', val: folhaT.bases.fgtsBaseXml },
          { rotulo: 'FGTS (S-5003)', val: folhaT.bases.fgtsDepXml },
          { rotulo: 'FGTS recalculado', val: folhaT.bases.fgtsCalc },
        ],
      });
    }

    // ---- memória de cálculo
    const regra = REGRAS_MOTIVO[mtv];
    const linhas: Linha[] = [];
    const itens = dms.flatMap((x) => x.itens);
    const somaNat = (nats: string[]) => {
      const sel = itens.filter((i) => i.rub.nat && nats.includes(i.rub.nat) && i.rub.tp === '1');
      if (!sel.length) return null;
      return sel.length === 1
        ? sel[0].valor
        : vc(somar(sel.map((i) => i.vNum)), refRegra('SOMA_RUBRICAS', `Σ rubricas de natureza ${nats.join('/')}`), 'moeda');
    };
    const addLinha = (item: string, r: Resultado | null, xml: Val | null, obs?: string, fmtV: Val['f'] = 'moeda', situacao?: string) => {
      const calc = r ? vc(r.valor, r.ref, fmtV) : situacao ? va(obs ?? situacao, fmtV) : null;
      const cmp = r && xml ? comparar(r.valor, num(xml), cx.tab.tolerancia, !!r.ref.incompleto?.length) : null;
      linhas.push(
        linha({
          item,
          regra: r ? `${r.ref.regra} v${r.ref.versao}` : '—',
          calc,
          xml,
          dif: cmp?.diferenca != null ? vc(cmp.diferenca, refRegra('DIFERENCA', 'XML − calculado'), 'moeda') : null,
          sit: situacao ?? (cmp ? STATUS[cmp.status] : r ? (r.ref.incompleto?.length ? 'Informativo (com ressalvas)' : 'Informativo') : 'Não aplicável'),
          obs: [obs, ...(r?.ref.incompleto ?? [])].filter(Boolean).join(' • '),
        }),
      );
      if (cmp?.status === 'divergente') pend.push({ nivel: 'alerta', categoria: 'divergencia', mensagem: `${item}: diferença de R$ ${fmt(cmp.diferenca)} entre o XML e o cálculo de conferência.`, cpf });
    };
    const dtAdm = ctr.dtAdm.v as string | undefined;
    const salario = num(ctr.salario);
    const und = ctr.undSalFixo.v as string | undefined;
    const medias = vxOuComp(cx.d, undefined, undefined, { escopo: 'rescisao', referencia: `${cpf}|${dtDeslig}`, campo: 'medias', rotulo: 'Médias de variáveis (R$/mês)' }, 'moeda', 'Médias não constam nos XMLs');
    const saldoFgts = vxOuComp(cx.d, undefined, undefined, { escopo: 'rescisao', referencia: `${cpf}|${dtDeslig}`, campo: 'saldo_fgts', rotulo: 'Saldo do FGTS para fins rescisórios (R$)' }, 'moeda', 'Saldo do FGTS não consta nos XMLs (extrato do FGTS Digital/CAIXA)');
    const remuneracao = salario != null ? salario + (num(medias) ?? 0) : null;

    if (!regra) {
      linhas.push(linha({ item: `Motivo ${mtv}`, sit: 'Regra não cadastrada', obs: 'Sem regra de conferência para este motivo; confira manualmente.' }));
      pend.push({ nivel: 'info', categoria: 'calculo_incompleto', mensagem: `Motivo de desligamento ${mtv} sem regra de conferência cadastrada.`, cpf });
    } else if (!dtAdm || salario == null) {
      linhas.push(linha({ item: 'Memória de cálculo', sit: 'Incompleto', obs: 'Data de admissão e/ou salário contratual ausentes (S-2200/S-2206 não importados).' }));
      pend.push({ nivel: 'alerta', categoria: 'calculo_incompleto', mensagem: 'Rescisão sem S-2200/S-2206: memória de cálculo não gerada.', cpf });
    } else {
      if (und !== '5') pend.push({ nivel: 'alerta', categoria: 'calculo_incompleto', mensagem: 'Salário contratual não é mensal (undSalFixo ≠ 5): cálculos proporcionais não são confiáveis.', cpf });
      if (medias.o === 'ausente') pend.push({ nivel: 'info', categoria: 'ausente', mensagem: 'Médias de verbas variáveis não informadas: 13º, férias e aviso consideram apenas o salário.', cpf });
      const anos = anosCompletos(dtAdm, dtDeslig);
      addLinha('Tempo de serviço (anos completos)', { valor: anos, ref: refRegra('TEMPO_SERVICO', 'Anos completos entre admissão e desligamento', { admissao: dtAdm, desligamento: dtDeslig }) }, null, undefined, 'inteiro');
      // aviso
      let diasAviso = 0;
      if (regra.aviso !== 'nao') {
        const r = avisoPrevioProporcional(dtAdm, dtDeslig, cx.tab);
        diasAviso = r.valor!;
        const xmlDias = dtProj ? { v: diasEntre(dtDeslig, dtProj), o: 'calculado' as const, f: 'inteiro' as const, c: refRegra('DIAS_PROJECAO', 'dtProjFimAPI − dtDeslig (S-2299)', { dtDeslig, dtProjFimAPI: dtProj }) } : null;
        addLinha('Dias de aviso prévio', r, xmlDias, regra.aviso === 'metade' ? 'Metade do aviso é indenizada neste motivo' : undefined, 'inteiro');
        if (indAPI === 'S') {
          const fator = regra.aviso === 'metade' ? 0.5 : 1;
          const valor = arred((remuneracao! / 30) * diasAviso * fator);
          addLinha(
            'Aviso prévio indenizado',
            { valor, ref: refRegra('AVISO_INDENIZADO', `Remuneração ÷ 30 × dias de aviso${fator < 1 ? ' × 50%' : ''}`, { remuneracao: remuneracao!, dias: diasAviso }, medias.o === 'ausente' ? ['Médias não informadas'] : undefined) },
            somaNat(['6003']),
            'Comparado com rubricas de natureza 6003',
          );
        }
      } else addLinha('Aviso prévio', null, null, regra.obs ?? 'Não devido/indenizado pelo empregador neste motivo');
      const fimProj = indAPI === 'S' && dtProj ? dtProj : dtDeslig;
      // saldo
      addLinha('Saldo de salário', saldoSalario(salario, dtDeslig, dtAdm), somaNat(['6000']), 'Comparado com rubricas de natureza 6000');
      // 13º
      if (regra.decimo > 0) {
        const ano = Number(dtDeslig.slice(0, 4));
        const inicio = dtAdm > `${ano}-01-01` ? dtAdm : `${ano}-01-01`;
        const av = avos13(inicio, fimProj, ano);
        addLinha('Avos de 13º salário', av, null, undefined, 'inteiro');
        const r = proporcional(remuneracao!, av.valor! * regra.decimo, false, 'DECIMO_PROPORCIONAL', '13º proporcional');
        addLinha('13º salário proporcional', r, somaNat(['5001', '6001']), 'Comparado com rubricas de natureza 5001/6001; adiantamentos de 13º não são deduzidos');
      } else addLinha('13º salário proporcional', null, null, regra.obs);
      // férias
      const fer = afastamentos(cx.d, cpf, mat).filter((a) => ehFerias(a) && a.perAquisFim);
      const ultimoPer = fer.map((a) => a.perAquisFim!).sort().pop();
      let inicioPer = ultimoPer ? somarDias(ultimoPer, 1) : dtAdm;
      let completos = 0;
      while (somarDias(somarMeses(inicioPer, 12), -1) <= fimProj) {
        completos++;
        inicioPer = somarMeses(inicioPer, 12);
      }
      if (completos > 0) {
        const semHistorico = !fer.length;
        addLinha(
          'Períodos aquisitivos completos sem gozo registrado',
          { valor: completos, ref: refRegra('FERIAS_VENCIDAS_POSSIVEIS', 'Períodos completos após o último perAquis de férias (S-2230)', { ultimoPeriodoRegistrado: ultimoPer ?? null }, ['Férias gozadas antes do período importado podem não constar']) },
          null,
          semHistorico
            ? 'Nenhum S-2230 de férias importado para o trabalhador: não é possível afirmar que há férias vencidas. Valor não calculado.'
            : 'Possíveis férias vencidas: confirme no sistema de folha. Valor não calculado (pode haver dobra — CLT, art. 137).',
          'inteiro',
          'A confirmar',
        );
        pend.push({
          nivel: 'alerta',
          categoria: 'calculo_incompleto',
          mensagem: semHistorico
            ? 'Sem histórico de férias (S-2230) importado: férias vencidas não podem ser conferidas.'
            : `${completos} período(s) aquisitivo(s) completo(s) sem registro de gozo nos S-2230 importados (possíveis férias vencidas).`,
          cpf,
        });
      }
      if (regra.ferias > 0) {
        const av = avosFerias(inicioPer, fimProj);
        addLinha('Avos de férias proporcionais', av, null, `Período aquisitivo em curso desde ${dtBr(inicioPer)}`, 'inteiro');
        const r = proporcional(remuneracao!, av.valor! * regra.ferias, true, 'FERIAS_PROPORCIONAIS', 'Férias proporcionais + 1/3');
        addLinha('Férias proporcionais + 1/3', r, somaNat(['6006']), 'Comparado com rubricas de natureza 6006 (ajuste se a empresa usar outra natureza)');
      } else addLinha('Férias proporcionais + 1/3', null, null, regra.obs);
      const vencidasXml = somaNat(['6007']);
      if (vencidasXml) addLinha('Férias vencidas pagas no XML (natureza 6007)', null, vencidasXml, 'Conferir com os períodos aquisitivos em aberto', 'moeda', 'A conferir');
      // multa FGTS
      if (regra.multa) {
        const saldo = num(saldoFgts);
        if (saldo == null) {
          addLinha(`Multa rescisória do FGTS (${regra.multa * 100}%)`, null, null, 'Informe o saldo do FGTS para fins rescisórios (complemento) para calcular', 'moeda', 'Aguardando complemento');
          pend.push({ nivel: 'info', categoria: 'ausente', mensagem: 'Saldo do FGTS para fins rescisórios não informado: multa não calculada.', cpf });
        } else {
          const t = cx.tab.fgts(per);
          addLinha(`Multa rescisória do FGTS (${regra.multa * 100}%)`, { valor: arred(saldo * regra.multa), ref: { regra: 'MULTA_FGTS', versao: '1', formula: `Saldo para fins rescisórios × ${regra.multa * 100}%`, parametros: { saldo }, tabela: t ? { id: t.id, versao: t.versao, fonte: t.fonte } : undefined } }, null, 'Recolhida via FGTS Digital (não integra o líquido)');
        }
      } else addLinha('Multa rescisória do FGTS', null, null, 'Não devida neste motivo');
    }
    doc.blocos.push({
      titulo: 'Memória de cálculo — prévia para conferência',
      destaque: 'memoria',
      tabela: {
        colunas: [col('item', 'Item'), col('regra', 'Regra'), col('calc', 'Calculado', 'moeda'), col('xml', 'No XML', 'moeda'), col('dif', 'Diferença', 'moeda'), col('sit', 'Situação'), col('obs', 'Observações / pendências')],
        linhas,
      },
      campos: [
        { rotulo: 'Remuneração base usada', val: remuneracao != null ? vc(arred(remuneracao), refRegra('REMUNERACAO_BASE', 'Salário contratual + médias informadas', { salario: salario ?? null, medias: num(medias) }), 'moeda') : va('Salário não encontrado', 'moeda') },
        { rotulo: 'Médias de variáveis', val: medias },
        { rotulo: 'Saldo do FGTS (fins rescisórios)', val: saldoFgts },
      ],
      colunasCampos: 3,
      notas: [
        'Cálculo de conferência determinístico. Não substitui o cálculo do sistema de folha nem a análise profissional (CCT, faltas, afastamentos, médias, adiantamentos e estabilidades não constam integralmente nos XMLs).',
        regra?.obs ?? '',
      ].filter(Boolean),
    });
    for (const p of [...pend, ...(folhaT?.pendencias ?? [])]) p.nome = String(cad.nome.v ?? '');
    contarPendencias(doc, [...pend, ...(folhaT?.pendencias ?? [])]);
  }
  if (!n) doc.blocos.push({ notas: [`Nenhum desligamento (S-2299) ativo com data em ${competenciaBr(per)}.`] });
  doc.estatisticas = { rescisoes: n };
  return doc;
}

// ------------------------------------------------------------------ Admissões e desligamentos
export function admissoesDesligamentos(cx: Contexto): Documento {
  exigir(cx.p, 'perIni', 'perFim');
  const doc = documentoBase(cx, 'admissoes_desligamentos', 'Histórico de admissões e desligamentos', [], 'paisagem');
  const ini = `${cx.p.perIni}-01`;
  const fim = ultimoDiaMes(cx.p.perFim!);
  const linhas: Array<{ data: string; l: Linha }> = [];
  let adm = 0;
  let desl = 0;
  for (const v of vinculos(cx.d)) {
    const dt = v.dtInicio;
    if (!dt || dt < ini || dt > fim) continue;
    const cad = cadastro(cx.d, v.cpf, dt);
    const ctr = contrato(cx.d, v.cpf, v.matricula, dt);
    adm++;
    linhas.push({
      data: dt,
      l: linha({ data: vx(v.ev, desc(v.ev.raiz, v.origem === 'S-2200' ? 'dtAdm' : 'dtInicio')[0], 'data'), mov: `Admissão (${v.origem})`, nome: cad.nome, cpf: mascararCpf({ v: v.cpf, o: 'xml', x: { tipoEvento: v.origem, eventoId: v.ev.eventoId, recibo: v.ev.recibo, arquivo: v.ev.arquivo, campo: 'cpfTrab' } }, cx.p.mascararCpf), mat: v.matricula ?? '', categ: v.codCateg ?? '', cargo: ctr.cargo, sal: ctr.salario, motivo: '' }),
    });
  }
  for (const tipo of ['S-2299', 'S-2399']) {
    for (const ev of cx.d.todos(tipo)) {
      const dt = ev.dataRef;
      if (!dt || dt < ini || dt > fim) continue;
      desl++;
      const cad = cadastro(cx.d, ev.cpf!, dt);
      const ctr = contrato(cx.d, ev.cpf!, ev.matricula, dt);
      const mtv = tipo === 'S-2299' ? txt(ev.raiz, 'infoDeslig/mtvDeslig') : txt(ev.raiz, 'infoTSVTermino/mtvDesligTSV');
      linhas.push({
        data: dt,
        l: linha({ data: vx(ev, desc(ev.raiz, tipo === 'S-2299' ? 'dtDeslig' : 'dtTerm')[0], 'data'), mov: `Desligamento (${tipo})`, nome: cad.nome, cpf: mascararCpf({ v: ev.cpf!, o: 'xml' }, cx.p.mascararCpf), mat: ev.matricula ?? '', categ: String(ctr.codCateg.v ?? ''), cargo: ctr.cargo, sal: ctr.salario, motivo: mtv ? descrever(MTV_DESLIG, mtv) : '' }),
      });
    }
  }
  linhas.sort((a, b) => a.data.localeCompare(b.data));
  const out = linhas.map((x) => x.l);
  out.push(linha({ mov: `Admissões: ${adm} · Desligamentos: ${desl} · Saldo: ${adm - desl}` }, 'total'));
  doc.blocos.push({
    tabela: {
      colunas: [col('data', 'Data', 'data'), col('mov', 'Movimento'), col('nome', 'Nome'), col('cpf', 'CPF'), col('mat', 'Matrícula'), col('categ', 'Categoria'), col('cargo', 'Cargo'), col('sal', 'Salário', 'moeda'), col('motivo', 'Motivo')],
      linhas: out,
    },
  });
  doc.estatisticas = { admissoes: adm, desligamentos: desl };
  return doc;
}

// ------------------------------------------------------------------ Remunerações e pagamentos
export function remuneracoesPagamentos(cx: Contexto): Documento {
  exigir(cx.p, 'perIni', 'perFim');
  const doc = documentoBase(cx, 'remuneracoes_pagamentos', 'Remunerações (S-1200) × pagamentos (S-1210)', [], 'paisagem');
  const linhas: Linha[] = [];
  for (const c of listaCompetencias(cx.p.perIni!, cx.p.perFim!)) {
    const lista = montarFolha(cx.d, cx.tab, c, '1').filter((t) => correspondeTrabalhador(cx.p.trabalhador, t.cpf, t.nome.v, t.matricula));
    if (!lista.length) continue;
    linhas.push(linha({ comp: `Competência ${competenciaBr(c)}` }, 'grupo'));
    const liq: number[] = [];
    const pago: number[] = [];
    for (const t of lista.sort((a, b) => String(a.nome.v).localeCompare(String(b.nome.v), 'pt-BR'))) {
      for (const dm of t.dms) {
        liq.push(dm.liquidoNum ?? 0);
        pago.push(num(dm.pago) ?? 0);
        linhas.push(
          linha({
            comp: competenciaBr(c),
            nome: t.nome,
            dm: `${dm.ideDmDev} (${dm.origem})`,
            prov: dm.proventos,
            desc: dm.descontos,
            liq: dm.liquido,
            pago: dm.pago,
            dt: dm.dtPgto,
            dif: dm.conferenciaLiquido.diferenca,
            sit: STATUS[dm.conferenciaLiquido.status],
          }),
        );
      }
      contarPendencias(doc, t.pendencias.filter((p) => p.categoria !== 'calculo_incompleto'));
    }
    const ref = refRegra('SOMA_COMPETENCIA', 'Σ dos demonstrativos da competência');
    linhas.push(linha({ nome: `Total ${competenciaBr(c)}`, liq: vc(somar(liq), ref, 'moeda'), pago: vc(somar(pago), ref, 'moeda') }, 'subtotal'));
  }
  doc.blocos.push({
    tabela: {
      colunas: [col('comp', 'Competência'), col('nome', 'Trabalhador'), col('dm', 'Demonstrativo'), col('prov', 'Proventos', 'moeda'), col('desc', 'Descontos', 'moeda'), col('liq', 'Líquido calculado', 'moeda'), col('pago', 'Líquido pago', 'moeda'), col('dt', 'Data pgto', 'data'), col('dif', 'Diferença', 'moeda'), col('sit', 'Situação')],
      linhas,
    },
  });
  return doc;
}

// ------------------------------------------------------------------ Rubricas por competência
export function rubricasPorCompetencia(cx: Contexto): Documento {
  exigir(cx.p, 'perIni', 'perFim');
  const doc = documentoBase(cx, 'rubricas_competencia', 'Rubricas por competência', [], 'paisagem');
  const comps = listaCompetencias(cx.p.perIni!, cx.p.perFim!, 24);
  const mapa = new Map<string, { cod: string; dsc: Val; tp?: string; valores: Record<string, number[]> }>();
  for (const c of comps) {
    for (const t of montarFolha(cx.d, cx.tab, c, '1')) {
      if (!correspondeTrabalhador(cx.p.trabalhador, t.cpf, t.nome.v, t.matricula)) continue;
      for (const i of t.dms.flatMap((d) => d.itens)) {
        const k = `${i.codRubr}|${i.ideTabRubr}`;
        if (!mapa.has(k)) mapa.set(k, { cod: i.codRubr, dsc: i.rub.dsc, tp: i.rub.tp, valores: {} });
        (mapa.get(k)!.valores[c] ??= []).push(i.vNum ?? 0);
      }
    }
  }
  const ref = refRegra('SOMA_RUBRICA_COMPETENCIA', 'Σ vrRubr da rubrica na competência');
  const linhas: Linha[] = [...mapa.values()]
    .sort((a, b) => (a.tp ?? '9').localeCompare(b.tp ?? '9') || a.cod.localeCompare(b.cod, 'pt-BR', { numeric: true }))
    .map((r) => {
      const c: Record<string, Val | string | null> = { cod: r.cod, dsc: r.dsc, tipo: descricaoTipo(r.tp) };
      const tot: number[] = [];
      for (const comp of comps) {
        const vs = r.valores[comp];
        c[comp] = vs ? vc(somar(vs), ref, 'moeda') : null;
        if (vs) tot.push(...vs);
      }
      c.total = vc(somar(tot), ref, 'moeda');
      return linha(c);
    });
  doc.blocos.push({
    tabela: {
      colunas: [col('cod', 'Cód.'), col('dsc', 'Descrição'), col('tipo', 'Tipo'), ...comps.map((c) => col(c, competenciaBr(c), 'moeda')), col('total', 'Total', 'moeda')],
      linhas,
    },
  });
  doc.estatisticas = { rubricas: mapa.size, competencias: comps.length };
  return doc;
}

// ------------------------------------------------------------------ Eventos ausentes / pendências
export function eventosAusentes(cx: Contexto): Documento {
  exigir(cx.p, 'competencia');
  const per = cx.p.competencia!;
  const doc = documentoBase(cx, 'eventos_ausentes', 'Eventos ausentes e pendências', [], 'paisagem');
  const pend: Pendencia[] = [];
  const iniMes = `${per}-01`;
  const fimMes = ultimoDiaMes(per);
  if (!cx.d.todos('S-1000').length) pend.push({ nivel: 'alerta', categoria: 'evento_ausente', mensagem: 'Informações do empregador (S-1000) não importadas.', competencia: per });
  if (!cx.d.todos('S-1010').length) {
    const doRecibo = cx.d.qtdRubricasDoRecibo();
    pend.push(
      doRecibo
        ? { nivel: 'info', categoria: 'evento_ausente', mensagem: `Tabela de rubricas (S-1010) não importada: tipo e incidências de ${doRecibo} rubrica(s) foram lidos dos recibos do eSocial; as descrições podem ser informadas em Complementos.`, competencia: per }
        : { nivel: 'alerta', categoria: 'evento_ausente', mensagem: 'Tabela de rubricas (S-1010) não importada: tipos e incidências das rubricas ficarão ausentes.', competencia: per },
    );
  }
  const folhaComp = montarFolha(cx.d, cx.tab, per, '1');
  const comRemun = new Set(folhaComp.map((t) => t.cpf));
  for (const v of vinculos(cx.d)) {
    if (!v.dtInicio || v.dtInicio > fimMes) continue;
    const deslig = cx.d.doTrabalhador(v.origem === 'S-2200' ? 'S-2299' : 'S-2399', v.cpf).find((e) => !v.matricula || e.matricula === v.matricula);
    if (deslig?.dataRef && deslig.dataRef < iniMes) continue;
    if (comRemun.has(v.cpf)) continue;
    const cad = cadastro(cx.d, v.cpf, fimMes);
    const afastadoMesTodo = afastamentos(cx.d, v.cpf, v.matricula).some((a) => (a.ini ?? '9') <= iniMes && (!a.fim || a.fim >= fimMes));
    pend.push({
      nivel: afastadoMesTodo ? 'info' : 'alerta',
      categoria: 'evento_ausente',
      mensagem: afastadoMesTodo
        ? 'Vínculo afastado durante todo o mês e sem S-1200 (pode não haver remuneração).'
        : `Vínculo ativo (${v.origem}) sem remuneração (S-1200) na competência.`,
      cpf: v.cpf,
      nome: String(cad.nome.v ?? ''),
      competencia: per,
    });
  }
  for (const t of folhaComp) pend.push(...t.pendencias.filter((p) => p.categoria !== 'divergencia' && p.categoria !== 'calculo_incompleto'));
  const fech = [...cx.d.doPeriodo('S-1299', per, '1'), ...cx.d.doPeriodo('S-1298', per, '1')].sort((a, b) => a.ordem.localeCompare(b.ordem)).pop();
  if (!fech) pend.push({ nivel: 'alerta', categoria: 'evento_ausente', mensagem: 'Competência sem fechamento (S-1299) nos arquivos importados.', competencia: per });
  else if (fech.tipo === 'S-1298') pend.push({ nivel: 'alerta', categoria: 'evento_ausente', mensagem: 'Competência reaberta (S-1298) sem novo fechamento posterior nos arquivos importados.', competencia: per });
  for (const cpf of new Set(cx.d.todos('S-2230').map((e) => e.cpf!))) {
    for (const a of afastamentos(cx.d, cpf)) {
      if (ehFerias(a) && a.ini && a.ini <= fimMes && (!a.fim || a.fim >= iniMes) && !a.perAquisIni) {
        pend.push({ nivel: 'alerta', categoria: 'ausente', mensagem: 'Férias (S-2230) sem período aquisitivo informado.', cpf, competencia: per });
      }
      if (a.ini && !a.fim && a.ini <= fimMes && !ehFerias(a)) {
        pend.push({ nivel: 'info', categoria: 'ausente', mensagem: `Afastamento (${descricaoAfastamento(a.codMot)}) iniciado em ${dtBr(a.ini)} sem término informado.`, cpf, competencia: per });
      }
    }
  }
  const outros = cx.db
    .prepare(
      `SELECT evento_id, tipo, cpf, situacao, situacao_motivo FROM eventos
        WHERE emp_chave = ? AND (situacao IN ('substituido_inferido','producao_restrita') OR (situacao = 'ativo' AND situacao_motivo IS NOT NULL))
          AND (per_apur = ? OR substr(coalesce(data_ref,''),1,7) = ?)`,
    )
    .all(cx.p.empresa, per, per) as Array<{ evento_id: string; tipo: string; cpf: string | null; situacao: string; situacao_motivo: string }>;
  for (const o of outros) {
    pend.push({
      nivel: o.situacao === 'substituido_inferido' ? 'alerta' : 'info',
      categoria: o.situacao === 'producao_restrita' ? 'ambiente' : o.situacao === 'substituido_inferido' ? 'duplicidade' : 'evento_ausente',
      mensagem: `${o.tipo} ${o.evento_id}: ${o.situacao_motivo}`,
      cpf: o.cpf ?? undefined,
      competencia: per,
      eventoId: o.evento_id,
    });
  }
  const conflitos = cx.db
    .prepare(`SELECT c.evento_id, c.descricao FROM conflitos c JOIN eventos e ON e.evento_id = c.evento_id WHERE e.emp_chave = ?`)
    .all(cx.p.empresa) as Array<{ evento_id: string; descricao: string }>;
  for (const c of conflitos) pend.push({ nivel: 'erro', categoria: 'duplicidade', mensagem: `${c.evento_id}: ${c.descricao}`, eventoId: c.evento_id });

  const NIVEL: Record<string, string> = { erro: 'Erro', alerta: 'Alerta', info: 'Informação' };
  const CAT: Record<string, string> = { ausente: 'Dado ausente', divergencia: 'Divergência', evento_ausente: 'Evento ausente', calculo_incompleto: 'Cálculo incompleto', validacao: 'Validação', duplicidade: 'Duplicidade', ambiente: 'Ambiente' };
  const ordemNivel = { erro: 0, alerta: 1, info: 2 };
  const vistos = new Set<string>();
  const unicas = pend.filter((p) => {
    const k = `${p.categoria}|${p.cpf}|${p.mensagem}`;
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
  unicas.sort((a, b) => ordemNivel[a.nivel] - ordemNivel[b.nivel] || (a.nome ?? '').localeCompare(b.nome ?? ''));
  doc.blocos.push({
    tabela: {
      colunas: [col('nivel', 'Nível'), col('cat', 'Categoria'), col('trab', 'Trabalhador'), col('cpf', 'CPF'), col('msg', 'Descrição')],
      linhas: unicas.map((p) =>
        linha({ nivel: NIVEL[p.nivel], cat: CAT[p.categoria] ?? p.categoria, trab: p.nome ?? '', cpf: p.cpf ? (cx.p.mascararCpf ? `***.${p.cpf.slice(3, 6)}.${p.cpf.slice(6, 9)}-**` : p.cpf) : '', msg: p.mensagem }),
      ),
    },
    notas: [unicas.length ? `${unicas.length} pendência(s).` : 'Nenhuma pendência encontrada para a competência.'],
  });
  doc.pendencias = unicas;
  doc.estatisticas = { pendencias: unicas.length };
  return doc;
}

export type { Campo, EvCarregado };
export { vm };
