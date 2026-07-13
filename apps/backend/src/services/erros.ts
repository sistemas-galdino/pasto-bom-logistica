// Erro de negócio das transições/carga, com status HTTP e código estável.
//
// Vive num módulo próprio (e não em transitions.ts) para que carga.ts possa
// lançá-lo sem criar import circular entre os dois serviços.

export class TransicaoError extends Error {
  readonly statusCode: number;
  readonly codigo: string;

  constructor(statusCode: number, codigo: string, mensagem: string) {
    super(mensagem);
    this.name = 'TransicaoError';
    this.statusCode = statusCode;
    this.codigo = codigo;
  }
}
