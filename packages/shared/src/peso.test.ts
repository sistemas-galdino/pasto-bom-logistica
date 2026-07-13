import { describe, it, expect } from 'vitest';
import { pesoDoNomeProduto } from './peso.js';

describe('pesoDoNomeProduto', () => {
  it.each([
    // Casos reais colhidos na sondagem da API do Órix (13/07/2026) — todos eles
    // chegam da API com peso 0 ou peso 1 (placeholder), por isso o parser existe.
    ['RACAO COOPAMA NOVILHA 40KG', 40],
    ['MILHO GRAOS 50KG', 50],
    ['SEMENTE DE AVEIA PRETA 40KG', 40],
    ['FEGATEX 1L', 1], // 1 litro = 1 quilo (regra da reunião)
    ['ADUBO 40 KG', 40],
    ['SAL MINERAL 30KGS', 30],
    ['DEFENSIVO 20 LT', 20],
    ['HERBICIDA 5 LITROS', 5],
    ['SUPLEMENTO 500G', 0.5],
    ['CALCARIO 1TN', 1000],
    ['OLEO 2,5L', 2.5],
    ['RACAO 1.5KG', 1.5],
    // Veterinários vêm em mililitros — 250 dos 402 produtos ficaram sem peso no
    // primeiro backfill justamente por isto.
    ['VALLEECALCIO 500ML', 0.5],
    ['MASTER LP OURO FINO 1000ML', 1],
    ['BORGAL 50 ML', 0.05],
    ['IMIZOL 15ML', 0.015],
  ])('extrai o peso de %s', (nome, esperado) => {
    expect(pesoDoNomeProduto(nome)).toBe(esperado);
  });

  it.each([
    // Peças de oficina e produtos sem embalagem: a equipe digita o peso UMA vez.
    ['POSTE DE EUCALIPTO'],
    ['ESTICADOR'],
    ['CORREIA B-97'],
    ['MOLA DA EMBREAGEM HUSQ 226R'],
    ['CARBURADOR STIHL'],
    ['CORRENTE 71PM3'],
    ['BUCHA FIXACAO 12'],
    ['LANTERNA 1 LED'], // "LED" não é litro
    ['LAMPADA AMARELA'],
  ])('devolve null para %s (sem peso reconhecível)', (nome) => {
    expect(pesoDoNomeProduto(nome)).toBeNull();
  });

  it('não confunde KG com gramas', () => {
    // Se 'G' fosse testado antes de 'KG', "40KG" viraria 0,04 kg.
    expect(pesoDoNomeProduto('RACAO 40KG')).toBe(40);
  });

  it('não lê miligrama como grama', () => {
    expect(pesoDoNomeProduto('VERMIFUGO 500MG')).toBeNull();
  });

  it('não confunde sufixo de código de peça com unidade', () => {
    // "226R" não é peso; "3T" também não (por isso 'T' sozinho não é unidade).
    expect(pesoDoNomeProduto('HUSQ226G')).toBeNull();
    expect(pesoDoNomeProduto('CORRENTE 71PM3 T')).toBeNull();
  });

  it('usa a última embalagem quando o nome tem mais de um número', () => {
    expect(pesoDoNomeProduto('RACAO 18 PROTEINA SACO 40KG')).toBe(40);
  });

  it('tolera entrada vazia ou nula', () => {
    expect(pesoDoNomeProduto('')).toBeNull();
    expect(pesoDoNomeProduto(null)).toBeNull();
    expect(pesoDoNomeProduto(undefined)).toBeNull();
  });
});
