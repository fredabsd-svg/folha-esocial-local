import type { MultipartFile } from '@fastify/multipart';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { TABELAS_PADRAO, type ConjuntoTabelas, validarConjunto } from './calculo/tabelas.js';
import type { Marca } from './compartilhado/tipos.js';
import type { Estado } from './app.js';
import { EMPRESA_SINTETICA, gerarEventosSinteticos, gerarZipSintetico } from './demo/sinteticos.js';
import { CATALOGO_PUBLICO } from './esocial/catalogo.js';
import { chaveEmpregador } from './esocial/extrair.js';
import { resolverSituacoes } from './esocial/resolver.js';
import { excluirImportacao, importarArquivo, registrarEmpresasDetectadas } from './importacao/importador.js';
import { ErroParametro } from './relatorios/base.js';
import { definicoes } from './relatorios/registro.js';
import { excluirTudo, gerarBackup, restaurarBackup, tamanhoDados, validarSenhaBackup } from './servicos/backup.js';
import {
  buscarEventos,
  competencias,
  detalheEvento,
  detalheImportacao,
  detalheTrabalhador,
  listarEmpresas,
  listarTrabalhadores,
  painel,
} from './servicos/consultas.js';
import { lerArquivoDaPasta, lerConfigPasta, listarPasta, salvarConfigPasta } from './servicos/pasta.js';
import { exportarDocumento, gerarDocumento, MIME, tabelasEfetivas } from './servicos/relatorios.js';
import { log } from './util/log.js';
import { importarPacoteXsd, listarPacotes, removerPacote, validarPendentes } from './xsd/validador.js';

const agora = () => new Date().toISOString();
type Q = Record<string, string | undefined>;

class ErroHttp extends Error {
  constructor(
    readonly statusCode: number,
    msg: string,
  ) {
    super(msg);
  }
}

const texto = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);
const empresaValida = (e?: string) => {
  if (!e || !/^[12]:[0-9A-Z]{8,14}$/.test(e)) throw new ErroHttp(400, 'Empresa inválida.');
  return e;
};
const compValida = (c?: string) => {
  if (c && !/^\d{4}(-\d{2})?$/.test(c)) throw new ErroHttp(400, 'Competência inválida (use AAAA-MM).');
  return c || undefined;
};

export const URL_PORTAL_PADRAO = 'https://login.esocial.gov.br/login.aspx';

function enviarArquivo(reply: FastifyReply, buf: Buffer, nome: string, mime: string) {
  return reply
    .header('Content-Type', mime)
    .header('Content-Disposition', `attachment; filename="${nome.replace(/[^\w.-]/g, '_')}"`)
    .send(buf);
}

async function lerArquivos(req: FastifyRequest) {
  const arquivos: Array<{ nome: string; dados: Buffer }> = [];
  const campos: Record<string, string> = {};
  for await (const parte of req.parts()) {
    if (parte.type === 'file') {
      const f = parte as MultipartFile;
      const dados = await f.toBuffer();
      if (f.file.truncated) throw new ErroHttp(413, `Arquivo ${f.filename} excede o tamanho máximo.`);
      arquivos.push({ nome: f.filename, dados });
    } else {
      campos[parte.fieldname] = String((parte as { value: unknown }).value ?? '');
    }
  }
  return { arquivos, campos };
}

export async function registrarRotas(app: FastifyInstance, estado: Estado) {
  const arm = () => estado.arm;
  const db = () => estado.arm.db;
  const cfg = estado.cfg;

  const aposImportar = () => {
    setImmediate(() => {
      validarPendentes(arm()).catch((e) => log.aviso('Validação XSD não concluída', { erro: (e as Error).message.slice(0, 80) }));
    });
  };

  // ---------------------------------------------------------------- saúde e painel
  app.get('/api/saude', async () => ({
    ok: true,
    versao: '1.0.0',
    dadosDir: arm().dir,
    modoChave: arm().modoChave,
    local: true,
  }));

  app.get('/api/painel', async (req) => {
    const q = req.query as Q;
    return painel(db(), tabelasEfetivas(arm()), q.empresa ? empresaValida(q.empresa) : undefined);
  });

  app.get('/api/catalogo', async () => CATALOGO_PUBLICO);

  // ---------------------------------------------------------------- empresas
  app.get('/api/empresas', async () => listarEmpresas(db()));

  app.post('/api/empresas', async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const tp = b.tpInsc === '2' ? '2' : '1';
    const doc = String(b.documento ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
    if (tp === '1' && !/^[0-9A-Z]{12}\d{2}$/.test(doc)) throw new ErroHttp(400, 'CNPJ deve ter 14 posições (numérico ou alfanumérico).');
    if (tp === '2' && !/^\d{11}$/.test(doc)) throw new ErroHttp(400, 'CPF deve ter 11 dígitos.');
    const chave = chaveEmpregador(tp, doc)!;
    const existe = db().prepare('SELECT id FROM empresas WHERE chave = ?').get(chave) as { id: number } | undefined;
    const vals = [texto(b.razaoSocial, 200) ?? null, texto(b.nomeFantasia, 200) ?? null, doc, texto(b.perfilAcesso, 60) ?? null, texto(b.autorizacaoObs) ?? null, texto(b.observacoes) ?? null];
    if (existe) {
      db().prepare(
        `UPDATE empresas SET razao_social = ?, nome_fantasia = ?, documento_completo = ?, perfil_acesso = ?, autorizacao_obs = ?, observacoes = ?,
           origem_cadastro = 'cadastrada', atualizado_em = ? WHERE id = ?`,
      ).run(...vals, agora(), existe.id);
      return { id: existe.id, chave };
    }
    const id = db()
      .prepare(
        `INSERT INTO empresas (tp_insc, nr_insc, chave, razao_social, nome_fantasia, documento_completo, perfil_acesso, autorizacao_obs, observacoes, origem_cadastro, cadastrado_em, atualizado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'cadastrada', ?, ?)`,
      )
      .run(tp, chave.split(':')[1], chave, ...vals, agora(), agora()).lastInsertRowid;
    return { id: Number(id), chave };
  });

  app.put('/api/empresas/:id', async (req) => {
    const id = Number((req.params as Q).id);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const atual = db().prepare('SELECT * FROM empresas WHERE id = ?').get(id) as Record<string, string> | undefined;
    if (!atual) throw new ErroHttp(404, 'Empresa não encontrada.');
    let doc = atual.documento_completo;
    if (b.documento !== undefined) {
      doc = String(b.documento).toUpperCase().replace(/[^0-9A-Z]/g, '');
      if (doc && chaveEmpregador(atual.tp_insc, doc) !== atual.chave) throw new ErroHttp(400, 'O documento informado não corresponde à inscrição desta empresa.');
    }
    db().prepare(
      `UPDATE empresas SET razao_social = ?, nome_fantasia = ?, documento_completo = ?, perfil_acesso = ?, autorizacao_obs = ?, observacoes = ?,
         origem_cadastro = 'cadastrada', atualizado_em = ? WHERE id = ?`,
    ).run(
      texto(b.razaoSocial, 200) ?? atual.razao_social,
      texto(b.nomeFantasia, 200) ?? atual.nome_fantasia,
      doc || null,
      texto(b.perfilAcesso, 60) ?? atual.perfil_acesso,
      texto(b.autorizacaoObs) ?? atual.autorizacao_obs,
      texto(b.observacoes) ?? atual.observacoes,
      agora(),
      id,
    );
    return { ok: true };
  });

  app.delete('/api/empresas/:id', async (req) => {
    const id = Number((req.params as Q).id);
    db().prepare('DELETE FROM empresas WHERE id = ?').run(id);
    arm().auditar('empresa_cadastro_removido', `id=${id}`);
    return { ok: true };
  });

  app.post('/api/empresas/:id/excluir-dados', async (req) => {
    const id = Number((req.params as Q).id);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const emp = db().prepare('SELECT chave FROM empresas WHERE id = ?').get(id) as { chave: string } | undefined;
    if (!emp) throw new ErroHttp(404, 'Empresa não encontrada.');
    if (b.confirmacao !== emp.chave) throw new ErroHttp(400, 'Confirmação não confere com a inscrição da empresa.');
    const d = db();
    d.transaction(() => {
      d.prepare('DELETE FROM recibos WHERE evento_id IN (SELECT evento_id FROM eventos WHERE emp_chave = ?)').run(emp.chave);
      d.prepare('DELETE FROM eventos WHERE emp_chave = ?').run(emp.chave);
      d.prepare('DELETE FROM complementos WHERE emp_chave = ?').run(emp.chave);
      d.prepare('DELETE FROM solicitacoes WHERE emp_chave = ?').run(emp.chave);
      d.prepare('DELETE FROM empresas WHERE id = ?').run(id);
    })();
    const rel = d.prepare('SELECT id FROM relatorios_gerados WHERE emp_chave = ?').all(emp.chave) as Array<{ id: number }>;
    for (const r of rel) await arm().removerRelatorio(r.id);
    d.prepare('DELETE FROM relatorios_gerados WHERE emp_chave = ?').run(emp.chave);
    arm().auditar('empresa_dados_excluidos', `empresa=${id}`);
    return { ok: true, observacao: 'Eventos, complementos, solicitações e relatórios da empresa foram excluídos. O histórico e os arquivos originais das importações são mantidos até que as importações sejam excluídas.' };
  });

  app.get('/api/competencias', async (req) => competencias(db(), empresaValida((req.query as Q).empresa)));

  // ---------------------------------------------------------------- importações
  app.post('/api/importacoes', async (req) => {
    const { arquivos, campos } = await lerArquivos(req);
    if (!arquivos.length) throw new ErroHttp(400, 'Nenhum arquivo enviado.');
    const solicitacaoId = campos.solicitacaoId ? Number(campos.solicitacaoId) : null;
    const resultados = [];
    for (const a of arquivos) {
      resultados.push(await importarArquivo(arm(), cfg, { nomeArquivo: a.nome, dados: a.dados, origem: 'upload', solicitacaoId }));
    }
    aposImportar();
    return resultados;
  });

  app.get('/api/importacoes', async () =>
    db()
      .prepare(
        `SELECT id, nome_arquivo, tamanho, tipo, origem, importado_em, status, mensagem, qtd_arquivos, qtd_arquivos_erro, qtd_eventos,
                qtd_eventos_novos, qtd_eventos_repetidos, qtd_recibos, empregadores, periodo_inicio, periodo_fim, arquivo_repetido_de, solicitacao_id
           FROM importacoes ORDER BY id DESC LIMIT 500`,
      )
      .all(),
  );

  app.get('/api/importacoes/:id', async (req) => {
    const r = detalheImportacao(db(), Number((req.params as Q).id));
    if (!r) throw new ErroHttp(404, 'Importação não encontrada.');
    return r;
  });

  app.get('/api/importacoes/:id/original', async (req, reply) => {
    const imp = db().prepare('SELECT sha256, nome_arquivo, tipo FROM importacoes WHERE id = ?').get(Number((req.params as Q).id)) as
      | { sha256: string; nome_arquivo: string; tipo: string }
      | undefined;
    if (!imp) throw new ErroHttp(404, 'Importação não encontrada.');
    return enviarArquivo(reply, await arm().lerOriginal(imp.sha256), imp.nome_arquivo, imp.tipo === 'zip' ? 'application/zip' : 'application/xml');
  });

  app.delete('/api/importacoes/:id', async (req) => {
    const ok = await excluirImportacao(arm(), Number((req.params as Q).id));
    if (!ok) throw new ErroHttp(404, 'Importação não encontrada.');
    return { ok: true };
  });

  app.post('/api/demonstracao', async () => {
    const zip = await gerarZipSintetico();
    const r = await importarArquivo(arm(), cfg, { nomeArquivo: 'demonstracao-sintetica.zip', dados: zip, origem: 'demonstracao' });
    const chave = `1:${EMPRESA_SINTETICA.raiz}`;
    registrarEmpresasDetectadas(arm(), [chave]);
    db().prepare(
      `UPDATE empresas SET razao_social = coalesce(razao_social, ?), documento_completo = coalesce(documento_completo, ?),
         observacoes = coalesce(observacoes, 'Dados fictícios para demonstração'), atualizado_em = ? WHERE chave = ?`,
    ).run(EMPRESA_SINTETICA.razaoSocial, EMPRESA_SINTETICA.cnpj, agora(), chave);
    aposImportar();
    return { resumo: r, empresa: chave, cenario: gerarEventosSinteticos().descricao };
  });

  // ---------------------------------------------------------------- eventos e trabalhadores
  app.get('/api/eventos', async (req) => {
    const q = req.query as Q;
    return buscarEventos(db(), { ...q, empresa: q.empresa ? empresaValida(q.empresa) : undefined, perIni: compValida(q.perIni), perFim: compValida(q.perFim) });
  });

  app.get('/api/eventos/:id', async (req) => {
    const r = detalheEvento(db(), Number((req.params as Q).id));
    if (!r) throw new ErroHttp(404, 'Evento não encontrado.');
    return r;
  });

  app.post('/api/eventos/reprocessar', async () => ({ situacoes: resolverSituacoes(db()) }));

  app.get('/api/trabalhadores', async (req) => {
    const q = req.query as Q;
    return listarTrabalhadores(db(), tabelasEfetivas(arm()), empresaValida(q.empresa), compValida(q.competencia), texto(q.q, 80));
  });

  app.get('/api/trabalhadores/:cpf', async (req) => {
    const cpf = String((req.params as Q).cpf).replace(/\D/g, '');
    return detalheTrabalhador(db(), tabelasEfetivas(arm()), empresaValida((req.query as Q).empresa), cpf);
  });

  // ---------------------------------------------------------------- relatórios
  app.get('/api/relatorios/catalogo', async () => definicoes());

  app.post('/api/relatorios/visualizar', async (req) => {
    const b = (req.body ?? {}) as { tipo?: string; parametros?: Record<string, unknown> };
    try {
      return gerarDocumento(arm(), String(b.tipo), b.parametros ?? {});
    } catch (e) {
      if (e instanceof ErroParametro) throw new ErroHttp(400, e.message);
      throw e;
    }
  });

  app.post('/api/relatorios/exportar', async (req, reply) => {
    const b = (req.body ?? {}) as { tipo?: string; parametros?: Record<string, unknown>; formato?: string };
    try {
      const r = await exportarDocumento(arm(), String(b.tipo), b.parametros ?? {}, String(b.formato));
      arm().auditar('relatorio_exportado', `tipo=${b.tipo} formato=${b.formato} id=${r.id}`);
      return enviarArquivo(reply.header('X-Relatorio-Id', String(r.id)), r.buf, r.nome, r.mime);
    } catch (e) {
      if (e instanceof ErroParametro) throw new ErroHttp(400, e.message);
      throw e;
    }
  });

  app.get('/api/relatorios/historico', async (req) => {
    const q = req.query as Q;
    const where = q.empresa ? 'WHERE emp_chave = ?' : '';
    return db()
      .prepare(`SELECT id, tipo, titulo, formato, emp_chave, competencia, parametros_json, gerado_em, tamanho, qtd_pendencias, nome_arquivo FROM relatorios_gerados ${where} ORDER BY id DESC LIMIT 300`)
      .all(...(q.empresa ? [empresaValida(q.empresa)] : []));
  });

  app.get('/api/relatorios/historico/:id/arquivo', async (req, reply) => {
    const id = Number((req.params as Q).id);
    const r = db().prepare('SELECT formato, nome_arquivo FROM relatorios_gerados WHERE id = ?').get(id) as { formato: string; nome_arquivo: string } | undefined;
    if (!r) throw new ErroHttp(404, 'Relatório não encontrado.');
    return enviarArquivo(reply, await arm().lerRelatorio(id), r.nome_arquivo, MIME[r.formato]);
  });

  app.delete('/api/relatorios/historico/:id', async (req) => {
    const id = Number((req.params as Q).id);
    db().prepare('DELETE FROM relatorios_gerados WHERE id = ?').run(id);
    await arm().removerRelatorio(id);
    return { ok: true };
  });

  app.get('/api/relatorios/modelos/:tipo', async (req) => arm().obterConfig(`modelo:${(req.params as Q).tipo}`, {}));

  app.put('/api/relatorios/modelos/:tipo', async (req) => {
    const tipo = String((req.params as Q).tipo);
    if (!definicoes().some((d) => d.tipo === tipo)) throw new ErroHttp(404, 'Relatório desconhecido.');
    const b = (req.body ?? {}) as Record<string, unknown>;
    const modelo = {
      titulo: texto(b.titulo, 120) ?? '',
      rodape: texto(b.rodape, 300) ?? '',
      colunasOcultas: Array.isArray(b.colunasOcultas) ? b.colunasOcultas.filter((c) => typeof c === 'string').slice(0, 50) : [],
      opcoes: typeof b.opcoes === 'object' && b.opcoes ? b.opcoes : {},
    };
    arm().salvarConfig(`modelo:${tipo}`, modelo);
    return modelo;
  });

  // ---------------------------------------------------------------- pendências
  app.get('/api/pendencias', async (req) => {
    const q = req.query as Q;
    const empresa = empresaValida(q.empresa);
    const competencia = compValida(q.competencia);
    if (!competencia) throw new ErroHttp(400, 'Informe a competência.');
    const ausentes = gerarDocumento(arm(), 'eventos_ausentes', { empresa, competencia });
    const diverg = gerarDocumento(arm(), 'divergencias', { empresa, competencia, incluirConferidos: false });
    return { pendencias: ausentes.pendencias, divergencias: diverg.blocos[0]?.tabela ?? null };
  });

  // ---------------------------------------------------------------- complementos
  app.get('/api/complementos', async (req) => {
    const q = req.query as Q;
    return db()
      .prepare('SELECT * FROM complementos WHERE emp_chave = ? ORDER BY ativo DESC, id DESC')
      .all(empresaValida(q.empresa));
  });

  app.post('/api/complementos', async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const empresa = empresaValida(texto(b.empresa, 20));
    const escopo = texto(b.escopo, 30);
    const referencia = texto(b.referencia, 120);
    const campo = texto(b.campo, 60);
    const valor = texto(b.valor, 500);
    const origem = texto(b.origem, 300);
    if (!escopo || !referencia || !campo || !valor) throw new ErroHttp(400, 'Informe escopo, referência, campo e valor.');
    if (!origem) throw new ErroHttp(400, 'Informe a origem da informação (documento, pessoa ou fonte).');
    if (/^(senha|password|token|cookie)/i.test(campo)) throw new ErroHttp(400, 'Campo não permitido.');
    const d = db();
    const id = d.transaction(() => {
      const novo = Number(
        d.prepare('INSERT INTO complementos (emp_chave, escopo, referencia, campo, valor, origem, informado_em) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(empresa, escopo, referencia, campo, valor, origem, agora()).lastInsertRowid,
      );
      d.prepare('UPDATE complementos SET ativo = 0, substituido_por = ? WHERE emp_chave = ? AND escopo = ? AND referencia = ? AND campo = ? AND id <> ? AND ativo = 1')
        .run(novo, empresa, escopo, referencia, campo, novo);
      return novo;
    })();
    if (escopo === 'empresa' && campo === 'razao_social') {
      d.prepare('UPDATE empresas SET razao_social = ?, atualizado_em = ? WHERE chave = ?').run(valor, agora(), empresa);
    }
    return { id };
  });

  app.delete('/api/complementos/:id', async (req) => {
    db().prepare('UPDATE complementos SET ativo = 0 WHERE id = ?').run(Number((req.params as Q).id));
    return { ok: true };
  });

  // ---------------------------------------------------------------- obtenção pelo portal oficial
  app.get('/api/portal', async () => ({
    urlLogin: arm().obterConfig('url_portal', URL_PORTAL_PADRAO),
    urlDocumentacao: 'https://www.gov.br/esocial/pt-br/documentacao-tecnica',
    orientacoes: {
      fonte: 'Notícia oficial "eSocial Download: para facilitar a vida do empregador" (gov.br/esocial), consultada em 23/09/2026',
      itens: [
        'Menu Download › Solicitação: escolha o tipo de pedido (período, trabalhador, tabelas etc.) e o intervalo.',
        'Acompanhe e baixe os arquivos em Download › Painel de download. O arquivo é um ZIP com XMLs; cada XML traz o evento e o seu recibo.',
        'Segundo a orientação oficial, apenas o titular ou o responsável legal têm acesso ao menu Download. Verifique no portal as regras vigentes para o seu perfil.',
        'O portal informa limites de quantidade de pedidos, intervalo de datas, volume de registros e prazo de disponibilidade dos arquivos. Esses limites podem mudar: siga sempre o que o portal exibir.',
      ],
    },
  }));

  app.put('/api/portal', async (req) => {
    const url = texto((req.body as Record<string, unknown>)?.urlLogin, 300) ?? '';
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      throw new ErroHttp(400, 'URL inválida.');
    }
    if (u.protocol !== 'https:' || !(u.hostname === 'gov.br' || u.hostname.endsWith('.gov.br'))) {
      throw new ErroHttp(400, 'Somente endereços oficiais https em domínio .gov.br são aceitos.');
    }
    arm().salvarConfig('url_portal', u.toString());
    return { ok: true };
  });

  app.get('/api/solicitacoes', async (req) => {
    const q = req.query as Q;
    const where = q.empresa ? 'WHERE emp_chave = ?' : '';
    return db().prepare(`SELECT * FROM solicitacoes ${where} ORDER BY id DESC`).all(...(q.empresa ? [empresaValida(q.empresa)] : []));
  });

  app.post('/api/solicitacoes', async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const empresa = empresaValida(texto(b.empresa, 20));
    const doc = String(b.documentoConfirmado ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
    if (chaveEmpregador(empresa.split(':')[0], doc) !== empresa && doc !== empresa.split(':')[1]) {
      throw new ErroHttp(400, 'O CPF/CNPJ confirmado não corresponde à empresa selecionada.');
    }
    if (b.confirmado !== true) throw new ErroHttp(400, 'Confirme o CPF/CNPJ e a autorização antes de iniciar a consulta.');
    const perfil = texto(b.perfil, 60);
    const tipo = texto(b.tipoSolicitacao, 80);
    if (!perfil || !tipo) throw new ErroHttp(400, 'Informe o perfil de acesso e o tipo de solicitação.');
    const per = (v: unknown) => {
      const s = texto(v, 10);
      if (s && !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new ErroHttp(400, 'Datas no formato AAAA-MM-DD.');
      return s ?? null;
    };
    const id = db()
      .prepare(
        `INSERT INTO solicitacoes (emp_chave, documento_confirmado, perfil, tipo_solicitacao, periodo_inicio, periodo_fim, cpf_trabalhador, status, observacao, confirmado_em, atualizado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'aguardando_portal', ?, ?, ?)`,
      )
      .run(empresa, doc, perfil, tipo, per(b.periodoInicio), per(b.periodoFim), texto(b.cpfTrabalhador, 14)?.replace(/\D/g, '') || null, texto(b.observacao) ?? null, agora(), agora())
      .lastInsertRowid;
    arm().auditar('solicitacao_registrada', `id=${id}`);
    return { id: Number(id) };
  });

  app.put('/api/solicitacoes/:id', async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const status = texto(b.status, 30);
    const validos = ['aguardando_portal', 'solicitado', 'disponivel', 'baixado', 'importado', 'expirado', 'cancelado'];
    if (status && !validos.includes(status)) throw new ErroHttp(400, 'Status inválido.');
    db().prepare('UPDATE solicitacoes SET status = coalesce(?, status), observacao = coalesce(?, observacao), atualizado_em = ? WHERE id = ?')
      .run(status ?? null, texto(b.observacao) ?? null, agora(), Number((req.params as Q).id));
    return { ok: true };
  });

  app.delete('/api/solicitacoes/:id', async (req) => {
    db().prepare('DELETE FROM solicitacoes WHERE id = ?').run(Number((req.params as Q).id));
    return { ok: true };
  });

  // ---------------------------------------------------------------- pasta monitorada
  app.get('/api/pasta', async () => ({ config: lerConfigPasta(arm()), arquivos: await listarPasta(arm(), cfg.maxUploadBytes) }));

  app.put('/api/pasta', async (req) => {
    try {
      return salvarConfigPasta(arm(), (req.body ?? {}) as Record<string, never>);
    } catch (e) {
      throw new ErroHttp(400, (e as Error).message);
    }
  });

  app.post('/api/pasta/importar', async (req) => {
    const b = (req.body ?? {}) as { arquivos?: unknown; solicitacaoId?: unknown };
    const nomes = Array.isArray(b.arquivos) ? b.arquivos.filter((x): x is string => typeof x === 'string').slice(0, 50) : [];
    if (!nomes.length) throw new ErroHttp(400, 'Selecione ao menos um arquivo.');
    const resultados = [];
    for (const nome of nomes) {
      const dados = await lerArquivoDaPasta(arm(), nome, cfg.maxUploadBytes).catch((e) => {
        throw new ErroHttp(400, (e as Error).message);
      });
      resultados.push(await importarArquivo(arm(), cfg, { nomeArquivo: nome, dados, origem: 'pasta_monitorada', solicitacaoId: b.solicitacaoId ? Number(b.solicitacaoId) : null }));
    }
    aposImportar();
    return resultados;
  });

  // ---------------------------------------------------------------- XSD
  app.get('/api/xsd', async () => {
    const status = db().prepare('SELECT xsd_status, count(*) n FROM eventos GROUP BY xsd_status').all();
    return { pacotes: await listarPacotes(arm()), status };
  });

  app.post('/api/xsd', async (req) => {
    const { arquivos } = await lerArquivos(req);
    if (arquivos.length !== 1) throw new ErroHttp(400, 'Envie um único arquivo ZIP com os esquemas XSD.');
    try {
      const p = await importarPacoteXsd(arm(), arquivos[0].nome, arquivos[0].dados);
      setImmediate(() => validarPendentes(arm(), true).catch(() => undefined));
      return p;
    } catch (e) {
      throw new ErroHttp(400, (e as Error).message);
    }
  });

  app.delete('/api/xsd/:id', async (req) => {
    await removerPacote(arm(), String((req.params as Q).id));
    db().prepare("UPDATE eventos SET xsd_status = 'nao_validado', xsd_mensagem = NULL").run();
    return { ok: true };
  });

  app.post('/api/xsd/validar', async () => validarPendentes(arm(), true));

  // ---------------------------------------------------------------- tabelas de cálculo
  app.get('/api/tabelas', async () => ({
    vigente: arm().obterConfig<ConjuntoTabelas>('tabelas_personalizadas', TABELAS_PADRAO),
    padrao: TABELAS_PADRAO,
  }));

  app.put('/api/tabelas', async (req) => {
    const r = validarConjunto(req.body);
    if (!r.ok) throw new ErroHttp(400, `Tabelas inválidas: ${r.erros.join(' ')}`);
    arm().salvarConfig('tabelas_personalizadas', r.conjunto);
    arm().auditar('tabelas_atualizadas', r.conjunto.versao);
    return r.conjunto;
  });

  app.delete('/api/tabelas', async () => {
    arm().removerConfig('tabelas_personalizadas');
    return { ok: true };
  });

  // ---------------------------------------------------------------- marca
  app.get('/api/config/marca', async () => arm().obterConfig<Marca>('marca', {}));

  app.put('/api/config/marca', async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const logo = texto(b.logoDataUrl, 700_000);
    if (logo && !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(logo)) throw new ErroHttp(400, 'Logotipo deve ser PNG ou JPEG (até ~500 KB).');
    const marca: Marca = {
      nome: texto(b.nome, 150),
      documento: texto(b.documento, 30),
      endereco: texto(b.endereco, 200),
      contato: texto(b.contato, 150),
      logoDataUrl: logo || undefined,
    };
    arm().salvarConfig('marca', marca);
    return marca;
  });

  // ---------------------------------------------------------------- dados, backup e exclusão
  app.get('/api/dados', async () => ({
    diretorio: arm().dir,
    protecao:
      arm().modoChave === 'dpapi'
        ? 'Banco SQLite cifrado (ChaCha20-Poly1305) e arquivos cifrados (AES-256-GCM); chave protegida pela DPAPI do Windows (somente este usuário deste computador).'
        : 'Banco SQLite cifrado (ChaCha20-Poly1305) e arquivos cifrados (AES-256-GCM); chave em arquivo com permissão restrita no diretório de dados.',
    tamanho: await tamanhoDados(arm().dir),
    contagens: {
      importacoes: (db().prepare('SELECT count(*) n FROM importacoes').get() as { n: number }).n,
      eventos: (db().prepare('SELECT count(*) n FROM eventos').get() as { n: number }).n,
      relatorios: (db().prepare('SELECT count(*) n FROM relatorios_gerados').get() as { n: number }).n,
      complementos: (db().prepare('SELECT count(*) n FROM complementos').get() as { n: number }).n,
    },
    envioExterno: 'Nenhum. O serviço não envia dados, telemetria ou arquivos para fora deste computador.',
  }));

  app.post('/api/dados/backup', async (req, reply) => {
    const senha = (() => {
      try {
        return validarSenhaBackup((req.body as Record<string, unknown>)?.senha);
      } catch (e) {
        throw new ErroHttp(400, (e as Error).message);
      }
    })();
    const buf = await gerarBackup(arm(), senha);
    const nome = `backup-folha-esocial-${new Date().toISOString().slice(0, 10)}.folhabak`;
    return enviarArquivo(reply, buf, nome, 'application/octet-stream');
  });

  app.post('/api/dados/restaurar', async (req) => {
    const { arquivos, campos } = await lerArquivos(req);
    if (arquivos.length !== 1) throw new ErroHttp(400, 'Envie o arquivo de backup.');
    if (campos.confirmacao !== 'SUBSTITUIR') throw new ErroHttp(400, 'Digite SUBSTITUIR para confirmar a substituição dos dados atuais.');
    try {
      return await restaurarBackup(arm(), arquivos[0].dados, validarSenhaBackup(campos.senha));
    } catch (e) {
      throw new ErroHttp(400, (e as Error).message);
    }
  });

  app.post('/api/dados/excluir-tudo', async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (b.confirmacao !== 'EXCLUIR TODOS OS DADOS') throw new ErroHttp(400, 'Digite EXCLUIR TODOS OS DADOS para confirmar.');
    await excluirTudo(arm());
    await estado.reabrir();
    log.info('Todos os dados locais foram excluídos');
    return { ok: true };
  });

  app.get('/api/auditoria', async () => db().prepare('SELECT * FROM auditoria ORDER BY id DESC LIMIT 200').all());
}
