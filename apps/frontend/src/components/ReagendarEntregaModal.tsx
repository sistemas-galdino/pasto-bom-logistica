// Modal de REAGENDAR ENTREGA: muda data, período, motorista e caminhão de uma
// viagem que já está agendada, sem voltar o card.
//
// Pedido da Natália, textual: "na etapa agendamento ter a opção de reagendar a
// data sem voltar o Card, pois a separação já está pronta (independente se está
// separado ou não)". Antes disto, remarcar exigia desfazer o agendamento e
// criar outro — e a conferência de separação ia junto.
//
// O QUE ESTA TELA DELIBERADAMENTE NÃO ALTERA (espelha reagendarEntrega no
// backend, que também não aceita):
//
//   - quantidades e itens. Mudar o que vai no caminhão é outra viagem, não a
//     mesma noutro dia.
//   - o peso congelado dos itens. É a MESMA carga física, os mesmos sacos; só
//     mudou o dia. Recongelar pelo cadastro atual faria a ocupação do slot
//     antigo e a do novo discordarem.
//   - propriedade/destino. Trocar o destino muda o clima e o link do mapa: é
//     agendamento novo.
//   - as marcas de separação. Elas sobrevivem por construção (o UPDATE toca só
//     a tabela `entregas`), e é justamente o que ela pediu para preservar.
//
// Este componente NÃO faz a mutação: monta o corpo com apenas o que mudou e
// entrega ao quadro, que é quem chama a API.

import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Caminhao, Entrega, MotoristaResumo, PeriodoEntrega } from '@pastobom/shared';
import { api } from '../lib/api';
import { formatarData } from '../lib/format';

export interface ReagendarBody {
  dataAgendada?: string; // YYYY-MM-DD
  periodo?: 'manha' | 'tarde';
  motoristaId?: string;
  caminhaoId?: string;
  motivo?: string;
  avisarCliente?: boolean;
}

interface Props {
  entrega: Entrega;
  enviando: boolean;
  erro: string | null;
  onConfirmar: (body: ReagendarBody) => void;
  onFechar: () => void;
}

const PERIODO_ROTULO: Record<PeriodoEntrega, string> = {
  manha: 'manhã',
  tarde: 'tarde',
};

function hojeISO(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * O `<input type="date">` só aceita YYYY-MM-DD. `dataAgendada` é uma coluna
 * date e chega assim, mas um timestamp vindo de outra rota travaria o campo em
 * branco — cortar os 10 primeiros caracteres evita a tela abrir vazia e a
 * pessoa "reagendar" sem perceber que perdeu a data atual.
 */
function paraCampoData(iso: string): string {
  return iso.slice(0, 10);
}

function formatarT(kg: number): string {
  return `${(kg / 1000).toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  })} t`;
}

export function ReagendarEntregaModal({
  entrega,
  enviando,
  erro,
  onConfirmar,
  onFechar,
}: Props): React.ReactElement {
  // Começa com os valores ATUAIS: a pessoa precisa ver de onde está saindo,
  // não preencher o agendamento de novo.
  const dataAtual = paraCampoData(entrega.dataAgendada);
  const [data, setData] = useState(dataAtual);
  const [periodo, setPeriodo] = useState<PeriodoEntrega | ''>(entrega.periodo ?? '');
  const [motoristaId, setMotoristaId] = useState(entrega.motoristaId ?? '');
  const [caminhaoId, setCaminhaoId] = useState(entrega.caminhaoId ?? '');
  const [motivo, setMotivo] = useState('');
  // DESMARCADO por padrão: trocar só o caminhão na mesma data é ajuste interno
  // e não justifica uma segunda mensagem ao cliente. Quem já recebeu "sua
  // entrega é dia 12" não quer um WhatsApp por causa de troca de motorista.
  const [avisarCliente, setAvisarCliente] = useState(false);

  // As MESMAS queryKeys do AgendarEntregaModal, para reaproveitar o cache: quem
  // acabou de agendar e reagenda em seguida não espera duas listas de novo.
  const motoristasQuery = useQuery({
    queryKey: ['motoristas'],
    queryFn: ({ signal }) => api.listarMotoristas(signal),
  });
  const caminhoesQuery = useQuery({
    queryKey: ['caminhoes'],
    queryFn: ({ signal }) => api.listarCaminhoes(signal),
  });

  const motoristas: MotoristaResumo[] = motoristasQuery.data ?? [];
  const caminhoes: Caminhao[] = (caminhoesQuery.data ?? []).filter((c) => c.ativo);

  // Esc fecha e o corpo para de rolar atrás do modal — igual ao detalhe da
  // entrega.
  React.useEffect(() => {
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

  const totalItens = entrega.itens.length;
  const separados = entrega.itens.filter((i) => i.separado).length;

  const mudouData = data !== '' && data !== dataAtual;
  const mudouPeriodo = periodo !== '' && periodo !== entrega.periodo;
  const mudouMotorista = motoristaId !== '' && motoristaId !== entrega.motoristaId;
  const mudouCaminhao = caminhaoId !== '' && caminhaoId !== entrega.caminhaoId;
  const mudouSlotDeTempo = mudouData || mudouPeriodo;
  const algoMudou = mudouSlotDeTempo || mudouMotorista || mudouCaminhao;

  // O backend exige os quatro para revalidar a capacidade do caminhão. Viagem
  // antiga sem período/motorista/caminhão preenchido só reagenda se a pessoa
  // completar o slot aqui — melhor dizer isso na tela do que colher o 422.
  const faltaCompletar = periodo === '' || motoristaId === '' || caminhaoId === '';

  const motivoLimpo = motivo.trim();
  const motivoInvalido = motivoLimpo !== '' && motivoLimpo.length < 3;

  const dataNoPassado = data !== '' && data < hojeISO();

  const bloqueado = enviando || !algoMudou || faltaCompletar || motivoInvalido;

  function confirmar(): void {
    if (bloqueado) return;
    // Só os campos que realmente mudaram. Mandar o valor atual de volta faria
    // o histórico registrar "de 12/08 para 12/08" e, pior, dispararia o aviso
    // ao cliente numa mudança que não é de data.
    const body: ReagendarBody = {};
    if (mudouData) body.dataAgendada = data;
    // `mudouPeriodo` já garante que `periodo` não é '' (o TS estreita por ele).
    if (mudouPeriodo) body.periodo = periodo;
    if (mudouMotorista) body.motoristaId = motoristaId;
    if (mudouCaminhao) body.caminhaoId = caminhaoId;
    if (motivoLimpo !== '') body.motivo = motivoLimpo;
    // O aviso só existe quando a data ou o período mudou — o backend ignora nos
    // outros casos, então não mandamos para não parecer que saiu.
    if (avisarCliente && mudouSlotDeTempo) body.avisarCliente = true;

    onConfirmar(body);
  }

  const campoCls =
    'w-full rounded-lg border border-linha bg-creme-50 px-3 py-2 text-sm text-tinta outline-none transition focus:border-mata/40 focus:bg-papel disabled:opacity-60';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-mata-escuro/30 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Reagendar entrega"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !enviando) onFechar();
      }}
    >
      <div className="max-h-[90vh] w-full max-w-xl animate-sobe overflow-y-auto rounded-xl2 bg-papel p-5 shadow-flutua">
        <h2 className="font-display text-lg font-semibold text-mata-escuro">
          Reagendar entrega
        </h2>
        <p className="mt-0.5 text-sm text-tinta-suave">
          Pedido nº {entrega.orixNumero || '—'} —{' '}
          {entrega.clienteNome || entrega.clienteCodigo}
        </p>

        {/* O ponto do pedido dela, em destaque: a separação NÃO se perde. É a
            primeira coisa que se lê, antes de mexer em qualquer campo. */}
        <div className="mt-3 rounded-xl border border-mata/30 bg-mata-claro/50 px-3 py-2">
          <p className="text-sm font-semibold text-mata-escuro">
            {separados > 0
              ? `Separação ${separados}/${totalItens} será mantida`
              : 'A separação não é perdida no reagendamento.'}
          </p>
          <p className="mt-0.5 text-[11px] text-mata-escuro/80">
            Só mudam o dia e quem leva. Quantidades, produtos e peso desta viagem
            continuam os mesmos.
          </p>
        </div>

        <p className="mt-3 text-xs text-tinta-suave">
          Hoje está para {formatarData(entrega.dataAgendada)}
          {entrega.periodo ? `, ${PERIODO_ROTULO[entrega.periodo]}` : ''}
          {entrega.motoristaNome ? ` · ${entrega.motoristaNome}` : ''}
          {entrega.caminhaoNome ? ` · ${entrega.caminhaoNome}` : ''}
        </p>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-semibold text-tinta">Nova data</span>
            <input
              type="date"
              value={data}
              disabled={enviando}
              autoFocus
              onChange={(e) => setData(e.target.value)}
              className={`mt-1 ${campoCls}`}
            />
            {dataNoPassado && (
              <span className="mt-1 block text-[11px] font-semibold text-trigo-escuro">
                Esta data já passou.
              </span>
            )}
          </label>

          <label className="block">
            <span className="text-sm font-semibold text-tinta">Período</span>
            <select
              value={periodo}
              disabled={enviando}
              onChange={(e) => setPeriodo(e.target.value as PeriodoEntrega | '')}
              className={`mt-1 ${campoCls}`}
            >
              <option value="">Escolha…</option>
              <option value="manha">Manhã</option>
              <option value="tarde">Tarde</option>
            </select>
          </label>

          <label className="block">
            <span className="text-sm font-semibold text-tinta">Motorista</span>
            <select
              value={motoristaId}
              disabled={enviando}
              onChange={(e) => setMotoristaId(e.target.value)}
              className={`mt-1 ${campoCls}`}
            >
              <option value="">Escolha…</option>
              {motoristas.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome || m.id}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-sm font-semibold text-tinta">Caminhão</span>
            <select
              value={caminhaoId}
              disabled={enviando}
              onChange={(e) => setCaminhaoId(e.target.value)}
              className={`mt-1 ${campoCls}`}
            >
              <option value="">Escolha…</option>
              {caminhoes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome} ({formatarT(c.capacidadeKg)})
                </option>
              ))}
            </select>
            {caminhoes.length === 0 && !caminhoesQuery.isLoading && (
              <span className="mt-1 block text-[11px] text-trigo-escuro">
                Nenhum caminhão ativo cadastrado.
              </span>
            )}
          </label>

          <label className="block sm:col-span-2">
            <span className="text-sm font-semibold text-tinta">
              Motivo <span className="font-normal text-pedra">(opcional)</span>
            </span>
            <input
              type="text"
              value={motivo}
              maxLength={500}
              disabled={enviando}
              placeholder="ex.: chuva na estrada, cliente pediu outro dia"
              onChange={(e) => setMotivo(e.target.value)}
              className={`mt-1 ${campoCls}`}
            />
            <span className="mt-1 block text-[11px] text-pedra">
              {motivoInvalido
                ? 'Escreva ao menos 3 letras ou deixe em branco.'
                : 'Fica no histórico da viagem, junto do que mudou.'}
            </span>
          </label>
        </div>

        {/* O aviso ao cliente só sai quando a data ou o período muda — é o que o
            backend faz. Fora disso o checkbox fica desabilitado, para ninguém
            marcar e achar que a mensagem foi enviada. */}
        <label
          className={`mt-4 flex items-start gap-2 rounded-lg border px-3 py-2 ${
            mudouSlotDeTempo
              ? 'border-linha bg-creme-50'
              : 'border-linha/60 bg-creme-50/50'
          }`}
        >
          <input
            type="checkbox"
            checked={avisarCliente && mudouSlotDeTempo}
            disabled={enviando || !mudouSlotDeTempo}
            onChange={(e) => setAvisarCliente(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-linha text-mata focus:ring-mata/30 disabled:opacity-50"
          />
          <span className="text-sm">
            <span
              className={
                mudouSlotDeTempo ? 'font-semibold text-tinta' : 'text-tinta-suave'
              }
            >
              Avisar o cliente da nova data
            </span>
            <span className="mt-0.5 block text-[11px] text-tinta-suave">
              {mudouSlotDeTempo
                ? 'Manda um WhatsApp com o novo dia e período.'
                : 'Só vale quando a data ou o período muda. Trocar motorista ou caminhão não gera mensagem.'}
            </span>
          </span>
        </label>

        {faltaCompletar && (
          <p className="mt-4 rounded-lg border border-trigo/40 bg-trigo-claro px-3 py-2 text-sm text-trigo-escuro">
            Esta viagem está sem período, motorista ou caminhão. Complete os três
            para reagendar — é o que permite conferir se a carga cabe no caminhão
            no dia novo.
          </p>
        )}

        {!faltaCompletar && !algoMudou && (
          <p className="mt-4 rounded-lg border border-linha bg-creme-50 px-3 py-2 text-sm text-tinta-suave">
            Nada mudou ainda.
          </p>
        )}

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
            {enviando ? 'Reagendando…' : 'Reagendar'}
          </button>
        </div>
      </div>
    </div>
  );
}
