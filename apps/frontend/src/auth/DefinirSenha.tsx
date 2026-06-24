// Tela de destino do link de convite (/definir-senha).
//
// O supabase-js parseia o hash da URL e cria a sessão automaticamente. Com
// sessão, a pessoa define a senha de acesso (updateUser). Sem sessão (link
// expirado/inválido), mostramos uma mensagem amigável com link para o login.

import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import { useAuth } from './AuthProvider';
import { supabase } from '../lib/supabase';
import { Marca } from '../components/Marca';

const inputCls =
  'w-full rounded-lg border border-linha bg-creme-50 px-3 py-2.5 text-sm text-tinta outline-none transition placeholder:text-pedra focus:border-folha focus:bg-papel focus:ring-2 focus:ring-folha/25';

export function DefinirSenha(): React.ReactElement {
  const { carregando, session } = useAuth();
  const navigate = useNavigate();
  const [senha, setSenha] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [concluido, setConcluido] = useState(false);

  async function aoSubmeter(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);

    if (senha.length < 6) {
      setErro('A senha deve ter ao menos 6 caracteres.');
      return;
    }
    if (senha !== confirmar) {
      setErro('As senhas não conferem.');
      return;
    }

    setEnviando(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: senha });
      if (error) throw new Error(error.message);
      setConcluido(true);
      // Pequena pausa para a pessoa ver a confirmação antes do redirecionamento.
      setTimeout(() => navigate('/dashboard', { replace: true }), 1500);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao definir a senha.');
    } finally {
      setEnviando(false);
    }
  }

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

        <div className="rounded-xl2 border border-linha bg-papel/90 p-6 shadow-flutua backdrop-blur">
          {carregando ? (
            <p className="py-6 text-center text-sm text-tinta-suave">
              Validando o convite…
            </p>
          ) : !session ? (
            <div className="text-center">
              <h2 className="font-display text-lg font-semibold text-mata-escuro">
                Convite inválido ou expirado
              </h2>
              <p className="mt-2 text-sm text-tinta-suave">
                Este link não é mais válido. Peça à logística um novo convite ou
                acesse com sua senha, se já a tiver definido.
              </p>
              <Link
                to="/login"
                className="mt-5 inline-block rounded-lg bg-mata px-4 py-2.5 text-sm font-bold text-creme-50 shadow-sm transition hover:bg-mata-escuro"
              >
                Ir para o login
              </Link>
            </div>
          ) : concluido ? (
            <div className="text-center">
              <CheckCircle2
                className="mx-auto h-10 w-10 text-mata"
                aria-hidden="true"
              />
              <h2 className="mt-3 font-display text-lg font-semibold text-mata-escuro">
                Senha definida!
              </h2>
              <p className="mt-2 text-sm text-tinta-suave">
                Tudo pronto. Redirecionando para o sistema…
              </p>
            </div>
          ) : (
            <form onSubmit={aoSubmeter}>
              <h2 className="mb-4 font-display text-lg font-semibold text-mata-escuro">
                Crie sua senha de acesso
              </h2>

              <label className="mb-4 block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-tinta-suave">
                  Senha
                </span>
                <input
                  type="password"
                  required
                  minLength={6}
                  autoComplete="new-password"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  className={inputCls}
                  placeholder="Ao menos 6 caracteres"
                />
              </label>

              <label className="mb-5 block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-tinta-suave">
                  Confirmar senha
                </span>
                <input
                  type="password"
                  required
                  minLength={6}
                  autoComplete="new-password"
                  value={confirmar}
                  onChange={(e) => setConfirmar(e.target.value)}
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
                {enviando ? 'Salvando…' : 'Definir senha'}
              </button>
            </form>
          )}
        </div>

        <p className="mt-5 text-center text-xs text-tinta-suave">
          Acesso restrito à equipe Pasto Bom · Três Pontas/MG
        </p>
      </div>
    </div>
  );
}
