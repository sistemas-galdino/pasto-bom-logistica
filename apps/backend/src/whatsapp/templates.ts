// [AGENTE WHATSAPP] Renderização de templates de mensagem.
//
// Contrato (assinatura EXATA):
//   export function renderTemplate(tpl: string, vars: Record<string, string>): string
//
// Os templates usam placeholders no formato {chave} (ex.: {nome_cliente},
// {numero}, {data_agendada}, {propriedade}). Cada ocorrência de {chave} é
// substituída pelo valor de vars[chave].

/**
 * Substitui placeholders {chave} no template pelos valores de `vars`.
 *
 * - Chaves válidas: [A-Za-z0-9_] (letras, dígitos e underscore).
 * - Se uma chave não existir em `vars`, o placeholder é mantido como está
 *   (evita "undefined" no texto enviado ao cliente).
 *
 * Exemplo:
 *   renderTemplate("Olá, {nome}! Pedido {numero}.", { nome: "Ana", numero: "123" })
 *     -> "Olá, Ana! Pedido 123."
 */
export function renderTemplate(tpl: string, vars: Record<string, string>): string {
  if (typeof tpl !== 'string') return '';

  return tpl.replace(/\{([A-Za-z0-9_]+)\}/g, (correspondencia, chave: string) => {
    const valor = vars[chave];
    return valor === undefined || valor === null ? correspondencia : String(valor);
  });
}
