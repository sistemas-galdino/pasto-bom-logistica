// [FUNDAÇÃO] Logger simples com timestamp ISO e nível.

type Nivel = 'info' | 'warn' | 'error' | 'debug';

function escrever(nivel: Nivel, mensagem: string, ...args: unknown[]): void {
  const ts = new Date().toISOString();
  const linha = `[${ts}] [${nivel.toUpperCase()}] ${mensagem}`;
  if (nivel === 'error') {
    // eslint-disable-next-line no-console
    console.error(linha, ...args);
  } else if (nivel === 'warn') {
    // eslint-disable-next-line no-console
    console.warn(linha, ...args);
  } else {
    // eslint-disable-next-line no-console
    console.log(linha, ...args);
  }
}

export const log = {
  info: (mensagem: string, ...args: unknown[]) =>
    escrever('info', mensagem, ...args),
  warn: (mensagem: string, ...args: unknown[]) =>
    escrever('warn', mensagem, ...args),
  error: (mensagem: string, ...args: unknown[]) =>
    escrever('error', mensagem, ...args),
  debug: (mensagem: string, ...args: unknown[]) =>
    escrever('debug', mensagem, ...args),
};
