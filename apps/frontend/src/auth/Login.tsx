// Tela de login (e-mail/senha via Supabase Auth).

import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { Marca } from '../components/Marca';

interface LocationState {
  from?: { pathname?: string };
}

export function Login(): React.ReactElement {
  const { entrar } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const destino =
    (location.state as LocationState | null)?.from?.pathname ?? '/board';

  async function aoSubmeter(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await entrar(email.trim(), senha);
      navigate(destino, { replace: true });
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao entrar.');
    } finally {
      setEnviando(false);
    }
  }

  const inputCls =
    'w-full rounded-lg border border-linha bg-creme-50 px-3 py-2.5 text-sm text-tinta outline-none transition placeholder:text-pedra focus:border-folha focus:bg-papel focus:ring-2 focus:ring-folha/25';

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm animate-sobe">
        <div className="mb-7 flex flex-col items-center text-center">
          <Marca className="h-14 w-14 drop-shadow" />
          <h1 className="mt-4 font-display text-3xl font-semibold text-mata-escuro">
            Pasto Bom
          </h1>
          <p className="mt-1 text-sm text-tinta-suave">
            Sistema de Logística Inteligente
          </p>
        </div>

        <form
          onSubmit={aoSubmeter}
          className="rounded-xl2 border border-linha bg-papel/90 p-6 shadow-flutua backdrop-blur"
        >
          <label className="mb-4 block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-tinta-suave">
              E-mail
            </span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputCls}
              placeholder="voce@pastobom.com.br"
            />
          </label>

          <label className="mb-5 block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-tinta-suave">
              Senha
            </span>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              className={inputCls}
              placeholder="••••••••"
            />
          </label>

          {erro && (
            <div
              role="alert"
              className="mb-4 rounded-lg border border-terra/30 bg-terra-claro px-3 py-2 text-sm text-terra-escuro"
            >
              {erro}
            </div>
          )}

          <button
            type="submit"
            disabled={enviando}
            className="w-full rounded-lg bg-mata px-4 py-2.5 text-sm font-bold text-creme-50 shadow-sm transition hover:bg-mata-escuro disabled:cursor-not-allowed disabled:opacity-60"
          >
            {enviando ? 'Entrando…' : 'Entrar'}
          </button>
        </form>

        <p className="mt-5 text-center text-xs text-tinta-suave">
          Acesso restrito à equipe Pasto Bom · Três Pontas/MG
        </p>
      </div>
    </div>
  );
}
