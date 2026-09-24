/**
 * 1. Importação de XML e ZIP; 2. identificação e validação de eventos;
 * proteções contra arquivos maliciosos.
 */
import { describe, expect, it } from 'vitest';
import yazl from 'yazl';
import { gerarArquivosSinteticos, gerarXmlIsolado, TRABALHADORES_SINTETICOS, zipar } from '../src/demo/sinteticos.js';
import { extrairDoDocumento } from '../src/esocial/extrair.js';
import { importarArquivo } from '../src/importacao/importador.js';
import { lerXml, parseXml, XmlRejeitadoError } from '../src/xml/arvore.js';
import { lerZip, LIMITES_ZIP_PADRAO } from '../src/xml/zip.js';
import { validarPendentes, importarPacoteXsd } from '../src/xsd/validador.js';
import { abrirArmazenamento, armComDemo, cfgTeste } from './apoio.js';

describe('importação de ZIP e XML', () => {
  it('importa o ZIP do eSocial Download com eventos, recibos e totalizadores', async () => {
    const { arm, resumo } = await armComDemo();
    expect(resumo.status).toBe('concluida');
    expect(resumo.arquivos.total).toBe(53);
    expect(resumo.arquivos.comErro).toBe(0);
    expect(resumo.eventos.novos).toBe(79);
    expect(resumo.recibos).toBe(53);
    expect(resumo.porTipo['S-1200']).toBe(12);
    expect(resumo.porTipo['S-5001']).toBe(13);
    expect(resumo.empregadores).toEqual(['1:98765432']);
    expect(resumo.periodo).toEqual({ inicio: '2026-06', fim: '2026-09' });
    expect(resumo.trabalhadores).toBe(4);
    // o original é preservado byte a byte (cifrado em disco)
    const imp = arm.db.prepare('SELECT sha256 FROM importacoes WHERE id = ?').get(resumo.importacaoId) as { sha256: string };
    const original = await arm.lerOriginal(imp.sha256);
    expect(original.subarray(0, 2).toString()).toBe('PK');
    arm.fechar();
  });

  it('importa XML avulso (sem recibo) e registra a ausência de recibo', async () => {
    const arm = await abrirArmazenamento();
    const x = gerarXmlIsolado();
    const r = await importarArquivo(arm, cfgTeste(), { nomeArquivo: x.nome, dados: Buffer.from(x.conteudo), origem: 'upload' });
    expect(r.tipo).toBe('xml');
    expect(r.eventos.novos).toBe(1);
    expect(r.recibos).toBe(0);
    expect(r.eventos.semRecibo).toBe(1);
    arm.fechar();
  });

  it('lê ZIP aninhado e ignora arquivos que não são XML', async () => {
    const arm = await abrirArmazenamento();
    const arquivos = gerarArquivosSinteticos().slice(0, 5);
    const interno = await zipar(arquivos.map((a) => ({ nome: a.nome, conteudo: a.conteudo })));
    const externo = await zipar([{ nome: 'lote/interno.zip', conteudo: interno }, { nome: 'leia-me.txt', conteudo: 'texto' }]);
    const r = await importarArquivo(arm, cfgTeste(), { nomeArquivo: 'externo.zip', dados: externo, origem: 'upload' });
    expect(r.eventos.novos).toBe(5);
    expect(r.arquivos.ignorados).toBe(1);
    arm.fechar();
  });

  it('identifica tipo, versão do leiaute, chaves e recibo de cada evento', () => {
    const arq = gerarArquivosSinteticos().find((a) => a.nome.includes('evtRemun'))!;
    const { eventos, recibos } = extrairDoDocumento(parseXml(arq.conteudo));
    const s1200 = eventos.find((e) => e.tipo === 'S-1200')!;
    expect(s1200.versaoLeiaute).toBe('S-1.3');
    expect(s1200.empChave).toBe('1:98765432');
    expect(s1200.cpf).toBe(TRABALHADORES_SINTETICOS[0].cpf);
    expect(s1200.perApur).toBe('2026-06');
    expect(s1200.matricula).toBe('M001');
    expect(eventos.filter((e) => e.origem === 'totalizador_no_recibo').map((e) => e.tipo).sort()).toEqual(['S-5001', 'S-5003']);
    expect(recibos).toHaveLength(1);
    expect(recibos[0].eventoId).toBe(s1200.eventoId);
  });

  it('valida eventos contra XSD importado (válido, inválido e sem esquema)', async () => {
    const arm = await abrirArmazenamento();
    const ns = 'http://www.esocial.gov.br/schema/evt/evtTeste/v_S_01_03_00';
    const xsd = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="${ns}" xmlns="${ns}" elementFormDefault="qualified">
  <xs:include schemaLocation="tipos.xsd"/>
  <xs:element name="eSocial"><xs:complexType><xs:sequence>
    <xs:element name="evtTeste"><xs:complexType><xs:sequence>
      <xs:element name="ideEvento"><xs:complexType><xs:sequence><xs:element name="perApur" type="TS_perApur"/></xs:sequence></xs:complexType></xs:element>
    </xs:sequence><xs:attribute name="Id" type="xs:ID" use="required"/></xs:complexType></xs:element>
  </xs:sequence></xs:complexType></xs:element>
</xs:schema>`;
    const tipos = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="${ns}" xmlns="${ns}" elementFormDefault="qualified">
  <xs:simpleType name="TS_perApur"><xs:restriction base="xs:string"><xs:pattern value="\\d{4}-\\d{2}"/></xs:restriction></xs:simpleType>
</xs:schema>`;
    const pacote = await zipar([{ nome: 'esquemas/evtTeste.xsd', conteudo: xsd }, { nome: 'esquemas/tipos.xsd', conteudo: tipos }]);
    await importarPacoteXsd(arm, 'pacote-teste.zip', pacote);
    const ev = (id: string, per: string) => `<eSocial xmlns="${ns}"><evtTeste Id="${id}"><ideEvento><perApur>${per}</perApur></ideEvento></evtTeste></eSocial>`;
    const zip = await zipar([
      { nome: 'ok.xml', conteudo: ev('ID1987654320000002026010100000000001', '2026-01') },
      { nome: 'ruim.xml', conteudo: ev('ID1987654320000002026010100000000002', '01/2026') },
      { nome: 'outro.xml', conteudo: gerarXmlIsolado().conteudo },
    ]);
    await importarArquivo(arm, cfgTeste(), { nomeArquivo: 'xsd.zip', dados: zip, origem: 'upload' });
    const r = await validarPendentes(arm, true);
    expect(r).toEqual({ validados: 1, invalidos: 1, semXsd: 1 });
    const invalido = arm.db.prepare("SELECT xsd_mensagem FROM eventos WHERE xsd_status = 'invalido'").get() as { xsd_mensagem: string };
    expect(invalido.xsd_mensagem).toMatch(/perApur/);
    arm.fechar();
  });
});

describe('proteção contra arquivos maliciosos', () => {
  it('rejeita XML com DOCTYPE/entidade externa (XXE)', () => {
    const xxe = '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///c:/windows/win.ini">]><eSocial>&e;</eSocial>';
    expect(() => parseXml(xxe)).toThrow(XmlRejeitadoError);
    const bomba = '<!DOCTYPE l [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;">]><r>&b;</r>';
    expect(() => parseXml(bomba)).toThrow(/DOCTYPE/);
  });

  it('rejeita XML acima do limite de tamanho e XML malformado', () => {
    expect(() => lerXml(Buffer.alloc(2048, 'a'), { maxBytes: 1024, maxNos: 10, maxProfundidade: 5 })).toThrow(/limite/);
    expect(() => parseXml('<a><b></a>')).toThrow(/malformado/);
  });

  it('recusa entradas de ZIP com caminho indevido e marca "zip bomb"', async () => {
    // caminho com ".." (substitui o nome no ZIP mantendo o mesmo tamanho)
    const base = await zipar([{ nome: 'aa/evil.xml', conteudo: '<a/>' }]);
    const malicioso = Buffer.from(base.toString('latin1').split('aa/evil.xml').join('../evil.xml'), 'latin1');
    const itens = [];
    for await (const i of lerZip(malicioso)) itens.push(i);
    expect(itens[0].erro).toMatch(/\.\./);
    // bomba de compressão: 5 MB de zeros comprimem para poucos KB
    const bomba = await new Promise<Buffer>((resolve) => {
      const z = new yazl.ZipFile();
      z.addBuffer(Buffer.alloc(5 * 1024 * 1024, 0x20), 'grande.xml', { compress: true });
      z.end();
      const partes: Buffer[] = [];
      z.outputStream.on('data', (c: Buffer) => partes.push(c));
      z.outputStream.on('end', () => resolve(Buffer.concat(partes)));
    });
    const r = [];
    for await (const i of lerZip(bomba, { ...LIMITES_ZIP_PADRAO, maxTaxaCompressao: 100 })) r.push(i);
    expect(r[0].erro).toMatch(/zip bomb/);
  });

  it('não grava nada extraído do ZIP em disco (somente o original cifrado)', async () => {
    const { arm } = await armComDemo();
    const fs = await import('node:fs');
    const path = await import('node:path');
    const originais = fs.readdirSync(path.join(arm.dir, 'originais'));
    expect(originais).toHaveLength(1);
    const bruto = fs.readFileSync(path.join(arm.dir, 'originais', originais[0]));
    expect(bruto.subarray(0, 4).toString()).toBe('FXE1'); // envelope AES-256-GCM
    expect(bruto.includes(Buffer.from('eSocial'))).toBe(false);
    expect(bruto.includes(Buffer.from('retornoProcessamentoDownload'))).toBe(false);
    arm.fechar();
  });
});
