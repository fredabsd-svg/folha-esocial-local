import { useEffect, useMemo, useState } from 'react';
import type { DefinicaoRelatorio, Documento } from '../../../server/src/compartilhado/tipos';
import { api, baixarGet, baixarPost } from '../api';
import { Campo, Carregando, DocumentoView, Erro, Etiqueta, SemEmpresa, Tabs, Vazio } from '../componentes';
import { useApp, useCarregar } from '../contexto';
import { bytes, competencia as fmtComp, dataHora, documentoEmpresa } from '../formato';

type Aba = 'gerar' | 'historico' | 'mapa' | 'modelo';

interface Historico {
  id: number;
  tipo: string;
  titulo: string;
  formato: string;
  emp_chave: string;
  competencia: string | null;
  gerado_em: string;
  tamanho: number;
  qtd_pendencias: number;
  nome_arquivo: string;
}

function lerSessao(chave: string) {
  try {
    const v = sessionStorage.getItem(chave) ?? '';
    sessionStorage.removeItem(chave);
    return v;
  } catch {
    return '';
  }
}

export function Relatorios({ tipo, auto }: { tipo?: string; auto?: boolean }) {
  const { empresa, competencia, competencias, notificar, versaoDados } = useApp();
  const catalogo = useCarregar(() => api.get<DefinicaoRelatorio[]>('/api/relatorios/catalogo'), []);
  const [aba, setAba] = useState<Aba>('gerar');
  const tipoAtual = tipo ?? 'extrato';
  const def = catalogo.dados?.find((d) => d.tipo === tipoAtual);
  const [params, setParams] = useState<Record<string, string | boolean>>({});
  const [doc, setDoc] = useState<Documento | null>(null);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState('');
  const [mostrarOrigem, setMostrarOrigem] = useState(true);
  const [exportando, setExportando] = useState('');

  // parâmetros padrão a cada troca de relatório
  useEffect(() => {
    if (!def) return;
    const p: Record<string, string | boolean> = {};
    for (const x of def.parametros) if (x.padrao !== undefined) p[x.id] = x.padrao;
    p.competencia = competencia;
    const ord = [...competencias].sort();
    p.perIni = ord[0] ?? competencia;
    p.perFim = ord[ord.length - 1] ?? competencia;
    const trab = lerSessao('folha.trabalhador');
    if (trab) p.trabalhador = trab;
    setParams(p);
    setDoc(null);
    setErro('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def?.tipo]);
  useEffect(() => setParams((p) => ({ ...p, competencia })), [competencia]);

  const corpo = () => {
    const ids = new Set<string>();
    for (const p of def?.parametros ?? []) {
      if (p.tipo === 'periodo') {
        ids.add('perIni');
        ids.add('perFim');
      } else ids.add(p.id);
    }
    const enviados = Object.fromEntries(Object.entries(params).filter(([k]) => ids.has(k)));
    return { tipo: tipoAtual, parametros: { ...enviados, empresa } };
  };

  const visualizar = async () => {
    setGerando(true);
    setErro('');
    try {
      setDoc(await api.post<Documento>('/api/relatorios/visualizar', corpo()));
    } catch (e) {
      setErro((e as Error).message);
      setDoc(null);
    } finally {
      setGerando(false);
    }
  };

  // #/relatorios/<tipo>/previa abre a prévia diretamente (link compartilhável)
  const [autoFeito, setAutoFeito] = useState(false);
  useEffect(() => {
    if (auto && def && empresa && params.competencia && !autoFeito) {
      setAutoFeito(true);
      visualizar();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, def?.tipo, empresa, params.competencia, autoFeito]);

  useEffect(() => {
    if (auto && doc) document.querySelector('article.documento')?.scrollIntoView({ block: 'start' });
  }, [auto, doc]);

  // atualiza a prévia depois de complementar um dado
  useEffect(() => {
    if (doc) visualizar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versaoDados]);

  const exportar = async (formato: string) => {
    setExportando(formato);
    try {
      await baixarPost('/api/relatorios/exportar', { ...corpo(), formato }, `${tipoAtual}.${formato}`);
      notificar(`Relatório exportado em ${formato.toUpperCase()} e registrado no histórico.`);
    } catch (e) {
      notificar((e as Error).message, 'erro');
    } finally {
      setExportando('');
    }
  };

  if (!empresa) return <SemEmpresa />;
  if (catalogo.carregando) return <Carregando />;
  if (catalogo.erro) return <Erro texto={catalogo.erro} />;

  return (
    <>
      <div className="cabecalho-pagina">
        <div>
          <h1>Relatórios</h1>
          <p>Relatórios gerados a partir dos XMLs importados. Cada valor mostra sua origem; os documentos são prévias para conferência profissional.</p>
        </div>
      </div>
      <Tabs
        abas={[
          { id: 'gerar', rotulo: 'Gerar' },
          { id: 'historico', rotulo: 'Histórico' },
          { id: 'mapa', rotulo: 'Mapa de campos' },
          { id: 'modelo', rotulo: 'Configurar modelo' },
        ]}
        ativa={aba}
        aoMudar={setAba}
      />
      {aba === 'gerar' && (
        <>
          <div className="cartoes-relatorio" role="list">
            {catalogo.dados!.map((d) => (
              <a
                key={d.tipo}
                role="listitem"
                href={`#/relatorios/${d.tipo}`}
                className="cartao-relatorio"
                aria-pressed={d.tipo === tipoAtual}
                style={{ textDecoration: 'none' }}
              >
                <strong>{d.titulo}</strong>
                <span className="pequeno suave">{d.descricao}</span>
                {d.referencia ? <Etiqueta classe="info">Modelo de referência</Etiqueta> : <Etiqueta classe="neutra">Relatório adicional</Etiqueta>}
              </a>
            ))}
          </div>
          {def && (
            <section className="cartao">
              <div className="cartao-titulo"><h2>{def.titulo}</h2><span className="legenda">{documentoEmpresa(empresa)}</span></div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  visualizar();
                }}
              >
                <div className="grade grade-4">
                  {def.parametros.map((p) => {
                    const id = `p-${p.id}`;
                    if (p.tipo === 'competencia')
                      return (
                        <Campo key={p.id} rotulo={p.rotulo} id={id} ajuda={params.indApuracao === '2' ? 'Para 13º, use o ano (AAAA).' : undefined}>
                          {params.indApuracao === '2' ? (
                            <input id={id} type="text" inputMode="numeric" value={String(params.competencia ?? '').slice(0, 4)} onChange={(e) => setParams({ ...params, competencia: e.target.value })} />
                          ) : (
                            <input id={id} type="month" value={String(params.competencia ?? '')} onChange={(e) => setParams({ ...params, competencia: e.target.value })} required />
                          )}
                        </Campo>
                      );
                    if (p.tipo === 'periodo')
                      return (
                        <div key={p.id} className="linha" style={{ gridColumn: 'span 2', alignItems: 'flex-end' }}>
                          <Campo rotulo="Competência inicial" id="p-ini"><input id="p-ini" type="month" value={String(params.perIni ?? '')} onChange={(e) => setParams({ ...params, perIni: e.target.value })} required /></Campo>
                          <Campo rotulo="Competência final" id="p-fim"><input id="p-fim" type="month" value={String(params.perFim ?? '')} onChange={(e) => setParams({ ...params, perFim: e.target.value })} required /></Campo>
                        </div>
                      );
                    if (p.tipo === 'selecao')
                      return (
                        <Campo key={p.id} rotulo={p.rotulo} id={id}>
                          <select id={id} value={String(params[p.id] ?? '')} onChange={(e) => setParams({ ...params, [p.id]: e.target.value })}>
                            {p.opcoes!.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
                          </select>
                        </Campo>
                      );
                    if (p.tipo === 'booleano')
                      return (
                        <div key={p.id} className="campo" style={{ justifyContent: 'flex-end' }}>
                          <label className="checkbox"><input type="checkbox" checked={!!params[p.id]} onChange={(e) => setParams({ ...params, [p.id]: e.target.checked })} /><span>{p.rotulo}</span></label>
                        </div>
                      );
                    return (
                      <Campo key={p.id} rotulo={p.rotulo} id={id} ajuda="Deixe vazio para todos.">
                        <input id={id} type="search" value={String(params[p.id] ?? '')} onChange={(e) => setParams({ ...params, [p.id]: e.target.value })} />
                      </Campo>
                    );
                  })}
                </div>
                <div className="barra-acoes" style={{ marginTop: 16 }}>
                  <button type="submit" className="botao primario" disabled={gerando}>{gerando ? 'Gerando…' : 'Visualizar prévia'}</button>
                  <span className="legenda" style={{ marginLeft: 8 }}>Exportar:</span>
                  {def.formatos.map((f) => (
                    <button key={f} type="button" className="botao" disabled={!!exportando} onClick={() => exportar(f)}>
                      {exportando === f ? 'Gerando…' : f.toUpperCase()}
                    </button>
                  ))}
                  <label className="checkbox" style={{ marginLeft: 'auto' }}>
                    <input type="checkbox" checked={mostrarOrigem} onChange={(e) => setMostrarOrigem(e.target.checked)} />
                    <span>Mostrar selos de origem na prévia</span>
                  </label>
                </div>
              </form>
            </section>
          )}
          {erro && <Erro texto={erro} />}
          {gerando && !doc && <Carregando texto="Montando o relatório a partir dos eventos…" />}
          {doc && <DocumentoView doc={doc} mostrarOrigem={mostrarOrigem} />}
          {!doc && !gerando && !erro && def && (
            <Vazio titulo="Escolha os parâmetros e clique em “Visualizar prévia”">
              <p>A prévia mostra de onde vem cada valor. Valores ausentes podem ser complementados clicando no selo “AUSENTE”.</p>
            </Vazio>
          )}
        </>
      )}
      {aba === 'historico' && <HistoricoRelatorios />}
      {aba === 'mapa' && def && <MapaCampos def={def} />}
      {aba === 'modelo' && def && <ConfigModelo def={def} doc={doc} />}
    </>
  );
}

function HistoricoRelatorios() {
  const { empresa, notificar } = useApp();
  const h = useCarregar(() => api.get<Historico[]>(`/api/relatorios/historico?empresa=${encodeURIComponent(empresa)}`), [empresa]);
  if (h.carregando && !h.dados) return <Carregando />;
  if (h.erro) return <Erro texto={h.erro} />;
  if (!h.dados?.length) return <Vazio titulo="Nenhum relatório exportado para esta empresa" />;
  return (
    <section className="cartao">
      <p className="legenda">Os arquivos exportados ficam guardados cifrados neste computador e podem ser baixados novamente.</p>
      <div className="tabela-rolagem">
        <table className="dados">
          <thead><tr><th>Relatório</th><th>Formato</th><th>Competência</th><th>Gerado em</th><th className="dir">Pendências</th><th className="dir">Tamanho</th><th>Ações</th></tr></thead>
          <tbody>
            {h.dados.map((r) => (
              <tr key={r.id}>
                <td>{r.titulo}<div className="legenda mono">{r.nome_arquivo}</div></td>
                <td>{r.formato.toUpperCase()}</td>
                <td>{fmtComp(r.competencia) || '—'}</td>
                <td>{dataHora(r.gerado_em)}</td>
                <td className="dir num">{r.qtd_pendencias}</td>
                <td className="dir num">{bytes(r.tamanho)}</td>
                <td className="linha">
                  <button className="botao pequeno" onClick={() => baixarGet(`/api/relatorios/historico/${r.id}/arquivo`, r.nome_arquivo).catch((e) => notificar(e.message, 'erro'))}>Baixar</button>
                  <button className="botao pequeno perigo" onClick={async () => { await api.del(`/api/relatorios/historico/${r.id}`); h.recarregar(); }}>Excluir</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MapaCampos({ def }: { def: DefinicaoRelatorio }) {
  const classe = (c: string) => (c.startsWith('XML') ? 'neutra' : c.startsWith('Calc') ? 'info' : 'alerta');
  return (
    <section className="cartao">
      <h2>Mapa de campos — {def.titulo}</h2>
      <p className="suave">De onde vem cada informação do relatório: evento e campo do XML, regra de cálculo (com versão) ou complemento do usuário. Campos que não forem encontrados aparecem como “ausente”, nunca como zero.</p>
      <div className="tabela-rolagem">
        <table className="dados">
          <thead><tr><th>Campo do relatório</th><th>Origem</th><th>Eventos</th><th>Caminho no XML</th><th>Regra</th><th>Observação</th></tr></thead>
          <tbody>
            {def.mapaCampos.map((m, i) => (
              <tr key={i}>
                <td><strong>{m.campo}</strong></td>
                <td><Etiqueta classe={classe(m.classe)}>{m.classe}</Etiqueta></td>
                <td>{m.eventos ?? '—'}</td>
                <td className="mono pequeno">{m.caminho ?? '—'}</td>
                <td className="pequeno">{m.regra ?? '—'}</td>
                <td className="pequeno">{m.observacao ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ConfigModelo({ def, doc }: { def: DefinicaoRelatorio; doc: Documento | null }) {
  const { notificar } = useApp();
  const m = useCarregar(() => api.get<{ titulo?: string; rodape?: string; colunasOcultas?: string[] }>(`/api/relatorios/modelos/${def.tipo}`), [def.tipo]);
  const [titulo, setTitulo] = useState('');
  const [rodape, setRodape] = useState('');
  const [ocultas, setOcultas] = useState<string[]>([]);
  useEffect(() => {
    setTitulo(m.dados?.titulo ?? '');
    setRodape(m.dados?.rodape ?? '');
    setOcultas(m.dados?.colunasOcultas ?? []);
  }, [m.dados]);
  const colunas = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const b of doc?.tipo === def.tipo ? doc.blocos : []) for (const c of b.tabela?.colunas ?? []) mapa.set(c.id, c.rotulo);
    for (const id of ocultas) if (!mapa.has(id)) mapa.set(id, id);
    return [...mapa];
  }, [doc, def.tipo, ocultas]);
  const salvar = async () => {
    try {
      await api.put(`/api/relatorios/modelos/${def.tipo}`, { titulo, rodape, colunasOcultas: ocultas });
      notificar('Modelo salvo. Vale para as próximas prévias e exportações.');
    } catch (e) {
      notificar((e as Error).message, 'erro');
    }
  };
  if (m.carregando) return <Carregando />;
  return (
    <section className="cartao pilha">
      <h2>Configurar modelo — {def.titulo}</h2>
      <div className="grade grade-2">
        <Campo rotulo="Título personalizado" id="m-titulo" ajuda={`Em branco usa “${def.titulo}”.`}><input id="m-titulo" type="text" value={titulo} onChange={(e) => setTitulo(e.target.value)} /></Campo>
        <Campo rotulo="Texto complementar do cabeçalho" id="m-rodape"><input id="m-rodape" type="text" value={rodape} onChange={(e) => setRodape(e.target.value)} /></Campo>
      </div>
      <div>
        <h3>Colunas das tabelas</h3>
        {!colunas.length ? <p className="suave">Gere uma prévia deste relatório para escolher as colunas visíveis.</p> : (
          <div className="linha" style={{ marginTop: 8 }}>
            {colunas.map(([id, rotulo]) => (
              <label key={id} className="checkbox"><input type="checkbox" checked={!ocultas.includes(id)} onChange={(e) => setOcultas(e.target.checked ? ocultas.filter((x) => x !== id) : [...ocultas, id])} /><span>{rotulo}</span></label>
            ))}
          </div>
        )}
      </div>
      <p className="legenda">Nome, CNPJ e logotipo do seu escritório para o cabeçalho dos relatórios: <a href="#/configuracoes/marca">Configurações › Marca</a>.</p>
      <div className="linha fim"><button className="botao primario" onClick={salvar}>Salvar modelo</button></div>
    </section>
  );
}
