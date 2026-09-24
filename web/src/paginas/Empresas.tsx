import { useState } from 'react';
import { api } from '../api';
import { Campo, Erro, Etiqueta, Modal, Vazio } from '../componentes';
import { type Empresa, useApp } from '../contexto';
import { competencia as fmtComp, documentoEmpresa } from '../formato';

const VAZIO = { tpInsc: '1', documento: '', razaoSocial: '', nomeFantasia: '', perfilAcesso: '', autorizacaoObs: '', observacoes: '' };

export function Empresas() {
  const { empresas, recarregarEmpresas, notificar, setEmpresa, dadosAlterados } = useApp();
  const [form, setForm] = useState<typeof VAZIO | null>(null);
  const [editando, setEditando] = useState<Empresa | null>(null);
  const [erro, setErro] = useState('');
  const [excluir, setExcluir] = useState<Empresa | null>(null);
  const [confirmacao, setConfirmacao] = useState('');

  const abrir = (e?: Empresa) => {
    setErro('');
    setEditando(e ?? null);
    setForm(
      e
        ? {
            tpInsc: e.tp_insc,
            documento: e.documento_completo ?? '',
            razaoSocial: e.razao_social ?? '',
            nomeFantasia: e.nome_fantasia ?? '',
            perfilAcesso: e.perfil_acesso ?? '',
            autorizacaoObs: e.autorizacao_obs ?? '',
            observacoes: e.observacoes ?? '',
          }
        : { ...VAZIO },
    );
  };

  const salvar = async () => {
    if (!form) return;
    setErro('');
    try {
      if (editando) await api.put(`/api/empresas/${editando.id}`, form);
      else {
        const r = await api.post<{ chave: string }>('/api/empresas', form);
        setEmpresa(r.chave);
      }
      await recarregarEmpresas();
      notificar('Cadastro salvo.');
      setForm(null);
    } catch (e) {
      setErro((e as Error).message);
    }
  };

  const excluirDados = async () => {
    if (!excluir) return;
    try {
      await api.post(`/api/empresas/${excluir.id}/excluir-dados`, { confirmacao });
      notificar('Dados da empresa excluídos.');
      setExcluir(null);
      dadosAlterados();
    } catch (e) {
      notificar((e as Error).message, 'erro');
    }
  };

  const f = form;
  return (
    <>
      <div className="cabecalho-pagina">
        <div>
          <h1>Empresas e pessoas autorizadas</h1>
          <p>Empresas detectadas nos XMLs aparecem automaticamente. Complete o cadastro com a razão social (o S-1000 não a traz) e registre o perfil de acesso e a autorização que você possui.</p>
        </div>
        <button className="botao primario" onClick={() => abrir()}>Cadastrar empresa</button>
      </div>
      <section className="cartao">
        {!empresas.length ? <Vazio titulo="Nenhuma empresa cadastrada ou detectada" /> : (
          <div className="tabela-rolagem">
            <table className="dados">
              <thead><tr><th>Razão social</th><th>Inscrição</th><th>Perfil / autorização</th><th className="dir">Eventos ativos</th><th className="dir">Trabalhadores</th><th>Última competência</th><th>Origem</th><th>Ações</th></tr></thead>
              <tbody>
                {empresas.map((e) => (
                  <tr key={e.id}>
                    <td>{e.razao_social ?? <span className="valor ausente"><span className="texto">razão social não informada</span></span>}{e.nome_fantasia && <div className="legenda">{e.nome_fantasia}</div>}</td>
                    <td className="num">{documentoEmpresa(e.chave, e.documento_completo)}</td>
                    <td className="pequeno">{e.perfil_acesso ?? '—'}{e.autorizacao_obs && <div className="legenda">{e.autorizacao_obs}</div>}</td>
                    <td className="dir num">{e.estatisticas.eventos}</td>
                    <td className="dir num">{e.estatisticas.trabalhadores}</td>
                    <td>{fmtComp(e.estatisticas.ultima) || '—'}</td>
                    <td>{e.origem_cadastro === 'cadastrada' ? <Etiqueta classe="ok">Cadastrada</Etiqueta> : <Etiqueta classe="alerta">Detectada nos XMLs</Etiqueta>}</td>
                    <td className="linha">
                      <button className="botao pequeno" onClick={() => abrir(e)}>Editar</button>
                      <button className="botao pequeno" onClick={() => { setEmpresa(e.chave); window.location.hash = '#/painel'; }}>Selecionar</button>
                      <button className="botao pequeno perigo" onClick={() => { setExcluir(e); setConfirmacao(''); }}>Excluir dados</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {f && (
        <Modal titulo={editando ? 'Editar empresa' : 'Cadastrar empresa'} aoFechar={() => setForm(null)}>
          <div className="grade grade-2">
            <Campo rotulo="Tipo de inscrição" id="e-tp">
              <select id="e-tp" value={f.tpInsc} disabled={!!editando} onChange={(e) => setForm({ ...f, tpInsc: e.target.value })}>
                <option value="1">CNPJ</option>
                <option value="2">CPF (empregador pessoa física)</option>
              </select>
            </Campo>
            <Campo rotulo={f.tpInsc === '1' ? 'CNPJ completo' : 'CPF'} id="e-doc" ajuda={f.tpInsc === '1' ? 'Aceita CNPJ numérico ou alfanumérico.' : undefined}>
              <input id="e-doc" type="text" value={f.documento} onChange={(e) => setForm({ ...f, documento: e.target.value })} />
            </Campo>
          </div>
          <Campo rotulo="Razão social / nome" id="e-razao"><input id="e-razao" type="text" value={f.razaoSocial} onChange={(e) => setForm({ ...f, razaoSocial: e.target.value })} /></Campo>
          <Campo rotulo="Nome fantasia" id="e-fant"><input id="e-fant" type="text" value={f.nomeFantasia} onChange={(e) => setForm({ ...f, nomeFantasia: e.target.value })} /></Campo>
          <Campo rotulo="Perfil de acesso ao eSocial" id="e-perfil">
            <select id="e-perfil" value={f.perfilAcesso} onChange={(e) => setForm({ ...f, perfilAcesso: e.target.value })}>
              <option value="">Não informado</option>
              <option>Titular</option>
              <option>Responsável legal</option>
              <option>Procurador</option>
            </select>
          </Campo>
          <Campo rotulo="Autorização / procuração (anotação)" id="e-aut" ajuda="Ex.: procuração eletrônica válida até 31/12/2027. Não informe senhas ou códigos.">
            <input id="e-aut" type="text" value={f.autorizacaoObs} onChange={(e) => setForm({ ...f, autorizacaoObs: e.target.value })} />
          </Campo>
          <Campo rotulo="Observações" id="e-obs"><input id="e-obs" type="text" value={f.observacoes} onChange={(e) => setForm({ ...f, observacoes: e.target.value })} /></Campo>
          {erro && <Erro texto={erro} />}
          <div className="linha fim">
            <button className="botao" onClick={() => setForm(null)}>Cancelar</button>
            <button className="botao primario" onClick={salvar}>Salvar</button>
          </div>
        </Modal>
      )}
      {excluir && (
        <Modal titulo="Excluir dados da empresa" aoFechar={() => setExcluir(null)}>
          <div className="aviso erro"><div>Serão excluídos definitivamente deste computador os eventos, complementos, solicitações e relatórios de <strong>{excluir.razao_social ?? excluir.chave}</strong>. O histórico de importações é mantido até que você exclua as importações.</div></div>
          <Campo rotulo={`Digite ${excluir.chave} para confirmar`} id="conf-exc"><input id="conf-exc" type="text" value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} /></Campo>
          <div className="linha fim">
            <button className="botao" onClick={() => setExcluir(null)}>Cancelar</button>
            <button className="botao perigo cheio" disabled={confirmacao !== excluir.chave} onClick={excluirDados}>Excluir definitivamente</button>
          </div>
        </Modal>
      )}
    </>
  );
}
