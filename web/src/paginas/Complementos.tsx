import { useState } from 'react';
import { api } from '../api';
import { Campo, Carregando, Erro, Etiqueta, SemEmpresa, Vazio } from '../componentes';
import { useApp, useCarregar } from '../contexto';
import { dataHora } from '../formato';

interface Complemento {
  id: number;
  escopo: string;
  referencia: string;
  campo: string;
  valor: string;
  origem: string;
  informado_em: string;
  ativo: number;
  substituido_por: number | null;
}

const ESCOPOS: Record<string, { rotulo: string; referencia: string; campos: Array<[string, string]> }> = {
  empresa: { rotulo: 'Empresa', referencia: 'Inscrição (preenchida automaticamente)', campos: [['razao_social', 'Razão social']] },
  trabalhador: { rotulo: 'Trabalhador', referencia: 'CPF do trabalhador (11 dígitos)', campos: [['nome', 'Nome do trabalhador']] },
  ferias: { rotulo: 'Férias', referencia: 'CPF|data de início do gozo (AAAA-MM-DD)', campos: [['data_aviso', 'Data do aviso de férias'], ['dias_abono', 'Dias de abono pecuniário'], ['medias', 'Médias de variáveis (R$)']] },
  rescisao: { rotulo: 'Rescisão', referencia: 'CPF|data do desligamento (AAAA-MM-DD)', campos: [['medias', 'Médias de variáveis (R$/mês)'], ['saldo_fgts', 'Saldo do FGTS para fins rescisórios (R$)']] },
};

export function Complementos() {
  const { empresa, notificar, dadosAlterados, versaoDados } = useApp();
  const lista = useCarregar(() => (empresa ? api.get<Complemento[]>(`/api/complementos?empresa=${encodeURIComponent(empresa)}`) : Promise.resolve([])), [empresa, versaoDados]);
  const [escopo, setEscopo] = useState('rescisao');
  const [referencia, setReferencia] = useState('');
  const [campo, setCampo] = useState('medias');
  const [valor, setValor] = useState('');
  const [origem, setOrigem] = useState('');
  const [erro, setErro] = useState('');
  if (!empresa) return <SemEmpresa />;

  const salvar = async () => {
    setErro('');
    try {
      await api.post('/api/complementos', { empresa, escopo, referencia: escopo === 'empresa' ? empresa : referencia.trim(), campo, valor, origem });
      notificar('Complemento registrado.');
      setValor('');
      setOrigem('');
      dadosAlterados();
    } catch (e) {
      setErro((e as Error).message);
    }
  };
  return (
    <>
      <div className="cabecalho-pagina">
        <div>
          <h1>Complementos</h1>
          <p>Informações que não constam nos XMLs e foram informadas pelo usuário, sempre com origem e data. Nos relatórios, aparecem com o selo “COMP”. Ao informar um novo valor, o anterior fica no histórico como substituído.</p>
        </div>
      </div>
      <section className="cartao pilha">
        <h2>Novo complemento</h2>
        <p className="legenda">Dica: o jeito mais simples é clicar no selo “AUSENTE” de um valor na prévia do relatório — a referência já vem preenchida.</p>
        <div className="grade grade-3">
          <Campo rotulo="Escopo" id="c-esc">
            <select id="c-esc" value={escopo} onChange={(e) => { setEscopo(e.target.value); setCampo(ESCOPOS[e.target.value].campos[0][0]); }}>
              {Object.entries(ESCOPOS).map(([k, v]) => <option key={k} value={k}>{v.rotulo}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Referência" id="c-ref" ajuda={ESCOPOS[escopo].referencia}>
            <input id="c-ref" type="text" value={escopo === 'empresa' ? empresa : referencia} disabled={escopo === 'empresa'} onChange={(e) => setReferencia(e.target.value)} />
          </Campo>
          <Campo rotulo="Campo" id="c-campo">
            <select id="c-campo" value={campo} onChange={(e) => setCampo(e.target.value)}>
              {ESCOPOS[escopo].campos.map(([k, r]) => <option key={k} value={k}>{r}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Valor" id="c-valor" ajuda="Datas em AAAA-MM-DD; valores com ponto decimal (ex.: 1234.56)."><input id="c-valor" type="text" value={valor} onChange={(e) => setValor(e.target.value)} /></Campo>
          <Campo rotulo="Origem da informação" id="c-origem"><input id="c-origem" type="text" value={origem} onChange={(e) => setOrigem(e.target.value)} /></Campo>
          <div className="campo" style={{ justifyContent: 'flex-end' }}><button className="botao primario" disabled={!valor || !origem || (escopo !== 'empresa' && !referencia)} onClick={salvar}>Registrar</button></div>
        </div>
        {erro && <Erro texto={erro} />}
      </section>
      <section className="cartao">
        <h2>Complementos registrados</h2>
        {lista.carregando && !lista.dados ? <Carregando /> : !lista.dados?.length ? <Vazio titulo="Nenhum complemento registrado" /> : (
          <div className="tabela-rolagem" style={{ marginTop: 12 }}>
            <table className="dados">
              <thead><tr><th>Escopo</th><th>Referência</th><th>Campo</th><th>Valor</th><th>Origem</th><th>Informado em</th><th>Situação</th><th></th></tr></thead>
              <tbody>
                {lista.dados.map((c) => (
                  <tr key={c.id}>
                    <td>{ESCOPOS[c.escopo]?.rotulo ?? c.escopo}</td>
                    <td className="mono pequeno">{c.referencia}</td>
                    <td>{ESCOPOS[c.escopo]?.campos.find(([k]) => k === c.campo)?.[1] ?? c.campo}</td>
                    <td>{c.valor}</td>
                    <td className="pequeno">{c.origem}</td>
                    <td>{dataHora(c.informado_em)}</td>
                    <td>{c.ativo ? <Etiqueta classe="ok">Em uso</Etiqueta> : <Etiqueta classe="neutra">{c.substituido_por ? 'Substituído' : 'Desativado'}</Etiqueta>}</td>
                    <td>{!!c.ativo && <button className="botao pequeno perigo" onClick={async () => { await api.del(`/api/complementos/${c.id}`); dadosAlterados(); }}>Desativar</button>}</td>
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
