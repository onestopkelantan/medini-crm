import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      /* React Compiler-era rules (eslint-plugin-react-hooks v7). This app does
       * NOT run the React Compiler yet (no babel-plugin-react-compiler), so
       * these flag valid patterns — e.g. syncing server state into a local
       * draft, or reading Date.now() during render — that the compiler itself
       * would later transform. Kept as warnings so the signal stays visible
       * without pretending the codebase is compiler-clean. Revisit when the
       * compiler is adopted; then fix and promote back to 'error'. */
      "react-hooks/purity": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/static-components": "warn",
    },
  },
])
