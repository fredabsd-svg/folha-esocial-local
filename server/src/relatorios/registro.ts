/**
 * Catálogo de relatórios: parâmetros, formatos e mapeamento campo a campo
 * entre o modelo e os dados dos eventos (origem de cada informação).
 */
import type { DefinicaoRelatorio, Documento, ItemMapaCampo, ParametroRelatorio } from '../compartilhado/tipos.js';
import type { Contexto } from './base.js';
import {
  admissoesDesligamentos,
  avisoReciboFerias,
  eventosAusentes,
  relatorioRescisao,
  remuneracoesPagamentos,
  rubricasPorCompetencia,
} from './relatorios-eventos.js';
import { divergencias, extratoMensal, movimentos, reciboPagamento, relacaoLiquidos, resumoMensal } from './relatorios-folha.js';

const P = {
  competencia: { id: 'competencia', rotulo: 'Competência', tipo: 'competencia', obrigatorio: true } as ParametroRelatorio,
  indApuracao: {
    id: 'indApuracao',
    rotulo: 'Apuração',
    tipo: 'selecao',
    padrao: '1',
    opcoes: [
      { valor: '1', rotulo: 'Mensal' },
      { valor: '2', rotulo: 'Anual (13º salário) — informe a competência como AAAA' },
    ],
  } as ParametroRelatorio,
  periodo: { id: 'periodo', rotulo: 'Período (competência inicial e final)', tipo: 'periodo', obrigatorio: true } as ParametroRelatorio,
  trabalhador: { id: 'trabalhador', rotulo: 'Trabalhador (nome, CPF ou matrícula)', tipo: 'trabalhador' } as ParametroRelatorio,
  ordenar: {
    id: 'ordenar',
    rotulo: 'Ordenar por',
    tipo: 'selecao',
    padrao: 'nome',
    opcoes: [
      { valor: 'nome', rotulo: 'Nome' },
      { valor: 'matricula', rotulo: 'Matrícula' },
      { valor: 'cpf', rotulo: 'CPF' },
      { valor: 'valor', rotulo: 'Líquido (maior primeiro)' },
    ],
  } as ParametroRelatorio,
  agrupar: {
    id: 'agrupar',
    rotulo: 'Agrupar por',
    tipo: 'selecao',
    padrao: 'nenhum',
    opcoes: [
      { valor: 'nenhum', rotulo: 'Sem agrupamento' },
      { valor: 'estabelecimento', rotulo: 'Estabelecimento' },
      { valor: 'lotacao', rotulo: 'Lotação tributária' },
      { valor: 'categoria', rotulo: 'Categoria do trabalhador' },
    ],
  } as ParametroRelatorio,
  mascararCpf: { id: 'mascararCpf', rotulo: 'Mascarar CPF', tipo: 'booleano', padrao: false } as ParametroRelatorio,
  informativas: { id: 'incluirInformativas', rotulo: 'Incluir rubricas informativas', tipo: 'booleano', padrao: false } as ParametroRelatorio,
};

const XML = 'XML' as const;
const CALC = 'Calculado' as const;
const COMP = 'Complementado' as const;

const MAPA_TRABALHADOR: ItemMapaCampo[] = [
  { campo: 'Empresa — razão social', classe: COMP, observacao: 'O S-1000 (leiaute S-1.x) não traz a razão social; vem do cadastro da empresa no sistema.' },
  { campo: 'Empresa — inscrição', classe: 'XML ou Complementado', eventos: 'Todos', caminho: 'ideEmpregador/nrInsc' },
  { campo: 'Nome do trabalhador', classe: 'XML ou Complementado', eventos: 'S-2205 › S-2200 › S-2300 › S-1200', caminho: 'dadosTrabalhador/nmTrab · trabalhador/nmTrab · ideTrabalhador/infoComplem/nmTrab' },
  { campo: 'CPF', classe: XML, eventos: 'S-1200 / S-2299', caminho: 'ideTrabalhador/cpfTrab · ideVinculo/cpfTrab' },
  { campo: 'Matrícula', classe: XML, eventos: 'S-1200', caminho: 'dmDev/infoPerApur/ideEstabLot/remunPerApur/matricula' },
  { campo: 'Categoria', classe: XML, eventos: 'S-1200', caminho: 'dmDev/codCateg' },
  { campo: 'Admissão', classe: XML, eventos: 'S-2200', caminho: 'vinculo/infoRegimeTrab/infoCeletista/dtAdm' },
  { campo: 'Cargo / CBO / salário', classe: XML, eventos: 'S-2206 vigente › S-2200', caminho: 'infoContrato/nmCargo, CBOCargo, remuneracao/vrSalFx, undSalFixo' },
  { campo: 'Situação na competência', classe: CALC, eventos: 'S-2299, S-2230, S-2200', regra: 'SITUACAO_COMPETENCIA v1' },
  { campo: 'Dependentes para IRRF', classe: CALC, eventos: 'S-2205 › S-2200', caminho: 'dependente/depIRRF = S', regra: 'CONTAGEM_DEPENDENTES_IRRF v1' },
];

const MAPA_RUBRICAS: ItemMapaCampo[] = [
  { campo: 'Código da rubrica / tabela', classe: XML, eventos: 'S-1200 / S-2299', caminho: 'itensRemun/codRubr, ideTabRubr · detVerbas/codRubr' },
  { campo: 'Descrição, natureza, tipo, incidências', classe: XML, eventos: 'S-1010 vigente na competência', caminho: 'dadosRubrica/dscRubr, natRubr, tpRubr, codIncCP, codIncIRRF, codIncFGTS' },
  { campo: 'Referência (quantidade/fator)', classe: XML, eventos: 'S-1200 / S-2299', caminho: 'qtdRubr · fatorRubr' },
  { campo: 'Valor informado', classe: XML, eventos: 'S-1200 / S-2299', caminho: 'vrRubr' },
  { campo: 'Proventos / descontos / informativas', classe: CALC, regra: 'TOTAIS_DEMONSTRATIVO v1', observacao: 'Somatório por tpRubr (1, 2, 3/4) do S-1010.' },
  { campo: 'Líquido calculado', classe: CALC, regra: 'LIQUIDO v1', observacao: 'Proventos − descontos.' },
  { campo: 'Líquido pago e data do pagamento', classe: XML, eventos: 'S-1210', caminho: 'ideBenef/infoPgto/vrLiq, dtPgto (casado por perRef + ideDmDev)' },
];

const MAPA_BASES: ItemMapaCampo[] = [
  { campo: 'Base do INSS (eSocial)', classe: XML, eventos: 'S-5001', caminho: 'infoCp/.../infoBaseCS (ind13, tpValor = 11, valor)' },
  { campo: 'INSS calculado / descontado (eSocial)', classe: XML, eventos: 'S-5001', caminho: 'infoCpCalc/vrCpSeg, vrDescSeg' },
  { campo: 'Base do INSS (rubricas)', classe: CALC, regra: 'BASE_INSS_RUBRICAS v1', observacao: 'Σ proventos − Σ descontos com codIncCP 11/15/21.' },
  { campo: 'INSS recalculado', classe: CALC, regra: 'INSS_PROGRESSIVO v2', observacao: 'Tabela do INSS vigente na competência (Configurações › Tabelas); cada faixa truncada em centavos, como no S-5001.' },
  { campo: 'Base e depósito do FGTS (eSocial)', classe: XML, eventos: 'S-5003', caminho: 'infoBaseFGTS/basePerApur/remFGTS, dpsFGTS' },
  { campo: 'FGTS recalculado', classe: CALC, regra: 'FGTS_DEPOSITO v1', observacao: '8% (2% para aprendiz, categoria 103).' },
  { campo: 'Base / IRRF recalculado', classe: CALC, regra: 'IRRF_PROGRESSIVO v1', observacao: 'Tabela progressiva, dependentes, desconto simplificado e redutor da Lei 15.270/2025 quando vigentes.' },
  { campo: 'IRRF retido', classe: XML, eventos: 'S-1200', caminho: 'rubricas com codIncIRRF 31/32/33' },
];

interface Registro extends DefinicaoRelatorio {
  gerar: (cx: Contexto) => Documento;
}

export const RELATORIOS: Registro[] = [
  {
    tipo: 'extrato',
    titulo: 'Extrato mensal',
    descricao: 'Por trabalhador: empresa, competência, vínculo, situação, cargo, salário, rubricas, proventos, descontos, bases, líquido e conferências.',
    referencia: true,
    parametros: [P.competencia, P.indApuracao, P.trabalhador, P.ordenar, P.mascararCpf, P.informativas],
    mapaCampos: [...MAPA_TRABALHADOR, ...MAPA_RUBRICAS, ...MAPA_BASES],
    formatos: ['pdf', 'xlsx', 'csv'],
    gerar: extratoMensal,
  },
  {
    tipo: 'movimentos',
    titulo: 'Movimentos',
    descricao: 'Rubricas por trabalhador com código, descrição, referência, valor informado, valor calculado, tipo, estabelecimento/lotação, subtotais e totais.',
    referencia: true,
    parametros: [P.competencia, P.indApuracao, P.trabalhador, P.ordenar, P.informativas],
    mapaCampos: [
      ...MAPA_RUBRICAS,
      { campo: 'Valor calculado', classe: CALC, regra: 'INSS_PROGRESSIVO v2 / IRRF_PROGRESSIVO v1', observacao: 'Somente para a rubrica de INSS (codIncCP 31) e de IRRF (codIncIRRF 31/32/33); demais rubricas: "—".' },
      { campo: 'Estabelecimento / lotação', classe: XML, eventos: 'S-1200', caminho: 'ideEstabLot/nrInsc, codLotacao' },
    ],
    formatos: ['pdf', 'xlsx', 'csv'],
    gerar: movimentos,
  },
  {
    tipo: 'recibo',
    titulo: 'Recibo de pagamento',
    descricao: 'Demonstrativo individual (holerite) por demonstrativo do S-1200, com vencimentos, descontos, líquido, bases e campo de assinatura.',
    referencia: true,
    parametros: [P.competencia, P.indApuracao, P.trabalhador, P.ordenar, P.mascararCpf, P.informativas],
    mapaCampos: [...MAPA_TRABALHADOR.filter((m) => !m.campo.startsWith('Situação')), ...MAPA_RUBRICAS, ...MAPA_BASES],
    formatos: ['pdf', 'xlsx', 'csv'],
    gerar: reciboPagamento,
  },
  {
    tipo: 'liquidos',
    titulo: 'Relação geral dos líquidos',
    descricao: 'Líquido por trabalhador, quantidade de pessoas por grupo e total da empresa.',
    referencia: true,
    parametros: [
      P.competencia,
      P.indApuracao,
      P.agrupar,
      P.ordenar,
      {
        id: 'fonteLiquido',
        rotulo: 'Líquido a apresentar',
        tipo: 'selecao',
        padrao: 'pago',
        opcoes: [
          { valor: 'pago', rotulo: 'Pago (S-1210), com cálculo quando ausente' },
          { valor: 'calculado', rotulo: 'Calculado (proventos − descontos)' },
        ],
      },
      P.mascararCpf,
    ],
    mapaCampos: [
      { campo: 'Nome, CPF, matrícula', classe: XML, eventos: 'S-2200 / S-1200' },
      { campo: 'Líquido pago', classe: XML, eventos: 'S-1210', caminho: 'infoPgto/vrLiq' },
      { campo: 'Líquido calculado (fallback)', classe: CALC, regra: 'LIQUIDO v1' },
      { campo: 'Quantidade por grupo / total', classe: CALC, regra: 'SOMA_LIQUIDOS v1' },
    ],
    formatos: ['pdf', 'xlsx', 'csv'],
    gerar: relacaoLiquidos,
  },
  {
    tipo: 'resumo',
    titulo: 'Resumo mensal da folha',
    descricao: 'Rubricas agrupadas em proventos, descontos e informativas, quantidade de trabalhadores, valores informados e calculados, totais, bases e totalizadores.',
    referencia: true,
    parametros: [P.competencia, P.indApuracao],
    mapaCampos: [
      ...MAPA_RUBRICAS,
      { campo: 'Qtd. de trabalhadores por rubrica', classe: CALC, regra: 'Contagem de CPFs distintos' },
      { campo: 'Totais por grupo', classe: CALC, regra: 'SOMA_RUBRICA v1' },
      ...MAPA_BASES,
      { campo: 'Totalizadores da empresa', classe: XML, eventos: 'S-5011 / S-5013', caminho: 'infoCRContrib/tpCR, vrCR' },
      { campo: 'Fechamento', classe: XML, eventos: 'S-1299 / S-1298' },
    ],
    formatos: ['pdf', 'xlsx', 'csv'],
    gerar: resumoMensal,
  },
  {
    tipo: 'ferias',
    titulo: 'Aviso e recibo de férias',
    descricao: 'Período aquisitivo e de gozo (S-2230), rubricas de férias do S-1200, bases, proventos, descontos, líquido e campos de ciência/assinatura.',
    referencia: true,
    parametros: [P.competencia, P.trabalhador, P.mascararCpf, P.informativas],
    mapaCampos: [
      { campo: 'Período aquisitivo', classe: XML, eventos: 'S-2230', caminho: 'iniAfastamento/perAquis/dtInicio, dtFim' },
      { campo: 'Início / término do gozo', classe: XML, eventos: 'S-2230 (codMotAfast 15)', caminho: 'iniAfastamento/dtIniAfast · fimAfastamento/dtTermAfast' },
      { campo: 'Dias de gozo / retorno', classe: CALC, regra: 'DIAS_GOZO v1 / DATA_RETORNO v1' },
      { campo: 'Data do aviso, abono pecuniário, médias', classe: COMP, observacao: 'Não são transmitidos ao eSocial; informe como complemento.' },
      { campo: 'Rubricas de férias', classe: XML, eventos: 'S-1200 (demonstrativo com natureza 1016/1017 ou codIncIRRF 13)' },
      { campo: 'Líquido pago / data', classe: XML, eventos: 'S-1210' },
      { campo: 'IRRF sobre férias (recálculo)', classe: CALC, regra: 'IRRF_PROGRESSIVO v1 (tipo férias)' },
    ],
    formatos: ['pdf', 'xlsx', 'csv'],
    gerar: avisoReciboFerias,
  },
  {
    tipo: 'rescisao',
    titulo: 'Relatório de rescisão',
    descricao: 'Dados do desligamento, verbas, descontos, bases, líquido, memória de cálculo de conferência e pendências.',
    referencia: true,
    parametros: [P.competencia, P.trabalhador, P.mascararCpf, P.informativas],
    mapaCampos: [
      { campo: 'Motivo, datas, aviso, projeção, pensão', classe: XML, eventos: 'S-2299', caminho: 'infoDeslig/mtvDeslig, dtDeslig, dtAvPrv, indPagtoAPI, dtProjFimAPI, pensAlim' },
      { campo: 'Verbas rescisórias', classe: XML, eventos: 'S-2299', caminho: 'verbasResc/dmDev/.../detVerbas' },
      { campo: 'Líquido pago / data', classe: XML, eventos: 'S-1210 (tpPgto 2)' },
      { campo: 'Prazo de pagamento', classe: CALC, regra: 'PRAZO_PAGAMENTO_RESCISAO v1 (CLT art. 477 § 6º)' },
      { campo: 'Aviso proporcional, saldo, 13º, férias, avos', classe: CALC, regra: 'AVISO_PROPORCIONAL, SALDO_SALARIO, AVOS_13, AVOS_FERIAS, DECIMO_PROPORCIONAL, FERIAS_PROPORCIONAIS (v1)' },
      { campo: 'Médias e saldo do FGTS', classe: COMP, observacao: 'Não constam nos XMLs.' },
      { campo: 'Multa do FGTS', classe: CALC, regra: 'MULTA_FGTS v1', observacao: 'Somente com saldo do FGTS complementado.' },
      ...MAPA_BASES.filter((m) => !m.campo.includes('IRRF')),
    ],
    formatos: ['pdf', 'xlsx', 'csv'],
    gerar: relatorioRescisao,
  },
  {
    tipo: 'admissoes_desligamentos',
    titulo: 'Admissões e desligamentos',
    descricao: 'Histórico de admissões (S-2200/S-2300) e desligamentos (S-2299/S-2399) no período.',
    referencia: false,
    parametros: [P.periodo, P.mascararCpf],
    mapaCampos: [
      { campo: 'Data e tipo do movimento', classe: XML, eventos: 'S-2200, S-2300, S-2299, S-2399' },
      { campo: 'Cargo e salário na data', classe: XML, eventos: 'S-2206 vigente › S-2200' },
      { campo: 'Motivo do desligamento', classe: XML, eventos: 'S-2299', caminho: 'infoDeslig/mtvDeslig' },
    ],
    formatos: ['pdf', 'xlsx', 'csv'],
    gerar: admissoesDesligamentos,
  },
  {
    tipo: 'remuneracoes_pagamentos',
    titulo: 'Remunerações e pagamentos',
    descricao: 'Por competência e demonstrativo: líquido calculado (S-1200/S-2299) × líquido pago (S-1210).',
    referencia: false,
    parametros: [P.periodo, P.trabalhador],
    mapaCampos: [...MAPA_RUBRICAS],
    formatos: ['pdf', 'xlsx', 'csv'],
    gerar: remuneracoesPagamentos,
  },
  {
    tipo: 'rubricas_competencia',
    titulo: 'Rubricas por competência',
    descricao: 'Matriz de rubricas × competências com o somatório dos valores informados.',
    referencia: false,
    parametros: [P.periodo, P.trabalhador],
    mapaCampos: [{ campo: 'Valores por competência', classe: CALC, regra: 'SOMA_RUBRICA_COMPETENCIA v1', observacao: 'Σ vrRubr (XML) por rubrica e competência.' }],
    formatos: ['pdf', 'xlsx', 'csv'],
    gerar: rubricasPorCompetencia,
  },
  {
    tipo: 'eventos_ausentes',
    titulo: 'Eventos ausentes e pendências',
    descricao: 'Vínculos sem remuneração, remunerações sem pagamento, tabelas ausentes, fechamento, duplicidades, retificações sem original e dados ausentes.',
    referencia: false,
    parametros: [P.competencia, P.mascararCpf],
    mapaCampos: [{ campo: 'Pendências', classe: CALC, regra: 'Verificações determinísticas sobre os eventos importados' }],
    formatos: ['pdf', 'xlsx', 'csv'],
    gerar: eventosAusentes,
  },
  {
    tipo: 'divergencias',
    titulo: 'Divergências',
    descricao: 'Conferências entre valores do XML e recálculo (líquido, bases, INSS, FGTS, IRRF) e duplicidades sem recibo.',
    referencia: false,
    parametros: [P.competencia, P.indApuracao, P.trabalhador, { id: 'incluirConferidos', rotulo: 'Incluir conferências sem divergência', tipo: 'booleano', padrao: false }],
    mapaCampos: [...MAPA_BASES, { campo: 'Situação', classe: CALC, regra: 'comparar(): tolerância configurável (padrão R$ 0,01)' }],
    formatos: ['pdf', 'xlsx', 'csv'],
    gerar: divergencias,
  },
];

export function definicoes(): DefinicaoRelatorio[] {
  return RELATORIOS.map(({ gerar: _g, ...def }) => def);
}

export function obterRelatorio(tipo: string) {
  return RELATORIOS.find((r) => r.tipo === tipo);
}
