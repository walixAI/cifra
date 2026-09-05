// El paquete no publica tipos. Es un webpack plugin mínimo: constructor sin argumentos y
// `apply(compiler)` — basta para que next.config.ts lo tipe sin recurrir a `any`.
declare module "@prisma/nextjs-monorepo-workaround-plugin" {
  export class PrismaPlugin {
    constructor();
    apply(compiler: unknown): void;
  }
}
