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

/**
 * Toneladas com uma casa (ex.: 4,2). A tela SEMPRE fala em toneladas — o kg é
 * unidade de cadastro, tonelada é a unidade da conversa do Johnny com a frota.
 *
 * Estava duplicada em quatro arquivos (Agenda, EntregaDetalheModal, Separação
 * impressa e mais), byte a byte. Uma casa decimal é decisão de apresentação e
 * mudá-la em três lugares e esquecer o quarto é o desfecho previsível.
 */
export function emToneladas(kg: number): string {
  return (kg / 1000).toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

// Partículas que ficam minúsculas no meio do nome ("Maria da Silva").
const PARTICULAS_NOME = new Set(['da', 'das', 'de', 'di', 'do', 'dos', 'e']);

/**
 * Nome de pessoa em maiúsculas/minúsculas: "LIOMAR MUNIZ VILELA FILHO" →
 * "Liomar Muniz Vilela Filho". Só apresentação: o cadastro segue como está.
 * Nome que já vem misto ("Marco Justino") passa pelo mesmo caminho e sai igual.
 */
export function nomeProprio(nome: string): string {
  return nome
    .trim()
    .toLocaleLowerCase('pt-BR')
    .split(/\s+/)
    .map((p, i) =>
      i > 0 && PARTICULAS_NOME.has(p)
        ? p
        : p.charAt(0).toLocaleUpperCase('pt-BR') + p.slice(1),
    )
    .join(' ');
}

/**
 * Telefone como o Órix guardou, arrumado para leitura quando dá:
 * "35999998888" -> "(35) 99999-8888"; "3533331111" -> "(35) 3333-1111".
 * Com DDI 55 na frente, ele sai. O nome que a equipe anota junto ("35 99999-8888
 * (ALICE)") é mantido depois do número — é ele que diz com quem se fala.
 * Qualquer outro formato volta como veio: melhor mostrar o número cru do que
 * esconder um contato por não reconhecer o formato.
 */
export function formatarTelefone(bruto: string): string {
  const texto = bruto.trim();
  const inicioNota = texto.search(/[A-Za-zÀ-ÿ]/);
  const parteNumero = inicioNota === -1 ? texto : texto.slice(0, inicioNota);
  const nota = inicioNota === -1 ? '' : texto.slice(inicioNota).replace(/\)\s*$/, '').trim();

  // DDI de fora do Brasil: não há como saber o formato, vai como veio.
  if (/^\s*\+/.test(parteNumero) && !/^\s*\+\s*55/.test(parteNumero)) return texto;
  let d = parteNumero.replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  let numero: string;
  if (d.length === 11) numero = `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  else if (d.length === 10) numero = `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  else return texto;
  return nota ? `${numero} (${nota})` : numero;
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

/**
 * Quantidade de produto em pt-BR: "40", "6,5", "0,125".
 *
 * SEM separador de milhar, de propósito: o mesmo texto volta de um input, e
 * "1.200" seria lido de volta como 1,2. Até 3 casas, como o saldo arredonda.
 */
export function formatarQuantidade(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('pt-BR', {
    maximumFractionDigits: 3,
    useGrouping: false,
  });
}
