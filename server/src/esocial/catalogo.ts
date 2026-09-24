/**
 * Catálogo de eventos e de códigos do eSocial usados pelo sistema.
 *
 * As descrições são resumidas e servem para leitura dos relatórios. Somente
 * códigos cuja semântica é usada por alguma regra estão listados; os demais
 * aparecem nos relatórios apenas pelo código. Confira sempre as tabelas do
 * leiaute vigente (Documentação Técnica do eSocial) — a versão de referência
 * desta implementação é o leiaute S-1.3.
 */

export type GrupoEvento = 'tabela' | 'nao_periodico' | 'periodico' | 'totalizador' | 'exclusao' | 'outro';

export interface InfoEvento {
  codigo: string;
  nome: string;
  grupo: GrupoEvento;
}

export const EVENTOS: Record<string, InfoEvento> = {
  evtInfoEmpregador: { codigo: 'S-1000', nome: 'Informações do empregador/contribuinte', grupo: 'tabela' },
  evtTabEstab: { codigo: 'S-1005', nome: 'Tabela de estabelecimentos, obras ou unidades de órgãos públicos', grupo: 'tabela' },
  evtTabRubrica: { codigo: 'S-1010', nome: 'Tabela de rubricas', grupo: 'tabela' },
  evtTabLotacao: { codigo: 'S-1020', nome: 'Tabela de lotações tributárias', grupo: 'tabela' },
  evtTabProcesso: { codigo: 'S-1070', nome: 'Tabela de processos administrativos/judiciais', grupo: 'tabela' },
  evtRemun: { codigo: 'S-1200', nome: 'Remuneração de trabalhador vinculado ao RGPS', grupo: 'periodico' },
  evtRmnRPPS: { codigo: 'S-1202', nome: 'Remuneração de servidor vinculado ao RPPS', grupo: 'periodico' },
  evtBenPrRP: { codigo: 'S-1207', nome: 'Benefícios - entes públicos', grupo: 'periodico' },
  evtPgtos: { codigo: 'S-1210', nome: 'Pagamentos de rendimentos do trabalho', grupo: 'periodico' },
  evtComProd: { codigo: 'S-1260', nome: 'Comercialização da produção rural pessoa física', grupo: 'periodico' },
  evtContratAvNP: { codigo: 'S-1270', nome: 'Contratação de trabalhadores avulsos não portuários', grupo: 'periodico' },
  evtInfoComplPer: { codigo: 'S-1280', nome: 'Informações complementares aos eventos periódicos', grupo: 'periodico' },
  evtReabreEvPer: { codigo: 'S-1298', nome: 'Reabertura dos eventos periódicos', grupo: 'periodico' },
  evtFechaEvPer: { codigo: 'S-1299', nome: 'Fechamento dos eventos periódicos', grupo: 'periodico' },
  evtAdmPrelim: { codigo: 'S-2190', nome: 'Registro preliminar de trabalhador', grupo: 'nao_periodico' },
  evtAdmissao: { codigo: 'S-2200', nome: 'Cadastramento inicial do vínculo e admissão/ingresso de trabalhador', grupo: 'nao_periodico' },
  evtAltCadastral: { codigo: 'S-2205', nome: 'Alteração de dados cadastrais do trabalhador', grupo: 'nao_periodico' },
  evtAltContratual: { codigo: 'S-2206', nome: 'Alteração de contrato de trabalho/relação estatutária', grupo: 'nao_periodico' },
  evtCAT: { codigo: 'S-2210', nome: 'Comunicação de acidente de trabalho', grupo: 'nao_periodico' },
  evtMonit: { codigo: 'S-2220', nome: 'Monitoramento da saúde do trabalhador', grupo: 'nao_periodico' },
  evtToxic: { codigo: 'S-2221', nome: 'Exame toxicológico do motorista profissional', grupo: 'nao_periodico' },
  evtAfastTemp: { codigo: 'S-2230', nome: 'Afastamento temporário', grupo: 'nao_periodico' },
  evtCessao: { codigo: 'S-2231', nome: 'Cessão/exercício em outro órgão', grupo: 'nao_periodico' },
  evtExpRisco: { codigo: 'S-2240', nome: 'Condições ambientais do trabalho - agentes nocivos', grupo: 'nao_periodico' },
  evtReintegr: { codigo: 'S-2298', nome: 'Reintegração/outros provimentos', grupo: 'nao_periodico' },
  evtDeslig: { codigo: 'S-2299', nome: 'Desligamento', grupo: 'nao_periodico' },
  evtTSVInicio: { codigo: 'S-2300', nome: 'Trabalhador sem vínculo de emprego/estatutário - início', grupo: 'nao_periodico' },
  evtTSVAltContr: { codigo: 'S-2306', nome: 'Trabalhador sem vínculo de emprego/estatutário - alteração contratual', grupo: 'nao_periodico' },
  evtTSVTermino: { codigo: 'S-2399', nome: 'Trabalhador sem vínculo de emprego/estatutário - término', grupo: 'nao_periodico' },
  evtCdBenefIn: { codigo: 'S-2400', nome: 'Cadastro de beneficiário - entes públicos', grupo: 'nao_periodico' },
  evtCdBenefAlt: { codigo: 'S-2405', nome: 'Alteração de dados cadastrais do beneficiário', grupo: 'nao_periodico' },
  evtCdBenIn: { codigo: 'S-2410', nome: 'Cadastro de benefício - entes públicos', grupo: 'nao_periodico' },
  evtCdBenAlt: { codigo: 'S-2416', nome: 'Alteração do cadastro de benefício', grupo: 'nao_periodico' },
  evtReativBen: { codigo: 'S-2418', nome: 'Reativação de benefício', grupo: 'nao_periodico' },
  evtCdBenTerm: { codigo: 'S-2420', nome: 'Cadastro de benefício - término', grupo: 'nao_periodico' },
  evtProcTrab: { codigo: 'S-2500', nome: 'Processo trabalhista', grupo: 'nao_periodico' },
  evtContProc: { codigo: 'S-2501', nome: 'Informações de tributos decorrentes de processo trabalhista', grupo: 'nao_periodico' },
  evtConsolidContProc: { codigo: 'S-2555', nome: 'Solicitação de consolidação das informações de tributos decorrentes de processo trabalhista', grupo: 'nao_periodico' },
  evtExclusao: { codigo: 'S-3000', nome: 'Exclusão de eventos', grupo: 'exclusao' },
  evtExcProcTrab: { codigo: 'S-3500', nome: 'Exclusão de eventos - processo trabalhista', grupo: 'exclusao' },
  evtBasesTrab: { codigo: 'S-5001', nome: 'Informações das contribuições sociais por trabalhador', grupo: 'totalizador' },
  evtIrrfBenef: { codigo: 'S-5002', nome: 'Imposto de renda retido na fonte por trabalhador', grupo: 'totalizador' },
  evtBasesFGTS: { codigo: 'S-5003', nome: 'Informações do FGTS por trabalhador', grupo: 'totalizador' },
  evtCS: { codigo: 'S-5011', nome: 'Informações das contribuições sociais consolidadas por contribuinte', grupo: 'totalizador' },
  evtIrrf: { codigo: 'S-5012', nome: 'Imposto de renda retido na fonte consolidado por contribuinte', grupo: 'totalizador' },
  evtFGTS: { codigo: 'S-5013', nome: 'Informações do FGTS consolidadas por contribuinte', grupo: 'totalizador' },
  evtTribProcTrab: { codigo: 'S-5501', nome: 'Informações consolidadas de tributos decorrentes de processo trabalhista', grupo: 'totalizador' },
  evtFGTSProcTrab: { codigo: 'S-5503', nome: 'Informações do FGTS por trabalhador em processo trabalhista', grupo: 'totalizador' },
  evtAnotJud: { codigo: 'S-8200', nome: 'Anotação judicial do vínculo', grupo: 'nao_periodico' },
  evtBaixa: { codigo: 'S-8299', nome: 'Baixa judicial do vínculo', grupo: 'nao_periodico' },
};

export function infoEvento(tag: string): InfoEvento {
  return EVENTOS[tag] ?? { codigo: tag, nome: `Evento não catalogado (${tag})`, grupo: 'outro' };
}

export const CODIGO_PARA_TAG: Record<string, string> = Object.fromEntries(
  Object.entries(EVENTOS).map(([tag, i]) => [i.codigo, tag]),
);

type Tabela = Record<string, string>;

/** tpRubr (S-1010) */
export const TP_RUBR: Tabela = {
  '1': 'Vencimento, provento ou pensão',
  '2': 'Desconto',
  '3': 'Informativa',
  '4': 'Informativa dedutora',
};

export const IND_APURACAO: Tabela = { '1': 'Mensal', '2': 'Anual (13º salário)' };

/** undSalFixo (S-2200/S-2206) */
export const UND_SAL_FIXO: Tabela = {
  '1': 'Por hora',
  '2': 'Por dia',
  '3': 'Por semana',
  '4': 'Por quinzena',
  '5': 'Por mês',
  '6': 'Por tarefa',
  '7': 'Não aplicável - salário exclusivamente variável',
};

/** tpPgto (S-1210) — subconjunto usado pelas regras */
export const TP_PGTO: Tabela = {
  '1': 'Remuneração apurada no S-1200',
  '2': 'Verbas rescisórias apuradas no S-2299',
  '3': 'Verbas rescisórias apuradas no S-2399',
  '4': 'Remuneração apurada no S-1202',
  '5': 'Benefícios apurados no S-1207',
};

/** codMotAfast (Tabela 18) — subconjunto */
export const MOT_AFAST: Tabela = {
  '01': 'Acidente/doença do trabalho',
  '03': 'Acidente/doença não relacionada ao trabalho',
  '15': 'Gozo de férias ou recesso',
  '17': 'Licença-maternidade',
};
export const COD_MOT_AFAST_FERIAS = '15';

/** mtvDeslig (Tabela 19) — subconjunto usado pelas regras de conferência */
export const MTV_DESLIG: Tabela = {
  '01': 'Rescisão com justa causa, por iniciativa do empregador',
  '02': 'Rescisão sem justa causa, por iniciativa do empregador',
  '03': 'Rescisão antecipada do contrato a termo por iniciativa do empregador',
  '04': 'Rescisão antecipada do contrato a termo por iniciativa do empregado',
  '05': 'Rescisão por culpa recíproca',
  '06': 'Rescisão por término do contrato a termo',
  '07': 'Rescisão do contrato de trabalho por iniciativa do empregado',
  '10': 'Rescisão por falecimento do empregado',
  '33': 'Rescisão por acordo entre as partes (art. 484-A da CLT)',
};

/** codCateg (Tabela 01) — subconjunto */
export const COD_CATEG: Tabela = {
  '101': 'Empregado - geral',
  '103': 'Empregado - aprendiz',
  '104': 'Empregado - doméstico',
  '111': 'Empregado - contrato de trabalho intermitente',
  '701': 'Contribuinte individual - autônomo em geral',
  '721': 'Contribuinte individual - diretor não empregado, com FGTS',
  '722': 'Contribuinte individual - diretor não empregado, sem FGTS',
  '723': 'Contribuinte individual - empresário, sócio e membro de conselho',
  '901': 'Estagiário',
};

export function ehEmpregado(codCateg?: string | null): boolean {
  return !!codCateg && /^1\d\d$/.test(codCateg);
}

/** natRubr (Tabela 03) — subconjunto usado nas regras e nos agrupamentos */
export const NAT_RUBR: Tabela = {
  '1000': 'Salário, vencimento, soldo',
  '1002': 'Descanso semanal remunerado - DSR',
  '1003': 'Horas extraordinárias',
  '1016': 'Férias',
  '1017': 'Terço constitucional de férias',
  '1202': 'Adicional de insalubridade',
  '1203': 'Adicional de periculosidade',
  '1205': 'Adicional noturno',
  '1409': 'Salário-família',
  '5001': '13º salário',
  '6000': 'Saldo de salários na rescisão contratual',
  '6003': 'Indenização compensatória do aviso prévio',
  '9201': 'Contribuição previdenciária',
  '9203': 'Imposto de renda retido na fonte',
  '9209': 'Faltas ou atrasos',
  '9216': 'Desconto de vale-transporte',
  '9901': 'Base de cálculo da contribuição previdenciária',
};
export const NAT_FERIAS = new Set(['1016', '1017']);

/** codIncCP — subconjunto */
export const INC_CP: Tabela = {
  '00': 'Não é base de cálculo',
  '11': 'Base de cálculo - salário de contribuição mensal',
  '12': 'Base de cálculo - 13º salário',
  '13': 'Base exclusiva do empregador - mensal',
  '14': 'Base exclusiva do empregador - 13º salário',
  '15': 'Base exclusiva do segurado - mensal',
  '16': 'Base exclusiva do segurado - 13º salário',
  '21': 'Salário-maternidade mensal pago pelo empregador',
  '22': 'Salário-maternidade 13º salário pago pelo empregador',
  '31': 'Contribuição descontada do segurado - mensal',
  '32': 'Contribuição descontada do segurado - 13º salário',
  '51': 'Salário-família',
};

/** codIncIRRF — subconjunto */
export const INC_IRRF: Tabela = {
  '00': 'Rendimento não tributável',
  '09': 'Outras verbas não consideradas como base de cálculo ou rendimento',
  '11': 'Remuneração mensal',
  '12': '13º salário',
  '13': 'Férias',
  '14': 'PLR',
  '31': 'Retenção do IRRF - remuneração mensal',
  '32': 'Retenção do IRRF - 13º salário',
  '33': 'Retenção do IRRF - férias',
  '41': 'Dedução - previdência social oficial - mensal',
  '42': 'Dedução - previdência social oficial - 13º salário',
  '43': 'Dedução - previdência social oficial - férias',
  '46': 'Dedução - previdência privada - mensal',
  '47': 'Dedução - previdência privada - 13º salário',
  '48': 'Dedução - previdência privada - férias',
  '51': 'Pensão alimentícia - mensal',
  '52': 'Pensão alimentícia - 13º salário',
  '53': 'Pensão alimentícia - férias',
};

/** codIncFGTS — subconjunto */
export const INC_FGTS: Tabela = {
  '00': 'Não é base de cálculo do FGTS',
  '11': 'Base de cálculo do FGTS mensal',
  '12': 'Base de cálculo do FGTS 13º salário',
  '21': 'Base de cálculo do FGTS aviso prévio indenizado',
};

export function descrever(tabela: Tabela, codigo?: string | null): string {
  if (!codigo) return '';
  return tabela[codigo] ? `${codigo} - ${tabela[codigo]}` : codigo;
}

/** Versão do leiaute a partir do namespace (ex.: v_S_01_03_00 → S-1.3). */
export function versaoDoNamespace(ns?: string): string | undefined {
  if (!ns) return undefined;
  const m = /v_S_(\d{2})_(\d{2})_(\d{2})\/?$/.exec(ns);
  if (m) return `S-${Number(m[1])}.${Number(m[2])}${m[3] !== '00' ? '.' + Number(m[3]) : ''}`;
  const m2 = /v(\d{2})_(\d{2})_(\d{2})\/?$/.exec(ns);
  if (m2) return `${Number(m2[1])}.${Number(m2[2])}.${Number(m2[3])}`;
  return undefined;
}

export const CATALOGO_PUBLICO = {
  eventos: EVENTOS,
  tpRubr: TP_RUBR,
  indApuracao: IND_APURACAO,
  undSalFixo: UND_SAL_FIXO,
  tpPgto: TP_PGTO,
  motAfast: MOT_AFAST,
  mtvDeslig: MTV_DESLIG,
  codCateg: COD_CATEG,
  natRubr: NAT_RUBR,
  incCP: INC_CP,
  incIRRF: INC_IRRF,
  incFGTS: INC_FGTS,
  observacao:
    'Descrições resumidas de subconjuntos das tabelas do eSocial, usadas nas regras deste sistema. ' +
    'Códigos não listados aparecem somente pelo número. Confira as tabelas do leiaute vigente.',
};
