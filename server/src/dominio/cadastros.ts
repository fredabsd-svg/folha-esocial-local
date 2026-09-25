/**
 * Cadastros derivados dos eventos: empregador, tabelas com vigência
 * (S-1000/S-1005/S-1010/S-1020), vínculos, dados cadastrais e contratuais
 * vigentes em uma data, afastamentos e desligamentos.
 */
import type { Val } from '../compartilhado/tipos.js';
import { COD_MOT_AFAST_FERIAS, descrever, MOT_AFAST, NAT_RUBR, TP_RUBR } from '../esocial/catalogo.js';
import { sel, txt, um, type Ctx } from '../xml/arvore.js';
import { type Dados, type EvCarregado, type LinhaRubricaRecibo, va, vm, vx } from './dados.js';

// ------------------------------------------------------------------ tabelas com vigência
export interface VersaoTabela {
  chave: string;
  ini: string;
  fim?: string;
  ev: EvCarregado;
  dados: Ctx;
}

const GRUPOS: Record<string, { grupo: string; ide: string; campos: string[] }> = {
  'S-1000': { grupo: 'infoEmpregador', ide: 'idePeriodo', campos: [] },
  'S-1005': { grupo: 'infoEstab', ide: 'ideEstab', campos: ['tpInsc', 'nrInsc'] },
  'S-1010': { grupo: 'infoRubrica', ide: 'ideRubrica', campos: ['codRubr', 'ideTabRubr'] },
  'S-1020': { grupo: 'infoLotacao', ide: 'ideLotacao', campos: ['codLotacao'] },
};

const cacheTabelas = new WeakMap<Dados, Map<string, Map<string, VersaoTabela[]>>>();

export function versoesTabela(d: Dados, tipo: keyof typeof GRUPOS | string): Map<string, VersaoTabela[]> {
  let porDados = cacheTabelas.get(d);
  if (!porDados) cacheTabelas.set(d, (porDados = new Map()));
  const existente = porDados.get(tipo);
  if (existente) return existente;
  const g = GRUPOS[tipo];
  const mapa = new Map<string, VersaoTabela[]>();
  for (const ev of d.todos(tipo)) {
    const op = ev.operacao;
    if (!op) continue;
    const opCtx = um(ev.raiz, `${g.grupo}/${op}`);
    const ide = um(opCtx, g.ide);
    if (!opCtx || !ide) continue;
    const chave = g.campos.map((c) => txt(ide, c) ?? '').join('|');
    const ini = txt(ide, 'iniValid') ?? '';
    const fim = txt(ide, 'fimValid');
    const lista = mapa.get(chave) ?? [];
    const idx = lista.findIndex((v) => v.ini === ini);
    if (op === 'inclusao') {
      if (idx >= 0) lista.splice(idx, 1);
      lista.push({ chave, ini, fim, ev, dados: opCtx });
    } else if (op === 'alteracao') {
      const nova = um(opCtx, 'novaValidade');
      const v: VersaoTabela = {
        chave,
        ini: txt(nova, 'iniValid') ?? ini,
        fim: nova ? txt(nova, 'fimValid') : fim,
        ev,
        dados: opCtx,
      };
      if (idx >= 0) lista[idx] = v;
      else lista.push(v);
    } else if (op === 'exclusao') {
      if (idx >= 0) lista.splice(idx, 1);
    }
    mapa.set(chave, lista);
  }
  porDados.set(tipo, mapa);
  return mapa;
}

export function vigenteEm(lista: VersaoTabela[] | undefined, per: string): VersaoTabela | undefined {
  const p = per.slice(0, 7);
  return (lista ?? [])
    .filter((v) => v.ini <= p && (!v.fim || v.fim >= p))
    .sort((a, b) => b.ini.localeCompare(a.ini))[0];
}

// ------------------------------------------------------------------ empregador
export interface InfoEmpregador {
  nome: Val;
  documento: Val;
  classTrib: Val;
  versao?: VersaoTabela;
}

export function empregador(d: Dados, per: string): InfoEmpregador {
  const [tp, nr] = d.empChave.split(':');
  const versao = vigenteEm(versoesTabela(d, 'S-1000').get(''), per);
  const cad = d.empresaCadastro();
  const compNome = d.complemento('empresa', d.empChave, 'razao_social');
  const nome: Val = cad?.razao_social
    ? { v: cad.razao_social, o: 'complementado', f: 'texto', m: { complementoId: 0, origem: 'Cadastro de empresas do sistema', informadoEm: '' } }
    : compNome
      ? vm(compNome, 'texto')
      : va('O leiaute S-1.x do eSocial não traz a razão social no S-1000; informe no cadastro da empresa.', 'texto', {
          escopo: 'empresa',
          referencia: d.empChave,
          campo: 'razao_social',
          rotulo: 'Razão social',
        });
  let documento: Val;
  if (cad?.documento_completo) {
    documento = { v: cad.documento_completo, o: 'complementado', f: tp === '1' ? 'cnpj' : 'cpf', m: { complementoId: 0, origem: 'Cadastro de empresas do sistema', informadoEm: '' } };
  } else {
    const qualquer =
      versao?.ev ?? d.todos('S-1200')[0] ?? d.todos('S-2200')[0] ?? d.todos('S-1210')[0] ?? d.todos('S-2299')[0];
    documento = qualquer
      ? {
          ...vx(qualquer, um(qualquer.raiz, 'ideEmpregador/nrInsc'), 'texto'),
          obs: 'Número de inscrição informado nos eventos (para CNPJ, normalmente a raiz de 8 posições)',
        }
      : va(`Inscrição ${tp}:${nr} sem eventos ativos`, 'texto');
  }
  return {
    nome,
    documento,
    classTrib: versao ? vx(versao.ev, um(versao.dados, 'infoCadastro/classTrib')) : va('S-1000 não importado'),
    versao,
  };
}

// ------------------------------------------------------------------ rubricas
export interface InfoRubrica {
  encontrada: boolean;
  dsc: Val;
  natRubr: Val;
  tpRubr: Val;
  codIncCP: Val;
  codIncIRRF: Val;
  codIncFGTS: Val;
  tp?: string;
  nat?: string;
  cp?: string;
  ir?: string;
  fgts?: string;
}

export function rubrica(d: Dados, codRubr: string, ideTabRubr: string, per: string): InfoRubrica {
  const v = vigenteEm(versoesTabela(d, 'S-1010').get(`${codRubr}|${ideTabRubr}`), per);
  if (!v) {
    const doRecibo = rubricaDoRecibo(d, codRubr, ideTabRubr, per);
    if (doRecibo) return doRecibo;
    const obs = `S-1010 da rubrica ${codRubr} (tabela ${ideTabRubr}) vigente em ${per} não foi importado e o recibo do eSocial não trouxe os dados dela`;
    const comp = { escopo: 'rubrica', referencia: `${codRubr}|${ideTabRubr}`, campo: 'descricao', rotulo: `Descrição da rubrica ${codRubr}` };
    const m = d.complemento(comp.escopo, comp.referencia, comp.campo);
    return {
      encontrada: false,
      dsc: m ? vm(m, 'texto') : va(obs, 'texto', comp),
      natRubr: va(obs),
      tpRubr: va(obs),
      codIncCP: va(obs),
      codIncIRRF: va(obs),
      codIncFGTS: va(obs),
    };
  }
  const dr = um(v.dados, 'dadosRubrica');
  const g = (c: string) => vx(v.ev, um(dr, c), 'texto');
  const r: InfoRubrica = {
    encontrada: true,
    dsc: g('dscRubr'),
    natRubr: g('natRubr'),
    tpRubr: g('tpRubr'),
    codIncCP: g('codIncCP'),
    codIncIRRF: g('codIncIRRF'),
    codIncFGTS: g('codIncFGTS'),
  };
  r.tp = r.tpRubr.v as string | undefined;
  r.nat = r.natRubr.v as string | undefined;
  r.cp = r.codIncCP.v as string | undefined;
  r.ir = r.codIncIRRF.v as string | undefined;
  r.fgts = r.codIncFGTS.v as string | undefined;
  return r;
}

/**
 * Dados da rubrica informados pelo eSocial no recibo do S-1200/S-1210/S-2299
 * (retornoEvento/recibo/rubricas/rubrica). O recibo do S-1200 traz natureza,
 * tipo e incidências de INSS/FGTS; o do S-1210 traz a incidência de IRRF.
 * O recibo não traz a descrição: exibe-se a natureza, e a descrição pode ser complementada.
 */
function rubricaDoRecibo(d: Dados, codRubr: string, ideTabRubr: string, per: string): InfoRubrica | undefined {
  const linhas = d.rubricasDoRecibo(codRubr, ideTabRubr);
  if (!linhas.length) return undefined;
  // prefere o recibo da mesma competência; depois o mais recente
  const ordenadas = [...linhas].sort((a, b) => Number(b.per_apur === per) - Number(a.per_apur === per) || (b.per_apur ?? '').localeCompare(a.per_apur ?? ''));
  const achar = (campo: keyof LinhaRubricaRecibo) => ordenadas.find((l) => l[campo] !== null && l[campo] !== undefined && l[campo] !== '');
  const val = (campo: keyof LinhaRubricaRecibo, atributo: string): Val => {
    const l = achar(campo);
    if (!l) return va(`O recibo não informou ${atributo} desta rubrica`, 'texto');
    return {
      v: String(l[campo]),
      o: 'xml',
      f: 'texto',
      x: {
        tipoEvento: `Recibo do ${l.tipo_evento ?? 'evento'}`,
        eventoId: l.evento_id,
        recibo: l.nr_recibo_evento ?? undefined,
        arquivo: l.arquivo ?? undefined,
        campo: `retornoEvento/recibo/rubricas/rubrica[cdR=${codRubr}]/@${atributo}`,
      },
      obs: 'Dado da rubrica informado pelo eSocial no recibo (o S-1010 não foi importado).',
    };
  };
  const natRubr = val('nat_rubr', 'ntR');
  const tpRubr = val('tp_rubr', 'tpR');
  const comp = { escopo: 'rubrica', referencia: `${codRubr}|${ideTabRubr}`, campo: 'descricao', rotulo: `Descrição da rubrica ${codRubr}` };
  const m = d.complemento(comp.escopo, comp.referencia, comp.campo);
  const nat = natRubr.v as string | undefined;
  const dsc: Val = m
    ? vm(m, 'texto')
    : {
        v: nat ? `${NAT_RUBR[nat] ?? `Natureza ${nat}`} (rubrica ${codRubr})` : `Rubrica ${codRubr}`,
        o: 'calculado',
        f: 'texto',
        c: {
          regra: 'DESCRICAO_PELA_NATUREZA',
          versao: '1',
          formula: 'O recibo do eSocial não traz a descrição da rubrica: exibida a descrição da natureza (Tabela 03). Informe a descrição da empresa ou importe o S-1010.',
          fontes: natRubr.x ? [natRubr.x] : undefined,
        },
        comp,
      };
  const r: InfoRubrica = {
    encontrada: true,
    dsc,
    natRubr,
    tpRubr,
    codIncCP: val('inc_cp', 'inCP'),
    codIncIRRF: val('inc_irrf', 'inIR'),
    codIncFGTS: val('inc_fgts', 'inFGTS'),
  };
  r.tp = r.tpRubr.v as string | undefined;
  r.nat = nat;
  r.cp = (r.codIncCP.v as string | null) ?? undefined;
  r.ir = (r.codIncIRRF.v as string | null) ?? undefined;
  r.fgts = (r.codIncFGTS.v as string | null) ?? undefined;
  return r;
}

export function descricaoTipo(tp?: string) {
  if (tp === '1') return 'Provento';
  if (tp === '2') return 'Desconto';
  if (tp === '3' || tp === '4') return 'Informativa';
  return tp ? descrever(TP_RUBR, tp) : '—';
}

// ------------------------------------------------------------------ vínculos e cadastro
export interface Vinculo {
  cpf: string;
  matricula?: string;
  origem: 'S-2200' | 'S-2300';
  ev: EvCarregado;
  dtInicio?: string;
  codCateg?: string;
}

export function vinculos(d: Dados): Vinculo[] {
  const r: Vinculo[] = [];
  for (const ev of d.todos('S-2200')) {
    r.push({
      cpf: ev.cpf!,
      matricula: ev.matricula,
      origem: 'S-2200',
      ev,
      dtInicio: ev.dataRef,
      codCateg: txt(ev.raiz, 'vinculo/infoContrato/codCateg'),
    });
  }
  for (const ev of d.todos('S-2300')) {
    r.push({
      cpf: ev.cpf!,
      matricula: ev.matricula,
      origem: 'S-2300',
      ev,
      dtInicio: ev.dataRef,
      codCateg: txt(ev.raiz, 'infoTSVInicio/codCateg'),
    });
  }
  return r;
}

export function vinculoDe(d: Dados, cpf: string, matricula?: string): Vinculo | undefined {
  const lista = vinculos(d).filter((v) => v.cpf === cpf);
  return lista.find((v) => matricula && v.matricula === matricula) ?? lista[0];
}

export interface Cadastro {
  nome: Val;
  nascimento: Val;
  dependentesIrrf: number | null;
  dependentesVal: Val;
}

export function cadastro(d: Dados, cpf: string, ateData: string, nomeRemun?: { ev: EvCarregado; c?: Ctx }): Cadastro {
  const adm = d.doTrabalhador('S-2200', cpf)[0] ?? d.doTrabalhador('S-2300', cpf)[0];
  const alt = d
    .doTrabalhador('S-2205', cpf)
    .filter((e) => (e.dataRef ?? '') <= ateData)
    .sort((a, b) => (a.dataRef ?? '').localeCompare(b.dataRef ?? '') || a.ordem.localeCompare(b.ordem))
    .pop();
  const altDados = alt ? um(alt.raiz, 'alteracao/dadosTrabalhador') : undefined;
  const trab = adm ? um(adm.raiz, 'trabalhador') : undefined;

  let nome: Val;
  if (alt && um(altDados, 'nmTrab')) nome = vx(alt, um(altDados, 'nmTrab'), 'texto');
  else if (adm && um(trab, 'nmTrab')) nome = vx(adm, um(trab, 'nmTrab'), 'texto');
  else if (nomeRemun?.c) nome = vx(nomeRemun.ev, nomeRemun.c, 'texto');
  else {
    const comp = d.complemento('trabalhador', cpf, 'nome');
    nome = comp
      ? vm(comp, 'texto')
      : va('Nome não encontrado (S-2200/S-2205/S-2300 não importados e S-1200 sem infoComplem)', 'texto', {
          escopo: 'trabalhador',
          referencia: cpf,
          campo: 'nome',
          rotulo: 'Nome do trabalhador',
        });
  }
  const nascimento = alt && um(altDados, 'nascimento/dtNascto')
    ? vx(alt, um(altDados, 'nascimento/dtNascto'), 'data')
    : adm
      ? vx(adm, um(trab, 'nascimento/dtNascto'), 'data')
      : va('S-2200 não importado', 'data');

  const fonteDeps = alt && sel(altDados, 'dependente').length ? { ev: alt, c: altDados } : adm ? { ev: adm, c: trab } : undefined;
  let dependentesIrrf: number | null = null;
  let dependentesVal: Val = va('Dependentes não conhecidos: S-2200/S-2205 não importado', 'inteiro', {
    escopo: 'trabalhador',
    referencia: cpf,
    campo: 'dependentes_irrf',
    rotulo: 'Quantidade de dependentes para IRRF',
  });
  const compDeps = d.complemento('trabalhador', cpf, 'dependentes_irrf');
  if (compDeps && Number.isInteger(Number(compDeps.valor))) {
    dependentesIrrf = Number(compDeps.valor);
    dependentesVal = vm(compDeps, 'inteiro');
  }
  if (fonteDeps) {
    const deps = sel(fonteDeps.c, 'dependente').filter((x) => txt(x, 'depIRRF') === 'S');
    dependentesIrrf = deps.length;
    dependentesVal = {
      v: deps.length,
      o: 'calculado',
      f: 'inteiro',
      c: {
        regra: 'CONTAGEM_DEPENDENTES_IRRF',
        versao: '1',
        formula: 'Quantidade de grupos "dependente" com depIRRF = S no cadastro vigente',
        fontes: [{ tipoEvento: fonteDeps.ev.tipo, eventoId: fonteDeps.ev.eventoId, recibo: fonteDeps.ev.recibo, arquivo: fonteDeps.ev.arquivo, campo: `${fonteDeps.c!.caminho}/dependente` }],
      },
    };
  }
  return { nome, nascimento, dependentesIrrf, dependentesVal };
}

export interface Contrato {
  cargo: Val;
  cbo: Val;
  salario: Val;
  undSalFixo: Val;
  codCateg: Val;
  dtAdm: Val;
  tpContr: Val;
  origem?: EvCarregado;
}

export function contrato(d: Dados, cpf: string, matricula: string | undefined, ateData: string): Contrato {
  const adm = d.doTrabalhador('S-2200', cpf).find((e) => !matricula || e.matricula === matricula);
  if (adm) {
    const alt = d
      .doTrabalhador('S-2206', cpf)
      .filter((e) => (!matricula || e.matricula === matricula) && (e.dataRef ?? '') <= ateData)
      .sort((a, b) => (a.dataRef ?? '').localeCompare(b.dataRef ?? '') || a.ordem.localeCompare(b.ordem))
      .pop();
    const fonte = alt ?? adm;
    const ic = um(fonte.raiz, alt ? 'altContratual/infoContrato' : 'vinculo/infoContrato');
    return {
      cargo: vx(fonte, um(ic, 'nmCargo'), 'texto'),
      cbo: vx(fonte, um(ic, 'CBOCargo'), 'texto'),
      salario: vx(fonte, um(ic, 'remuneracao/vrSalFx'), 'moeda'),
      undSalFixo: vx(fonte, um(ic, 'remuneracao/undSalFixo'), 'texto'),
      codCateg: vx(fonte, um(ic, 'codCateg'), 'texto'),
      tpContr: vx(fonte, um(ic, 'duracao/tpContr'), 'texto'),
      dtAdm: vx(
        adm,
        um(adm.raiz, 'vinculo/infoRegimeTrab/infoCeletista/dtAdm') ?? um(adm.raiz, 'vinculo/infoRegimeTrab/infoEstatutario/dtExercicio'),
        'data',
      ),
      origem: fonte,
    };
  }
  const tsv = d.doTrabalhador('S-2300', cpf).find((e) => !matricula || e.matricula === matricula);
  if (tsv) {
    const info = um(tsv.raiz, 'infoTSVInicio');
    return {
      cargo: vx(tsv, um(info, 'infoComplementares/cargoFuncao/nmCargo'), 'texto'),
      cbo: vx(tsv, um(info, 'infoComplementares/cargoFuncao/CBOCargo'), 'texto'),
      salario: vx(tsv, um(info, 'infoComplementares/remuneracao/vrSalFx'), 'moeda'),
      undSalFixo: vx(tsv, um(info, 'infoComplementares/remuneracao/undSalFixo'), 'texto'),
      codCateg: vx(tsv, um(info, 'codCateg'), 'texto'),
      tpContr: va('Não se aplica a TSVE', 'texto'),
      dtAdm: vx(tsv, um(info, 'dtInicio'), 'data'),
      origem: tsv,
    };
  }
  // Sem S-2200/S-2300: usa a alteração contratual (S-2206) mais recente, se houver,
  // e os complementos informados pelo usuário para o que faltar.
  const obs = 'Vínculo não encontrado: S-2200/S-2300 do trabalhador não foi importado';
  const alt = d
    .doTrabalhador('S-2206', cpf)
    .filter((e) => (!matricula || e.matricula === matricula) && (e.dataRef ?? '') <= ateData)
    .sort((a, b) => (a.dataRef ?? '').localeCompare(b.dataRef ?? '') || a.ordem.localeCompare(b.ordem))
    .pop();
  const ic = alt ? um(alt.raiz, 'altContratual/infoContrato') : undefined;
  const doXmlOuComp = (caminho: string | null, campo: string, rotulo: string, f: Val['f']): Val => {
    if (alt && caminho) {
      const x = vx(alt, um(ic, caminho), f);
      if (x.o === 'xml') return x;
    }
    const m = d.complemento('trabalhador', cpf, campo);
    if (m) return vm(m, f);
    return va(alt ? `${rotulo} não consta no S-2206 importado e o S-2200 não foi importado` : obs, f, {
      escopo: 'trabalhador',
      referencia: cpf,
      campo,
      rotulo,
    });
  };
  const salario = doXmlOuComp('remuneracao/vrSalFx', 'salario', 'Salário mensal (R$)', 'moeda');
  let undSalFixo = alt ? vx(alt, um(ic, 'remuneracao/undSalFixo'), 'texto') : va(obs, 'texto');
  // salário complementado é informado como mensal
  if (salario.o === 'complementado' && undSalFixo.o === 'ausente') undSalFixo = { ...salario, v: '5', f: 'texto' };
  return {
    cargo: doXmlOuComp('nmCargo', 'cargo', 'Cargo', 'texto'),
    cbo: doXmlOuComp('CBOCargo', 'cbo', 'CBO', 'texto'),
    salario,
    undSalFixo,
    codCateg: alt ? vx(alt, um(ic, 'codCateg'), 'texto') : va(obs, 'texto'),
    tpContr: alt ? vx(alt, um(ic, 'duracao/tpContr'), 'texto') : va(obs, 'texto'),
    dtAdm: doXmlOuComp(null, 'data_admissao', 'Data de admissão', 'data'),
    origem: alt,
  };
}

// ------------------------------------------------------------------ afastamentos e desligamento
export interface Afastamento {
  ini?: string;
  fim?: string;
  codMot?: string;
  perAquisIni?: string;
  perAquisFim?: string;
  evIni?: EvCarregado;
  evFim?: EvCarregado;
  ctxIni?: Ctx;
  ctxFim?: Ctx;
}

export function afastamentos(d: Dados, cpf: string, matricula?: string): Afastamento[] {
  const evs = d
    .doTrabalhador('S-2230', cpf)
    .filter((e) => !matricula || !e.matricula || e.matricula === matricula)
    .sort((a, b) => (a.dataRef ?? '').localeCompare(b.dataRef ?? '') || a.ordem.localeCompare(b.ordem));
  const lista: Afastamento[] = [];
  for (const ev of evs) {
    const ini = um(ev.raiz, 'infoAfastamento/iniAfastamento');
    const fim = um(ev.raiz, 'infoAfastamento/fimAfastamento');
    if (ini) {
      lista.push({
        ini: txt(ini, 'dtIniAfast'),
        codMot: txt(ini, 'codMotAfast'),
        perAquisIni: txt(ini, 'perAquis/dtInicio'),
        perAquisFim: txt(ini, 'perAquis/dtFim'),
        evIni: ev,
        ctxIni: ini,
        ...(fim ? { fim: txt(fim, 'dtTermAfast'), evFim: ev, ctxFim: fim } : {}),
      });
    } else if (fim) {
      const dt = txt(fim, 'dtTermAfast');
      const aberto = [...lista].reverse().find((a) => !a.fim && (a.ini ?? '') <= (dt ?? ''));
      if (aberto) Object.assign(aberto, { fim: dt, evFim: ev, ctxFim: fim });
      else lista.push({ fim: dt, evFim: ev, ctxFim: fim });
    }
  }
  return lista;
}

export const ehFerias = (a: Afastamento) => a.codMot === COD_MOT_AFAST_FERIAS;
export const descricaoAfastamento = (cod?: string) => (cod ? (MOT_AFAST[cod] ?? `motivo ${cod}`) : 'motivo não informado');

export function desligamento(d: Dados, cpf: string, matricula?: string): EvCarregado | undefined {
  return (
    d.doTrabalhador('S-2299', cpf).find((e) => !matricula || e.matricula === matricula) ??
    d.doTrabalhador('S-2399', cpf).find((e) => !matricula || !e.matricula || e.matricula === matricula)
  );
}
