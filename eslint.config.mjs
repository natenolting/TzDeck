import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Agent worktrees are full checkouts of this repo living inside it, build
    // output and all. Linting them reports thousands of problems in files that
    // are not the working tree and drowns the one that is.
    ".claude/**",
  ]),
  {
    // `trackFunnelEvent` only accepts a closed union with nowhere to put a
    // wallet address, a contract address, a token id or a card key. A direct
    // `track` call takes an arbitrary property bag and would route around
    // that, so the compile error is backed by a lint error. The `Analytics`
    // component imports from "@vercel/analytics/next", a different specifier,
    // and is untouched by this.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/analytics.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@vercel/analytics",
              importNames: ["track"],
              message:
                "Import trackFunnelEvent from @/lib/analytics instead. Its closed event union is what keeps wallet addresses, contract addresses, token ids and card keys out of analytics.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
