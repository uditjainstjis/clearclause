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
    // Tests that run in jsdom rather than workerd. They are excluded from the
    // root tsconfig on purpose — the Worker must not be able to reach for
    // `document` and still typecheck — so typed linting needs pointing at the
    // config that does have the DOM lib and Node's types.
    files: ['test/**/*.dom.test.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: './tsconfig.dom.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      // Test doubles must be async to satisfy the interface they stand in for,
      // even when the fake implementation has nothing to await.
      '@typescript-eslint/require-await': 'off',
      // `expect(env.AI.run).not.toHaveBeenCalled()` reads a vi.fn() off the
      // stub object it was installed on. The rule is guarding against losing
      // `this`, which a spy has none of — it is a false positive here, and the
      // alternative is casting every assertion into unreadability.
      '@typescript-eslint/unbound-method': 'off',
    },
  },
);
