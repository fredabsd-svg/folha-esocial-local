# Mapa de campos dos relatórios

Gerado automaticamente a partir do código (`server/src/relatorios/registro.ts`). A mesma informação aparece na aba **Relatórios › Mapa de campos**.

Classes de origem: **XML** (veio de um evento importado, com arquivo, evento, Id, recibo e campo), **Calculado** (regra determinística com versão, fórmula e parâmetros), **Complementado** (informado pelo usuário, com origem e data) e **Ausente** (não encontrado — nunca vira zero).

## Extrato mensal (`extrato`)

Por trabalhador: empresa, competência, vínculo, situação, cargo, salário, rubricas, proventos, descontos, bases, líquido e conferências.

| Campo | Origem | Eventos | Caminho no XML | Regra | Observação |
|---|---|---|---|---|---|
| Empresa — razão social | Complementado |  |  |  | O S-1000 (leiaute S-1.x) não traz a razão social; vem do cadastro da empresa no sistema. |
| Empresa — inscrição | XML ou Complementado | Todos | `ideEmpregador/nrInsc` |  |  |
| Nome do trabalhador | XML ou Complementado | S-2205 › S-2200 › S-2300 › S-1200 | `dadosTrabalhador/nmTrab · trabalhador/nmTrab · ideTrabalhador/infoComplem/nmTrab` |  |  |
| CPF | XML | S-1200 / S-2299 | `ideTrabalhador/cpfTrab · ideVinculo/cpfTrab` |  |  |
| Matrícula | XML | S-1200 | `dmDev/infoPerApur/ideEstabLot/remunPerApur/matricula` |  |  |
| Categoria | XML | S-1200 | `dmDev/codCateg` |  |  |
| Admissão | XML | S-2200 | `vinculo/infoRegimeTrab/infoCeletista/dtAdm` |  |  |
| Cargo / CBO / salário | XML | S-2206 vigente › S-2200 | `infoContrato/nmCargo, CBOCargo, remuneracao/vrSalFx, undSalFixo` |  |  |
| Situação na competência | Calculado | S-2299, S-2230, S-2200 |  | SITUACAO_COMPETENCIA v1 |  |
| Dependentes para IRRF | Calculado | S-2205 › S-2200 | `dependente/depIRRF = S` | CONTAGEM_DEPENDENTES_IRRF v1 |  |
| Código da rubrica / tabela | XML | S-1200 / S-2299 | `itensRemun/codRubr, ideTabRubr · detVerbas/codRubr` |  |  |
| Descrição, natureza, tipo, incidências | XML | S-1010 vigente na competência | `dadosRubrica/dscRubr, natRubr, tpRubr, codIncCP, codIncIRRF, codIncFGTS` |  |  |
| Referência (quantidade/fator) | XML | S-1200 / S-2299 | `qtdRubr · fatorRubr` |  |  |
| Valor informado | XML | S-1200 / S-2299 | `vrRubr` |  |  |
| Proventos / descontos / informativas | Calculado |  |  | TOTAIS_DEMONSTRATIVO v1 | Somatório por tpRubr (1, 2, 3/4) do S-1010. |
| Líquido calculado | Calculado |  |  | LIQUIDO v1 | Proventos − descontos. |
| Líquido pago e data do pagamento | XML | S-1210 | `ideBenef/infoPgto/vrLiq, dtPgto (casado por perRef + ideDmDev)` |  |  |
| Base do INSS (eSocial) | XML | S-5001 | `infoCp/.../infoBaseCS (ind13, tpValor = 11, valor)` |  |  |
| INSS calculado / descontado (eSocial) | XML | S-5001 | `infoCpCalc/vrCpSeg, vrDescSeg` |  |  |
| Base do INSS (rubricas) | Calculado |  |  | BASE_INSS_RUBRICAS v1 | Σ proventos − Σ descontos com codIncCP 11/15/21. |
| INSS recalculado | Calculado |  |  | INSS_PROGRESSIVO v2 | Tabela do INSS vigente na competência (Configurações › Tabelas); cada faixa truncada em centavos, como no S-5001. |
| Base e depósito do FGTS (eSocial) | XML | S-5003 | `infoBaseFGTS/basePerApur/remFGTS, dpsFGTS` |  |  |
| FGTS recalculado | Calculado |  |  | FGTS_DEPOSITO v1 | 8% (2% para aprendiz, categoria 103). |
| Base / IRRF recalculado | Calculado |  |  | IRRF_PROGRESSIVO v1 | Tabela progressiva, dependentes, desconto simplificado e redutor da Lei 15.270/2025 quando vigentes. |
| IRRF retido | XML | S-1200 | `rubricas com codIncIRRF 31/32/33` |  |  |

## Movimentos (`movimentos`)

Rubricas por trabalhador com código, descrição, referência, valor informado, valor calculado, tipo, estabelecimento/lotação, subtotais e totais.

| Campo | Origem | Eventos | Caminho no XML | Regra | Observação |
|---|---|---|---|---|---|
| Código da rubrica / tabela | XML | S-1200 / S-2299 | `itensRemun/codRubr, ideTabRubr · detVerbas/codRubr` |  |  |
| Descrição, natureza, tipo, incidências | XML | S-1010 vigente na competência | `dadosRubrica/dscRubr, natRubr, tpRubr, codIncCP, codIncIRRF, codIncFGTS` |  |  |
| Referência (quantidade/fator) | XML | S-1200 / S-2299 | `qtdRubr · fatorRubr` |  |  |
| Valor informado | XML | S-1200 / S-2299 | `vrRubr` |  |  |
| Proventos / descontos / informativas | Calculado |  |  | TOTAIS_DEMONSTRATIVO v1 | Somatório por tpRubr (1, 2, 3/4) do S-1010. |
| Líquido calculado | Calculado |  |  | LIQUIDO v1 | Proventos − descontos. |
| Líquido pago e data do pagamento | XML | S-1210 | `ideBenef/infoPgto/vrLiq, dtPgto (casado por perRef + ideDmDev)` |  |  |
| Valor calculado | Calculado |  |  | INSS_PROGRESSIVO v2 / IRRF_PROGRESSIVO v1 | Somente para a rubrica de INSS (codIncCP 31) e de IRRF (codIncIRRF 31/32/33); demais rubricas: "—". |
| Estabelecimento / lotação | XML | S-1200 | `ideEstabLot/nrInsc, codLotacao` |  |  |

## Recibo de pagamento (`recibo`)

Demonstrativo individual (holerite) por demonstrativo do S-1200, com vencimentos, descontos, líquido, bases e campo de assinatura.

| Campo | Origem | Eventos | Caminho no XML | Regra | Observação |
|---|---|---|---|---|---|
| Empresa — razão social | Complementado |  |  |  | O S-1000 (leiaute S-1.x) não traz a razão social; vem do cadastro da empresa no sistema. |
| Empresa — inscrição | XML ou Complementado | Todos | `ideEmpregador/nrInsc` |  |  |
| Nome do trabalhador | XML ou Complementado | S-2205 › S-2200 › S-2300 › S-1200 | `dadosTrabalhador/nmTrab · trabalhador/nmTrab · ideTrabalhador/infoComplem/nmTrab` |  |  |
| CPF | XML | S-1200 / S-2299 | `ideTrabalhador/cpfTrab · ideVinculo/cpfTrab` |  |  |
| Matrícula | XML | S-1200 | `dmDev/infoPerApur/ideEstabLot/remunPerApur/matricula` |  |  |
| Categoria | XML | S-1200 | `dmDev/codCateg` |  |  |
| Admissão | XML | S-2200 | `vinculo/infoRegimeTrab/infoCeletista/dtAdm` |  |  |
| Cargo / CBO / salário | XML | S-2206 vigente › S-2200 | `infoContrato/nmCargo, CBOCargo, remuneracao/vrSalFx, undSalFixo` |  |  |
| Dependentes para IRRF | Calculado | S-2205 › S-2200 | `dependente/depIRRF = S` | CONTAGEM_DEPENDENTES_IRRF v1 |  |
| Código da rubrica / tabela | XML | S-1200 / S-2299 | `itensRemun/codRubr, ideTabRubr · detVerbas/codRubr` |  |  |
| Descrição, natureza, tipo, incidências | XML | S-1010 vigente na competência | `dadosRubrica/dscRubr, natRubr, tpRubr, codIncCP, codIncIRRF, codIncFGTS` |  |  |
| Referência (quantidade/fator) | XML | S-1200 / S-2299 | `qtdRubr · fatorRubr` |  |  |
| Valor informado | XML | S-1200 / S-2299 | `vrRubr` |  |  |
| Proventos / descontos / informativas | Calculado |  |  | TOTAIS_DEMONSTRATIVO v1 | Somatório por tpRubr (1, 2, 3/4) do S-1010. |
| Líquido calculado | Calculado |  |  | LIQUIDO v1 | Proventos − descontos. |
| Líquido pago e data do pagamento | XML | S-1210 | `ideBenef/infoPgto/vrLiq, dtPgto (casado por perRef + ideDmDev)` |  |  |
| Base do INSS (eSocial) | XML | S-5001 | `infoCp/.../infoBaseCS (ind13, tpValor = 11, valor)` |  |  |
| INSS calculado / descontado (eSocial) | XML | S-5001 | `infoCpCalc/vrCpSeg, vrDescSeg` |  |  |
| Base do INSS (rubricas) | Calculado |  |  | BASE_INSS_RUBRICAS v1 | Σ proventos − Σ descontos com codIncCP 11/15/21. |
| INSS recalculado | Calculado |  |  | INSS_PROGRESSIVO v2 | Tabela do INSS vigente na competência (Configurações › Tabelas); cada faixa truncada em centavos, como no S-5001. |
| Base e depósito do FGTS (eSocial) | XML | S-5003 | `infoBaseFGTS/basePerApur/remFGTS, dpsFGTS` |  |  |
| FGTS recalculado | Calculado |  |  | FGTS_DEPOSITO v1 | 8% (2% para aprendiz, categoria 103). |
| Base / IRRF recalculado | Calculado |  |  | IRRF_PROGRESSIVO v1 | Tabela progressiva, dependentes, desconto simplificado e redutor da Lei 15.270/2025 quando vigentes. |
| IRRF retido | XML | S-1200 | `rubricas com codIncIRRF 31/32/33` |  |  |

## Relação geral dos líquidos (`liquidos`)

Líquido por trabalhador, quantidade de pessoas por grupo e total da empresa.

| Campo | Origem | Eventos | Caminho no XML | Regra | Observação |
|---|---|---|---|---|---|
| Nome, CPF, matrícula | XML | S-2200 / S-1200 |  |  |  |
| Líquido pago | XML | S-1210 | `infoPgto/vrLiq` |  |  |
| Líquido calculado (fallback) | Calculado |  |  | LIQUIDO v1 |  |
| Quantidade por grupo / total | Calculado |  |  | SOMA_LIQUIDOS v1 |  |

## Resumo mensal da folha (`resumo`)

Rubricas agrupadas em proventos, descontos e informativas, quantidade de trabalhadores, valores informados e calculados, totais, bases e totalizadores.

| Campo | Origem | Eventos | Caminho no XML | Regra | Observação |
|---|---|---|---|---|---|
| Código da rubrica / tabela | XML | S-1200 / S-2299 | `itensRemun/codRubr, ideTabRubr · detVerbas/codRubr` |  |  |
| Descrição, natureza, tipo, incidências | XML | S-1010 vigente na competência | `dadosRubrica/dscRubr, natRubr, tpRubr, codIncCP, codIncIRRF, codIncFGTS` |  |  |
| Referência (quantidade/fator) | XML | S-1200 / S-2299 | `qtdRubr · fatorRubr` |  |  |
| Valor informado | XML | S-1200 / S-2299 | `vrRubr` |  |  |
| Proventos / descontos / informativas | Calculado |  |  | TOTAIS_DEMONSTRATIVO v1 | Somatório por tpRubr (1, 2, 3/4) do S-1010. |
| Líquido calculado | Calculado |  |  | LIQUIDO v1 | Proventos − descontos. |
| Líquido pago e data do pagamento | XML | S-1210 | `ideBenef/infoPgto/vrLiq, dtPgto (casado por perRef + ideDmDev)` |  |  |
| Qtd. de trabalhadores por rubrica | Calculado |  |  | Contagem de CPFs distintos |  |
| Totais por grupo | Calculado |  |  | SOMA_RUBRICA v1 |  |
| Base do INSS (eSocial) | XML | S-5001 | `infoCp/.../infoBaseCS (ind13, tpValor = 11, valor)` |  |  |
| INSS calculado / descontado (eSocial) | XML | S-5001 | `infoCpCalc/vrCpSeg, vrDescSeg` |  |  |
| Base do INSS (rubricas) | Calculado |  |  | BASE_INSS_RUBRICAS v1 | Σ proventos − Σ descontos com codIncCP 11/15/21. |
| INSS recalculado | Calculado |  |  | INSS_PROGRESSIVO v2 | Tabela do INSS vigente na competência (Configurações › Tabelas); cada faixa truncada em centavos, como no S-5001. |
| Base e depósito do FGTS (eSocial) | XML | S-5003 | `infoBaseFGTS/basePerApur/remFGTS, dpsFGTS` |  |  |
| FGTS recalculado | Calculado |  |  | FGTS_DEPOSITO v1 | 8% (2% para aprendiz, categoria 103). |
| Base / IRRF recalculado | Calculado |  |  | IRRF_PROGRESSIVO v1 | Tabela progressiva, dependentes, desconto simplificado e redutor da Lei 15.270/2025 quando vigentes. |
| IRRF retido | XML | S-1200 | `rubricas com codIncIRRF 31/32/33` |  |  |
| Totalizadores da empresa | XML | S-5011 / S-5013 | `infoCRContrib/tpCR, vrCR` |  |  |
| Fechamento | XML | S-1299 / S-1298 |  |  |  |

## Aviso e recibo de férias (`ferias`)

Período aquisitivo e de gozo (S-2230), rubricas de férias do S-1200, bases, proventos, descontos, líquido e campos de ciência/assinatura.

| Campo | Origem | Eventos | Caminho no XML | Regra | Observação |
|---|---|---|---|---|---|
| Período aquisitivo | XML | S-2230 | `iniAfastamento/perAquis/dtInicio, dtFim` |  |  |
| Início / término do gozo | XML | S-2230 (codMotAfast 15) | `iniAfastamento/dtIniAfast · fimAfastamento/dtTermAfast` |  |  |
| Dias de gozo / retorno | Calculado |  |  | DIAS_GOZO v1 / DATA_RETORNO v1 |  |
| Data do aviso, abono pecuniário, médias | Complementado |  |  |  | Não são transmitidos ao eSocial; informe como complemento. |
| Rubricas de férias | XML | S-1200 (demonstrativo com natureza 1016/1017 ou codIncIRRF 13) |  |  |  |
| Líquido pago / data | XML | S-1210 |  |  |  |
| IRRF sobre férias (recálculo) | Calculado |  |  | IRRF_PROGRESSIVO v1 (tipo férias) |  |

## Relatório de rescisão (`rescisao`)

Dados do desligamento, verbas, descontos, bases, líquido, memória de cálculo de conferência e pendências.

| Campo | Origem | Eventos | Caminho no XML | Regra | Observação |
|---|---|---|---|---|---|
| Motivo, datas, aviso, projeção, pensão | XML | S-2299 | `infoDeslig/mtvDeslig, dtDeslig, dtAvPrv, indPagtoAPI, dtProjFimAPI, pensAlim` |  |  |
| Verbas rescisórias | XML | S-2299 | `verbasResc/dmDev/.../detVerbas` |  |  |
| Líquido pago / data | XML | S-1210 (tpPgto 2) |  |  |  |
| Prazo de pagamento | Calculado |  |  | PRAZO_PAGAMENTO_RESCISAO v1 (CLT art. 477 § 6º) |  |
| Aviso proporcional, saldo, 13º, férias, avos | Calculado |  |  | AVISO_PROPORCIONAL, SALDO_SALARIO, AVOS_13, AVOS_FERIAS, DECIMO_PROPORCIONAL, FERIAS_PROPORCIONAIS (v1) |  |
| Médias e saldo do FGTS | Complementado |  |  |  | Não constam nos XMLs. |
| Multa do FGTS | Calculado |  |  | MULTA_FGTS v1 | Somente com saldo do FGTS complementado. |
| Base do INSS (eSocial) | XML | S-5001 | `infoCp/.../infoBaseCS (ind13, tpValor = 11, valor)` |  |  |
| INSS calculado / descontado (eSocial) | XML | S-5001 | `infoCpCalc/vrCpSeg, vrDescSeg` |  |  |
| Base do INSS (rubricas) | Calculado |  |  | BASE_INSS_RUBRICAS v1 | Σ proventos − Σ descontos com codIncCP 11/15/21. |
| INSS recalculado | Calculado |  |  | INSS_PROGRESSIVO v2 | Tabela do INSS vigente na competência (Configurações › Tabelas); cada faixa truncada em centavos, como no S-5001. |
| Base e depósito do FGTS (eSocial) | XML | S-5003 | `infoBaseFGTS/basePerApur/remFGTS, dpsFGTS` |  |  |
| FGTS recalculado | Calculado |  |  | FGTS_DEPOSITO v1 | 8% (2% para aprendiz, categoria 103). |

## Admissões e desligamentos (`admissoes_desligamentos`)

Histórico de admissões (S-2200/S-2300) e desligamentos (S-2299/S-2399) no período.

| Campo | Origem | Eventos | Caminho no XML | Regra | Observação |
|---|---|---|---|---|---|
| Data e tipo do movimento | XML | S-2200, S-2300, S-2299, S-2399 |  |  |  |
| Cargo e salário na data | XML | S-2206 vigente › S-2200 |  |  |  |
| Motivo do desligamento | XML | S-2299 | `infoDeslig/mtvDeslig` |  |  |

## Remunerações e pagamentos (`remuneracoes_pagamentos`)

Por competência e demonstrativo: líquido calculado (S-1200/S-2299) × líquido pago (S-1210).

| Campo | Origem | Eventos | Caminho no XML | Regra | Observação |
|---|---|---|---|---|---|
| Código da rubrica / tabela | XML | S-1200 / S-2299 | `itensRemun/codRubr, ideTabRubr · detVerbas/codRubr` |  |  |
| Descrição, natureza, tipo, incidências | XML | S-1010 vigente na competência | `dadosRubrica/dscRubr, natRubr, tpRubr, codIncCP, codIncIRRF, codIncFGTS` |  |  |
| Referência (quantidade/fator) | XML | S-1200 / S-2299 | `qtdRubr · fatorRubr` |  |  |
| Valor informado | XML | S-1200 / S-2299 | `vrRubr` |  |  |
| Proventos / descontos / informativas | Calculado |  |  | TOTAIS_DEMONSTRATIVO v1 | Somatório por tpRubr (1, 2, 3/4) do S-1010. |
| Líquido calculado | Calculado |  |  | LIQUIDO v1 | Proventos − descontos. |
| Líquido pago e data do pagamento | XML | S-1210 | `ideBenef/infoPgto/vrLiq, dtPgto (casado por perRef + ideDmDev)` |  |  |

## Rubricas por competência (`rubricas_competencia`)

Matriz de rubricas × competências com o somatório dos valores informados.

| Campo | Origem | Eventos | Caminho no XML | Regra | Observação |
|---|---|---|---|---|---|
| Valores por competência | Calculado |  |  | SOMA_RUBRICA_COMPETENCIA v1 | Σ vrRubr (XML) por rubrica e competência. |

## Eventos ausentes e pendências (`eventos_ausentes`)

Vínculos sem remuneração, remunerações sem pagamento, tabelas ausentes, fechamento, duplicidades, retificações sem original e dados ausentes.

| Campo | Origem | Eventos | Caminho no XML | Regra | Observação |
|---|---|---|---|---|---|
| Pendências | Calculado |  |  | Verificações determinísticas sobre os eventos importados |  |

## Divergências (`divergencias`)

Conferências entre valores do XML e recálculo (líquido, bases, INSS, FGTS, IRRF) e duplicidades sem recibo.

| Campo | Origem | Eventos | Caminho no XML | Regra | Observação |
|---|---|---|---|---|---|
| Base do INSS (eSocial) | XML | S-5001 | `infoCp/.../infoBaseCS (ind13, tpValor = 11, valor)` |  |  |
| INSS calculado / descontado (eSocial) | XML | S-5001 | `infoCpCalc/vrCpSeg, vrDescSeg` |  |  |
| Base do INSS (rubricas) | Calculado |  |  | BASE_INSS_RUBRICAS v1 | Σ proventos − Σ descontos com codIncCP 11/15/21. |
| INSS recalculado | Calculado |  |  | INSS_PROGRESSIVO v2 | Tabela do INSS vigente na competência (Configurações › Tabelas); cada faixa truncada em centavos, como no S-5001. |
| Base e depósito do FGTS (eSocial) | XML | S-5003 | `infoBaseFGTS/basePerApur/remFGTS, dpsFGTS` |  |  |
| FGTS recalculado | Calculado |  |  | FGTS_DEPOSITO v1 | 8% (2% para aprendiz, categoria 103). |
| Base / IRRF recalculado | Calculado |  |  | IRRF_PROGRESSIVO v1 | Tabela progressiva, dependentes, desconto simplificado e redutor da Lei 15.270/2025 quando vigentes. |
| IRRF retido | XML | S-1200 | `rubricas com codIncIRRF 31/32/33` |  |  |
| Situação | Calculado |  |  | comparar(): tolerância configurável (padrão R$ 0,01) |  |

## Tabelas legais em uso (padrão)

Versão 2026.1, conferida em 2026-08-28.

- INSS-2024 (2024-01 a 2024-12): teto R$ 7786.02 — Portaria Interministerial MPS/MF nº 2, de 11/01/2024
- INSS-2025 (2025-01 a 2025-12): teto R$ 8157.41 — Portaria Interministerial MPS/MF nº 6, de 10/01/2025
- INSS-2026 (2026-01 a atual): teto R$ 8475.55 — Portaria Interministerial MPS/MF nº 13, de 09/01/2026
- IRRF-2024-02 (2024-02 a 2025-04): dependente R$ 189.59, simplificado R$ 564.80 — Lei nº 9.250/1995, com a tabela da Lei nº 14.848/2024; dispensa de retenção: Lei nº 9.430/1996, art. 67
- IRRF-2025-05 (2025-05 a 2025-12): dependente R$ 189.59, simplificado R$ 607.20 — Lei nº 9.250/1995, com a tabela da Lei nº 15.191/2025 (MP nº 1.294/2025); Lei nº 9.430/1996, art. 67
- IRRF-2026-01 (2026-01 a atual): dependente R$ 189.59, simplificado R$ 607.20, com redutor da Lei 15.270/2025 — Lei nº 9.250/1995 (tabela da Lei nº 15.191/2025) e Lei nº 15.270/2025; Lei nº 9.430/1996, art. 67
- SM-2025: R$ 1518.00 — Decreto nº 12.342/2024
- SM-2026: R$ 1621.00 — Decreto federal de dezembro/2025 (conferir o número do decreto)