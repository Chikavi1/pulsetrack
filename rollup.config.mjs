import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';

export default [
  // ESM + CJS
  {
    input: 'src/index.ts',
    output: [
      { dir: 'dist', format: 'esm', entryFileNames: '[name].js' },
      { dir: 'dist', format: 'cjs', entryFileNames: '[name].cjs.js' }
    ],
    plugins: [
      resolve({ browser: true }),
      commonjs(),
      typescript({ tsconfig: './tsconfig.json' })
    ]
  },

  // UMD para navegador
  {
    input: 'src/index.ts',
    output: [
      {
        file: 'dist/pulsetrack.umd.js',
        format: 'umd',
        name: 'PulseTrack'
      },
      {
        file: 'dist/pulsetrack.umd.min.js',
        format: 'umd',
        name: 'PulseTrack',
        plugins: [terser({ format: { comments: false } })]
      }
    ],
    plugins: [
      resolve({ browser: true }),
      commonjs(),
      typescript({ tsconfig: './tsconfig.json' }),
      terser()
    ]
  }
];
