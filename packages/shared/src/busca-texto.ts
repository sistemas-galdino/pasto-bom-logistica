// A BUSCA DIGITADA COM PRESSA — normalização e casamento de texto.
//
// Quem usa o quadro digita "joao" procurando "João", "CABO VERDE" procurando
// "Cabo Verde" e " 12345 " com o espaço que veio do copiar-e-colar. A decisão
// de que essas três coisas casam é uma só, e estava escrita dentro da página do
// Quadro. Com o seletor de pedidos da tela de Agendamento (09/2026) ela passou
// a ser precisa em dois lugares — e a terceira cópia é sempre a que esquece o
// `normalize('NFD')`.
//
// SOBRE O REGEX DE ACENTO: os caracteres combinantes vão aqui como ESCAPES
// (̀-ͯ), e não como os caracteres literais que estavam no fonte
// original. Combinante literal é invisível no editor: quem redigitasse a linha
// produziria um regex que não remove acento nenhum, e a busca continuaria
// "funcionando" — só que "joão" deixaria de casar com "joao", sem erro nenhum.

/** Minúsculas, sem acento, aparado. */
export function normalizarBusca(texto: string | null | undefined): string {
  return (texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * O termo casa com ALGUM dos campos?
 *
 * Termo vazio casa com tudo — é o estado normal da tela, e obrigar cada
 * chamador a testar isso antes seria colecionar um `if` que um dia falta.
 * Campo nulo simplesmente não casa.
 *
 * O termo JÁ vem normalizado por quem chama (a tela normaliza uma vez por
 * digitação, e não uma vez por cartão × campo). `casaBusca` normaliza os campos
 * porque eles mudam a cada item.
 */
export function casaBusca(
  termoNormalizado: string,
  campos: readonly (string | null | undefined)[],
): boolean {
  if (termoNormalizado === '') return true;
  return campos.some((c) => normalizarBusca(c).includes(termoNormalizado));
}
