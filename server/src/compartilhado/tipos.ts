/**
 * Tipos compartilhados entre o serviço local e a interface.
 * (A interface importa este arquivo apenas para tipagem.)
 */

/** Classificação da origem de cada valor apresentado. */
export type Origem = 'xml' | 'calculado' | 'complementado' | 'ausente';

export type Formato =
  | 'texto'
  | 'moeda'
  | 'numero'
  | 'quantidade'
  | 'data'
  | 'competencia'
  | 'cpf'
  | 'cnpj'
  | 'percentual'
  | 'inteiro';

export interface RefXml {
  arquivo?: string;
  importacaoId?: number;
  tipoEvento: string;
  eventoId: string;
  recibo?: string;
  campo: string;
}

export interface RefCalculo {
  regra: string;
  versao: string;
  formula: string;
  parametros?: Record<string, string | number | boolean | null>;
  tabela?: { id: string; versao: string; fonte: string };
  memoria?: Array<{ descricao: string; valor: string | number | null }>;
  incompleto?: string[];
  fontes?: RefXml[];
}

export interface RefComplemento {
  complementoId: number;
  origem: string;
  informadoEm: string;
}

export interface Val {
  v: string | number | null;
  o: Origem;
  f?: Formato;
  x?: RefXml;
  c?: RefCalculo;
  m?: RefComplemento;
  /** motivo da ausência ou observação */
  obs?: string;
  /** campo que pode ser complementado pelo usuário */
  comp?: { escopo: string; referencia: string; campo: string; rotulo: string };
}

export type Celula = Val | string | number | null;

export interface Coluna {
  id: string;
  rotulo: string;
  tipo?: Formato;
  alinhar?: 'esq' | 'dir' | 'centro';
  largura?: number;
}

export interface Linha {
  c: Record<string, Celula>;
  tipo?: 'dados' | 'grupo' | 'subtotal' | 'total';
}

export interface Tabela {
  colunas: Coluna[];
  linhas: Linha[];
}

export interface Campo {
  rotulo: string;
  val: Celula;
}

export type NivelPendencia = 'erro' | 'alerta' | 'info';

export type CategoriaPendencia =
  | 'ausente'
  | 'divergencia'
  | 'evento_ausente'
  | 'calculo_incompleto'
  | 'validacao'
  | 'duplicidade'
  | 'ambiente';

export interface Pendencia {
  nivel: NivelPendencia;
  categoria: CategoriaPendencia;
  mensagem: string;
  cpf?: string;
  nome?: string;
  competencia?: string;
  eventoId?: string;
}

export interface Bloco {
  id?: string;
  titulo?: string;
  subtitulo?: string;
  campos?: Campo[];
  colunasCampos?: 2 | 3 | 4;
  tabela?: Tabela;
  notas?: string[];
  assinaturas?: string[];
  quebraPagina?: boolean;
  destaque?: 'recibo' | 'resumo' | 'memoria';
}

export interface Marca {
  nome?: string;
  documento?: string;
  endereco?: string;
  contato?: string;
  logoDataUrl?: string;
}

export interface Documento {
  tipo: string;
  titulo: string;
  subtitulo?: string;
  empresa: { chave: string; nome: Val; documento: Val };
  competencia?: string;
  cabecalho: Campo[];
  blocos: Bloco[];
  pendencias: Pendencia[];
  geradoEm: string;
  aviso: string;
  parametros: Record<string, unknown>;
  marca?: Marca;
  orientacao?: 'retrato' | 'paisagem';
  estatisticas?: Record<string, number>;
}

export interface ItemMapaCampo {
  campo: string;
  classe: 'XML' | 'Calculado' | 'Complementado' | 'XML ou Complementado' | 'XML ou Calculado';
  eventos?: string;
  caminho?: string;
  regra?: string;
  observacao?: string;
}

export interface ParametroRelatorio {
  id: string;
  rotulo: string;
  tipo: 'competencia' | 'periodo' | 'texto' | 'booleano' | 'selecao' | 'trabalhador';
  opcoes?: Array<{ valor: string; rotulo: string }>;
  padrao?: string | boolean;
  obrigatorio?: boolean;
  ajuda?: string;
}

export interface DefinicaoRelatorio {
  tipo: string;
  titulo: string;
  descricao: string;
  referencia: boolean;
  parametros: ParametroRelatorio[];
  mapaCampos: ItemMapaCampo[];
  formatos: Array<'pdf' | 'xlsx' | 'csv'>;
}

export const AVISO_PREVIA =
  'PRÉVIA PARA CONFERÊNCIA PROFISSIONAL — relatório gerado localmente a partir dos XMLs importados. ' +
  'Não é documento oficial do eSocial e não foi transmitido ao governo.';
