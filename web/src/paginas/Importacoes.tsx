import { useRef, useState } from 'react';
import { api, baixarGet } from '../api';
import { Carregando, Erro, Etiqueta, Modal, Vazio } from '../componentes';
import { useApp, useCarregar } from '../contexto';
import { bytes, competencia as fmtComp, dataHora, documentoEmpresa, SITUACAO_EVENTO, STATUS_XSD } from '../formato';

interface Importacao {
  id: number;
  nome_arquivo: string;
  tamanho: number;
  tipo: string;
  origem: string;
  importado_em: string;
  status: string;
  mensagem: string | null;
  qtd_arquivos: number;
  qtd_arquivos_erro: number;
  qtd_eventos: number;
  qtd_eventos_novos: number;
  qtd_eventos_repetidos: number;
  qtd_recibos: number;
  empregadores: string | null;
  periodo_inicio: string | null;
  periodo_fim: string | null;
  arquivo_repetido_de: number | null;
  solicitacao_id: number | null;
}

const ORIGEM: Record<string, string> = { upload: 'Envio manual', pasta_monitorada: 'Pasta monitorada', demonstracao: 'Demonstração' };
const STATUS: Record<string, { rotulo: string; classe: string }> = {
  concluida: { rotulo: 'Concluída', classe: 'ok' },
  concluida_com_erros: { rotulo: 'Concluída com erros', classe: 'alerta' },
  rejeitada: { rotulo: 'Rejeitada', classe: 'erro' },
  processando: { rotulo: 'Processando', classe: 'info' },
};

export function Importacoes({ id }: { id?: string }) {
  if (id) return <DetalheImportacao id={Number(id)} />;
  return <ListaImportacoes />;
}

function ListaImportacoes() {
  const { notificar, dadosAlterados, versaoDados, setEmpresa } = useApp();
  const lista = useCarregar(() => api.get<Importacao[]>('/api/importacoes'), [versaoDados]);
  const [enviando, setEnviando] = useState(false);
  const [ativo, setAtivo] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  const enviar = async (arquivos: FileList | null) => {
    if (!arquivos?.length) return;
    setEnviando(true);
    const fd = new FormData();
    for (const f of Array.from(arquivos)) fd.append('arquivos', f, f.name);
    try {
      const r = await api.enviar<Array<{ importacaoId: number; status: string; eventos: { encontrados: number; novos: number; repetidos: number }; arquivos: { comErro: number } }>>('/api/importacoes', fd);
      const novos = r.reduce((a, x) => a + x.eventos.novos, 0);
      const erros = r.reduce((a, x) => a + x.arquivos.comErro, 0);
      notificar(`${r.length} arquivo(s) processado(s): ${novos} evento(s) novo(s)${erros ? `, ${erros} XML(s) com erro` : ''}.`, erros ? 'info' : 'sucesso');
      dadosAlterados();
      if (r.length === 1) window.location.hash = `#/importacoes/${r[0].importacaoId}`;
    } catch (e) {
      notificar((e as Error).message, 'erro');
    } finally {
      setEnviando(false);
    }
  };

  const demo = async () => {
    setEnviando(true);
    try {
      const r = await api.post<{ empresa: string; resumo: { importacaoId: number } }>('/api/demonstracao');
      setEmpresa(r.empresa);
      notificar('Demonstração importada (dados fictícios).');
      dadosAlterados();
    } catch (e) {
      notificar((e as Error).message, 'erro');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <>
      <div className="cabecalho-pagina">
        <div>
          <h1>Importações</h1>
          <p>Envie o ZIP do eSocial Download ou XMLs avulsos. O original é guardado sem alteração (cifrado), cada XML é registrado e os eventos repetidos não são duplicados.</p>
        </div>
        <button className="botao" onClick={demo} disabled={enviando}>Carregar demonstração (dados fictícios)</button>
      </div>
      <div
        className={`soltar ${ativo ? 'ativo' : ''}`}
        role="button"
        tabIndex={0}
        aria-label="Selecionar arquivos ZIP ou XML para importar"
        onClick={() => ref.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && ref.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setAtivo(true); }}
        onDragLeave={() => setAtivo(false)}
        onDrop={(e) => { e.preventDefault(); setAtivo(false); enviar(e.dataTransfer.files); }}
      >
        <strong>{enviando ? 'Importando… aguarde' : 'Arraste arquivos ZIP ou XML aqui, ou clique para escolher'}</strong>
        <div className="legenda">Aceita vários arquivos e ZIPs com subpastas ou ZIPs internos. Arquivos maliciosos (caminhos indevidos, entidades externas, “zip bomb”) são recusados.</div>
      </div>
      <input ref={ref} type="file" accept=".zip,.xml" multiple hidden onChange={(e) => { enviar(e.target.files); e.target.value = ''; }} />
      <section className="cartao">
        <h2>Histórico de importações</h2>
        {lista.carregando && !lista.dados ? <Carregando /> : lista.erro ? <Erro texto={lista.erro} aoTentar={lista.recarregar} /> : !lista.dados?.length ? (
          <Vazio titulo="Nenhuma importação ainda"><p>Os arquivos importados aparecerão aqui, com o resultado da validação.</p></Vazio>
        ) : (
          <div className="tabela-rolagem">
            <table className="dados">
              <thead><tr><th>Nº</th><th>Arquivo</th><th>Data</th><th>Origem</th><th className="dir">XMLs</th><th className="dir">Eventos</th><th className="dir">Novos</th><th>Empresas</th><th>Período</th><th>Situação</th></tr></thead>
              <tbody>
                {lista.dados.map((i) => (
                  <tr key={i.id} className="clicavel" tabIndex={0} onClick={() => (window.location.hash = `#/importacoes/${i.id}`)} onKeyDown={(e) => e.key === 'Enter' && (window.location.hash = `#/importacoes/${i.id}`)}>
                    <td>{i.id}</td>
                    <td style={{ overflowWrap: 'anywhere', maxWidth: 260 }}>{i.nome_arquivo}<div className="legenda">{i.tipo.toUpperCase()} · {bytes(i.tamanho)}{i.arquivo_repetido_de ? ` · idêntico à nº ${i.arquivo_repetido_de}` : ''}</div></td>
                    <td>{dataHora(i.importado_em)}</td>
                    <td>{ORIGEM[i.origem] ?? i.origem}</td>
                    <td className="dir num">{i.qtd_arquivos}{i.qtd_arquivos_erro ? <div className="legenda" style={{ color: 'var(--cor-erro)' }}>{i.qtd_arquivos_erro} com erro</div> : null}</td>
                    <td className="dir num">{i.qtd_eventos}</td>
                    <td className="dir num">{i.qtd_eventos_novos}</td>
                    <td>{(JSON.parse(i.empregadores ?? '[]') as string[]).map((e) => documentoEmpresa(e)).join(', ') || '—'}</td>
                    <td>{i.periodo_inicio ? `${fmtComp(i.periodo_inicio)} a ${fmtComp(i.periodo_fim)}` : '—'}</td>
                    <td><Etiqueta classe={STATUS[i.status]?.classe ?? 'neutra'}>{STATUS[i.status]?.rotulo ?? i.status}</Etiqueta></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

interface Detalhe extends Importacao {
  resumo: {
    arquivos: { total: number; lidos: number; comErro: number; ignorados: number; semEventos: number };
    eventos: { encontrados: number; novos: number; repetidos: number; conflitos: number; semRecibo: number };
    recibos: number;
    trabalhadores: number;
    totalizadores: number;
    producaoRestrita: number;
    avisos: string[];
    erros: Array<{ arquivo: string; mensagem: string }>;
    situacoes?: Record<string, number>;
  } | null;
  arquivos: Array<{ id: number; caminho: string; tamanho: number | null; status: string; mensagem: string | null; qtd_eventos: number }>;
  porTipo: Array<{ tipo: string; situacao: string; n: number }>;
  xsd: Array<{ xsd_status: string; n: number }>;
  competencias: Array<{ emp_chave: string; per_apur: string; tipo: string; trabalhadores: number; n: number }>;
  solicitacao: { id: number; tipo_solicitacao: string; periodo_inicio: string | null; periodo_fim: string | null } | null;
}

function DetalheImportacao({ id }: { id: number }) {
  const { notificar, dadosAlterados } = useApp();
  const d = useCarregar(() => api.get<Detalhe>(`/api/importacoes/${id}`), [id]);
  const [confirmar, setConfirmar] = useState(false);
  const [filtroArq, setFiltroArq] = useState('');
  if (d.carregando && !d.dados) return <Carregando />;
  if (d.erro) return <Erro texto={d.erro} />;
  const i = d.dados!;
  const r = i.resumo;
  const comps = [...new Set(i.competencias.map((c) => c.per_apur))].sort();
  const tipos = ['S-1200', 'S-1210', 'S-5001', 'S-5003', 'S-1299'];
  const celula = (per: string, tipo: string) => {
    const linhas = i.competencias.filter((c) => c.per_apur === per && c.tipo === tipo);
    if (tipo === 'S-1299') return linhas.length ? 'fechamento' : 0;
    return linhas.reduce((a, c) => a + c.trabalhadores, 0);
  };
  const mesesSolicitados = (() => {
    const s = i.solicitacao;
    if (!s?.periodo_inicio || !s.periodo_fim) return [];
    const out: string[] = [];
    let c = s.periodo_inicio.slice(0, 7);
    while (c <= s.periodo_fim.slice(0, 7) && out.length < 60) {
      out.push(c);
      const [a, m] = c.split('-').map(Number);
      c = m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`;
    }
    return out;
  })();
  const semEventos = mesesSolicitados.filter((m) => !comps.includes(m));
  const arquivos = i.arquivos.filter((a) => !filtroArq || a.status === filtroArq);

  const excluir = async () => {
    try {
      await api.del(`/api/importacoes/${id}`);
      notificar('Importação excluída. Eventos presentes apenas nela foram removidos.');
      dadosAlterados();
      window.location.hash = '#/importacoes';
    } catch (e) {
      notificar((e as Error).message, 'erro');
    }
  };

  return (
    <>
      <div className="cabecalho-pagina">
        <div>
          <a href="#/importacoes">← Importações</a>
          <h1 style={{ marginTop: 8 }}>Importação nº {i.id}</h1>
          <p>{i.nome_arquivo} · {bytes(i.tamanho)} · {dataHora(i.importado_em)} · {ORIGEM[i.origem] ?? i.origem}</p>
        </div>
        <div className="barra-acoes">
          <button className="botao" onClick={() => baixarGet(`/api/importacoes/${id}/original`, i.nome_arquivo)}>Baixar original</button>
          <a className="botao" href={`#/eventos`} onClick={() => { try { sessionStorage.setItem('folha.filtroImportacao', String(id)); } catch { /* sem armazenamento */ } }}>Ver eventos</a>
          <button className="botao perigo" onClick={() => setConfirmar(true)}>Excluir importação</button>
        </div>
      </div>
      {i.mensagem && <div className={`aviso ${i.status === 'rejeitada' ? 'erro' : 'alerta'}`}><div>{i.mensagem}</div></div>}
      {r && (
        <>
          <div className="grade grade-4">
            <div className="cartao indicador"><span className="rotulo">XMLs no pacote</span><span className="valor">{r.arquivos.total}</span><span className="legenda">{r.arquivos.lidos} lidos · {r.arquivos.comErro} com erro · {r.arquivos.ignorados} ignorados · {r.arquivos.semEventos} sem eventos</span></div>
            <div className="cartao indicador"><span className="rotulo">Eventos encontrados</span><span className="valor">{r.eventos.encontrados}</span><span className="legenda">{r.eventos.novos} novos · {r.eventos.repetidos} já existentes · {r.eventos.conflitos} conflitos</span></div>
            <div className="cartao indicador"><span className="rotulo">Recibos</span><span className="valor">{r.recibos}</span><span className="legenda">{r.eventos.semRecibo} evento(s) sem recibo nos arquivos</span></div>
            <div className="cartao indicador"><span className="rotulo">Trabalhadores (CPFs)</span><span className="valor">{r.trabalhadores}</span><span className="legenda">{r.totalizadores} totalizadores · {r.producaoRestrita} de produção restrita</span></div>
          </div>
          <div className="aviso info">
            <div>
              <strong>Escopo real desta importação</strong>
              Os números acima referem-se somente ao que estava nos arquivos enviados. O sistema não afirma que obteve “todos os XMLs”: confira abaixo as competências cobertas{i.solicitacao ? ' em relação ao período solicitado' : ''} e os arquivos com erro.
            </div>
          </div>
        </>
      )}
      {i.solicitacao && (
        <section className="cartao">
          <h2>Solicitação vinculada nº {i.solicitacao.id}</h2>
          <p>{i.solicitacao.tipo_solicitacao}{i.solicitacao.periodo_inicio ? ` — de ${i.solicitacao.periodo_inicio} a ${i.solicitacao.periodo_fim}` : ''}</p>
          {semEventos.length ? (
            <div className="aviso alerta"><div>Competências do período solicitado sem nenhum evento periódico nos arquivos: <strong>{semEventos.map(fmtComp).join(', ')}</strong>. Verifique se o download foi completo ou se não houve movimento.</div></div>
          ) : mesesSolicitados.length ? <div className="aviso sucesso"><div>Todas as competências do período solicitado têm eventos periódicos nos arquivos.</div></div> : null}
        </section>
      )}
      <div className="grade grade-2">
        <section className="cartao">
          <h2>Cobertura por competência</h2>
          <p className="legenda">Quantidade de trabalhadores (CPFs) com cada evento, por período de apuração.</p>
          {!comps.length ? <p className="suave">Sem eventos periódicos.</p> : (
            <div className="tabela-rolagem">
              <table className="dados">
                <thead><tr><th>Competência</th>{tipos.map((t) => <th key={t} className="dir">{t}</th>)}</tr></thead>
                <tbody>{comps.map((c) => <tr key={c}><td>{fmtComp(c)}</td>{tipos.map((t) => <td key={t} className="dir num">{celula(c, t) || '—'}</td>)}</tr>)}</tbody>
              </table>
            </div>
          )}
        </section>
        <section className="cartao">
          <h2>Eventos por tipo e situação</h2>
          <div className="tabela-rolagem">
            <table className="dados">
              <thead><tr><th>Tipo</th><th>Situação</th><th className="dir">Qtd.</th></tr></thead>
              <tbody>{i.porTipo.map((t, k) => <tr key={k}><td>{t.tipo}</td><td><Etiqueta classe={SITUACAO_EVENTO[t.situacao]?.classe ?? 'neutra'}>{SITUACAO_EVENTO[t.situacao]?.rotulo ?? t.situacao}</Etiqueta></td><td className="dir num">{t.n}</td></tr>)}</tbody>
            </table>
          </div>
          <div className="linha" style={{ marginTop: 12 }}>
            <span className="pequeno suave">Validação XSD:</span>
            {i.xsd.map((x) => <Etiqueta key={x.xsd_status} classe={STATUS_XSD[x.xsd_status]?.classe ?? 'neutra'}>{STATUS_XSD[x.xsd_status]?.rotulo ?? x.xsd_status}: {x.n}</Etiqueta>)}
            <a className="pequeno" href="#/configuracoes/xsd">Esquemas XSD</a>
          </div>
        </section>
      </div>
      <section className="cartao">
        <div className="cartao-titulo">
          <h2>Arquivos XML ({i.arquivos.length})</h2>
          <select aria-label="Filtrar arquivos" value={filtroArq} onChange={(e) => setFiltroArq(e.target.value)}>
            <option value="">Todos</option>
            <option value="ok">Lidos</option>
            <option value="erro">Com erro</option>
            <option value="ignorado">Ignorados</option>
            <option value="sem_eventos">Sem eventos</option>
          </select>
        </div>
        <div className="tabela-rolagem" style={{ maxHeight: 420 }}>
          <table className="dados">
            <thead><tr><th>Arquivo</th><th className="dir">Tamanho</th><th className="dir">Eventos</th><th>Resultado</th><th>Mensagem</th></tr></thead>
            <tbody>
              {arquivos.map((a) => (
                <tr key={a.id}>
                  <td className="mono" style={{ overflowWrap: 'anywhere' }}>{a.caminho}</td>
                  <td className="dir num">{bytes(a.tamanho)}</td>
                  <td className="dir num">{a.qtd_eventos}</td>
                  <td><Etiqueta classe={a.status === 'ok' ? 'ok' : a.status === 'erro' ? 'erro' : 'neutra'}>{a.status === 'ok' ? 'Lido' : a.status === 'erro' ? 'Erro' : a.status === 'ignorado' ? 'Ignorado' : 'Sem eventos'}</Etiqueta></td>
                  <td className="pequeno">{a.mensagem ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {confirmar && (
        <Modal titulo="Excluir importação" aoFechar={() => setConfirmar(false)}>
          <p>Serão removidos: o registro desta importação, seus XMLs registrados e os eventos que só aparecem nela. Eventos que também vieram de outras importações são mantidos. O arquivo original é apagado se nenhuma outra importação o usar.</p>
          <div className="linha fim">
            <button className="botao" onClick={() => setConfirmar(false)}>Cancelar</button>
            <button className="botao perigo cheio" onClick={excluir}>Excluir</button>
          </div>
        </Modal>
      )}
    </>
  );
}
