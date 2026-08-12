// Página do link de acesso (/acesso/:token) — a "sala de espera" antes de criar
// a senha.
//
// POR QUE ELA EXISTE (queixa da Natália, 12/08/2026: "o link expira muito
// rápido")
// ---------------------------------------------------------------------------
// Antes, a logística mandava o link do Supabase direto. Esse link é de uso único
// e é gasto por QUEM ABRIR A URL — inclusive um robô. O WhatsApp busca o link
// para montar a pré-visualização da mensagem, e essa visita já queimava o token:
// a pessoa clicava depois e encontrava "link inválido".
//
// Esta página quebra o problema em dois passos. Abri-la não consome nada (é só
// uma consulta); o link do Supabase só é gerado quando a pessoa clica no botão,
// e é usado segundos depois. O robô abre a página, não aperta o botão.

import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import type { EstadoLinkAcesso } from '@pastobom/shared';
import { api } from '../lib/api';
import { MarcaOficial } from '../components/Marca';

export function Acesso(): React.ReactElement {
  const { token = '' } = useParams<{ token: string }>();
  const [estado, setEstado] = useState<EstadoLinkAcesso | null>(null);
  const [falhaConsulta, setFalhaConsulta] = useState(false);
  const [indo, setIndo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const controle = new AbortController();
    api
      .estadoLinkAcesso(token, controle.signal)
      .then(setEstado)
      .catch((err) => {
        if (controle.signal.aborted) return;
        setFalhaConsulta(true);
        setEstado({ valido: false, motivo: 'invalido' });
        void err;
      });
    return () => controle.abort();
  }, [token]);

  async function confirmar() {
    setErro(null);
    setIndo(true);
    try {
      const { url } = await api.confirmarLinkAcesso(token);
      // Sai do SPA de propósito: a URL é do Supabase, que valida o token e
      // devolve o navegador em /definir-senha já com a sessão criada.
      window.location.href = url;
    } catch (err) {
      setErro(
        err instanceof Error
          ? err.message
          : 'Não foi possível abrir o acesso. Tente de novo.',
      );
      setIndo(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm animate-sobe">
        <div className="mb-7 flex flex-col items-center text-center">
          <MarcaOficial className="h-24 w-auto drop-shadow-sm" />
          <p className="mt-3 text-sm text-tinta-suave">
            Sistema de Logística Inteligente
          </p>
        </div>

        <div className="rounded-xl2 border border-linha bg-papel/90 p-6 shadow-flutua backdrop-blur">
          {estado === null ? (
            <p className="py-6 text-center text-sm text-tinta-suave">
              Verificando o link…
            </p>
          ) : estado.valido ? (
            <div className="text-center">
              <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-folha-claro text-mata">
                <KeyRound className="h-5 w-5" aria-hidden="true" />
              </span>
              <h1 className="mt-3 font-display text-lg font-semibold text-mata-escuro">
                {estado.nome ? `Olá, ${estado.nome}!` : 'Acesso ao sistema'}
              </h1>
              <p className="mt-2 text-sm text-tinta-suave">
                Clique abaixo para criar sua senha de acesso.
              </p>

              {erro && (
                <div
                  role="alert"
                  className="mt-4 rounded-lg border border-terra/30 bg-terra-claro px-3 py-2 text-left text-sm text-terra-escuro"
                >
                  {erro}
                </div>
              )}

              <button
                type="button"
                onClick={() => void confirmar()}
                disabled={indo}
                className="mt-5 w-full rounded-lg bg-mata px-4 py-2.5 text-sm font-bold text-creme-50 shadow-sm transition hover:bg-mata-escuro disabled:cursor-not-allowed disabled:opacity-60"
              >
                {indo ? 'Abrindo…' : 'Criar minha senha'}
              </button>
            </div>
          ) : (
            <div className="text-center">
              <h1 className="font-display text-lg font-semibold text-mata-escuro">
                {estado.motivo === 'expirado'
                  ? 'Link expirado'
                  : 'Link inválido'}
              </h1>
              <p className="mt-2 text-sm text-tinta-suave">
                {falhaConsulta
                  ? 'Não foi possível verificar este link agora. Tente de novo em instantes.'
                  : estado.motivo === 'expirado'
                    ? 'Este link passou do prazo de validade. Peça um novo à logística.'
                    : 'Este link não é mais válido — ele pode já ter sido usado ou substituído por outro. Peça um novo à logística.'}
              </p>
              <Link
                to="/login"
                className="mt-5 inline-block rounded-lg bg-mata px-4 py-2.5 text-sm font-bold text-creme-50 shadow-sm transition hover:bg-mata-escuro"
              >
                Ir para o login
              </Link>
            </div>
          )}
        </div>

        <p className="mt-5 text-center text-xs text-tinta-suave">
          Acesso restrito à equipe Pasto Bom · Botelhos/MG
        </p>
      </div>
    </div>
  );
}
