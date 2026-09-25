/**
 * Cenário real do eSocial Download "eventos entregues no período": o pacote traz
 * S-1200, S-1210, S-1299 e totalizadores, mas NÃO traz S-1010 (rubricas) nem
 * S-2200 (admissões). Os dados das rubricas vêm no recibo de cada evento
 * (retornoEvento/recibo/rubricas/rubrica, com atributos abreviados e incidências
 * sem zero à esquerda). Dados 100% sintéticos.
 */
import { describe, expect, it } from 'vitest';
import { TABELAS_PADRAO, Tabelas } from '../src/calculo/tabelas.js';
import { gerarZipSintetico, TRABALHADORES_SINTETICOS } from '../src/demo/sinteticos.js';
import { rubrica } from '../src/dominio/cadastros.js';
import { Dados } from '../src/dominio/dados.js';
import { montarFolha } from '../src/dominio/folha.js';
import { importarArquivo, reprocessarRubricasDosRecibos } from '../src/importacao/importador.js';
import { coberturaEmpresa, pendenciasCadastro } from '../src/servicos/consultas.js';
import { gerarDocumento } from '../src/servicos/relatorios.js';
import { abrirArmazenamento, cfgTeste, EMPRESA } from './apoio.js';

const tab = new Tabelas(TABELAS_PADRAO);

async function pacoteDoPeriodo() {
  const arm = await abrirArmazenamento();
  const cfg = cfgTeste();
  const resumo = await importarArquivo(arm, cfg, { nomeArquivo: 'periodo.zip', dados: await gerarZipSintetico({ semTabelas: true }), origem: 'upload' });
  return { arm, cfg, resumo };
}

describe('pacote "eventos do período" (sem S-1010 e sem S-2200)', () => {
  it('lê as rubricas informadas nos recibos e normaliza as incidências', async () => {
    const { arm, resumo } = await pacoteDoPeriodo();
    expect(resumo.porTipo['S-1010']).toBeUndefined();
    expect(resumo.porTipo['S-2200']).toBeUndefined();
    const linhas = arm.db.prepare("SELECT cod_rubr, tp_rubr, inc_cp, inc_irrf, inc_fgts FROM rubricas_recibo WHERE cod_rubr = '2010'").all() as Array<Record<string, string | null>>;
    expect(linhas.length).toBeGreaterThan(0);
    // aviso prévio indenizado: CP "0" → "00", FGTS "21"; IRRF "9" → "09" (recibo do S-1210)
    expect(linhas.some((l) => l.inc_cp === '00' && l.inc_fgts === '21')).toBe(true);
    expect(linhas.some((l) => l.inc_irrf === '09')).toBe(true);
    const d = new Dados(arm.db, EMPRESA);
    const r = rubrica(d, '1000', 'TAB01', '2026-07');
    expect(r.encontrada).toBe(true);
    expect(r.tp).toBe('1');
    expect(r.cp).toBe('11');
    expect(r.ir).toBe('11');
    expect(r.tpRubr.o).toBe('xml');
    expect(r.tpRubr.x?.tipoEvento).toMatch(/Recibo do S-12(00|10)/);
    expect(r.dsc.o).toBe('calculado');
    expect(String(r.dsc.v)).toMatch(/Salário, vencimento, soldo/);
    // sem S-1010, mas com rubricas nos recibos: informação, não alerta
    const aus = gerarDocumento(arm, 'eventos_ausentes', { empresa: EMPRESA, competencia: '2026-07' });
    const p1010 = aus.pendencias!.find((p) => /S-1010/.test(p.mensagem))!;
    expect(p1010.nivel).toBe('info');
    expect(p1010.mensagem).toMatch(/lidos dos recibos/);
    arm.fechar();
  });

  it('calcula proventos, descontos e líquido sem S-1010 e confere INSS, FGTS e IRRF sem divergência falsa', async () => {
    const { arm } = await pacoteDoPeriodo();
    const d = new Dados(arm.db, EMPRESA);
    for (const per of ['2026-06', '2026-07', '2026-08']) {
      for (const t of montarFolha(d, tab, per)) {
        expect(t.pendencias.some((p) => /sem S-1010/.test(p.mensagem))).toBe(false);
        for (const dm of t.dms) expect(dm.liquido.v).not.toBeNull();
        for (const c of t.conferencias.filter((x) => /^(inss|fgts|base_fgts|base_inss|irrf_mensal|rend_irrf)/.test(x.id))) {
          expect([c.id, c.status]).not.toEqual([c.id, 'divergente']);
        }
      }
    }
    // a trabalhadora com férias em 07/2026: IRRF do mês (salário + férias) confere com o S-5002
    const w2 = montarFolha(d, tab, '2026-07').find((t) => t.cpf === TRABALHADORES_SINTETICOS[1].cpf)!;
    expect(w2.conferencias.find((c) => c.id === 'rend_irrf')?.status).toBe('ok');
    expect(w2.bases.irrfS5002.o).not.toBe('ausente');
    arm.fechar();
  });

  it('a falta do S-1210 do mês seguinte vira informação explicada, não alerta', async () => {
    const { arm } = await pacoteDoPeriodo();
    const d = new Dados(arm.db, EMPRESA);
    const w4 = montarFolha(d, tab, '2026-08').find((t) => t.cpf === TRABALHADORES_SINTETICOS[3].cpf)!;
    const p = w4.pendencias.find((x) => /Pagamento \(S-1210\)/.test(x.mensagem))!;
    // há S-1210 de 09/2026 para outros trabalhadores: o do aprendiz falta de fato → alerta
    expect(p.nivel).toBe('alerta');
    arm.fechar();
  });

  it('lista o que falta no cadastro e aceita complementos em lote, identificados como COMP', async () => {
    const { arm } = await pacoteDoPeriodo();
    const pend = pendenciasCadastro(arm.db, EMPRESA);
    expect(pend.trabalhadores.length).toBe(4);
    expect(pend.trabalhadores.every((t) => !t.temVinculo && t.campos.nome.o === 'ausente')).toBe(true);
    expect(pend.rubricas.length).toBeGreaterThan(5);
    const cob = coberturaEmpresa(arm.db, EMPRESA);
    expect(cob).toMatchObject({ s1010: 0, s2200: 0, trabalhadoresSemCadastro: 4 });
    expect(cob.rubricasDoRecibo).toBeGreaterThan(5);

    const w1 = TRABALHADORES_SINTETICOS[0];
    const agora = new Date().toISOString();
    const ins = arm.db.prepare('INSERT INTO complementos (emp_chave, escopo, referencia, campo, valor, origem, informado_em) VALUES (?, ?, ?, ?, ?, ?, ?)');
    ins.run(EMPRESA, 'trabalhador', w1.cpf, 'nome', 'Nome Informado', 'Ficha de registro', agora);
    ins.run(EMPRESA, 'trabalhador', w1.cpf, 'salario', '3000', 'Ficha de registro', agora);
    ins.run(EMPRESA, 'rubrica', '1000|TAB01', 'descricao', 'Salário mensal', 'Tabela do sistema de folha', agora);
    const doc = gerarDocumento(arm, 'extrato', { empresa: EMPRESA, competencia: '2026-07', trabalhador: w1.cpf });
    const campo = (r: string) => doc.blocos[0].campos!.find((c) => c.rotulo === r)!.val as { v: unknown; o: string };
    expect(campo('Trabalhador')).toMatchObject({ v: 'Nome Informado', o: 'complementado' });
    expect(campo('Salário contratual')).toMatchObject({ v: 3000, o: 'complementado' });
    const linhaSalario = doc.blocos[1].tabela!.linhas.find((l) => l.c.cod === '1000')!;
    expect(linhaSalario.c.dsc).toMatchObject({ v: 'Salário mensal', o: 'complementado' });
    arm.fechar();
  });

  it('reprocessa importações antigas para extrair as rubricas dos recibos (idempotente)', async () => {
    const { arm, cfg } = await pacoteDoPeriodo();
    const antes = (arm.db.prepare('SELECT count(*) n FROM rubricas_recibo').get() as { n: number }).n;
    arm.db.prepare('DELETE FROM rubricas_recibo').run();
    const r1 = await reprocessarRubricasDosRecibos(arm, cfg);
    expect(r1.rubricas).toBe(antes);
    const r2 = await reprocessarRubricasDosRecibos(arm, cfg);
    expect(r2.rubricas).toBe(0);
    arm.fechar();
  });
});
