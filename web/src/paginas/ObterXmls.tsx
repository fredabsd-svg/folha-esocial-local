import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { Campo, Carregando, Erro, Etiqueta, Modal } from '../componentes';
import { useApp, useCarregar } from '../contexto';
import { bytes, data, dataHora, documentoEmpresa } from '../formato';

interface Portal {
  urlLogin: string;
  urlDocumentacao: string;
  orientacoes: { fonte: string; itens: string[] };
}
interface Solicitacao {
  id: number;
  emp_chave: string;
  documento_confirmado: string;
  perfil: string;
  tipo_solicitacao: string;
  periodo_inicio: string | null;
  periodo_fim: string | null;
  cpf_trabalhador: string | null;
  status: string;
  observacao: string | null;
  confirmado_em: string;
  atualizado_em: string;
}
interface Pasta {
  config: { caminho?: string; ativo: boolean; autoImportar: boolean; ativadoEm?: string };
  arquivos: Array<{ nome: string; tamanho: number; modificadoEm: string; jaImportado: boolean; importacaoId?: number }>;
}

const PERFIS = [
  'Titular (o próprio empregador)',
  'Responsável legal da empresa',
  'Procurador (verificar se a procuração permite o Download)',
];
const TIPOS = [
  'Todos os eventos entregues no período',
  'Eventos de um trabalhador',
  'Eventos enviados pela aplicação web',
  'Tabela de estabelecimentos/obras/unidades',
  'Tabela de rubricas',
  'Tabela de lotações tributárias',
  'Tabela de processos',
];
const STATUS: Record<string, string> = {
  aguardando_portal: 'Aguardando pedido no portal',
  solicitado: 'Pedido feito no portal',
  disponivel: 'Disponível para baixar',
  baixado: 'Baixado',
  importado: 'Importado',
  expirado: 'Expirado no portal',
  cancelado: 'Cancelado',
};

export function ObterXmls() {
  const { empresas, empresa: empSel, notificar, dadosAlterados } = useApp();
  const portal = useCarregar(() => api.get<Portal>('/api/portal'), []);
  const sols = useCarregar(() => api.get<Solicitacao[]>('/api/solicitacoes'), []);
  const [emp, setEmp] = useState(empSel);
  const [perfil, setPerfil] = useState('');
  const [tipo, setTipo] = useState(TIPOS[0]);
  const [ini, setIni] = useState('');
  const [fim, setFim] = useState('');
  const [cpfTrab, setCpfTrab] = useState('');
  const [docDigitado, setDocDigitado] = useState('');
  const [confirmado, setConfirmado] = useState(false);
  const [erro, setErro] = useState('');
  const [aberto, setAberto] = useState<number | null>(null);
  const [importarPara, setImportarPara] = useState<number | null>(null);
  const arquivoRef = useRef<HTMLInputElement>(null);

  useEffect(() => setEmp((e) => e || empSel), [empSel]);
  const empresa = empresas.find((e) => e.chave === emp);
  const docEsperado = empresa?.documento_completo ?? empresa?.nr_insc ?? '';
  const docConfere = !!docEsperado && docDigitado.replace(/[^0-9A-Za-z]/g, '').toUpperCase() === docEsperado.toUpperCase();
  const podeIniciar = !!empresa && !!perfil && docConfere && confirmado && (tipo !== TIPOS[1] || cpfTrab.replace(/\D/g, '').length === 11);

  const iniciar = async () => {
    setErro('');
    try {
      const r = await api.post<{ id: number }>('/api/solicitacoes', {
        empresa: emp,
        documentoConfirmado: docDigitado,
        confirmado,
        perfil,
        tipoSolicitacao: tipo,
        periodoInicio: ini || undefined,
        periodoFim: fim || undefined,
        cpfTrabalhador: cpfTrab || undefined,
      });
      setAberto(r.id);
      sols.recarregar();
      window.open(portal.dados?.urlLogin, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setErro((e as Error).message);
    }
  };

  const mudarStatus = async (id: number, status: string) => {
    await api.put(`/api/solicitacoes/${id}`, { status });
    sols.recarregar();
  };

  const enviar = async (arquivos: FileList | null, solicitacaoId: number | null) => {
    if (!arquivos?.length) return;
    const fd = new FormData();
    if (solicitacaoId) fd.append('solicitacaoId', String(solicitacaoId));
    for (const f of Array.from(arquivos)) fd.append('arquivos', f, f.name);
    try {
      const r = await api.enviar<Array<{ importacaoId: number; eventos: { encontrados: number; novos: number } }>>('/api/importacoes', fd);
      notificar(`${r.length} arquivo(s) importado(s): ${r.reduce((a, x) => a + x.eventos.novos, 0)} evento(s) novo(s).`);
      dadosAlterados();
      sols.recarregar();
      if (r.length === 1) window.location.hash = `#/importacoes/${r[0].importacaoId}`;
    } catch (e) {
      notificar((e as Error).message, 'erro');
    }
  };

  return (
    <>
      <div className="cabecalho-pagina">
        <div>
          <h1>Obter XMLs pelo eSocial Download</h1>
          <p>Fluxo assistido: você faz o login e o pedido no portal oficial, em uma janela do seu navegador; depois importa aqui o ZIP baixado.</p>
        </div>
      </div>

      <div className="aviso info">
        <div>
          <strong>Suas credenciais ficam só com o Gov.br</strong>
          O login acontece no site oficial, em uma aba do navegador. Este sistema não pede, não vê e não guarda senha, código de autenticação, certificado, token ou cookie. Ele também não controla o portal nem usa serviços internos não documentados: o eSocial Download é uma funcionalidade da aplicação web do eSocial e, segundo o comunicado oficial, não há opção equivalente por webservice. Por isso, o pedido e o download são feitos por você, e a importação é feita aqui.
        </div>
      </div>

      <div className="grade grade-2">
        <section className="cartao">
          <h2>Nova consulta</h2>
          <div className="etapas" style={{ marginTop: 12 }}>
            <div className={`etapa ${empresa ? 'feita' : ''}`}>
              <span className="n">1</span>
              <div className="pilha">
                <Campo rotulo="Empresa ou pessoa a consultar" id="obt-emp" ajuda="Cadastre novas empresas em Cadastros › Empresas.">
                  <select id="obt-emp" value={emp} onChange={(e) => { setEmp(e.target.value); setDocDigitado(''); setConfirmado(false); }}>
                    <option value="">Selecione…</option>
                    {empresas.map((e) => <option key={e.chave} value={e.chave}>{e.razao_social ?? 'Sem razão social'} — {documentoEmpresa(e.chave, e.documento_completo)}</option>)}
                  </select>
                </Campo>
                {empresa && !empresa.documento_completo && (
                  <span className="legenda">Esta empresa só tem a raiz do CNPJ. Para confirmar pelo número completo, complete o cadastro em Empresas; aqui a confirmação usa a raiz ({empresa.nr_insc}).</span>
                )}
              </div>
            </div>
            <div className={`etapa ${perfil ? 'feita' : ''}`}>
              <span className="n">2</span>
              <div className="pilha">
                <Campo rotulo="Perfil com que você acessará o portal" id="obt-perfil">
                  <select id="obt-perfil" value={perfil} onChange={(e) => setPerfil(e.target.value)}>
                    <option value="">Selecione…</option>
                    {PERFIS.map((p) => <option key={p}>{p}</option>)}
                  </select>
                </Campo>
                {perfil.startsWith('Procurador') && (
                  <div className="aviso alerta"><div>O comunicado oficial informa que o menu Download é restrito ao titular e ao responsável legal. Antes de continuar, verifique no portal se o seu perfil de procurador tem acesso a essa função. Se não tiver, o próprio cliente precisa fazer o download.</div></div>
                )}
                <Campo rotulo="Tipo de pedido" id="obt-tipo">
                  <select id="obt-tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
                    {TIPOS.map((t) => <option key={t}>{t}</option>)}
                  </select>
                </Campo>
                <div className="grade grade-2">
                  <Campo rotulo="Data inicial" id="obt-ini"><input id="obt-ini" type="date" value={ini} onChange={(e) => setIni(e.target.value)} /></Campo>
                  <Campo rotulo="Data final" id="obt-fim"><input id="obt-fim" type="date" value={fim} onChange={(e) => setFim(e.target.value)} /></Campo>
                </div>
                {tipo === TIPOS[1] && (
                  <Campo rotulo="CPF do trabalhador" id="obt-cpf"><input id="obt-cpf" type="text" inputMode="numeric" value={cpfTrab} onChange={(e) => setCpfTrab(e.target.value)} /></Campo>
                )}
                <span className="legenda">O portal define os limites de período, quantidade de pedidos e volume. Este sistema não impõe esses limites: siga o que o portal mostrar.</span>
              </div>
            </div>
            <div className={`etapa ${docConfere && confirmado ? 'feita' : ''}`}>
              <span className="n">3</span>
              <div className="pilha">
                {empresa ? (
                  <div className="aviso alerta">
                    <div>
                      Você vai consultar os dados de <strong style={{ display: 'inline' }}>{empresa.razao_social ?? 'empresa sem razão social cadastrada'}</strong>
                      {' — '}
                      <strong style={{ display: 'inline' }}>{documentoEmpresa(empresa.chave, empresa.documento_completo)}</strong>. Confira antes de continuar.
                    </div>
                  </div>
                ) : <p className="suave">Selecione a empresa para confirmar.</p>}
                <Campo rotulo={`Digite o ${empresa?.tp_insc === '2' ? 'CPF' : 'CNPJ'} para confirmar`} id="obt-doc" ajuda={empresa?.documento_completo ? 'Número completo, com ou sem pontuação.' : 'Raiz do CNPJ (8 posições).'}>
                  <input id="obt-doc" type="text" value={docDigitado} onChange={(e) => setDocDigitado(e.target.value)} disabled={!empresa} aria-invalid={!!docDigitado && !docConfere} />
                </Campo>
                {!!docDigitado && !docConfere && <span className="legenda" style={{ color: 'var(--cor-erro)' }}>O número digitado não confere com o cadastro.</span>}
                <label className="checkbox">
                  <input type="checkbox" checked={confirmado} onChange={(e) => setConfirmado(e.target.checked)} disabled={!empresa} />
                  <span>Confirmo que este é o CPF/CNPJ correto e que tenho autorização (titularidade, representação legal ou procuração vigente) para consultar estes dados no eSocial.</span>
                </label>
                {erro && <Erro texto={erro} />}
                <button className="botao primario" disabled={!podeIniciar || !portal.dados} onClick={iniciar}>
                  Registrar e abrir o portal oficial do eSocial
                </button>
                <span className="legenda">Abre {portal.dados?.urlLogin ?? 'o portal'} em nova aba. Endereço configurável em Configurações (somente domínios .gov.br).</span>
              </div>
            </div>
          </div>
        </section>

        <section className="cartao">
          <h2>No portal oficial</h2>
          {portal.carregando ? <Carregando /> : portal.erro ? <Erro texto={portal.erro} /> : (
            <div className="pilha" style={{ marginTop: 12 }}>
              <ol className="pilha" style={{ paddingLeft: 20, margin: 0 }}>
                <li>Faça login pelo Gov.br e selecione o perfil e o empregador conferidos ao lado.</li>
                {portal.dados!.orientacoes.itens.map((t, i) => <li key={i}>{t}</li>)}
                <li>Volte aqui e importe o ZIP baixado (abaixo), ou ative a pasta monitorada.</li>
              </ol>
              <span className="legenda">Fonte das orientações: {portal.dados!.orientacoes.fonte}. <a href={portal.dados!.urlDocumentacao} target="_blank" rel="noopener noreferrer">Documentação técnica oficial</a></span>
              <hr />
              <h3>Importar o arquivo baixado</h3>
              <div
                className="soltar"
                role="button"
                tabIndex={0}
                onClick={() => { setImportarPara(aberto); arquivoRef.current?.click(); }}
                onKeyDown={(e) => e.key === 'Enter' && arquivoRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); enviar(e.dataTransfer.files, aberto); }}
              >
                <strong>Arraste o ZIP/XML aqui ou clique para escolher</strong>
                <div className="legenda">{aberto ? `Será vinculado à solicitação nº ${aberto}.` : 'Os arquivos originais são preservados sem alteração.'}</div>
              </div>
              <input ref={arquivoRef} type="file" accept=".zip,.xml" multiple hidden onChange={(e) => { enviar(e.target.files, importarPara); e.target.value = ''; }} />
            </div>
          )}
        </section>
      </div>

      <PastaMonitorada />

      <section className="cartao">
        <div className="cartao-titulo"><h2>Solicitações registradas</h2><span className="legenda">Acompanhe o que foi pedido no portal e o que já foi importado.</span></div>
        {sols.carregando ? <Carregando /> : !sols.dados?.length ? <p className="suave">Nenhuma solicitação registrada.</p> : (
          <div className="tabela-rolagem">
            <table className="dados">
              <thead><tr><th>Nº</th><th>Empresa</th><th>Tipo</th><th>Período</th><th>Perfil</th><th>Confirmado em</th><th>Situação</th><th>Ações</th></tr></thead>
              <tbody>
                {sols.dados.map((s) => (
                  <tr key={s.id}>
                    <td>{s.id}</td>
                    <td>{empresas.find((e) => e.chave === s.emp_chave)?.razao_social ?? s.emp_chave}</td>
                    <td>{s.tipo_solicitacao}{s.cpf_trabalhador ? ` (CPF ${s.cpf_trabalhador})` : ''}</td>
                    <td>{s.periodo_inicio ? `${data(s.periodo_inicio)} a ${data(s.periodo_fim)}` : '—'}</td>
                    <td>{s.perfil}</td>
                    <td>{dataHora(s.confirmado_em)}</td>
                    <td>
                      <label className="sr-only" htmlFor={`st-${s.id}`}>Situação</label>
                      <select id={`st-${s.id}`} value={s.status} onChange={(e) => mudarStatus(s.id, e.target.value)}>
                        {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </td>
                    <td className="linha">
                      <button className="botao pequeno" onClick={() => { setImportarPara(s.id); arquivoRef.current?.click(); }}>Importar arquivo</button>
                      <button className="botao pequeno perigo" onClick={async () => { await api.del(`/api/solicitacoes/${s.id}`); sols.recarregar(); }}>Remover</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {aberto && (
        <Modal titulo="Portal aberto em nova aba" aoFechar={() => setAberto(null)}>
          <p>A solicitação nº {aberto} foi registrada. Faça o login e o pedido no portal oficial. Quando o arquivo estiver disponível e baixado, importe-o nesta página.</p>
          <p className="suave">Se a nova aba não abriu (bloqueador de pop-up), use o link: <a href={portal.dados?.urlLogin} target="_blank" rel="noopener noreferrer">{portal.dados?.urlLogin}</a></p>
          <div className="linha fim"><button className="botao primario" onClick={() => setAberto(null)}>Entendi</button></div>
        </Modal>
      )}
    </>
  );
}

function PastaMonitorada() {
  const { notificar, dadosAlterados } = useApp();
  const pasta = useCarregar(() => api.get<Pasta>('/api/pasta'), []);
  const [caminho, setCaminho] = useState('');
  const [sel, setSel] = useState<string[]>([]);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    if (pasta.dados?.config.caminho) setCaminho(pasta.dados.config.caminho);
  }, [pasta.dados?.config.caminho]);
  useEffect(() => {
    if (!pasta.dados?.config.ativo) return;
    const t = window.setInterval(() => pasta.recarregar(), 10000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pasta.dados?.config.ativo]);

  const salvar = async (c: Record<string, unknown>) => {
    try {
      await api.put('/api/pasta', c);
      pasta.recarregar();
    } catch (e) {
      notificar((e as Error).message, 'erro');
    }
  };
  const importar = async () => {
    setOcupado(true);
    try {
      const r = await api.post<unknown[]>('/api/pasta/importar', { arquivos: sel });
      notificar(`${r.length} arquivo(s) importado(s) da pasta.`);
      setSel([]);
      dadosAlterados();
      pasta.recarregar();
    } catch (e) {
      notificar((e as Error).message, 'erro');
    } finally {
      setOcupado(false);
    }
  };
  const cfg = pasta.dados?.config;
  return (
    <section className="cartao">
      <div className="cartao-titulo">
        <h2>Pasta monitorada (opcional)</h2>
        {cfg?.ativo ? <Etiqueta classe="ok">Ativa</Etiqueta> : <Etiqueta classe="neutra">Inativa</Etiqueta>}
      </div>
      <p className="suave">Indique a pasta onde o navegador salva os downloads. O sistema lista os ZIP/XML encontrados para você importar. Os arquivos da pasta nunca são alterados, movidos ou apagados.</p>
      <div className="linha" style={{ alignItems: 'flex-end' }}>
        <div className="campo" style={{ flex: '1 1 320px' }}>
          <label htmlFor="pasta-caminho">Caminho da pasta</label>
          <input id="pasta-caminho" type="text" placeholder="Ex.: C:\Users\seu.usuario\Downloads" value={caminho} onChange={(e) => setCaminho(e.target.value)} />
        </div>
        <button className="botao" onClick={() => salvar({ caminho })} disabled={!caminho.trim()}>Salvar pasta</button>
        <button className="botao" onClick={() => salvar({ ativo: !cfg?.ativo })} disabled={!cfg?.caminho}>{cfg?.ativo ? 'Desativar' : 'Ativar'}</button>
        <label className="checkbox">
          <input type="checkbox" checked={!!cfg?.autoImportar} onChange={(e) => salvar({ autoImportar: e.target.checked })} disabled={!cfg?.ativo} />
          <span>Importar automaticamente arquivos novos</span>
        </label>
      </div>
      {pasta.erro && <Erro texto={pasta.erro} />}
      {cfg?.caminho && (
        <div className="pilha" style={{ marginTop: 12 }}>
          {!pasta.dados?.arquivos.length ? <p className="suave">Nenhum ZIP/XML na pasta.</p> : (
            <>
              <div className="tabela-rolagem" style={{ maxHeight: 300 }}>
                <table className="dados">
                  <thead><tr><th><span className="sr-only">Selecionar</span></th><th>Arquivo</th><th className="dir">Tamanho</th><th>Modificado</th><th>Situação</th></tr></thead>
                  <tbody>
                    {pasta.dados.arquivos.map((a) => (
                      <tr key={a.nome}>
                        <td><input type="checkbox" aria-label={`Selecionar ${a.nome}`} checked={sel.includes(a.nome)} onChange={(e) => setSel(e.target.checked ? [...sel, a.nome] : sel.filter((x) => x !== a.nome))} /></td>
                        <td style={{ overflowWrap: 'anywhere' }}>{a.nome}</td>
                        <td className="dir num">{bytes(a.tamanho)}</td>
                        <td>{dataHora(a.modificadoEm)}</td>
                        <td>{a.jaImportado ? <a href={`#/importacoes/${a.importacaoId}`}><Etiqueta classe="ok">Já importado</Etiqueta></a> : <Etiqueta classe="info">Novo</Etiqueta>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="linha fim"><button className="botao primario" disabled={!sel.length || ocupado} onClick={importar}>{ocupado ? 'Importando…' : `Importar ${sel.length} selecionado(s)`}</button></div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
