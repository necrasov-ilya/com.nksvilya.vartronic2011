module.exports = {
  root: true,
  env: {
    es2022: true,
    node: true,
    jest: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'script',
    project: './tsconfig.eslint.json',
    tsconfigRootDir: __dirname,
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  ignorePatterns: ['.homeybuild/', 'coverage/', 'node_modules/', 'app.js', 'drivers/**/*.js'],
  overrides: [
    {
      files: ['*.js'],
      parserOptions: {
        project: null,
      },
    },
  ],
  rules: {
    '@typescript-eslint/consistent-type-imports': 'error',
    '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
    '@typescript-eslint/require-await': 'off',
    'no-console': 'off',
  },
};
