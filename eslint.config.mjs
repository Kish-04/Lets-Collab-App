import nextVitals from 'eslint-config-next/core-web-vitals';

export default [
  {
    ignores: [
      '.next/**',
      'asar_temp/**',
      'chrome/**',
      'dist/**',
      'node_modules/**',
      'out/**',
      'scratch/**',
      'server/artifacts/**',
      'server/cache/**',
      'server/node_modules/**',
    ],
  },
  ...nextVitals,
  {
    rules: {
      '@next/next/no-img-element': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/immutability': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react/no-unescaped-entities': 'off',
    },
  },
];
