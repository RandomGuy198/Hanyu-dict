/**
 * Flat ESLint config for the clean-room Hanyu Dictionary PWA.
 *
 * Scope: the app source (`src/`), the build-time content pipeline (`scripts/`), the test
 * suite (`tests/`, added by the test workstream) and the root config files.
 *
 * Deliberate choices:
 *  - Plain (non type-aware) `typescript-eslint` recommended rules. Type-aware linting would
 *    need `parserOptions.project` over a tsconfig that excludes this file and would make every
 *    CI run parse the whole program; `npm run typecheck` already owns type correctness.
 *  - Generated packs under `public/` are never linted; they are pipeline output, not source.
 *  - `react-hooks/exhaustive-deps` is a warning, not an error, and CI does not use
 *    `--max-warnings 0`. Warnings are reported and must be driven down; errors fail the build.
 *  - `console` is allowed in `scripts/**` on purpose: those are Node build tools whose output
 *    *is* the UX. App code keeps the "no console.log of user content" rule from
 *    docs/APP_CONTRACT.md by convention (see the `no-console` override below).
 *
 * The toolchain is declared in `package.json` devDependencies
 * (`eslint`, `@eslint/js`, `typescript-eslint`, `eslint-plugin-react`,
 * `eslint-plugin-react-hooks`, `globals`); `npm run lint` runs this file over `src/`, `tests/`,
 * `scripts/` and the root configs.
 */
import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

const unusedVars = [
  'error',
  {
    args: 'after-used',
    argsIgnorePattern: '^_',
    varsIgnorePattern: '^_',
    caughtErrorsIgnorePattern: '^_',
    destructuredArrayIgnorePattern: '^_',
  },
];

export default tseslint.config(
  {
    // Everything generated, vendored or transient stays out of the lint run.
    ignores: [
      'dist/**',
      'dist-*/**',
      'site/**', // committed Pages artifact produced by scripts/sync-pages.mjs: build output, not source
      'coverage/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
      '.vite/**',
      '.cache/**', // raw upstream downloads never live here anyway; belt and braces
      '.qbcheck/**', // tooling scratch directory, not project source
      'public/**', // committed pipeline output: packs, licences, icons
      '**/*.tsbuildinfo',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    // App + tests: browser DOM, React, JSX, hook rules.
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { react, 'react-hooks': reactHooks },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      'react/react-in-jsx-scope': 'off', // react-jsx runtime, no React import needed
      'react/prop-types': 'off', // TypeScript types are the contract here
      'react/no-unescaped-entities': 'off', // copy is written with real apostrophes/quotes
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-unused-vars': unusedVars,
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-explicit-any': 'warn', // documented escape hatch, see APP_CONTRACT rule 6
    },
  },

  {
    // Build-time pipeline and Vite config: Node, not the browser.
    files: ['scripts/**/*.{mjs,js}', 'vite.config.ts', 'playwright.config.ts', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-unused-vars': unusedVars,
      // scripts/content/lib/record.mjs deliberately matches [\u0000\u001F\r\n]: the pack format
      // uses U+001F as its field separator and must reject it (and NUL) inside any field.
      'no-control-regex': 'off',
    },
  },

  {
    files: ['**/*.d.ts'],
    rules: {
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'react-hooks/rules-of-hooks': 'off',
    },
  },
);
