import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Lint rules are chosen to catch the mistakes that matter in a Worker:
 * floating promises, unchecked `any` crossing a trust boundary, and dead code.
 * Stylistic questions are Prettier's job, not ESLint's.
 */
export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      'worker-configuration.d.ts',
      '.wrangler/**',
      'eslint.config.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
    },
  },
  {
    // Front-end code runs in the browser and is plain JavaScript.
    files: ['public/**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        fetch: 'readonly',
        navigator: 'readonly',
        localStorage: 'readonly',
        TextDecoder: 'readonly',
      },
    },
    rules: { 'no-undef': 'error' },
  },
  {
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      // Test doubles must be async to satisfy the interface they stand in for,
      // even when the fake implementation has nothing to await.
      '@typescript-eslint/require-await': 'off',
    },
  },
);
