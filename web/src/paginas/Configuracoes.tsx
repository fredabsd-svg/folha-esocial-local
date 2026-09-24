import { useEffect, useRef, useState } from 'react';
import type { Marca } from '../../../server/src/compartilhado/tipos';
import { api, baixarPost } from '../api';
import { Campo, Carregando, Erro, Etiqueta, Modal, Tabs } from '../componentes';
import { useApp, useCarregar } from '../contexto';
import { bytes, dataHora, STATUS_XSD } from '../formato';

type Aba = 'marca' | 'tabelas' | 'xsd' | 'dados' | 'portal' | 'auditoria';

export function Configuracoes({ aba: abaRota }: { aba?: string }) {
  const [aba, setAba] = useState<Aba>((abaRota as Aba) ?? 'marca');
  useEffect(() => {
    if (abaRota) setAba(abaRota as Aba);
  }, [abaRota]);
  return (
    <>
      <div className="cabecalho-pagina">
        <div>
          <h1>Configurações</h1>
          <p>Marca dos relatórios, tabelas legais com vigência, esquemas XSD oficiais, dados locais (backup e exclusão) e privacidade.</p>
        </div>
      </div>
      <Tabs
        abas={[
          { id: 'marca', rotulo: 'Marca dos relatórios' },
          { id: 'tabelas', rotulo: 'Tabelas de cálculo' },
          { id: 'xsd', rotulo: 'Esquemas XSD' },
          { id: 'dados', rotulo: 'Dados, backup e exclusão' },
          { id: 'portal', rotulo: 'Portal e privacidade' },
          { id: 'auditoria', rotulo: 'Registro de atividades' },
        ]}
        ativa={aba}
        aoMudar={(a) => { setAba(a); window.history.replaceState(null, '', `#/configuracoes/${a}`); }}
      />
      {aba === 'marca' && <MarcaCfg />}
      {aba === 'tabelas' && <TabelasCfg />}
      {aba === 'xsd' && <XsdCfg />}
      {aba === 'dados' && <DadosCfg />}
      {aba === 'portal' && <PortalCfg />}
      {aba === 'auditoria' && <Auditoria />}
    </>
  );
}

function MarcaCfg() {
  const { notificar } = useApp();
  const m = useCarregar(() => api.get<Marca>('/api/config/marca'), []);
  const [f, setF] = useState<Marca>({});
  useEffect(() => setF(m.dados ?? {}), [m.dados]);
  const carregarLogo = (arq?: File) => {
    if (!arq) return;
    if (!/^image\/(png|jpeg)$/.test(arq.type)) return notificar('Use PNG ou JPEG.', 'erro');
    if (arq.size > 500 * 1024) return notificar('Logotipo acima de 500 KB.', 'erro');
    const r = new FileReader();
    r.onload = () => setF((x) => ({ ...x, logoDataUrl: String(r.result) }));
    r.readAsDataURL(arq);
  };
  const salvar = async () => {
    try {
      await api.put('/api/config/marca', f);
      notificar('Marca salva. Aparecerá no cabeçalho dos relatórios.');
    } catch (e) {
      notificar((e as Error).message, 'erro');
    }
  };
  if (m.carregando) return <Carregando />;
  return (
    <section className="cartao pilha">
      <h2>Identidade do seu escritório</h2>
      <p className="suave">Os relatórios usam modelos próprios deste sistema. Aqui você define os dados e o logotipo do seu escritório, exibidos no cabeçalho.</p>
      <div className="grade grade-2">
        <Campo rotulo="Nome do escritório" id="mc-nome"><input id="mc-nome" type="text" value={f.nome ?? ''} onChange={(e) => setF({ ...f, nome: e.target.value })} /></Campo>
        <Campo rotulo="CNPJ / CRC" id="mc-doc"><input id="mc-doc" type="text" value={f.documento ?? ''} onChange={(e) => setF({ ...f, documento: e.target.value })} /></Campo>
        <Campo rotulo="Endereço" id="mc-end"><input id="mc-end" type="text" value={f.endereco ?? ''} onChange={(e) => setF({ ...f, endereco: e.target.value })} /></Campo>
        <Campo rotulo="Contato" id="mc-cont"><input id="mc-cont" type="text" value={f.contato ?? ''} onChange={(e) => setF({ ...f, contato: e.target.value })} /></Campo>
      </div>
      <div className="linha">
        <Campo rotulo="Logotipo (PNG ou JPEG, até 500 KB)" id="mc-logo"><input id="mc-logo" type="file" accept="image/png,image/jpeg" onChange={(e) => carregarLogo(e.target.files?.[0])} /></Campo>
        {f.logoDataUrl && <img src={f.logoDataUrl} alt="Logotipo atual" style={{ maxHeight: 48, maxWidth: 180 }} />}
        {f.logoDataUrl && <button className="botao pequeno" onClick={() => setF({ ...f, logoDataUrl: undefined })}>Remover logotipo</button>}
      </div>
      <div className="linha fim"><button className="botao primario" onClick={salvar}>Salvar</button></div>
    </section>
  );
}

interface Conjunto {
  versao: string;
  atualizadoEm: string;
  origem: string;
  observacao?: string;
  inss: Array<{ id: string; vigenciaInicio: string; vigenciaFim?: string | null; teto: number; faixas: Array<{ ate: number; aliquota: number }>; fonte: string }>;
  irrf: Array<{ id: string; vigenciaInicio: string; vigenciaFim?: string | null; faixas: Array<{ ate: number | null; aliquota: number; deducao: number }>; deducaoDependente: number; descontoSimplificado: number; reducao?: { limiteIsencao: number; limiteReducao: number; constante: number; coeficiente: number } | null; fonte: string }>;
  fgts: Array<{ id: string; aliquota: number; aliquotaAprendiz: number; fonte: string }>;
  salarioMinimo: Array<{ id: string; vigenciaInicio: string; valor: number; fonte: string }>;
  toleranciaConferencia: number;
}

function TabelasCfg() {
  const { notificar, dadosAlterados } = useApp();
  const t = useCarregar(() => api.get<{ vigente: Conjunto; padrao: Conjunto }>('/api/tabelas'), []);
  const [editar, setEditar] = useState(false);
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState('');
  if (t.carregando) return <Carregando />;
  if (t.erro) return <Erro texto={t.erro} />;
  const v = t.dados!.vigente;
  const n = (x: number) => x.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const p = (x: number) => `${(x * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
  const salvar = async () => {
    setErro('');
    try {
      await api.put('/api/tabelas', JSON.parse(texto));
      notificar('Tabelas atualizadas. Os recálculos passam a usar a nova versão.');
      setEditar(false);
      t.recarregar();
      dadosAlterados();
    } catch (e) {
      setErro(e instanceof SyntaxError ? 'JSON inválido.' : (e as Error).message);
    }
  };
  return (
    <>
      <section className="cartao pilha">
        <div className="cartao-titulo">
          <h2>Conjunto em uso: versão {v.versao} ({v.origem === 'padrao' ? 'padrão do sistema' : 'personalizado'})</h2>
          <div className="linha">
            <button className="botao" onClick={() => { setTexto(JSON.stringify(v, null, 2)); setEditar(true); }}>Editar/importar JSON</button>
            {v.origem !== 'padrao' && <button className="botao perigo" onClick={async () => { await api.del('/api/tabelas'); t.recarregar(); dadosAlterados(); }}>Voltar ao padrão</button>}
          </div>
        </div>
        <p className="suave">{v.observacao} Conferido em {v.atualizadoEm}. Competências sem tabela cadastrada geram cálculo “incompleto” — o sistema não aplica tabela de outro período. Tolerância de conferência: R$ {n(v.toleranciaConferencia)}.</p>
      </section>
      <div className="grade grade-2">
        {v.inss.map((x) => (
          <section className="cartao" key={x.id}>
            <h3>INSS {x.id} — {x.vigenciaInicio} a {x.vigenciaFim ?? 'atual'}</h3>
            <table className="dados" style={{ marginTop: 8 }}><thead><tr><th>Até</th><th className="dir">Alíquota</th></tr></thead><tbody>{x.faixas.map((f, i) => <tr key={i}><td className="num">R$ {n(f.ate)}</td><td className="dir num">{p(f.aliquota)}</td></tr>)}</tbody></table>
            <p className="legenda" style={{ marginTop: 8 }}>Teto R$ {n(x.teto)} · Fonte: {x.fonte}</p>
          </section>
        ))}
        {v.irrf.map((x) => (
          <section className="cartao" key={x.id}>
            <h3>IRRF {x.id} — {x.vigenciaInicio} a {x.vigenciaFim ?? 'atual'}</h3>
            <table className="dados" style={{ marginTop: 8 }}><thead><tr><th>Base até</th><th className="dir">Alíquota</th><th className="dir">Parcela a deduzir</th></tr></thead><tbody>{x.faixas.map((f, i) => <tr key={i}><td className="num">{f.ate === null ? 'acima' : `R$ ${n(f.ate)}`}</td><td className="dir num">{p(f.aliquota)}</td><td className="dir num">R$ {n(f.deducao)}</td></tr>)}</tbody></table>
            <p className="legenda" style={{ marginTop: 8 }}>
              Dependente R$ {n(x.deducaoDependente)} · Desconto simplificado R$ {n(x.descontoSimplificado)}
              {x.reducao && <> · Redutor: até R$ {n(x.reducao.limiteIsencao)} zera o imposto; até R$ {n(x.reducao.limiteReducao)} redução = {n(x.reducao.constante)} − {x.reducao.coeficiente} × rendimentos</>}
              <br />Fonte: {x.fonte}
            </p>
          </section>
        ))}
        <section className="cartao">
          <h3>FGTS e salário mínimo</h3>
          {v.fgts.map((x) => <p key={x.id} className="pequeno">FGTS {p(x.aliquota)} (aprendiz {p(x.aliquotaAprendiz)}) — {x.fonte}</p>)}
          {v.salarioMinimo.map((x) => <p key={x.id} className="pequeno">Salário mínimo a partir de {x.vigenciaInicio}: R$ {n(x.valor)} — {x.fonte}</p>)}
        </section>
      </div>
      {editar && (
        <Modal titulo="Editar tabelas (JSON)" aoFechar={() => setEditar(false)}>
          <p className="legenda">Mantenha a estrutura. Cada tabela exige id, vigenciaInicio (AAAA-MM), valores e fonte (norma). A versão anterior pode ser restaurada com “Voltar ao padrão”.</p>
          <textarea aria-label="Conteúdo JSON das tabelas" rows={18} value={texto} onChange={(e) => setTexto(e.target.value)} />
          {erro && <Erro texto={erro} />}
          <div className="linha fim"><button className="botao" onClick={() => setEditar(false)}>Cancelar</button><button className="botao primario" onClick={salvar}>Validar e salvar</button></div>
        </Modal>
      )}
    </>
  );
}

function XsdCfg() {
  const { notificar } = useApp();
  const x = useCarregar(() => api.get<{ pacotes: Array<{ id: string; nome: string; importadoEm: string; arquivos: string[]; namespaces: Record<string, string> }>; status: Array<{ xsd_status: string; n: number }> }>('/api/xsd'), []);
  const ref = useRef<HTMLInputElement>(null);
  const [ocupado, setOcupado] = useState(false);
  const enviar = async (f?: File) => {
    if (!f) return;
    setOcupado(true);
    const fd = new FormData();
    fd.append('arquivo', f, f.name);
    try {
      await api.enviar('/api/xsd', fd);
      notificar('Pacote de esquemas importado. A validação dos eventos foi iniciada.');
      x.recarregar();
    } catch (e) {
      notificar((e as Error).message, 'erro');
    } finally {
      setOcupado(false);
    }
  };
  const validar = async () => {
    setOcupado(true);
    try {
      const r = await api.post<{ validados: number; invalidos: number; semXsd: number }>('/api/xsd/validar');
      notificar(`Validação concluída: ${r.validados} válidos, ${r.invalidos} inválidos, ${r.semXsd} sem esquema.`);
      x.recarregar();
    } catch (e) {
      notificar((e as Error).message, 'erro');
    } finally {
      setOcupado(false);
    }
  };
  if (x.carregando) return <Carregando />;
  return (
    <section className="cartao pilha">
      <h2>Esquemas XSD oficiais</h2>
      <p className="suave">
        Baixe o pacote de esquemas XSD vigente na <a href="https://www.gov.br/esocial/pt-br/documentacao-tecnica" target="_blank" rel="noopener noreferrer">Documentação Técnica do eSocial</a> e importe o ZIP aqui. Cada evento é validado contra o esquema do seu namespace (versão do leiaute), localmente, sem acesso à internet.
      </p>
      <div className="linha">
        <button className="botao primario" disabled={ocupado} onClick={() => ref.current?.click()}>{ocupado ? 'Processando…' : 'Importar pacote XSD (.zip)'}</button>
        <button className="botao" disabled={ocupado || !x.dados?.pacotes.length} onClick={validar}>Validar todos os eventos novamente</button>
        <input ref={ref} type="file" accept=".zip" hidden onChange={(e) => { enviar(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      <div className="linha">{x.dados?.status.map((s) => <Etiqueta key={s.xsd_status} classe={STATUS_XSD[s.xsd_status]?.classe ?? 'neutra'}>{STATUS_XSD[s.xsd_status]?.rotulo ?? s.xsd_status}: {s.n}</Etiqueta>)}</div>
      {!x.dados?.pacotes.length ? <div className="aviso alerta"><div>Nenhum pacote importado: os eventos ficam como “Sem XSD”. A leitura e os relatórios funcionam normalmente; a validação estrutural fica pendente.</div></div> : (
        <table className="dados">
          <thead><tr><th>Pacote</th><th>Importado em</th><th className="dir">Arquivos</th><th>Eventos cobertos</th><th></th></tr></thead>
          <tbody>
            {x.dados.pacotes.map((p) => (
              <tr key={p.id}>
                <td>{p.nome}</td>
                <td>{dataHora(p.importadoEm)}</td>
                <td className="dir num">{p.arquivos.length}</td>
                <td className="pequeno">{Object.values(p.namespaces).length} esquemas de evento</td>
                <td><button className="botao pequeno perigo" onClick={async () => { await api.del(`/api/xsd/${p.id}`); x.recarregar(); }}>Remover</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function DadosCfg() {
  const { notificar, dadosAlterados } = useApp();
  const d = useCarregar(() => api.get<{ diretorio: string; protecao: string; tamanho: { bytes: number; arquivos: number }; contagens: Record<string, number>; envioExterno: string }>('/api/dados'), []);
  const [senha, setSenha] = useState('');
  const [senha2, setSenha2] = useState('');
  const [rest, setRest] = useState<{ arquivo?: File; senha: string; conf: string } | null>(null);
  const [excluir, setExcluir] = useState(false);
  const [conf, setConf] = useState('');
  const [ocupado, setOcupado] = useState(false);
  if (d.carregando) return <Carregando />;
  if (d.erro) return <Erro texto={d.erro} />;
  const info = d.dados!;
  const backup = async () => {
    setOcupado(true);
    try {
      await baixarPost('/api/dados/backup', { senha }, 'backup.folhabak');
      notificar('Backup gerado. Guarde a senha: sem ela não é possível restaurar.');
      setSenha('');
      setSenha2('');
    } catch (e) {
      notificar((e as Error).message, 'erro');
    } finally {
      setOcupado(false);
    }
  };
  const restaurar = async () => {
    if (!rest?.arquivo) return;
    setOcupado(true);
    const fd = new FormData();
    fd.append('senha', rest.senha);
    fd.append('confirmacao', rest.conf);
    fd.append('arquivo', rest.arquivo, rest.arquivo.name);
    try {
      await api.enviar('/api/dados/restaurar', fd);
      notificar('Backup restaurado.');
      setRest(null);
      dadosAlterados();
      d.recarregar();
    } catch (e) {
      notificar((e as Error).message, 'erro');
    } finally {
      setOcupado(false);
    }
  };
  const excluirTudo = async () => {
    try {
      await api.post('/api/dados/excluir-tudo', { confirmacao: conf });
      notificar('Todos os dados locais foram excluídos.');
      setExcluir(false);
      dadosAlterados();
      d.recarregar();
    } catch (e) {
      notificar((e as Error).message, 'erro');
    }
  };
  return (
    <>
      <section className="cartao pilha">
        <h2>Onde ficam os dados</h2>
        <dl className="detalhes">
          <dt>Diretório</dt><dd className="mono">{info.diretorio}</dd>
          <dt>Proteção</dt><dd>{info.protecao}</dd>
          <dt>Ocupação</dt><dd>{bytes(info.tamanho.bytes)} em {info.tamanho.arquivos} arquivo(s)</dd>
          <dt>Conteúdo</dt><dd>{Object.entries(info.contagens).map(([k, v]) => `${v} ${k}`).join(' · ')}</dd>
          <dt>Envio externo</dt><dd>{info.envioExterno}</dd>
        </dl>
        <p className="legenda">Arquivos temporários: não são criados. Os ZIPs são lidos em memória e os originais são gravados já cifrados. Os logs do servidor não registram CPFs, nomes, salários ou conteúdo de XML.</p>
      </section>
      <div className="grade grade-2">
        <section className="cartao pilha">
          <h2>Backup protegido por senha</h2>
          <p className="suave">Gera um arquivo .folhabak cifrado (AES-256-GCM, chave derivada da senha por scrypt) com banco, originais e relatórios. A senha não é guardada em lugar nenhum.</p>
          <Campo rotulo="Senha do backup (mínimo 10 caracteres)" id="bk-s1"><input id="bk-s1" type="password" autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value)} /></Campo>
          <Campo rotulo="Repita a senha" id="bk-s2"><input id="bk-s2" type="password" autoComplete="new-password" value={senha2} onChange={(e) => setSenha2(e.target.value)} /></Campo>
          {senha2 && senha !== senha2 && <span className="legenda" style={{ color: 'var(--cor-erro)' }}>As senhas não conferem.</span>}
          <div className="linha fim">
            <button className="botao" onClick={() => setRest({ senha: '', conf: '' })}>Restaurar backup…</button>
            <button className="botao primario" disabled={senha.length < 10 || senha !== senha2 || ocupado} onClick={backup}>Gerar backup</button>
          </div>
        </section>
        <section className="cartao pilha">
          <h2>Excluir todos os dados</h2>
          <p className="suave">Apaga definitivamente deste computador: banco, arquivos originais, relatórios, esquemas XSD, configurações e a chave de criptografia. Não há como desfazer; gere um backup antes, se precisar.</p>
          <div className="linha fim"><button className="botao perigo" onClick={() => { setConf(''); setExcluir(true); }}>Excluir todos os dados…</button></div>
        </section>
      </div>
      {rest && (
        <Modal titulo="Restaurar backup" aoFechar={() => setRest(null)}>
          <div className="aviso alerta"><div>Os dados atuais serão substituídos pelos dados do backup.</div></div>
          <Campo rotulo="Arquivo .folhabak" id="rs-arq"><input id="rs-arq" type="file" accept=".folhabak" onChange={(e) => setRest({ ...rest, arquivo: e.target.files?.[0] })} /></Campo>
          <Campo rotulo="Senha do backup" id="rs-senha"><input id="rs-senha" type="password" autoComplete="off" value={rest.senha} onChange={(e) => setRest({ ...rest, senha: e.target.value })} /></Campo>
          <Campo rotulo="Digite SUBSTITUIR para confirmar" id="rs-conf"><input id="rs-conf" type="text" value={rest.conf} onChange={(e) => setRest({ ...rest, conf: e.target.value })} /></Campo>
          <div className="linha fim"><button className="botao" onClick={() => setRest(null)}>Cancelar</button><button className="botao primario" disabled={!rest.arquivo || rest.conf !== 'SUBSTITUIR' || rest.senha.length < 10 || ocupado} onClick={restaurar}>Restaurar</button></div>
        </Modal>
      )}
      {excluir && (
        <Modal titulo="Excluir todos os dados" aoFechar={() => setExcluir(false)}>
          <div className="aviso erro"><div>Esta ação é definitiva.</div></div>
          <Campo rotulo="Digite EXCLUIR TODOS OS DADOS para confirmar" id="ex-conf"><input id="ex-conf" type="text" value={conf} onChange={(e) => setConf(e.target.value)} /></Campo>
          <div className="linha fim"><button className="botao" onClick={() => setExcluir(false)}>Cancelar</button><button className="botao perigo cheio" disabled={conf !== 'EXCLUIR TODOS OS DADOS'} onClick={excluirTudo}>Excluir definitivamente</button></div>
        </Modal>
      )}
    </>
  );
}

function PortalCfg() {
  const { notificar } = useApp();
  const p = useCarregar(() => api.get<{ urlLogin: string }>('/api/portal'), []);
  const [url, setUrl] = useState('');
  useEffect(() => setUrl(p.dados?.urlLogin ?? ''), [p.dados]);
  const salvar = async () => {
    try {
      await api.put('/api/portal', { urlLogin: url });
      notificar('Endereço do portal salvo.');
    } catch (e) {
      notificar((e as Error).message, 'erro');
    }
  };
  return (
    <>
      <section className="cartao pilha">
        <h2>Endereço do portal oficial</h2>
        <p className="suave">Usado pelo botão “abrir o portal oficial”. Aceita somente endereços https em domínio .gov.br.</p>
        <div className="linha" style={{ alignItems: 'flex-end' }}>
          <div className="campo" style={{ flex: '1 1 360px' }}><label htmlFor="url-portal">URL</label><input id="url-portal" type="text" value={url} onChange={(e) => setUrl(e.target.value)} /></div>
          <button className="botao primario" onClick={salvar}>Salvar</button>
        </div>
      </section>
      <section className="cartao pilha">
        <h2>Privacidade e segurança</h2>
        <ul className="pilha" style={{ paddingLeft: 20, margin: 0 }}>
          <li>O serviço escuta somente em 127.0.0.1 e recusa acessos de outros computadores ou de outros sites (verificação de Host, Origem e cabeçalho próprio).</li>
          <li>Nenhum dado de trabalhador é enviado a serviços externos, telemetria ou treinamento de modelos. A interface não carrega fontes, scripts ou imagens de terceiros.</li>
          <li>Senhas do Gov.br, códigos, certificados, tokens e cookies nunca são solicitados nem armazenados. O login no eSocial acontece no site oficial, fora deste sistema.</li>
          <li>Banco e arquivos cifrados; chave protegida pelo usuário do Windows (DPAPI).</li>
          <li>Relatórios são prévias para conferência profissional e não são documentos oficiais do eSocial. Nenhum evento é transmitido, alterado ou excluído no eSocial por este sistema.</li>
          <li>Os cálculos são determinísticos (regras versionadas e tabelas com fonte). Nenhum modelo de linguagem decide valores.</li>
        </ul>
      </section>
    </>
  );
}

function Auditoria() {
  const a = useCarregar(() => api.get<Array<{ id: number; em: string; acao: string; detalhe: string | null }>>('/api/auditoria'), []);
  if (a.carregando) return <Carregando />;
  return (
    <section className="cartao">
      <p className="legenda">Registro das ações relevantes (sem dados pessoais).</p>
      <div className="tabela-rolagem" style={{ marginTop: 8 }}>
        <table className="dados">
          <thead><tr><th>Data</th><th>Ação</th><th>Detalhe</th></tr></thead>
          <tbody>{a.dados?.map((x) => <tr key={x.id}><td>{dataHora(x.em)}</td><td>{x.acao.replace(/_/g, ' ')}</td><td className="mono pequeno">{x.detalhe ?? ''}</td></tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}
