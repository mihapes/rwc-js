import * as esbuild from 'esbuild';

let isDev = false;

process.argv.forEach((val) => {
    if (val === '-d') {
        isDev = true;
    }
});

await esbuild.build({
    entryPoints: ['rwc/compiler/rwccompiler.ts'],
    bundle: !isDev,
    minify: !isDev,
    platform: 'node',
    format: 'cjs',
    tsconfig: 'rwc/compiler/tsconfig.json',
    outfile: `dist/${isDev ? 'dev' : ''}/rwc-compiler.cjs`,
});

await esbuild.build({
    entryPoints: ['rwc/runtime/rwcruntime.ts'],
    bundle: !isDev,
    minify: !isDev,
    sourcemap: isDev,
    target: ['chrome58', 'firefox57', 'safari11', 'edge16'],
    format: 'iife',
    tsconfig: 'rwc/runtime/tsconfig.json',
    globalName: 'rwc',
    outfile: `dist/${isDev ? 'dev' : ''}/rwc-runtime.js`,
});