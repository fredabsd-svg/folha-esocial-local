/**
 * Armazenamento local: banco SQLite cifrado (SQLite3 Multiple Ciphers,
 * ChaCha20-Poly1305) + arquivos originais e relatórios cifrados (AES-256-GCM).
 */
import Database from 'better-sqlite3-multiple-ciphers';
import { promises as fs, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Config } from '../config.js';
import { cifrar, decifrar, derivarChave, obterChaveMestra } from '../seguranca/cripto.js';

export type DB = Database.Database;

const MIGRACOES: string[] = [
  `
  CREATE TABLE configuracoes (chave TEXT PRIMARY KEY, valor TEXT NOT NULL, atualizado_em TEXT NOT NULL);

  CREATE TABLE importacoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome_arquivo TEXT NOT NULL,
    tamanho INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    tipo TEXT NOT NULL,
    origem TEXT NOT NULL,
    solicitacao_id INTEGER,
    importado_em TEXT NOT NULL,
    status TEXT NOT NULL,
    mensagem TEXT,
    qtd_arquivos INTEGER NOT NULL DEFAULT 0,
    qtd_arquivos_erro INTEGER NOT NULL DEFAULT 0,
    qtd_eventos INTEGER NOT NULL DEFAULT 0,
    qtd_eventos_novos INTEGER NOT NULL DEFAULT 0,
    qtd_eventos_repetidos INTEGER NOT NULL DEFAULT 0,
    qtd_recibos INTEGER NOT NULL DEFAULT 0,
    empregadores TEXT,
    periodo_inicio TEXT,
    periodo_fim TEXT,
    resumo_json TEXT,
    arquivo_repetido_de INTEGER
  );
  CREATE INDEX ix_imp_sha ON importacoes(sha256);

  CREATE TABLE arquivos_xml (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    importacao_id INTEGER NOT NULL REFERENCES importacoes(id) ON DELETE CASCADE,
    caminho TEXT NOT NULL,
    sha256 TEXT,
    tamanho INTEGER,
    status TEXT NOT NULL,
    mensagem TEXT,
    qtd_eventos INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX ix_arq_imp ON arquivos_xml(importacao_id);

  CREATE TABLE eventos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    evento_id TEXT NOT NULL UNIQUE,
    tipo TEXT NOT NULL,
    tag TEXT NOT NULL,
    namespace TEXT,
    versao_leiaute TEXT,
    emp_tp TEXT,
    emp_nr TEXT,
    emp_chave TEXT,
    cpf TEXT,
    matricula TEXT,
    per_apur TEXT,
    ind_apuracao TEXT,
    data_ref TEXT,
    ind_retif TEXT,
    nr_recibo_retificado TEXT,
    tp_amb TEXT,
    chave_natural TEXT,
    operacao TEXT,
    nr_rec_arq_base TEXT,
    origem TEXT NOT NULL,
    hash_conteudo TEXT NOT NULL,
    arvore_json TEXT NOT NULL,
    xml TEXT NOT NULL,
    xsd_status TEXT NOT NULL DEFAULT 'nao_validado',
    xsd_mensagem TEXT,
    situacao TEXT NOT NULL DEFAULT 'ativo',
    situacao_motivo TEXT,
    substituido_por INTEGER,
    primeira_importacao_id INTEGER,
    criado_em TEXT NOT NULL
  );
  CREATE INDEX ix_ev_emp_tipo_per ON eventos(emp_chave, tipo, per_apur);
  CREATE INDEX ix_ev_emp_cpf ON eventos(emp_chave, cpf);
  CREATE INDEX ix_ev_chave ON eventos(chave_natural);

  CREATE TABLE recibos (
    evento_id TEXT PRIMARY KEY,
    nr_recibo TEXT NOT NULL,
    cd_resposta TEXT,
    desc_resposta TEXT,
    dh_processamento TEXT,
    dh_recepcao TEXT,
    protocolo TEXT,
    importacao_id INTEGER
  );
  CREATE INDEX ix_rec_nr ON recibos(nr_recibo);

  CREATE TABLE ocorrencias (
    evento_pk INTEGER NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
    arquivo_xml_id INTEGER NOT NULL REFERENCES arquivos_xml(id) ON DELETE CASCADE,
    importacao_id INTEGER NOT NULL,
    PRIMARY KEY (evento_pk, arquivo_xml_id)
  );
  CREATE INDEX ix_oc_imp ON ocorrencias(importacao_id);

  CREATE TABLE conflitos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    evento_id TEXT NOT NULL,
    importacao_id INTEGER,
    arquivo_xml_id INTEGER,
    hash_conteudo TEXT,
    detectado_em TEXT NOT NULL,
    descricao TEXT NOT NULL
  );

  CREATE TABLE empresas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tp_insc TEXT NOT NULL,
    nr_insc TEXT NOT NULL,
    chave TEXT NOT NULL UNIQUE,
    razao_social TEXT,
    nome_fantasia TEXT,
    documento_completo TEXT,
    perfil_acesso TEXT,
    autorizacao_obs TEXT,
    observacoes TEXT,
    origem_cadastro TEXT NOT NULL,
    cadastrado_em TEXT NOT NULL,
    atualizado_em TEXT NOT NULL
  );

  CREATE TABLE complementos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    emp_chave TEXT NOT NULL,
    escopo TEXT NOT NULL,
    referencia TEXT NOT NULL,
    campo TEXT NOT NULL,
    valor TEXT NOT NULL,
    origem TEXT NOT NULL,
    informado_em TEXT NOT NULL,
    ativo INTEGER NOT NULL DEFAULT 1,
    substituido_por INTEGER
  );
  CREATE INDEX ix_comp ON complementos(emp_chave, escopo, referencia, campo);

  CREATE TABLE relatorios_gerados (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo TEXT NOT NULL,
    titulo TEXT NOT NULL,
    formato TEXT NOT NULL,
    emp_chave TEXT,
    competencia TEXT,
    parametros_json TEXT NOT NULL,
    gerado_em TEXT NOT NULL,
    tamanho INTEGER,
    sha256 TEXT,
    qtd_pendencias INTEGER,
    nome_arquivo TEXT NOT NULL
  );

  CREATE TABLE solicitacoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    emp_chave TEXT NOT NULL,
    documento_confirmado TEXT NOT NULL,
    perfil TEXT NOT NULL,
    tipo_solicitacao TEXT NOT NULL,
    periodo_inicio TEXT,
    periodo_fim TEXT,
    cpf_trabalhador TEXT,
    status TEXT NOT NULL,
    observacao TEXT,
    confirmado_em TEXT NOT NULL,
    atualizado_em TEXT NOT NULL
  );

  CREATE TABLE auditoria (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    em TEXT NOT NULL,
    acao TEXT NOT NULL,
    detalhe TEXT
  );
  `,
];

export class Armazenamento {
  private constructor(
    readonly db: DB,
    readonly dir: string,
    private readonly chaveOriginais: Buffer,
    private readonly chaveRelatorios: Buffer,
    readonly modoChave: string,
  ) {}

  static async abrir(cfg: Pick<Config, 'dadosDir' | 'modoChave'>): Promise<Armazenamento> {
    const dir = cfg.dadosDir;
    for (const sub of ['', 'originais', 'relatorios', 'xsd']) {
      mkdirSync(path.join(dir, sub), { recursive: true, mode: 0o700 });
    }
    const mestra = await obterChaveMestra(dir, cfg.modoChave);
    const chaveBanco = derivarChave(mestra, 'banco');
    let db: Database.Database;
    try {
      db = new Database(path.join(dir, 'folha.db'));
    } catch (e) {
      throw new Error(
        `Não foi possível abrir o banco em ${dir} (${(e as Error).message}). ` +
          'Verifique permissões e se o caminho não é longo demais (limite de 260 caracteres no Windows); use FOLHA_DADOS_DIR para escolher outra pasta.',
      );
    }
    db.pragma(`cipher='chacha20'`);
    db.pragma(`hexkey='${chaveBanco.toString('hex')}'`);
    try {
      db.prepare('SELECT count(*) AS n FROM sqlite_master').get();
    } catch (e) {
      db.close();
      throw new Error(
        'Não foi possível abrir o banco local com a chave deste usuário. ' +
          'O banco pode pertencer a outro usuário do Windows ou estar corrompido.',
      );
    }
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('secure_delete = ON');
    const versao = db.pragma('user_version', { simple: true }) as number;
    for (let i = versao; i < MIGRACOES.length; i++) {
      db.exec('BEGIN');
      db.exec(MIGRACOES[i]);
      db.pragma(`user_version = ${i + 1}`);
      db.exec('COMMIT');
    }
    return new Armazenamento(
      db,
      dir,
      derivarChave(mestra, 'originais'),
      derivarChave(mestra, 'relatorios'),
      cfg.modoChave,
    );
  }

  fechar() {
    try {
      this.db.close();
    } catch {
      /* já fechado */
    }
  }

  private caminhoOriginal(sha: string) {
    if (!/^[a-f0-9]{64}$/.test(sha)) throw new Error('hash inválido');
    return path.join(this.dir, 'originais', `${sha}.bin`);
  }

  async salvarOriginal(sha: string, dados: Buffer) {
    const p = this.caminhoOriginal(sha);
    if (!existsSync(p)) await fs.writeFile(p, cifrar(this.chaveOriginais, dados), { mode: 0o600 });
  }

  async lerOriginal(sha: string): Promise<Buffer> {
    return decifrar(this.chaveOriginais, await fs.readFile(this.caminhoOriginal(sha)));
  }

  async removerOriginal(sha: string) {
    await fs.rm(this.caminhoOriginal(sha), { force: true });
  }

  private caminhoRelatorio(id: number) {
    return path.join(this.dir, 'relatorios', `${Math.trunc(id)}.bin`);
  }

  async salvarRelatorio(id: number, dados: Buffer) {
    await fs.writeFile(this.caminhoRelatorio(id), cifrar(this.chaveRelatorios, dados), { mode: 0o600 });
  }

  async lerRelatorio(id: number): Promise<Buffer> {
    return decifrar(this.chaveRelatorios, await fs.readFile(this.caminhoRelatorio(id)));
  }

  async removerRelatorio(id: number) {
    await fs.rm(this.caminhoRelatorio(id), { force: true });
  }

  // ---------------------------------------------------------------- config
  obterConfig<T>(chave: string, padrao: T): T {
    const r = this.db.prepare('SELECT valor FROM configuracoes WHERE chave = ?').get(chave) as
      | { valor: string }
      | undefined;
    if (!r) return padrao;
    try {
      return JSON.parse(r.valor) as T;
    } catch {
      return padrao;
    }
  }

  salvarConfig(chave: string, valor: unknown) {
    this.db
      .prepare(
        `INSERT INTO configuracoes (chave, valor, atualizado_em) VALUES (?, ?, ?)
         ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, atualizado_em = excluded.atualizado_em`,
      )
      .run(chave, JSON.stringify(valor), new Date().toISOString());
  }

  removerConfig(chave: string) {
    this.db.prepare('DELETE FROM configuracoes WHERE chave = ?').run(chave);
  }

  auditar(acao: string, detalhe?: string) {
    this.db
      .prepare('INSERT INTO auditoria (em, acao, detalhe) VALUES (?, ?, ?)')
      .run(new Date().toISOString(), acao, detalhe ?? null);
  }
}
