/**
 * 3. Deduplicação, retificação, exclusão e preservação do histórico.
 */
import { describe, expect, it } from 'vitest';
import { gerarXmlIsolado, gerarZipSintetico, zipar } from '../src/demo/sinteticos.js';
import { excluirImportacao, importarArquivo } from '../src/importacao/importador.js';
import { abrirArmazenamento, armComDemo, cfgTeste } from './apoio.js';

const contar = (arm: Awaited<ReturnType<typeof abrirArmazenamento>>, sql: string, ...a: unknown[]) =>
  (arm.db.prepare(sql).get(...a) as { n: number }).n;

describe('deduplicação e histórico', () => {
  it('reimportar o mesmo arquivo não duplica eventos e mantém as duas importações', async () => {
    const { arm, cfg } = await armComDemo();
    const r2 = await importarArquivo(arm, cfg, { nomeArquivo: 'demo-de-novo.zip', dados: await gerarZipSintetico(), origem: 'upload' });
    expect(r2.eventos.novos).toBe(0);
    expect(r2.eventos.repetidos).toBe(79);
    expect(r2.arquivoRepetidoDe).toBe(1);
    expect(contar(arm, 'SELECT count(*) n FROM eventos')).toBe(79);
    expect(contar(arm, 'SELECT count(*) n FROM importacoes')).toBe(2);
    expect(contar(arm, 'SELECT count(*) n FROM ocorrencias')).toBe(79 * 2);
    arm.fechar();
  });

  it('excluir uma importação preserva eventos que também vieram de outra', async () => {
    const { arm, cfg } = await armComDemo();
    await importarArquivo(arm, cfg, { nomeArquivo: 'demo-de-novo.zip', dados: await gerarZipSintetico(), origem: 'upload' });
    await excluirImportacao(arm, 1);
    expect(contar(arm, 'SELECT count(*) n FROM eventos')).toBe(79);
    await excluirImportacao(arm, 2);
    expect(contar(arm, 'SELECT count(*) n FROM eventos')).toBe(0);
    arm.fechar();
  });

  it('registra conflito quando o mesmo Id chega com conteúdo diferente, sem alterar o original', async () => {
    const arm = await abrirArmazenamento();
    const x = gerarXmlIsolado();
    await importarArquivo(arm, cfgTeste(), { nomeArquivo: 'a.xml', dados: Buffer.from(x.conteudo), origem: 'upload' });
    const alterado = x.conteudo.replace('<vrRubr>3000.00</vrRubr>', '<vrRubr>9999.00</vrRubr>');
    expect(alterado).not.toBe(x.conteudo);
    const r = await importarArquivo(arm, cfgTeste(), { nomeArquivo: 'b.xml', dados: Buffer.from(alterado), origem: 'upload' });
    expect(r.eventos.conflitos).toBe(1);
    const xml = (arm.db.prepare('SELECT xml FROM eventos').get() as { xml: string }).xml;
    expect(xml).toContain('3000.00');
    expect(contar(arm, 'SELECT count(*) n FROM conflitos')).toBe(1);
    arm.fechar();
  });
});

describe('retificação e exclusão', () => {
  it('S-1200 retificado fica inativo e só o retificador é considerado', async () => {
    const { arm } = await armComDemo();
    const linhas = arm.db
      .prepare("SELECT ind_retif, situacao FROM eventos WHERE tipo = 'S-1200' AND per_apur = '2026-07' AND matricula = 'M001' ORDER BY id")
      .all() as Array<{ ind_retif: string; situacao: string }>;
    expect(linhas).toEqual([
      { ind_retif: '1', situacao: 'retificado' },
      { ind_retif: '2', situacao: 'ativo' },
    ]);
    // totalizadores do original ficam substituídos
    expect(contar(arm, "SELECT count(*) n FROM eventos WHERE tipo IN ('S-5001','S-5003') AND situacao = 'substituido'")).toBe(2);
    arm.fechar();
  });

  it('S-2230 excluído por S-3000 deixa de ser considerado, mas continua no histórico', async () => {
    const { arm } = await armComDemo();
    const r = arm.db.prepare("SELECT situacao, situacao_motivo FROM eventos WHERE tipo = 'S-2230' AND data_ref = '2026-06-15'").get() as {
      situacao: string;
      situacao_motivo: string;
    };
    expect(r.situacao).toBe('excluido');
    expect(r.situacao_motivo).toMatch(/S-3000/);
    arm.fechar();
  });

  it('sem recibos, eventos com a mesma chave natural são marcados como possível duplicidade', async () => {
    const arm = await abrirArmazenamento();
    const x = gerarXmlIsolado();
    // mesmo trabalhador/competência, Id diferente (mais recente)
    const idAntigo = /Id="([^"]+)"/.exec(x.conteudo)![1];
    const idNovo = idAntigo.slice(0, 17) + '20260805120000' + '99999';
    const segundo = x.conteudo.replace(idAntigo, idNovo);
    const zip = await zipar([{ nome: 'a.xml', conteudo: x.conteudo }, { nome: 'b.xml', conteudo: segundo }]);
    await importarArquivo(arm, cfgTeste(), { nomeArquivo: 'dup.zip', dados: zip, origem: 'upload' });
    const s = arm.db.prepare('SELECT evento_id, situacao FROM eventos ORDER BY evento_id').all() as Array<{ evento_id: string; situacao: string }>;
    expect(s.find((e) => e.evento_id === idNovo)!.situacao).toBe('ativo');
    expect(s.find((e) => e.evento_id === idAntigo)!.situacao).toBe('substituido_inferido');
    arm.fechar();
  });
});
