// Flat config, replacing .eslintrc.cjs.
//
// eslint 8 went end of life and its two @humanwhocodes internals are
// deprecated, but eslint-config-airbnb-base declares peer eslint "^7 || ^8" and
// has not shipped since 2022, so it can never move to 9. eslint-config-airbnb-
// extended is a maintained flat-config port of the same rules with peer
// eslint ^9 -- which is as far as this can go for now, because
// eslint-plugin-import supports up to 9 and not 10.
//
// Every deviation below was carried over from .eslintrc.cjs with its reasoning.
// Each switches off a rule that fights a deliberate property of this codebase,
// not a rule we are too lazy to satisfy.
//
// Two renames to watch when editing: the port uses eslint-plugin-import-x, so
// `import/*` rules are `import-x/*`, and formatting rules moved to
// `@stylistic/*`. A rule written under the old name silently does not apply
// rather than erroring, which is the easy way to loosen this file by accident.
import { configs, plugins } from 'eslint-config-airbnb-extended';
// globals ships as a dependency of the config above rather than a direct one,
// so it is resolved through it instead of being declared twice. It is CJS, so
// it has no named exports.
import globals from 'globals';

const browserGlobals = globals.browser;

export default [
  {
    // Build output, vendored code and the Python virtualenv are not ours to lint.
    ignores: [
      'static/**',
      'node_modules/**',
      'vendor/**',
      '.venv/**',
      'release/**',
      'dist/**',
    ],
  },

  // base.recommended references import-x and @stylistic rules, so both plugins
  // have to be registered before it rather than assumed.
  plugins.stylistic,
  plugins.importX,
  ...configs.base.recommended,

  {
    files: ['js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'module',
      // The inherited config sets parserOptions.ecmaVersion to 2018, and that
      // takes precedence over the top-level ecmaVersion above. Left alone, every
      // `?.` and `??` in js/ is a parse error.
      parserOptions: { ecmaVersion: 2021, sourceType: 'module' },
      globals: {
        ...browserGlobals,
        // Injected at build time by webpack's DefinePlugin (see webpack.config.js).
        VERSION: 'readonly',
      },
    },
    rules: {
      'no-plusplus': 'off',
      'no-param-reassign': 'off',
      'import-x/prefer-default-export': 'off',
      '@stylistic/max-len': 'off',
      'no-console': 'warn',

      // Git stores these files with LF and normalizes on commit (core.autocrlf);
      // only Windows working trees are CRLF, so the rule reports thousands of
      // phantom errors locally that CI never sees.
      '@stylistic/linebreak-style': 'off',

      // Many identifiers mirror the snake_case JSON keys served by the Python
      // backend (preset_links, cfg_list, ...). Renaming them would break the
      // wire format, so the shape is intentional.
      camelcase: 'off',

      // The js/ module graph has 23 pre-existing cycles. They are real tech debt,
      // but untangling them is a refactor in its own right, not a lint fix.
      'import-x/no-cycle': 'off',

      // Bootstrap components are constructed for their side effects
      // (new Collapse(el, { hide: true })); there is no instance to keep.
      'no-new': 'off',

      // Frontend dependencies are bundled by webpack into static assets, so they
      // belong in devDependencies even though js/ imports them.
      'import-x/no-extraneous-dependencies': ['error', { devDependencies: true }],

      // This codebase writes explicit .js extensions on relative imports, which
      // is correct for ESM; airbnb's extensionless default is the odd one out.
      'import-x/extensions': ['error', 'ignorePackages', { js: 'always' }],

      // Empty catch blocks are the established idiom here for optional Bootstrap
      // calls that throw when an element is absent. Other empty blocks still error.
      'no-empty': ['error', { allowEmptyCatch: true }],

      // eslint 9 changed no-unused-vars' caughtErrors default from "none" to
      // "all", so every `catch (e) {}` above suddenly reports its own binding --
      // 55 of them, none a real finding. Restoring the previous behaviour rather
      // than renaming every caught error to satisfy a default that changed.
      'no-unused-vars': ['warn', {
        vars: 'all',
        args: 'after-used',
        ignoreRestSiblings: true,
        argsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],

      // Two rules where this port is stricter than the airbnb-base it replaces.
      // Both are restored to airbnb's own settings, checked against
      // eslint-config-airbnb-base@15.0.0 rules/style.js, so the migration
      // changes which linter runs and not what the codebase must look like:
      //   brace-style              ['error','1tbs',{allowSingleLine: true}]
      //   max-statements-per-line  ['off', { max: 1 }]
      // Left as the port has them, these report 98 and 44 pre-existing sites.
      '@stylistic/brace-style': ['error', '1tbs', { allowSingleLine: true }],
      '@stylistic/max-statements-per-line': ['off', { max: 1 }],

      // Function declarations hoist, so calling one above its definition is safe
      // and common in this file layout. Variables and classes still error.
      'no-use-before-define': ['error', { functions: false, classes: true, variables: true }],

      // airbnb's default also bans for..of, which needs no regenerator under our
      // webpack/babel target. for..in stays banned.
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ForInStatement',
          message: 'for..in iterates the prototype chain; use Object.{keys,values,entries}.',
        },
        {
          selector: 'LabeledStatement',
          message: 'Labels are a form of GOTO; use functions or early returns instead.',
        },
        {
          selector: 'WithStatement',
          message: '`with` is disallowed in strict mode and makes scope ambiguous.',
        },
      ],

      // Object.hasOwn is ES2022 and a runtime method, so babel does not shim it
      // and this project configures no browserslist target and no core-js. The
      // existing Object.prototype.hasOwnProperty.call form is correct and works
      // everywhere; swapping it to satisfy a style rule would quietly narrow
      // which browsers can open the interface. Worth revisiting once a browser
      // target is actually declared.
      'prefer-object-has-own': 'off',

      // Stylistic rules that this codebase deliberately does not follow.
      'no-continue': 'off',
      'no-underscore-dangle': 'off',
    },
  },
];
