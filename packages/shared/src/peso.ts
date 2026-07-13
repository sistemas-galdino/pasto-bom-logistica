// Peso do produto a partir do NOME.
//
// Por que isto existe: a API do Órix não entrega peso utilizável. Na sondagem de
// 13/07/2026 (2.013 produtos com pedidos recentes):
//   - 91,2% não têm peso nenhum;
//   - dos 8,8% que têm, 71% trazem `peso = 1` (placeholder, não peso real);
//   - os produtos que de fato pesam vêm com peso ZERO
//     (RACAO COOPAMA NOVILHA 40KG -> peso 0; MILHO GRAOS 50KG -> peso 0);
//   - `unidade` é 'UND' em 97% dos casos, inclusive nos líquidos.
// Ou seja: o campo `peso` da API é lixo e NUNCA deve ser usado. A única fonte
// confiável é a embalagem escrita no nome ("... 40KG", "... 1L").
//
// O que o parser não conseguir extrair fica null e a equipe digita UMA vez
// (tabela produtos_peso, origem='manual') — vale para todos os pedidos seguintes.

/** Litro -> quilo. Regra aprovada na reunião de 25/06 ("1 litro, 1 quilo"). */
const KG_POR_LITRO = 1;

/**
 * Unidades reconhecidas, da mais específica para a mais genérica, com o fator de
 * conversão para quilos. A ordem importa: 'KG' precisa ser testado antes de 'G',
 * senão "40KG" casaria como 40 gramas.
 *
 * Só entram unidades inequívocas. 'T' e 'K' sozinhos ficam de fora de propósito —
 * casariam com sufixos de código de peça ("CORRENTE 71PM3 T") e gerariam peso falso.
 */
const UNIDADES: { padrao: string; fator: number }[] = [
  { padrao: 'KGS|KG', fator: 1 },
  { padrao: 'TONS|TON|TN', fator: 1000 },
  // ML antes de L: muito comum nos veterinários ("IMIZOL 15ML", "BORGAL 50 ML").
  { padrao: 'MILILITROS|MILILITRO|ML', fator: KG_POR_LITRO * 0.001 },
  { padrao: 'LITROS|LITRO|LTS|LT|L', fator: KG_POR_LITRO },
  { padrao: 'GRAMAS|GRAMA|GRS|GR|G', fator: 0.001 },
];

/**
 * Extrai o peso unitário (kg) do nome do produto; null se não houver embalagem
 * reconhecível.
 *
 *   'RACAO COOPAMA NOVILHA 40KG'  -> 40
 *   'MILHO GRAOS 50KG'            -> 50
 *   'FEGATEX 1L'                  -> 1     (1 L = 1 kg)
 *   'ADUBO 500G'                  -> 0.5
 *   'CALCARIO 1TN'                -> 1000
 *   'POSTE DE EUCALIPTO'          -> null  (equipe digita)
 *   'MOLA DA EMBREAGEM HUSQ 226R' -> null  (código de peça, não peso)
 */
export function pesoDoNomeProduto(nome: string | null | undefined): number | null {
  if (!nome) return null;
  const alvo = nome.toUpperCase();

  for (const { padrao, fator } of UNIDADES) {
    // O número não pode ser precedido por letra/dígito (evita casar o "26" de
    // "HUSQ226G"); a unidade precisa terminar em fronteira de palavra.
    const re = new RegExp(
      `(?:^|[^A-Z0-9])(\\d+(?:[.,]\\d+)?)\\s*(?:${padrao})(?![A-Z0-9])`,
      'g',
    );

    // A embalagem costuma vir no FIM do nome ("SEMENTE DE AVEIA PRETA 40KG"),
    // então a última ocorrência é a que vale.
    let ultimo: number | null = null;
    for (const m of alvo.matchAll(re)) {
      const bruto = m[1];
      if (bruto === undefined) continue;
      const valor = Number(bruto.replace(',', '.'));
      if (Number.isFinite(valor) && valor > 0) {
        ultimo = valor * fator;
      }
    }
    if (ultimo !== null) {
      // 3 casas cobrem gramas sem arrastar erro de ponto flutuante.
      return Math.round(ultimo * 1000) / 1000;
    }
  }

  return null;
}
