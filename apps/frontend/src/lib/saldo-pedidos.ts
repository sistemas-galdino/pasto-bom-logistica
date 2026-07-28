// Derivação do SALDO no cliente — a regra central do modelo de entregas.
//
// Saía duplicada entre o Quadro e o Painel, e duplicar isto é perigoso: se as
// duas cópias divergirem, a mesma operação passa a ter dois "quanto falta
// entregar" e ninguém sabe qual é o certo. A conta em si NÃO mora aqui — mora em
// `calcularSaldo` (@pastobom/shared), a MESMA função que o backend usa. O que
// este arquivo faz é só o trabalho de juntar pedidos e entregas para alimentá-la.
//
// O saldo é calculado sobre TODAS as entregas do pedido, sem recorte de data. Os
// cortes de janela das telas são de EXIBIÇÃO: se uma viagem antiga saísse da
// conta, o pedido reapareceria na fila com um saldo que ele não tem.

import type { Entrega, Pedido, SaldoItem } from '@pastobom/shared';
import { calcularSaldo } from '@pastobom/shared';

/** Um pedido da fila, já com o saldo calculado. */
export interface PedidoComSaldo {
  pedido: Pedido;
  saldo: SaldoItem[];
}

/** Entregas indexadas por pedido — insumo do cálculo de saldo. */
export function agruparEntregasPorPedido(
  entregas: Entrega[],
): Map<string, Entrega[]> {
  const mapa = new Map<string, Entrega[]>();
  for (const e of entregas) {
    const lista = mapa.get(e.pedidoId) ?? [];
    lista.push(e);
    mapa.set(e.pedidoId, lista);
  }
  return mapa;
}

/**
 * Os pedidos que ainda têm o que entregar, com o saldo de cada produto.
 *
 * Considera só os pedidos em `pendente` — os outros dois status que o pedido
 * ainda tem (entregue, cancelada) estão fora da fila por definição. Um pedido
 * cujo saldo zerou não entra no resultado: não há o que agendar nele.
 */
export function pedidosComSaldo(
  pedidos: Pedido[],
  entregasPorPedido: Map<string, Entrega[]>,
): PedidoComSaldo[] {
  const resultado: PedidoComSaldo[] = [];
  for (const p of pedidos) {
    if (p.statusLogistico !== 'pendente') continue;
    const linhasEntrega = (entregasPorPedido.get(p.id) ?? []).flatMap((e) =>
      e.itens.map((i) => ({
        produtoCodigo: i.produtoCodigo,
        qtd: i.qtd,
        statusEntrega: e.status,
      })),
    );
    const saldo = calcularSaldo(
      p.itens.map((i) => ({
        produtoCodigo: i.produtoCodigo,
        nomeProduto: i.nomeProduto,
        qtd: i.qtd,
        pesoUnitKg: i.pesoUnitKg,
      })),
      linhasEntrega,
    );
    if (saldo.some((s) => s.qtdSaldo > 0)) resultado.push({ pedido: p, saldo });
  }
  return resultado;
}

/** 'YYYY-MM-DD' de hoje menos N dias, em horário LOCAL. */
export function isoMenosDias(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}
