// Consultas `.in()` divididas em lotes.
//
// O PostgREST devolve a consulta inteira, URL-encoded, no cabeçalho
// `Content-Location` da resposta. Com ~390 UUIDs num `.in()` esse cabeçalho
// passa de 16 KB — o limite de cabeçalho do fetch do Node (undici) — e a
// chamada morre com "TypeError: fetch failed" (causa: HeadersOverflowError).
// No Supabase ela aparece como 200: quem recusa é o nosso lado, ao ler a
// resposta. Acima de ~800 UUIDs o próprio Supabase passa a recusar a URL
// (400/414). Foi o que derrubou o Quadro em 17/10/2026, quando as entregas
// passaram de 390 — a lista de ids cresce a cada entrega nova.
//
// Toda lista de chaves que cresce com o volume (entregas, pedidos, clientes,
// produtos) passa por aqui. Listas limitadas por natureza (motoristas,
// caminhões) não precisam.

/** 100 UUIDs dão ~3,7 KB de URL e ~4 KB de Content-Location: folga de 4x. */
export const TAMANHO_LOTE = 100;

export function emLotes<T>(
  valores: readonly T[],
  tamanho = TAMANHO_LOTE,
): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < valores.length; i += tamanho) {
    lotes.push(valores.slice(i, i + tamanho));
  }
  return lotes;
}

interface RespostaLote<R> {
  data: R[] | null;
  error: { message: string } | null;
}

/**
 * Roda `consultar` uma vez por lote de chaves, em paralelo, e junta as linhas.
 * Mesmo formato `{ data, error }` do supabase-js, para o chamador não mudar:
 * qualquer lote com erro faz a consulta inteira falhar (resultado parcial
 * seria um saldo ou uma lista errada sem aviso).
 */
export async function selecionarEmLotes<R>(
  chaves: readonly string[],
  consultar: (lote: string[]) => PromiseLike<RespostaLote<R>>,
): Promise<RespostaLote<R>> {
  const respostas = await Promise.all(
    emLotes(chaves).map((lote) => consultar(lote)),
  );
  const falha = respostas.find((r) => r.error);
  if (falha) return { data: null, error: falha.error };
  return { data: respostas.flatMap((r) => r.data ?? []), error: null };
}
