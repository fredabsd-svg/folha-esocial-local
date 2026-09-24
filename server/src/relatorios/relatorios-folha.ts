/**
 * Relatórios baseados na folha da competência: extrato mensal, movimentos,
 * recibo de pagamento, relação de líquidos, resumo mensal e divergências.
 */
import { somar } from '../calculo/regras.js';
import type { Campo, Documento, Linha, Val } from '../compartilhado/tipos.js';
import { descricaoTipo } from '../dominio/cadastros.js';
import { num, va, vc } from '../dominio/dados.js';
import { type Conferencia, descricaoCategoria, type ItemRem, montarFolha, type TrabalhadorFolha } from '../dominio/folha.js';
import { descrever, NAT_RUBR, UND_SAL_FIXO } from '../esocial/catalogo.js';
import { desc, txt } from '../xml/arvore.js';
import {
  col,
  contarPendencias,
  type Contexto,
  documentoBase,
  exigir,
  filtrarTrabalhador,
  grupoDe,
  linha,
  mascararCpf,
  ordenar,
} from './base.js';

const STATUS: Record<string, string> = {
  ok: 'Confere',
  arredondamento: 'Diferença de arredondamento',
  divergente: 'DIVERGENTE',
  incompleto: 'Conferência incompleta',
  sem_referencia: 'Sem valor no XML para comparar',
  nao_aplicavel: 'Não aplicável',
};

function folha(cx: Contexto): TrabalhadorFolha[] {
  exigir(cx.p, 'competencia');
  const lista = montarFolha(cx.d, cx.tab, cx.p.competencia!, cx.p.indApuracao ?? '1');
  return ordenar(filtrarTrabalhador(lista, cx.p.trabalhador), cx.p.ordenar);
}

/** Referência = quantidade (qtdRubr) ou, na falta, fator (fatorRubr); sem nenhum dos dois, "não se aplica". */
const referencia = (i: ItemRem): Val | null => (i.qtd.v !== null ? i.qtd : i.fator.v !== null ? i.fator : null);

function camposTrabalhador(t: TrabalhadorFolha, mascarar?: boolean): Campo[] {
  const und = t.contrato.undSalFixo.v as string | undefined;
  return [
    { rotulo: 'Trabalhador', val: t.nome },
    { rotulo: 'CPF', val: mascararCpf(t.cpfVal, mascarar) },
    { rotulo: 'Matrícula', val: t.matriculaVal },
    { rotulo: 'Categoria', val: t.categoria ? { ...t.dms[0]?.codCateg, v: descricaoCategoria(t.categoria) } as Val : t.contrato.codCateg },
    { rotulo: 'Admissão', val: t.contrato.dtAdm },
    { rotulo: 'Situação na competência', val: t.situacao },
    { rotulo: 'Cargo', val: t.contrato.cargo },
    { rotulo: 'CBO', val: t.contrato.cbo },
    { rotulo: 'Salário contratual', val: t.contrato.salario },
    { rotulo: 'Unidade do salário', val: und ? { ...t.contrato.undSalFixo, v: descrever(UND_SAL_FIXO, und) } : t.contrato.undSalFixo },
    { rotulo: 'Estabelecimento / lotação', val: [t.estab, t.lotacao].filter(Boolean).join(' / ') || '—' },
    { rotulo: 'Dependentes para IRRF', val: t.dependentes },
  ];
}

function tabelaConferencias(conf: Conferencia[]) {
  return {
    colunas: [col('conf', 'Conferência'), col('calc', 'Calculado', 'moeda'), col('xml', 'Informado no XML', 'moeda'), col('dif', 'Diferença', 'moeda'), col('sit', 'Situação')],
    linhas: conf.map((c) =>
      linha({
        conf: c.titulo + (c.obs ? ` — ${c.obs}` : ''),
        calc: c.calculado,
        xml: c.referencias.find((r) => r.val.v !== null)?.val ?? c.referencias[0]?.val ?? null,
        dif: c.diferenca,
        sit: STATUS[c.status] ?? c.status,
      }),
    ),
  };
}

// ------------------------------------------------------------------ Extrato mensal
export function extratoMensal(cx: Contexto): Documento {
  const doc = documentoBase(cx, 'extrato', 'Extrato mensal da folha');
  const lista = folha(cx);
  lista.forEach((t, idx) => {
    doc.blocos.push({
      titulo: `${t.nome.v ?? 'Trabalhador sem nome'} — matrícula ${t.matricula ?? '—'}`,
      campos: camposTrabalhador(t, cx.p.mascararCpf),
      colunasCampos: 4,
      quebraPagina: idx > 0,
    });
    const linhas: Linha[] = [];
    for (const dm of t.dms) {
      linhas.push(linha({ dm: `Demonstrativo ${dm.ideDmDev} (${dm.origem})` }, 'grupo'));
      for (const i of dm.itens) {
        if (!cx.p.incluirInformativas && (i.rub.tp === '3' || i.rub.tp === '4')) continue;
        linhas.push(
          linha({
            dm: dm.ideDmDev,
            cod: i.codRubr,
            dsc: i.rub.dsc,
            nat: i.rub.natRubr,
            tipo: descricaoTipo(i.rub.tp),
            ref: referencia(i),
            valor: i.valor,
            inc: [i.rub.cp, i.rub.ir, i.rub.fgts].map((x) => x ?? '?').join(' / '),
            per: i.perRef ?? '',
          }),
        );
      }
      linhas.push(linha({ dsc: 'Proventos', valor: dm.proventos }, 'subtotal'));
      linhas.push(linha({ dsc: 'Descontos', valor: dm.descontos }, 'subtotal'));
      linhas.push(linha({ dsc: 'Líquido calculado', valor: dm.liquido }, 'subtotal'));
      linhas.push(linha({ dsc: 'Líquido pago (S-1210)', valor: dm.pago, ref: dm.dtPgto }, 'subtotal'));
    }
    doc.blocos.push({
      titulo: 'Rubricas',
      tabela: {
        colunas: [
          col('cod', 'Cód.'),
          col('dsc', 'Descrição'),
          col('nat', 'Natureza'),
          col('tipo', 'Tipo'),
          col('ref', 'Referência', 'quantidade'),
          col('valor', 'Valor', 'moeda'),
          col('inc', 'Incid. CP/IRRF/FGTS'),
          col('per', 'Per. ref.'),
        ],
        linhas,
      },
    });
    const b = t.bases;
    doc.blocos.push({
      titulo: 'Totais e bases',
      colunasCampos: 3,
      campos: [
        { rotulo: 'Total de proventos', val: t.proventos },
        { rotulo: 'Total de descontos', val: t.descontos },
        { rotulo: 'Líquido calculado', val: t.liquido },
        { rotulo: 'Líquido pago (S-1210)', val: t.pago },
        { rotulo: 'Base do INSS (S-5001)', val: b.cpXml },
        { rotulo: 'Base do INSS (rubricas)', val: b.cpRubricas },
        { rotulo: 'INSS calculado pelo eSocial (S-5001)', val: b.cpCalcESocial },
        { rotulo: 'INSS descontado (S-5001)', val: b.cpDescSeg },
        { rotulo: 'INSS recalculado', val: b.inssCalc ?? va('Não recalculado', 'moeda') },
        { rotulo: 'Base do FGTS (S-5003)', val: b.fgtsBaseXml },
        { rotulo: 'FGTS (S-5003)', val: b.fgtsDepXml },
        { rotulo: 'FGTS recalculado', val: b.fgtsCalc },
        { rotulo: 'Base do IRRF mensal (recálculo)', val: b.irrf_mensal_base ?? va('Sem rendimentos tributáveis mensais', 'moeda') },
        { rotulo: 'IRRF mensal recalculado', val: b.irrf_mensal_calc ?? va('Sem rendimentos tributáveis mensais', 'moeda') },
        { rotulo: 'IRRF mensal retido (rubricas)', val: b.irrf_mensal_retido ?? va('Sem rubrica de retenção', 'moeda') },
      ],
    });
    doc.blocos.push({ titulo: 'Conferências', tabela: tabelaConferencias(t.conferencias) });
    contarPendencias(doc, t.pendencias);
  });
  if (!lista.length) doc.blocos.push({ notas: ['Nenhuma remuneração (S-1200/S-2299) ativa encontrada para os filtros informados.'] });
  doc.estatisticas = { trabalhadores: lista.length };
  return doc;
}

// ------------------------------------------------------------------ Movimentos
function valorCalculadoItem(t: TrabalhadorFolha, i: ItemRem): Val | null {
  const itens = t.dms.flatMap((d) => d.itens);
  if (i.rub.cp === '31' && itens.filter((x) => x.rub.cp === '31').length === 1) return t.bases.inssCalc ?? null;
  const mapaIr: Record<string, string> = { '31': 'mensal', '33': 'ferias', '32': '13' };
  const tipo = i.rub.ir ? mapaIr[i.rub.ir] : undefined;
  if (tipo && itens.filter((x) => x.rub.ir === i.rub.ir).length === 1) return t.bases[`irrf_${tipo}_calc`] ?? null;
  return null;
}

export function movimentos(cx: Contexto): Documento {
  const doc = documentoBase(cx, 'movimentos', 'Movimentos da folha', [], 'paisagem');
  const lista = folha(cx);
  const linhas: Linha[] = [];
  const tot = { p: [] as number[], d: [] as number[] };
  for (const t of lista) {
    linhas.push(linha({ mat: t.matricula ?? '', trab: t.nome }, 'grupo'));
    for (const dm of t.dms) {
      for (const i of dm.itens) {
        if (!cx.p.incluirInformativas && (i.rub.tp === '3' || i.rub.tp === '4')) continue;
        linhas.push(
          linha({
            mat: t.matricula ?? '',
            trab: dm.ideDmDev,
            cod: i.codRubr,
            dsc: i.rub.dsc,
            ref: referencia(i),
            informado: i.valor,
            calculado: valorCalculadoItem(t, i),
            tipo: descricaoTipo(i.rub.tp),
            local: [i.estab, i.lotacao].filter(Boolean).join(' / '),
          }),
        );
      }
    }
    linhas.push(linha({ dsc: 'Subtotal proventos', informado: t.proventos }, 'subtotal'));
    linhas.push(linha({ dsc: 'Subtotal descontos', informado: t.descontos }, 'subtotal'));
    linhas.push(linha({ dsc: 'Líquido', informado: t.liquido }, 'subtotal'));
    tot.p.push(num(t.proventos) ?? 0);
    tot.d.push(num(t.descontos) ?? 0);
  }
  const ref = { regra: 'TOTAL_EMPRESA', versao: '1', formula: 'Soma dos subtotais dos trabalhadores listados' };
  linhas.push(linha({ dsc: `Total de proventos (${lista.length} trabalhadores)`, informado: vc(somar(tot.p), ref, 'moeda') }, 'total'));
  linhas.push(linha({ dsc: 'Total de descontos', informado: vc(somar(tot.d), ref, 'moeda') }, 'total'));
  linhas.push(linha({ dsc: 'Total líquido', informado: vc(somar([somar(tot.p), -somar(tot.d)]), ref, 'moeda') }, 'total'));
  doc.blocos.push({
    tabela: {
      colunas: [
        col('mat', 'Matrícula'),
        col('trab', 'Trabalhador / demonstrativo'),
        col('cod', 'Cód.'),
        col('dsc', 'Descrição'),
        col('ref', 'Referência', 'quantidade'),
        col('informado', 'Valor informado', 'moeda'),
        col('calculado', 'Valor calculado', 'moeda'),
        col('tipo', 'Tipo'),
        col('local', 'Estab. / lotação'),
      ],
      linhas,
    },
    notas: [
      '"Valor informado" vem do XML (vrRubr). "Valor calculado" existe apenas para rubricas com regra de recálculo (INSS e IRRF); nas demais aparece "—".',
    ],
  });
  for (const t of lista) contarPendencias(doc, t.pendencias);
  doc.estatisticas = { trabalhadores: lista.length };
  return doc;
}

// ------------------------------------------------------------------ Recibo de pagamento
export function reciboPagamento(cx: Contexto): Documento {
  const doc = documentoBase(cx, 'recibo', 'Recibo de pagamento de salário');
  const lista = folha(cx);
  let n = 0;
  for (const t of lista) {
    for (const dm of t.dms) {
      if (dm.origem !== 'S-1200' && !cx.p.incluirRescisao) continue;
      const linhas: Linha[] = dm.itens
        .filter((i) => cx.p.incluirInformativas || (i.rub.tp !== '3' && i.rub.tp !== '4'))
        .map((i) =>
          linha({
            cod: i.codRubr,
            dsc: i.rub.dsc,
            ref: referencia(i),
            venc: i.rub.tp === '1' ? i.valor : null,
            desc: i.rub.tp === '2' ? i.valor : null,
            info: i.rub.tp === '3' || i.rub.tp === '4' || !i.rub.tp ? i.valor : null,
          }),
        );
      linhas.push(linha({ dsc: 'Totais', venc: dm.proventos, desc: dm.descontos }, 'total'));
      const colunas = [col('cod', 'Cód.'), col('dsc', 'Descrição'), col('ref', 'Referência', 'quantidade'), col('venc', 'Vencimentos', 'moeda'), col('desc', 'Descontos', 'moeda')];
      if (cx.p.incluirInformativas || dm.itens.some((i) => !i.rub.tp)) colunas.push(col('info', 'Informativas / sem tipo', 'moeda'));
      const irrfBase = t.bases.irrf_mensal_base;
      const faixa = t.bases.irrf_mensal_calc?.c?.parametros?.aliquota;
      doc.blocos.push({
        titulo: `Demonstrativo ${dm.ideDmDev}`,
        destaque: 'recibo',
        quebraPagina: n++ > 0,
        colunasCampos: 4,
        campos: [
          { rotulo: 'Empregador', val: cx.emp.nome },
          { rotulo: 'Inscrição', val: cx.emp.documento },
          { rotulo: 'Trabalhador', val: t.nome },
          { rotulo: 'CPF', val: mascararCpf(t.cpfVal, cx.p.mascararCpf) },
          { rotulo: 'Matrícula', val: t.matriculaVal },
          { rotulo: 'Cargo', val: t.contrato.cargo },
          { rotulo: 'CBO', val: t.contrato.cbo },
          { rotulo: 'Admissão', val: t.contrato.dtAdm },
        ],
        tabela: { colunas, linhas },
      });
      doc.blocos.push({
        colunasCampos: 3,
        campos: [
          { rotulo: 'Total de vencimentos', val: dm.proventos },
          { rotulo: 'Total de descontos', val: dm.descontos },
          { rotulo: 'Líquido a receber (calculado)', val: dm.liquido },
          { rotulo: 'Líquido pago (S-1210)', val: dm.pago },
          { rotulo: 'Data do pagamento', val: dm.dtPgto },
          { rotulo: 'Salário base', val: t.contrato.salario },
          { rotulo: 'Sal. contribuição INSS (S-5001)*', val: t.bases.cpXml },
          { rotulo: 'Base de cálculo FGTS (S-5003)*', val: t.bases.fgtsBaseXml },
          { rotulo: 'FGTS do mês (S-5003)*', val: t.bases.fgtsDepXml },
          { rotulo: 'Base de cálculo IRRF mensal (recálculo)*', val: irrfBase ?? va('Sem rendimentos tributáveis mensais', 'moeda') },
          {
            rotulo: 'Faixa IRRF (recálculo)*',
            val: typeof faixa === 'number' ? vc(`${(faixa * 100).toFixed(1).replace('.', ',')}%`, t.bases.irrf_mensal_calc!.c!, 'texto') : va('Sem cálculo de IRRF mensal', 'texto'),
          },
        ],
        notas: ['* Bases referem-se ao total do trabalhador na competência.'],
        assinaturas: ['Declaro ter recebido a importância líquida discriminada neste recibo.', 'Data: ____/____/________', 'Assinatura do trabalhador'],
      });
      contarPendencias(doc, t.pendencias);
    }
  }
  if (!n) doc.blocos.push({ notas: ['Nenhum demonstrativo encontrado para os filtros informados.'] });
  doc.estatisticas = { recibos: n };
  return doc;
}

// ------------------------------------------------------------------ Relação geral dos líquidos
export function relacaoLiquidos(cx: Contexto): Documento {
  const doc = documentoBase(cx, 'liquidos', 'Relação geral dos líquidos');
  const lista = folha(cx);
  const usarPago = (cx.p.fonteLiquido ?? 'pago') === 'pago';
  const grupos = new Map<string, TrabalhadorFolha[]>();
  for (const t of lista) {
    const g = grupoDe(t, cx.p.agrupar);
    if (!grupos.has(g)) grupos.set(g, []);
    grupos.get(g)!.push(t);
  }
  const linhas: Linha[] = [];
  const totalGeral: number[] = [];
  const ref = (n: number) => ({ regra: 'SOMA_LIQUIDOS', versao: '1', formula: 'Σ líquidos listados', parametros: { pessoas: n } });
  for (const [g, membros] of grupos) {
    if (g) linhas.push(linha({ nome: g }, 'grupo'));
    const soma: number[] = [];
    for (const t of membros) {
      const val = usarPago && t.pago.v !== null ? t.pago : t.liquido;
      const origem = usarPago && t.pago.v !== null ? 'Pago (S-1210)' : usarPago ? 'Calculado — S-1210 ausente' : 'Calculado';
      soma.push(num(val) ?? 0);
      linhas.push(
        linha({
          mat: t.matricula ?? '',
          nome: t.nome,
          cpf: mascararCpf(t.cpfVal, cx.p.mascararCpf),
          liq: val,
          origem,
          dt: t.dms.find((x) => x.pagamento)?.dtPgto ?? va('Sem S-1210', 'data'),
        }),
      );
    }
    totalGeral.push(...soma);
    if (g) linhas.push(linha({ nome: `Subtotal ${g} — ${membros.length} pessoa(s)`, liq: vc(somar(soma), ref(membros.length), 'moeda') }, 'subtotal'));
  }
  linhas.push(linha({ nome: `Total da empresa — ${lista.length} pessoa(s)`, liq: vc(somar(totalGeral), ref(lista.length), 'moeda') }, 'total'));
  doc.blocos.push({
    tabela: {
      colunas: [col('mat', 'Matrícula'), col('nome', 'Nome'), col('cpf', 'CPF'), col('liq', 'Líquido', 'moeda'), col('origem', 'Origem do valor'), col('dt', 'Data do pagamento', 'data')],
      linhas,
    },
    notas: [
      usarPago
        ? 'Líquido = vrLiq do S-1210 (valor efetivamente pago). Sem S-1210, usa-se o líquido calculado (proventos − descontos), sinalizado na coluna "Origem do valor".'
        : 'Líquido calculado = proventos − descontos das rubricas do S-1200/S-2299.',
    ],
  });
  for (const t of lista) contarPendencias(doc, t.pendencias.filter((p) => p.categoria !== 'calculo_incompleto'));
  doc.estatisticas = { trabalhadores: lista.length, grupos: grupos.size };
  return doc;
}

// ------------------------------------------------------------------ Resumo mensal
export function resumoMensal(cx: Contexto): Documento {
  const doc = documentoBase(cx, 'resumo', 'Resumo mensal da folha', [], 'paisagem');
  const lista = folha(cx);
  interface Agreg {
    cod: string;
    dsc: Val;
    nat?: string;
    tp?: string;
    cpfs: Set<string>;
    qtd: number[];
    valor: number[];
    calc: number[];
    temCalc: boolean;
  }
  const mapa = new Map<string, Agreg>();
  for (const t of lista) {
    for (const dm of t.dms) {
      for (const i of dm.itens) {
        const k = `${i.codRubr}|${i.ideTabRubr}`;
        let a = mapa.get(k);
        if (!a) {
          a = { cod: i.codRubr, dsc: i.rub.dsc, nat: i.rub.nat, tp: i.rub.tp, cpfs: new Set(), qtd: [], valor: [], calc: [], temCalc: false };
          mapa.set(k, a);
        }
        a.cpfs.add(t.cpf);
        if (typeof i.qtd.v === 'number') a.qtd.push(i.qtd.v);
        a.valor.push(i.vNum ?? 0);
        const vcalc = valorCalculadoItem(t, i);
        if (vcalc && typeof vcalc.v === 'number') {
          a.calc.push(vcalc.v);
          a.temCalc = true;
        }
      }
    }
  }
  const grupos: Array<{ rotulo: string; filtro: (a: Agreg) => boolean }> = [
    { rotulo: 'Proventos', filtro: (a) => a.tp === '1' },
    { rotulo: 'Descontos', filtro: (a) => a.tp === '2' },
    { rotulo: 'Informativas', filtro: (a) => a.tp === '3' || a.tp === '4' },
    { rotulo: 'Sem tabela de rubricas (S-1010 ausente)', filtro: (a) => !a.tp },
  ];
  const linhas: Linha[] = [];
  const refSoma = (n: number) => ({ regra: 'SOMA_RUBRICA', versao: '1', formula: 'Σ vrRubr da rubrica nos demonstrativos listados', parametros: { lancamentos: n } });
  const totais: Record<string, number> = {};
  for (const g of grupos) {
    const itens = [...mapa.values()].filter(g.filtro).sort((a, b) => a.cod.localeCompare(b.cod, 'pt-BR', { numeric: true }));
    if (!itens.length) continue;
    linhas.push(linha({ cod: g.rotulo }, 'grupo'));
    for (const a of itens) {
      linhas.push(
        linha({
          cod: a.cod,
          dsc: a.dsc,
          nat: a.nat ? descrever(NAT_RUBR, a.nat) : '',
          trab: a.cpfs.size,
          ref: a.qtd.length ? somar(a.qtd) : null,
          informado: vc(somar(a.valor), refSoma(a.valor.length), 'moeda'),
          calculado: a.temCalc ? vc(somar(a.calc), { regra: 'SOMA_RECALCULO', versao: '1', formula: 'Σ valores recalculados (INSS/IRRF)' }, 'moeda') : null,
        }),
      );
    }
    totais[g.rotulo] = somar(itens.flatMap((a) => a.valor));
    linhas.push(linha({ dsc: `Total — ${g.rotulo}`, informado: vc(totais[g.rotulo], refSoma(itens.length), 'moeda') }, 'subtotal'));
  }
  doc.blocos.push({
    titulo: 'Rubricas agrupadas',
    tabela: {
      colunas: [
        col('cod', 'Cód.'),
        col('dsc', 'Descrição'),
        col('nat', 'Natureza'),
        col('trab', 'Qtd. trab.', 'inteiro'),
        col('ref', 'Referência (Σ)', 'quantidade'),
        col('informado', 'Valor informado', 'moeda'),
        col('calculado', 'Valor calculado', 'moeda'),
      ],
      linhas,
    },
  });
  // bases e totalizadores
  const soma = (k: string) => {
    const vals = lista.map((t) => t.bases[k]).filter((v) => v && typeof v.v === 'number') as Val[];
    return vals.length
      ? vc(somar(vals.map((v) => v.v as number)), { regra: 'SOMA_BASES', versao: '1', formula: `Σ ${k} dos trabalhadores listados`, parametros: { trabalhadores: vals.length } }, 'moeda')
      : va('Totalizadores não importados', 'moeda');
  };
  const refLiq = { regra: 'LIQUIDO_EMPRESA', versao: '1', formula: 'Total de proventos − total de descontos' };
  const categorias = new Map<string, number>();
  for (const t of lista) categorias.set(t.categoria || '?', (categorias.get(t.categoria || '?') ?? 0) + 1);
  const fech = cx.d.doPeriodo('S-1299', cx.p.competencia!, cx.p.indApuracao ?? '1');
  const reab = cx.d.doPeriodo('S-1298', cx.p.competencia!, cx.p.indApuracao ?? '1');
  const ultimo = [...fech, ...reab].sort((a, b) => a.ordem.localeCompare(b.ordem)).pop();
  const s5011 = cx.d.doPeriodo('S-5011', cx.p.competencia!, cx.p.indApuracao ?? '1');
  const s5013 = cx.d.doPeriodo('S-5013', cx.p.competencia!);
  const campos: Campo[] = [
    { rotulo: 'Trabalhadores na folha', val: lista.length },
    { rotulo: 'Por categoria', val: [...categorias].map(([c, n]) => `${c}: ${n}`).join(' · ') },
    { rotulo: 'Total de proventos', val: vc(totais['Proventos'] ?? 0, refLiq, 'moeda') },
    { rotulo: 'Total de descontos', val: vc(totais['Descontos'] ?? 0, refLiq, 'moeda') },
    { rotulo: 'Líquido', val: vc(somar([totais['Proventos'] ?? 0, -(totais['Descontos'] ?? 0)]), refLiq, 'moeda') },
    { rotulo: 'Base do INSS (Σ S-5001)', val: soma('cpXml') },
    { rotulo: 'INSS dos segurados — eSocial (Σ vrCpSeg)', val: soma('cpCalcESocial') },
    { rotulo: 'INSS descontado (Σ vrDescSeg)', val: soma('cpDescSeg') },
    { rotulo: 'Base do FGTS (Σ S-5003)', val: soma('fgtsBaseXml') },
    { rotulo: 'FGTS (Σ S-5003)', val: soma('fgtsDepXml') },
    { rotulo: 'FGTS recalculado', val: soma('fgtsCalc') },
    {
      rotulo: 'Fechamento da competência',
      val: ultimo
        ? { v: ultimo.tipo === 'S-1299' ? 'Fechada (S-1299)' : 'Reaberta (S-1298)', o: 'xml', x: { tipoEvento: ultimo.tipo, eventoId: ultimo.eventoId, recibo: ultimo.recibo, arquivo: ultimo.arquivo, campo: 'ideEvento/perApur' } }
        : va('S-1299 não encontrado nos arquivos importados'),
    },
  ];
  for (const ev of s5011) {
    for (const cr of desc(ev.raiz, 'infoCRContrib')) {
      campos.push({ rotulo: `S-5011 — código de receita ${txt(cr, 'tpCR')}`, val: { v: Number(txt(cr, 'vrCR') ?? 0), o: 'xml', f: 'moeda', x: { tipoEvento: 'S-5011', eventoId: ev.eventoId, recibo: ev.recibo, arquivo: ev.arquivo, campo: `${cr.caminho}/vrCR` } } });
    }
  }
  if (s5013.length) campos.push({ rotulo: 'S-5013 (FGTS consolidado)', val: `${s5013.length} evento(s) importado(s) — detalhes na consulta de eventos` });
  doc.blocos.push({ titulo: 'Totais, bases e totalizadores', campos, colunasCampos: 3 });
  for (const t of lista) contarPendencias(doc, t.pendencias.filter((p) => p.nivel !== 'info'));
  if (!ultimo) doc.pendencias.push({ nivel: 'alerta', categoria: 'evento_ausente', mensagem: 'Competência sem S-1299 (fechamento) nos arquivos importados.', competencia: cx.p.competencia });
  doc.estatisticas = { trabalhadores: lista.length, rubricas: mapa.size };
  return doc;
}

// ------------------------------------------------------------------ Divergências
export function divergencias(cx: Contexto): Documento {
  const doc = documentoBase(cx, 'divergencias', 'Divergências entre XML e recálculo', [], 'paisagem');
  const lista = folha(cx);
  const incluirOk = !!cx.p.incluirConferidos;
  const linhas: Linha[] = [];
  for (const t of lista) {
    for (const c of t.conferencias) {
      if (!incluirOk && (c.status === 'ok' || c.status === 'nao_aplicavel' || c.status === 'sem_referencia')) continue;
      linhas.push(
        linha({
          trab: t.nome,
          conf: c.titulo,
          calc: c.calculado,
          xml: c.referencias.find((r) => r.val.v !== null)?.val ?? null,
          dif: c.diferenca,
          sit: STATUS[c.status],
          obs: c.obs ?? (c.calculado.c?.incompleto ?? []).join('; '),
        }),
      );
    }
  }
  const dupl = cx.db
    .prepare(
      `SELECT evento_id, tipo, cpf, per_apur, situacao_motivo FROM eventos WHERE emp_chave = ? AND situacao = 'substituido_inferido'
         AND (per_apur = ? OR ? IS NULL)`,
    )
    .all(cx.p.empresa, cx.p.competencia ?? null, cx.p.competencia ?? null) as Array<{ evento_id: string; tipo: string; cpf: string; per_apur: string; situacao_motivo: string }>;
  for (const x of dupl) {
    linhas.push(linha({ trab: x.cpf ?? '', conf: `${x.tipo} possivelmente substituído (${x.evento_id})`, sit: 'Duplicidade sem recibo', obs: x.situacao_motivo }));
  }
  doc.blocos.push({
    tabela: {
      colunas: [col('trab', 'Trabalhador'), col('conf', 'Conferência'), col('calc', 'Calculado', 'moeda'), col('xml', 'Informado (XML)', 'moeda'), col('dif', 'Diferença', 'moeda'), col('sit', 'Situação'), col('obs', 'Observações')],
      linhas,
    },
    notas: [
      'Os valores do XML nunca são alterados. "Calculado" é o recálculo determinístico do sistema (regra, versão e tabela na origem de cada valor).',
      linhas.length ? '' : 'Nenhuma divergência ou conferência incompleta para os filtros informados.',
    ].filter(Boolean),
  });
  for (const t of lista) contarPendencias(doc, t.pendencias.filter((p) => p.categoria === 'divergencia'));
  doc.estatisticas = { linhas: linhas.length };
  return doc;
}
