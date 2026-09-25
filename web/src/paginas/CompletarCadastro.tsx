import { useState } from 'react';
import { api } from '../api';
import { Carregando, Erro, Etiqueta } from '../componentes';
import { useApp, useCarregar } from '../contexto';

/**
 * Completar em lote o que os XMLs importados não trazem: cadastro de trabalhadores
 * sem S-2200 e descrições de rubricas sem S-1010. Cada valor é gravado como
 * complemento (selo COMP), com a origem informada.
 */
interface ValSimples {
  v: string | number | null;
  o: 'xml' | 'calculado' | 'complementado' | 'ausente';
}
interface Pendentes {
  trabalhadores: Array<{ cpf: string; matricula: string | null; temVinculo: boolean; campos: Record<string, ValSimples> }>;
  rubricas: Array<{ codRubr: string; ideTabRubr: string; natureza: string | null; tipo: string | null; descricao: ValSimples; origemDados: string }>;
}

const CAMPOS_TRAB: Array<{ id: string; rotulo: string; tipo: string; largura: number }> = [
  { id: 'nome', rotulo: 'Nome', tipo: 'text', largura: 220 },
  { id: 'cargo', rotulo: 'Cargo', tipo: 'text', largura: 170 },
  { id: 'cbo', rotulo: 'CBO', tipo: 'text', largura: 80 },
  { id: 'salario', rotulo: 'Salário mensal', tipo: 'text', largura: 110 },
  { id: 'data_admissao', rotulo: 'Admissão', tipo: 'date', largura: 140 },
  { id: 'dependentes_irrf', rotulo: 'Dep. IRRF', tipo: 'number', largura: 70 },
];
const TIPO: Record<string, string> = { '1': 'Provento', '2': 'Desconto', '3': 'Informativa', '4': 'Informativa dedutora' };

const valorInicial = (v?: ValSimples) => (v && v.o === 'complementado' && v.v !== null ? String(v.v) : '');
const cpfFormatado = (c: string) => c.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');

export function CompletarCadastro() {
  const { empresa, notificar, dadosAlterados, versaoDados } = useApp();
  const p = useCarregar(() => api.get<Pendentes>(`/api/complementos/pendentes?empresa=${encodeURIComponent(empresa)}`), [empresa, versaoDados]);
  const [edicao, setEdicao] = useState<Record<string, string>>({});
  const [origem, setOrigem] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  if (p.carregando && !p.dados) return <Carregando />;
  if (p.erro) return <Erro texto={p.erro} />;
  if (!p.dados || (!p.dados.trabalhadores.length && !p.dados.rubricas.length)) return null;
  const { trabalhadores, rubricas } = p.dados;

  const chave = (escopo: string, ref: string, campo: string) => `${escopo}§${ref}§${campo}`;
  const valorAtual = (escopo: string, ref: string, campo: string, v?: ValSimples) => edicao[chave(escopo, ref, campo)] ?? valorInicial(v);
  const alterar = (k: string, v: string) => setEdicao((e) => ({ ...e, [k]: v }));
  const alterados = Object.values(edicao).filter((v) => v.trim()).length;
  const faltaTrab = trabalhadores.filter((t) => CAMPOS_TRAB.some((c) => t.campos[c.id]?.o === 'ausente')).length;
  const faltaRubr = rubricas.filter((r) => r.descricao.o !== 'complementado').length;

  const salvar = async () => {
    setErro('');
    const itens = Object.entries(edicao)
      .filter(([, v]) => v.trim())
      .map(([k, valor]) => {
        const [escopo, referencia, campo] = k.split('§');
        return { escopo, referencia, campo, valor: valor.trim() };
      });
    if (!itens.length) return setErro('Nenhuma informação alterada.');
    setSalvando(true);
    try {
      const r = await api.post<{ gravados: number }>('/api/complementos/lote', { empresa, origem, itens });
      notificar(`${r.gravados} informação(ões) gravada(s) como complemento.`);
      setEdicao({});
      dadosAlterados();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <section className="cartao pilha" id="completar-cadastro">
      <div className="cartao-titulo">
        <h2>Completar cadastro</h2>
        <span className="legenda">{alterados ? `${alterados} alteração(ões) não gravada(s)` : ''}</span>
      </div>
      <div className="aviso info">
        <div>
          <strong>Por que isso aparece?</strong>
          Os arquivos importados não trazem a admissão (S-2200) de alguns trabalhadores nem a tabela de rubricas (S-1010). O tipo e as incidências das
          rubricas já foram lidos dos recibos do eSocial; faltam nomes, dados contratuais e a descrição das rubricas. Informe aqui (ficha de registro ou
          sistema de folha) ou baixe esses eventos no eSocial Download: pedidos “Tabela de rubricas” e “Eventos de um trabalhador”.
        </div>
      </div>

      {!!trabalhadores.length && (
        <>
          <h3>Trabalhadores sem admissão no XML ({trabalhadores.length}) · {faltaTrab ? `${faltaTrab} com campos em aberto` : 'todos completados'}</h3>
          <div className="tabela-rolagem">
            <table className="dados">
              <thead>
                <tr>
                  <th>CPF / matrícula</th>
                  {CAMPOS_TRAB.map((c) => (
                    <th key={c.id}>{c.rotulo}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {trabalhadores.map((t) => (
                  <tr key={t.cpf}>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>
                      {cpfFormatado(t.cpf)}
                      <div className="legenda">
                        {t.matricula ? `matrícula ${t.matricula}` : ''}
                        {t.temVinculo ? ' · com S-2200' : ''}
                      </div>
                    </td>
                    {CAMPOS_TRAB.map((c) => {
                      const v = t.campos[c.id];
                      const doXml = v?.o === 'xml' || v?.o === 'calculado';
                      return (
                        <td key={c.id}>
                          {doXml ? (
                            <span className="valor xml" title="Veio do XML: não precisa complementar">
                              <span className="texto">{String(v.v ?? '')}</span>
                            </span>
                          ) : (
                            <input
                              aria-label={`${c.rotulo} do CPF ${cpfFormatado(t.cpf)}`}
                              type={c.tipo}
                              min={c.tipo === 'number' ? 0 : undefined}
                              style={{ width: c.largura }}
                              value={valorAtual('trabalhador', t.cpf, c.id, v)}
                              onChange={(e) => alterar(chave('trabalhador', t.cpf, c.id), e.target.value)}
                            />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!!rubricas.length && (
        <>
          <h3>Rubricas sem S-1010 ({rubricas.length}) · {faltaRubr ? `${faltaRubr} sem descrição` : 'todas descritas'}</h3>
          <div className="tabela-rolagem" style={{ maxHeight: 380 }}>
            <table className="dados">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Natureza</th>
                  <th>Tipo</th>
                  <th>Descrição usada na empresa</th>
                </tr>
              </thead>
              <tbody>
                {rubricas.map((r) => {
                  const ref = `${r.codRubr}|${r.ideTabRubr}`;
                  return (
                    <tr key={ref}>
                      <td className="num">
                        {r.codRubr}
                        <div className="legenda">tabela {r.ideTabRubr}</div>
                      </td>
                      <td>{r.natureza ?? '—'}</td>
                      <td>{r.tipo ? (TIPO[r.tipo] ?? r.tipo) : <Etiqueta classe="alerta">desconhecido</Etiqueta>}</td>
                      <td>
                        <input
                          aria-label={`Descrição da rubrica ${r.codRubr}`}
                          type="text"
                          style={{ width: 320 }}
                          placeholder={r.descricao.o === 'calculado' ? String(r.descricao.v ?? '') : ''}
                          value={valorAtual('rubrica', ref, 'descricao', r.descricao)}
                          onChange={(e) => alterar(chave('rubrica', ref, 'descricao'), e.target.value)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="linha" style={{ alignItems: 'flex-end' }}>
        <div className="campo" style={{ flex: '1 1 360px' }}>
          <label htmlFor="lote-origem">Origem destas informações</label>
          <input
            id="lote-origem"
            type="text"
            placeholder="Ex.: Fichas de registro e tabela de rubricas do sistema de folha (set/2026)"
            value={origem}
            onChange={(e) => setOrigem(e.target.value)}
          />
        </div>
        <button className="botao primario" disabled={!alterados || !origem.trim() || salvando} onClick={salvar}>
          {salvando ? 'Gravando…' : `Gravar ${alterados || ''} complemento(s)`}
        </button>
      </div>
      {erro && <Erro texto={erro} />}
    </section>
  );
}
