// Modal de RESERVA DE CAMINHÃO — o "card avulso" pedido pelo Johnny.
//
// O que esta tela cria não é entrega: é o caminhão ocupado por outra coisa —
// oficina, buscar adubo na fábrica, "reservar o caminhão para fazer outra
// coisa". A razão, nas palavras dele: "a única coisa que bloqueia a gente de
// agendar é o caminhão. Se eu esquecer, pode ser que eu deixe essas agendas
// vagas e uma hora eu esqueço de agendar algum cliente porque não tem cliente
// para agendar e a gente perde, tem que refazer o agendamento." O propósito é o
// dia NÃO PARECER vago.
//
// POR ISSO OS CAMPOS SÃO ESTES
// ---------------------------------------------------------------------------
//   serviço ....... entra no lugar do cliente e é o título do card. Sem ele o
//                   card não diz nada, então é o único texto obrigatório.
//   destino ....... FORNECEDOR do Órix (que já traz a cidade — pedido literal
//                   da Natália: "puxar o fornecedor já vai trazer a cidade") ou
//                   CIDADE digitada à mão. A alternância é manual e explícita:
//                   adivinhar por heurística faria a pessoa perder o que
//                   digitou quando o sistema mudasse de ideia sozinho.
//   produtos ...... texto livre. Não é item de pedido, não tem código nem
//                   saldo; é "adubo", "peças", o que a pessoa escrever.
//   motorista ..... OPCIONAL. Dá para mandar o caminhão à oficina sem decidir
//                   quem leva. O CAMINHÃO é obrigatório — é o propósito da
//                   reserva.
//   peso .......... OPCIONAL, e a ausência tem significado: sem peso a reserva
//                   ocupa o caminhão mas não consome tonelagem (oficina),
//                   contra a coleta de adubo, que consome.
//   bloqueia ...... nasce MARCADA. "Reservar o caminhão" é o pedido; desmarcar
//                   é o caso especial de dividir o período com entregas.
//
// A tela NÃO faz a mutação: monta o corpo e entrega ao quadro, como o
// ReagendarEntregaModal. No modo edição manda só o que mudou — mesma razão de
// lá: PATCH com o valor atual de volta é ruído no histórico e revalidação de
// carga à toa.

import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
  AtualizarReservaRequest,
  CriarReservaRequest,
  Fornecedor,
  PeriodoEntrega,
  Reserva,
} from '@pastobom/shared';
import { api } from '../lib/api';
import { SeletorSlot } from './SeletorSlot';

interface Props {
  /** Ausente = nova reserva. Presente = edição da reserva existente. */
  reserva?: Reserva | null;
  enviando: boolean;
  erro: string | null;
  /** Recebe o corpo do POST (nova) ou o PATCH parcial (edição). */
  onConfirmar: (body: CriarReservaRequest | AtualizarReservaRequest) => void;
  onFechar: () => void;
}

/** De onde vem o destino da viagem. */
type ModoDestino = 'fornecedor' | 'cidade';

function hojeISO(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Aceita vírgula decimal — a equipe digita 1,5 e não 1.5. */
function paraNumero(valor: string): number {
  return Number(valor.replace(',', '.'));
}

function formatarT(kg: number): string {
  return `${(kg / 1000).toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  })} t`;
}

/** "FERTILIZANTES X — Rio Verde/GO", com o que existir. */
function rotuloFornecedor(f: Fornecedor): string {
  const praca = [f.cidade, f.uf].filter((p) => p && p.trim() !== '').join('/');
  return praca === '' ? f.nome : `${f.nome} — ${praca}`;
}

const campoCls =
  'w-full rounded-lg border border-linha bg-creme-50 px-3 py-2 text-sm text-tinta outline-none transition focus:border-mata/40 focus:bg-papel disabled:opacity-60';

export function ReservaModal({
  reserva = null,
  enviando,
  erro,
  onConfirmar,
  onFechar,
}: Props): React.ReactElement {
  const editando = reserva !== null;

  const [servico, setServico] = useState(reserva?.servico ?? '');
  // O modo abre no que a reserva JÁ é: reserva com fornecedor abre no
  // fornecedor, reserva só com cidade abre na cidade. Nova abre no fornecedor,
  // que é o caminho pedido (a cidade vem de graça).
  const [modo, setModo] = useState<ModoDestino>(
    reserva && reserva.fornecedorCodigo === null && reserva.cidade !== null
      ? 'cidade'
      : 'fornecedor',
  );
  const [fornecedorCodigo, setFornecedorCodigo] = useState(
    reserva?.fornecedorCodigo ?? '',
  );
  // Nome e cidade do fornecedor escolhido ficam em estado próprio: a reserva
  // guarda o código, e reabrir a tela não pode obrigar uma busca só para
  // mostrar de novo o que já estava escolhido.
  const [fornecedorNome, setFornecedorNome] = useState(
    reserva?.fornecedorNome ?? '',
  );
  const [cidade, setCidade] = useState(reserva?.cidade ?? '');
  const [produtos, setProdutos] = useState(reserva?.produtos ?? '');
  const [data, setData] = useState(reserva?.dataAgendada.slice(0, 10) ?? hojeISO());
  const [periodo, setPeriodo] = useState<PeriodoEntrega>(
    reserva?.periodo ?? 'manha',
  );
  const [caminhaoId, setCaminhaoId] = useState(reserva?.caminhaoId ?? '');
  const [motoristaId, setMotoristaId] = useState(reserva?.motoristaId ?? '');
  // Peso como TEXTO, como no agendamento: guardar número atrapalha quem está no
  // meio de digitar "1," ou apagou o campo para redigitar.
  const [peso, setPeso] = useState(
    reserva?.pesoPrevistoKg === null || reserva?.pesoPrevistoKg === undefined
      ? ''
      : String(reserva.pesoPrevistoKg),
  );
  const [bloqueia, setBloqueia] = useState(reserva?.bloqueiaCaminhao ?? true);

  // --- busca de fornecedor --------------------------------------------------

  const [termo, setTermo] = useState('');
  const [termoAtrasado, setTermoAtrasado] = useState('');
  const [listaAberta, setListaAberta] = useState(false);

  // Debounce de 300 ms: o cadastro tem ~3.600 fornecedores e a rota é `ilike`
  // no banco. Uma requisição por tecla castigaria o servidor para mostrar
  // resultado que a próxima tecla já joga fora.
  useEffect(() => {
    const t = window.setTimeout(() => setTermoAtrasado(termo), 300);
    return () => window.clearTimeout(t);
  }, [termo]);

  const fornecedoresQuery = useQuery({
    queryKey: ['fornecedores', termoAtrasado],
    queryFn: ({ signal }) => api.buscarFornecedores(termoAtrasado, signal),
    // Só busca com a lista aberta: nada de consultar o cadastro por causa de um
    // modal aberto para editar o período.
    enabled: modo === 'fornecedor' && listaAberta,
  });

  const fornecedores: Fornecedor[] = fornecedoresQuery.data ?? [];

  function escolherFornecedor(f: Fornecedor): void {
    setFornecedorCodigo(f.codigo);
    setFornecedorNome(f.nome);
    // A cidade do fornecedor vira a cidade da reserva — é exatamente o que a
    // Natália pediu, e o backend também grava a cidade em texto para a reserva
    // de ontem não mudar quando o cadastro do Órix mudar.
    setCidade(f.cidade ?? '');
    setListaAberta(false);
    setTermo('');
  }

  function limparFornecedor(): void {
    setFornecedorCodigo('');
    setFornecedorNome('');
    setCidade('');
  }

  // Esc fecha e o corpo para de rolar atrás do modal — igual ao detalhe da
  // entrega. Com a lista de fornecedores aberta, o Esc fecha PRIMEIRO a lista
  // (tratado no próprio input, que interrompe a propagação).
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent): void {
      if (e.key === 'Escape' && !enviando) onFechar();
    }
    document.addEventListener('keydown', aoTeclar);
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', aoTeclar);
      document.body.style.overflow = overflowAnterior;
    };
  }, [onFechar, enviando]);

  // --- validação ------------------------------------------------------------

  const servicoLimpo = servico.trim();
  const cidadeLimpa = cidade.trim();
  const produtosLimpos = produtos.trim();
  const pesoLimpo = peso.trim();

  /** kg digitados, ou null (= reserva sem peso, que é caso válido). */
  const pesoKg = useMemo<number | null>(() => {
    if (pesoLimpo === '') return null;
    const n = paraNumero(pesoLimpo);
    if (!Number.isFinite(n) || n < 0) return null;
    return n;
  }, [pesoLimpo]);

  const pesoInvalido = pesoLimpo !== '' && pesoKg === null;

  /**
   * Fornecedor que vai ser GRAVADO. Segue o modo escolhido, não o que sobrou de
   * estado: quem escolheu um fornecedor e depois passou a digitar a cidade à
   * mão não quer sair com os dois gravados. Um único valor para a comparação
   * ("mudou?") e para o envio — calcular duas vezes é como o par saía
   * desalinhado.
   */
  const codigoDestino = modo === 'fornecedor' ? fornecedorCodigo || null : null;

  // Serviço e caminhão são o mínimo que o backend aceita (zod: servico + data +
  // periodo + caminhaoId). Data e período já vêm preenchidos pelo seletor.
  const faltaCampo = servicoLimpo === '' || caminhaoId === '' || data === '';

  // No modo edição o PATCH precisa de ao menos um campo — e mandar um PATCH
  // vazio só produziria 400.
  const mudou = useMemo(() => {
    if (!editando || !reserva) return true;
    return (
      servicoLimpo !== reserva.servico ||
      codigoDestino !== reserva.fornecedorCodigo ||
      (cidadeLimpa || null) !== reserva.cidade ||
      (produtosLimpos || null) !== reserva.produtos ||
      data !== reserva.dataAgendada.slice(0, 10) ||
      periodo !== reserva.periodo ||
      caminhaoId !== reserva.caminhaoId ||
      (motoristaId || null) !== reserva.motoristaId ||
      pesoKg !== reserva.pesoPrevistoKg ||
      bloqueia !== reserva.bloqueiaCaminhao
    );
  }, [
    editando,
    reserva,
    servicoLimpo,
    codigoDestino,
    cidadeLimpa,
    produtosLimpos,
    data,
    periodo,
    caminhaoId,
    motoristaId,
    pesoKg,
    bloqueia,
  ]);

  const bloqueado = enviando || faltaCampo || pesoInvalido || !mudou;

  function confirmar(): void {
    if (bloqueado) return;

    const cidadeFinal = cidadeLimpa === '' ? null : cidadeLimpa;

    if (reserva === null) {
      const body: CriarReservaRequest = {
        servico: servicoLimpo,
        dataAgendada: data,
        periodo,
        caminhaoId,
        motoristaId: motoristaId === '' ? null : motoristaId,
        fornecedorCodigo: codigoDestino,
        cidade: cidadeFinal,
        produtos: produtosLimpos === '' ? null : produtosLimpos,
        pesoPrevistoKg: pesoKg,
        bloqueiaCaminhao: bloqueia,
      };
      onConfirmar(body);
      return;
    }

    // Edição: só o que mudou. O `if` acima já estreitou `reserva` — nada de
    // cast, que é o tipo de atalho que sobrevive a uma mudança de props errada.
    const atual = reserva;
    const body: AtualizarReservaRequest = {};
    if (servicoLimpo !== atual.servico) body.servico = servicoLimpo;
    if (codigoDestino !== atual.fornecedorCodigo) {
      body.fornecedorCodigo = codigoDestino;
    }
    if (cidadeFinal !== atual.cidade) body.cidade = cidadeFinal;
    const produtosFinal = produtosLimpos === '' ? null : produtosLimpos;
    if (produtosFinal !== atual.produtos) body.produtos = produtosFinal;
    if (data !== atual.dataAgendada.slice(0, 10)) body.dataAgendada = data;
    if (periodo !== atual.periodo) body.periodo = periodo;
    if (caminhaoId !== atual.caminhaoId) body.caminhaoId = caminhaoId;
    const motoristaFinal = motoristaId === '' ? null : motoristaId;
    if (motoristaFinal !== atual.motoristaId) body.motoristaId = motoristaFinal;
    if (pesoKg !== atual.pesoPrevistoKg) body.pesoPrevistoKg = pesoKg;
    if (bloqueia !== atual.bloqueiaCaminhao) body.bloqueiaCaminhao = bloqueia;

    onConfirmar(body);
  }

  const abaDestinoCls = (ativo: boolean): string =>
    `rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
      ativo
        ? 'bg-mata text-creme-50 shadow-sm'
        : 'border border-linha bg-papel text-tinta-suave hover:border-mata/30 hover:text-mata'
    }`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-mata-escuro/30 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={editando ? 'Editar reserva de caminhão' : 'Reservar caminhão'}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !enviando) onFechar();
      }}
    >
      <div className="max-h-[90vh] w-full max-w-xl animate-sobe overflow-y-auto rounded-xl2 bg-papel p-5 shadow-flutua">
        <h2 className="font-display text-lg font-semibold text-mata-escuro">
          {editando ? 'Editar reserva' : 'Reservar caminhão'}
        </h2>
        <p className="mt-0.5 text-sm text-tinta-suave">
          Para o caminhão ocupado por algo que não é entrega a cliente — oficina,
          buscar mercadoria, outro serviço.
        </p>

        <label className="mt-4 block">
          <span className="text-sm font-semibold text-tinta">Serviço</span>
          <input
            type="text"
            value={servico}
            maxLength={200}
            disabled={enviando}
            autoFocus
            placeholder="ex.: oficina, buscar adubo na fábrica"
            onChange={(e) => setServico(e.target.value)}
            className={`mt-1 ${campoCls}`}
          />
          <span className="mt-1 block text-[11px] text-pedra">
            É o título do card no quadro e na agenda.
          </span>
        </label>

        {/* Destino: fornecedor do Órix OU cidade digitada. */}
        <div className="mt-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-tinta">
              Destino <span className="font-normal text-pedra">(opcional)</span>
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={enviando}
                onClick={() => setModo('fornecedor')}
                className={abaDestinoCls(modo === 'fornecedor')}
              >
                Fornecedor
              </button>
              <button
                type="button"
                disabled={enviando}
                onClick={() => {
                  setModo('cidade');
                  setListaAberta(false);
                }}
                className={abaDestinoCls(modo === 'cidade')}
              >
                Cidade
              </button>
            </div>
          </div>

          {modo === 'fornecedor' ? (
            fornecedorCodigo !== '' ? (
              // Já escolhido: mostra o que ficou gravado, com a cidade que ele
              // trouxe. É o ganho do autocomplete, então precisa estar visível.
              <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-mata/30 bg-mata-claro/50 px-3 py-2">
                <span className="min-w-0 text-sm text-mata-escuro">
                  <span className="block truncate font-semibold">
                    {fornecedorNome || fornecedorCodigo}
                  </span>
                  <span className="block text-[11px]">
                    {cidadeLimpa === ''
                      ? 'sem cidade no cadastro'
                      : `cidade: ${cidadeLimpa}`}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={enviando}
                  onClick={limparFornecedor}
                  className="shrink-0 rounded-lg border border-linha bg-papel px-2.5 py-1 text-[11px] font-semibold text-tinta-suave transition hover:border-mata/30 hover:text-mata"
                >
                  Trocar
                </button>
              </div>
            ) : (
              <div
                className="relative mt-2"
                // Fecha a lista quando o foco sai do combobox INTEIRO. Fechar
                // no blur do input mataria a lista antes do clique na opção;
                // olhar para onde o foco foi resolve os dois casos (clique e
                // Tab para dentro da lista).
                onBlur={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                    setListaAberta(false);
                  }
                }}
              >
                <input
                  type="text"
                  role="combobox"
                  aria-expanded={listaAberta}
                  aria-controls="lista-fornecedores"
                  autoComplete="off"
                  value={termo}
                  maxLength={120}
                  disabled={enviando}
                  placeholder="Procurar fornecedor por nome ou cidade…"
                  onFocus={() => setListaAberta(true)}
                  onChange={(e) => {
                    setTermo(e.target.value);
                    setListaAberta(true);
                  }}
                  onKeyDown={(e) => {
                    // Esc fecha a LISTA, não o modal — quem está procurando
                    // fornecedor não quer perder o formulário inteiro.
                    if (e.key === 'Escape' && listaAberta) {
                      e.stopPropagation();
                      setListaAberta(false);
                    }
                  }}
                  className={campoCls}
                />
                {listaAberta && (
                  <ul
                    id="lista-fornecedores"
                    role="listbox"
                    className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-linha bg-papel py-1 shadow-flutua"
                  >
                    {fornecedoresQuery.isLoading ? (
                      <li className="px-3 py-2 text-xs text-pedra">
                        Procurando…
                      </li>
                    ) : fornecedores.length === 0 ? (
                      <li className="px-3 py-2 text-xs text-pedra">
                        Nenhum fornecedor encontrado. Use a aba Cidade para
                        digitar o destino.
                      </li>
                    ) : (
                      fornecedores.map((f) => (
                        <li key={f.codigo} role="option" aria-selected={false}>
                          <button
                            type="button"
                            // Segura o foco no campo de busca: sem isto o
                            // mousedown tira o foco, o blur fecha a lista e o
                            // clique morre com o elemento desmontado.
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => escolherFornecedor(f)}
                            className="block w-full px-3 py-1.5 text-left text-sm text-tinta transition hover:bg-creme-50"
                          >
                            <span className="block truncate font-medium">
                              {rotuloFornecedor(f)}
                            </span>
                            {f.fantasia && f.fantasia.trim() !== '' && (
                              <span className="block truncate text-[11px] text-pedra">
                                {f.fantasia}
                              </span>
                            )}
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                )}
                <span className="mt-1 block text-[11px] text-pedra">
                  O fornecedor do Órix já traz a cidade.
                </span>
              </div>
            )
          ) : (
            <div className="mt-2">
              <input
                type="text"
                value={cidade}
                maxLength={120}
                disabled={enviando}
                placeholder="ex.: Rio Verde"
                onChange={(e) => setCidade(e.target.value)}
                className={campoCls}
              />
              <span className="mt-1 block text-[11px] text-pedra">
                Para quando o destino não é um fornecedor cadastrado.
              </span>
            </div>
          )}
        </div>

        <label className="mt-4 block">
          <span className="text-sm font-semibold text-tinta">
            Produtos <span className="font-normal text-pedra">(opcional)</span>
          </span>
          <input
            type="text"
            value={produtos}
            maxLength={500}
            disabled={enviando}
            placeholder="ex.: 20 t de adubo, peças do freio"
            onChange={(e) => setProdutos(e.target.value)}
            className={`mt-1 ${campoCls}`}
          />
          <span className="mt-1 block text-[11px] text-pedra">
            Texto livre: a reserva não tem item de pedido nem saldo.
          </span>
        </label>

        {/* Os MESMOS seletores do agendamento (SeletorSlot), com o motorista
            opcional: o caminhão vai à oficina mesmo sem se decidir quem leva. */}
        <SeletorSlot
          className="mt-4"
          data={data}
          periodo={periodo}
          motoristaId={motoristaId}
          caminhaoId={caminhaoId}
          onData={setData}
          onPeriodo={setPeriodo}
          onMotorista={setMotoristaId}
          onCaminhao={setCaminhaoId}
          desabilitado={enviando}
          motoristaOpcional
        />

        <label className="mt-4 block sm:w-1/2">
          <span className="text-sm font-semibold text-tinta">
            Peso previsto <span className="font-normal text-pedra">(opcional)</span>
          </span>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              value={peso}
              disabled={enviando}
              placeholder="0"
              onChange={(e) => setPeso(e.target.value)}
              className={campoCls}
            />
            <span className="shrink-0 text-sm text-tinta-suave">kg</span>
          </div>
          <span className="mt-1 block text-[11px] text-pedra">
            {pesoInvalido
              ? 'Peso inválido. Deixe em branco ou informe um número.'
              : pesoKg !== null && pesoKg > 0
                ? `${formatarT(pesoKg)} — conta na tonelagem do caminhão.`
                : 'Sem peso, a reserva ocupa o caminhão e o motorista, mas não conta tonelagem'}
          </span>
        </label>

        {/* MARCADA por padrão: "reservar o caminhão" é o pedido do Johnny.
            Desmarcar é o caso da coleta de adubo, que divide o período com
            entregas de cliente. */}
        <label className="mt-4 flex items-start gap-2 rounded-lg border border-linha bg-creme-50 px-3 py-2">
          <input
            type="checkbox"
            checked={bloqueia}
            disabled={enviando}
            onChange={(e) => setBloqueia(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-linha text-mata focus:ring-mata/30 disabled:opacity-50"
          />
          <span className="text-sm">
            <span className="font-semibold text-tinta">
              Caminhão indisponível neste período
            </span>
            <span className="mt-0.5 block text-[11px] text-tinta-suave">
              {bloqueia
                ? 'Nenhuma entrega de cliente entra neste caminhão neste dia e período.'
                : 'O caminhão continua aceitando entrega de cliente — é o caso de ir buscar mercadoria e ainda entregar no mesmo turno.'}
            </span>
          </span>
        </label>

        {editando && !mudou && (
          <p className="mt-4 rounded-lg border border-linha bg-creme-50 px-3 py-2 text-sm text-tinta-suave">
            Nada mudou ainda.
          </p>
        )}

        {/* O erro do servidor vem com a mensagem já escrita para a tela
            (caminhão reservado, caminhão com entregas, capacidade excedida,
            motorista ocupado) — exibir a dele é melhor que traduzir de novo e
            arriscar dizer outra coisa. */}
        {erro && (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-terra/30 bg-terra-claro px-3 py-2 text-sm text-terra-escuro"
          >
            {erro}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onFechar}
            disabled={enviando}
            className="rounded-lg border border-linha px-4 py-2 text-sm font-semibold text-tinta-suave transition hover:bg-creme-50 disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirmar}
            disabled={bloqueado}
            className="rounded-lg bg-mata px-4 py-2 text-sm font-bold text-creme-50 transition hover:bg-mata-escuro disabled:cursor-not-allowed disabled:opacity-60"
          >
            {enviando
              ? 'Salvando…'
              : editando
                ? 'Salvar reserva'
                : 'Reservar caminhão'}
          </button>
        </div>
      </div>
    </div>
  );
}
