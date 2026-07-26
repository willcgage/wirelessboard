// Replaces .eslintrc.json so each deviation from airbnb-base can say why it
// exists. Everything switched off below is a rule that fights a deliberate
// property of this codebase, not a rule we are too lazy to satisfy.
module.exports = {
  root: true,
  env: {
    browser: true,
    es2021: true,
  },
  extends: 'airbnb-base',
  parserOptions: {
    ecmaVersion: 2021,
    sourceType: 'module',
  },
  globals: {
    // Injected at build time by webpack's DefinePlugin (see webpack.config.js).
    VERSION: 'readonly',
  },
  rules: {
    'no-plusplus': 'off',
    'no-param-reassign': 'off',
    'import/prefer-default-export': 'off',
    'max-len': 'off',
    'no-console': 'warn',

    // Git stores these files with LF and normalizes on commit (core.autocrlf);
    // only Windows working trees are CRLF, so the rule reports thousands of
    // phantom errors locally that CI never sees.
    'linebreak-style': 'off',

    // Many identifiers mirror the snake_case JSON keys served by the Python
    // backend (preset_links, cfg_list, ...). Renaming them would break the
    // wire format, so the shape is intentional.
    camelcase: 'off',

    // The js/ module graph has 23 pre-existing cycles. They are real tech debt,
    // but untangling them is a refactor in its own right, not a lint fix.
    'import/no-cycle': 'off',

    // Bootstrap components are constructed for their side effects
    // (new Collapse(el, { hide: true })); there is no instance to keep.
    'no-new': 'off',

    // Frontend dependencies are bundled by webpack into static assets, so they
    // belong in devDependencies even though js/ imports them.
    'import/no-extraneous-dependencies': ['error', { devDependencies: true }],

    // This codebase writes explicit .js extensions on relative imports, which
    // is correct for ESM; airbnb's extensionless default is the odd one out.
    'import/extensions': ['error', 'ignorePackages', { js: 'always' }],

    // Empty catch blocks are the established idiom here for optional Bootstrap
    // calls that throw when an element is absent. Other empty blocks still error.
    'no-empty': ['error', { allowEmptyCatch: true }],

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

    // Stylistic rules that this codebase deliberately does not follow.
    'no-continue': 'off',
    'no-underscore-dangle': 'off',
  },
};
