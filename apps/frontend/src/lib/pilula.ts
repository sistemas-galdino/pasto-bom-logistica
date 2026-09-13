// A PÍLULA DE FILTRO — "quero ver só este".
//
// É o mesmo gesto em três telas (motorista na Rota, caminhão no Agendamento,
// caminhão na Separação) e por isso tem de ser o mesmo objeto na tela. Estava
// escrito à mão em cada uma, e as cópias JÁ tinham divergido: duas diziam
// `text-creme-50` e uma `text-creme` — dois cremes diferentes na mesma pílula
// ativa, só que em páginas que ninguém abre lado a lado.
//
// Vence o `creme-50` (#FBF8F1), que era a maioria e é o creme mais claro, com
// mais contraste sobre o verde-mata.

export function pilulaFiltro(ativo: boolean): string {
  return `rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
    ativo
      ? 'border-mata bg-mata text-creme-50 shadow-carta'
      : 'border-linha bg-papel text-tinta-suave hover:border-mata/30 hover:text-mata'
  }`;
}
