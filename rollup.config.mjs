import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';
import javascriptObfuscator from 'rollup-plugin-javascript-obfuscator';

const commonPlugins = [
  resolve({ browser: true }),
  commonjs(),
  typescript({ tsconfig: './tsconfig.json' }),
  terser({ mangle: true, compress: true }),
  javascriptObfuscator({
    compact: true,
    controlFlowFlattening: true,
    deadCodeInjection: true,
    stringArrayEncoding: 'rc4',
    rotateStringArray: true
  })
];

export default [
  // ESM
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/pulsetrack.esm.js',
      format: 'esm',
      sourcemap: false
    },
    plugins: commonPlugins
  },

  // CJS
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/pulsetrack.cjs.js',
      format: 'cjs',
      sourcemap: false
    },
    plugins: commonPlugins
  },

  // UMD
  {
    input: 'src/index.ts',
    output: [
      {
        file: 'dist/pulsetrack.umd.js',
        format: 'umd',
        name: 'PulseTrack',
        sourcemap: false
      },
      {
        file: 'dist/pulsetrack.umd.min.js',
        format: 'umd',
        name: 'PulseTrack',
        sourcemap: false
      }
    ],
    plugins: commonPlugins
  }
];
