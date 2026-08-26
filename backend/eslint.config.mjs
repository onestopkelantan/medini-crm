// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    plugins: { boundaries },
    settings: {
      'boundaries/elements': [
        { type: 'shared', pattern: 'src/shared/*', mode: 'folder' },
        { type: 'module-infra', pattern: 'src/modules/*/infrastructure', mode: 'folder' },
        { type: 'module-domain', pattern: 'src/modules/*/domain', mode: 'folder' },
        { type: 'module-app', pattern: 'src/modules/*/application', mode: 'folder' },
        { type: 'module-pres', pattern: 'src/modules/*/presentation', mode: 'folder' },
        { type: 'config', pattern: 'src/config/*', mode: 'folder' },
        { type: 'infra', pattern: 'src/infrastructure/*', mode: 'folder' },
      ],
      'boundaries/include': ['src/**/*.ts'],
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      /*
       * MODULE BOUNDARY RULE (element-types):
       * A domain module's infrastructure (repository/adapter) must NOT be
       * imported by another module. Cross-module talk = application ports,
       * read ports, or domain events only. Since no module exists at Sprint 0,
       * module-infra may only depend inward (shared/domain/app/config) — this
       * structurally blocks any OTHER module from reaching into it.
       */
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [
            { from: 'module-infra', allow: ['shared', 'module-domain', 'module-app', 'config'] },
            { from: 'module-domain', allow: ['shared'] },
            { from: 'module-app', allow: ['shared', 'module-domain', 'config'] },
            { from: 'module-pres', allow: ['shared', 'module-app', 'config'] },
            { from: 'infra', allow: ['shared', 'config'] },
            { from: 'config', allow: [] },
            { from: 'shared', allow: ['shared', 'config'] },
          ],
        },
      ],
    },
  },
);
