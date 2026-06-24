// Utilitários de formatação para a UI (moeda BRL, datas).

const moedaBRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

export function formatarMoeda(valor: number | null | undefined): string {
  return moedaBRL.format(typeof valor === 'number' ? valor : 0);
}

/**
 * Formata uma data ISO (yyyy-mm-dd) ou timestamp ISO para dd/mm/yyyy.
 * Datas no formato yyyy-mm-dd são tratadas como locais (sem fuso) para
 * evitar deslocamento de um dia.
 */
export function formatarData(iso: string | null | undefined): string {
  if (!iso) return '—';
  const apenasData = /^\d{4}-\d{2}-\d{2}$/.exec(iso);
  if (apenasData) {
    const partes = iso.split('-');
    const ano = partes[0];
    const mes = partes[1];
    const dia = partes[2];
    if (ano && mes && dia) {
      return `${dia}/${mes}/${ano}`;
    }
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('pt-BR');
}

/** Pluraliza "item"/"itens". */
export function rotuloItens(n: number): string {
  return n === 1 ? '1 item' : `${n} itens`;
}

/**
 * Tempo relativo curto em PT-BR a partir de um timestamp ISO:
 * "agora", "há N min", "há N h", "há N d". Datas com mais de ~7 dias caem
 * em formatarData (dd/mm/aaaa). Entrada nula/ inválida → "—".
 */
export function tempoRelativo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return '—';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'agora';
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `há ${min} min`;
  const horas = Math.floor(min / 60);
  if (horas < 24) return `há ${horas} h`;
  const dias = Math.floor(horas / 24);
  if (dias <= 7) return `há ${dias} d`;
  return formatarData(iso);
}
