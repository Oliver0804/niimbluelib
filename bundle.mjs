import * as esbuild from 'esbuild';

const common = {
    entryPoints: ['src/index.ts'],
    bundle: true,
    globalName: 'niimbluelib',
};

await esbuild.build({
    ...common,
    outfile: `./dist/umd/${common.globalName}.js`,
    format: 'iife',
    minify: false,
    sourcemap: true,
    platform: 'browser',
    target: ['es6'],
});

await esbuild.build({
    ...common,
    outfile: `./dist/umd/${common.globalName}.min.js`,
    format: 'iife',
    minify: true,
    sourcemap: true,
    platform: 'browser',
    target: ['es6'],
});

// ESM：給 Vite/Rollup 等 bundler 用（package.json exports.import）
await esbuild.build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    outfile: './dist/esm/index.mjs',
    format: 'esm',
    minify: false,
    sourcemap: false,
    platform: 'browser',
    target: ['es2021'],
});
