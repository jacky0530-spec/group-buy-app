import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // This app intentionally colocates small hooks/helpers with components.
      'react-refresh/only-export-components': 'off',
      // Data loading effects call async functions that update state; this is a valid I/O synchronization pattern here.
      'react-hooks/set-state-in-effect': 'off',
      // React Compiler is not enabled in this Vite app; this compiler-specific rule is not actionable here.
      'react-hooks/preserve-manual-memoization': 'off',
      // Chinese full-width spacing in JSX copy is presentation text, not source-code indentation.
      'no-irregular-whitespace': 'off',
    },
  },
])
