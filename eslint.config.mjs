// Lint del monorepo (flat config, ESLint 9). Es una compuerta de CI: la idea es cachar bugs
// reales —variables sin usar, hooks mal, imports rotos— no pelearse con el estilo (de eso se
// encarga el formateo). El chequeo de tipos ya lo hace `tsc` en `pnpm typecheck`, así que aquí
// las reglas de typescript-eslint van SIN type-checking, que es mucho más rápido.

import next from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.next-verificar/**",
      "**/.turbo/**",
      "packages/db/src/generated/**",
      "packages/db/.pgdata/**",
      "packages/db/prisma/migrations/**",
      "handoff/**",
      "**/next-env.d.ts", // lo genera Next, no se edita
    ],
  },

  // Base para todo el TypeScript del repo.
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    rules: {
      // El `_` como prefijo marca "a propósito sin usar" (args de callbacks, destructuring).
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
      // El motor y el dominio usan `any` en un par de fronteras (JSON del SAT, Prisma raw);
      // que sea aviso, no error — el error real lo cacha `tsc`.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },

  // Scripts y config en JS/MJS: sin las reglas de TS, y con globals de Node.
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: { globals: { ...globals.node } },
    ...tseslint.configs.disableTypeChecked,
  },

  // apps/web: reglas de Next y de React Hooks, solo ahí.
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "@next/next": next, "react-hooks": reactHooks },
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      ...next.configs.recommended.rules,
      ...next.configs["core-web-vitals"].rules,
      ...reactHooks.configs.recommended.rules,
      // Solo App Router: no hay carpeta pages/ y la regla no aplica.
      "@next/next/no-html-link-for-pages": "off",
    },
  },

  // Las pruebas hablan con Postgres embebido y hacen SQL crudo: `any` y console son normales.
  {
    files: ["**/__tests__/**", "**/test/**", "**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "no-console": "off",
    },
  },
);
