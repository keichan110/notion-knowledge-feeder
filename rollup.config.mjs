import typescript from '@rollup/plugin-typescript';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

const disableEntryPointTreeShaking = () => ({
  name: 'no-treeshaking',
  async resolveId(source, importer, options) {
    if (!importer) {
      const resolution = await this.resolve(source, importer, { skipSelf: true, ...options });
      resolution.moduleSideEffects = 'no-treeshake';
      return resolution;
    }
    return null;
  },
  renderChunk(code) {
    return code.replace(/\nexport\s+\{.*\};/g, '');
  },
});

export default {
  input: 'src/index.ts',
  output: {
    dir: 'dist',
    format: 'esm',
  },
  plugins: [
    disableEntryPointTreeShaking(),
    nodeResolve(),
    commonjs(),
    typescript(),
  ],
};
