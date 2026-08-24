// Limite de ENTREGAS por caminhão por dia — pedido 10 do documento da Natália.
//
// "Criar uma configuração que permita definir a quantidade máxima de
//  entregas/agendamentos por caminhão por dia, sem eliminar ou alterar a regra
//  de tonelagem. A validação deverá considerar as duas regras
//  simultaneamente."
//
// Duas coisas que este arquivo resolve e que a tela e o backend NÃO podem
// responder cada um do seu jeito:
//
//   1. QUAL janela vale numa data, quando há mais de uma cadastrada.
//   2. Se cabe mais uma entrega, dado o que já está marcado no dia.
//
// O slot do sistema é dia x turno (manhã/tarde), mas o limite pedido é POR DIA.
// Então quem chama tem de somar as entregas dos dois turnos da data — e é por
// isso que a função recebe `entregasNoDia`, não "entregas no slot". Errar isso
// deixaria o caminhão levar 5 de manhã e 5 à tarde com teto de 5.

/** Uma janela de vigência cadastrada para um caminhão. */
export interface LimiteCaminhao {
  /** Data ISO (YYYY-MM-DD) em que a janela começa a valer, inclusiva. */
  validoDe: string;
  /** Data ISO final, inclusiva. null = vigência aberta. */
  validoAte: string | null;
  maxEntregasDia: number;
}

/**
 * A janela que vale numa data, ou null se nenhuma vale.
 *
 * Quando duas janelas se sobrepõem — a rota impede cadastrar, mas dado velho
 * ou importado pode existir — vence a de `validoDe` MAIS RECENTE: é a última
 * decisão que alguém tomou sobre aquele dia. Empate em `validoDe` resolve pelo
 * menor teto, que é o lado seguro: nunca deixar passar mais do que a
 * configuração mais restritiva permitia.
 */
export function limiteVigente(
  limites: readonly LimiteCaminhao[],
  data: string,
): LimiteCaminhao | null {
  let escolhido: LimiteCaminhao | null = null;
  for (const l of limites) {
    if (!Number.isFinite(l.maxEntregasDia) || l.maxEntregasDia <= 0) continue;
    // Comparação de string funciona em 'YYYY-MM-DD' e evita fuso.
    if (data < l.validoDe) continue;
    if (l.validoAte !== null && data > l.validoAte) continue;
    if (escolhido === null) {
      escolhido = l;
      continue;
    }
    if (l.validoDe > escolhido.validoDe) {
      escolhido = l;
    } else if (
      l.validoDe === escolhido.validoDe &&
      l.maxEntregasDia < escolhido.maxEntregasDia
    ) {
      escolhido = l;
    }
  }
  return escolhido;
}

export interface EntradaLimiteEntregas {
  limites: readonly LimiteCaminhao[];
  /** Data da entrega que se quer agendar (YYYY-MM-DD). */
  data: string;
  /**
   * Entregas ATIVAS que o caminhão já tem NESSE DIA — os dois turnos somados,
   * sem contar a própria viagem quando se está reagendando.
   */
  entregasNoDia: number;
  /** Quantas viagens estão sendo criadas agora. Normalmente 1. */
  novasEntregas?: number;
}

export interface ResultadoLimiteEntregas {
  /** false só quando existe janela vigente E ela seria estourada. */
  cabe: boolean;
  /** null = nenhuma janela cadastrada para essa data: sem teto de quantidade. */
  maxEntregasDia: number | null;
  entregasNoDia: number;
  /**
   * Quantas ainda cabem, independente de quantas foram pedidas; null sem teto.
   * `cabe: false` com `restantes: 2` é estado legítimo — significa "cabem 2,
   * você pediu 3" — e é o que a mensagem de erro deve dizer.
   */
  restantes: number | null;
}

/**
 * Cabe mais uma entrega nesse caminhão nesse dia?
 *
 * SEM janela cadastrada, cabe — e de propósito: nenhum default foi pedido, e
 * inventar um (digamos, 5) faria o sistema começar a recusar agendamento que
 * hoje passa, sem ninguém ter configurado nada. Quem não cadastra continua
 * limitado só pela tonelagem, exatamente como antes.
 *
 * Esta função NÃO olha peso. A tonelagem é a outra metade da regra e vive em
 * services/carga.ts; as duas valem juntas, e nenhuma substitui a outra.
 */
export function avaliarLimiteEntregas(
  entrada: EntradaLimiteEntregas,
): ResultadoLimiteEntregas {
  const jaTem = Number.isFinite(entrada.entregasNoDia)
    ? Math.max(0, Math.trunc(entrada.entregasNoDia))
    : 0;
  const novas = Number.isFinite(entrada.novasEntregas ?? 1)
    ? Math.max(1, Math.trunc(entrada.novasEntregas ?? 1))
    : 1;

  const vigente = limiteVigente(entrada.limites, entrada.data);
  if (vigente === null) {
    return {
      cabe: true,
      maxEntregasDia: null,
      entregasNoDia: jaTem,
      restantes: null,
    };
  }

  const max = vigente.maxEntregasDia;
  return {
    cabe: jaTem + novas <= max,
    maxEntregasDia: max,
    entregasNoDia: jaTem,
    restantes: Math.max(0, max - jaTem),
  };
}

/**
 * Duas janelas do mesmo caminhão se sobrepõem?
 *
 * Usada pela rota de cadastro para recusar 01/09–30/09 em cima de 15/09–15/10,
 * que deixaria a operação sem saber qual teto vale.
 *
 * Vigência aberta (`validoAte: null`) colide com qualquer janela que TERMINE em
 * ou depois do início dela — inclusive uma que tenha começado antes. As bordas
 * são inclusivas, então janelas que só se tocam (uma termina no dia em que a
 * outra começa) também colidem.
 */
export function janelasSeSobrepoem(
  a: LimiteCaminhao,
  b: LimiteCaminhao,
): boolean {
  const aFim = a.validoAte ?? '9999-12-31';
  const bFim = b.validoAte ?? '9999-12-31';
  return a.validoDe <= bFim && b.validoDe <= aFim;
}
