// Composição do app: provedores (react-query + auth) e rotas.
// /login é pública; /board é protegida (exige sessão).

import React from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
} from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { Login } from './auth/Login';
import { Board } from './pages/Board';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function TelaCarregando(): React.ReactElement {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-400">
      Carregando…
    </div>
  );
}

/** Bloqueia rotas que exigem sessão; redireciona ao login preservando destino. */
function RotaProtegida({
  children,
}: {
  children: React.ReactElement;
}): React.ReactElement {
  const { carregando, session } = useAuth();
  const location = useLocation();

  if (carregando) return <TelaCarregando />;
  if (!session) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return children;
}

/** Em /login, se já houver sessão, manda direto ao board. */
function RotaLogin(): React.ReactElement {
  const { carregando, session } = useAuth();
  if (carregando) return <TelaCarregando />;
  if (session) return <Navigate to="/board" replace />;
  return <Login />;
}

export function App(): React.ReactElement {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<RotaLogin />} />
            <Route
              path="/board"
              element={
                <RotaProtegida>
                  <Board />
                </RotaProtegida>
              }
            />
            <Route path="*" element={<Navigate to="/board" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
