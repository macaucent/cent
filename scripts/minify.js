#!/usr/bin/env node

/**
 * Minification script to reduce bundle size of built JavaScript files.
 * Uses Terser for modern JavaScript minification with tree-shaking.
 */

import fs from 'fs/promises';
import path from 'path';
import { minify } from 'terser';
import { glob } from 'glob';

const DIST_DIR = './dist';
const EXCLUDE_PATTERNS = ['*.d.ts', '*.map'];

async function minifyFile(filePath) {
  try {
    console.log(`Minifying: ${filePath}`);
    const content = await fs.readFile(filePath, 'utf8');
    
    const result = await minify(content, {
      compress: {
        drop_console: false,
        drop_debugger: true,
        pure_funcs: ['console.log', 'console.debug'],
        passes: 2,
        unsafe: true,
        unsafe_comps: true,
        unsafe_math: true,
        unsafe_methods: true,
        unsafe_proto: true,
        unsafe_regexp: true,
        module: true,
      },
      mangle: {
        properties: false, // Don't mangle properties to avoid breaking dynamic access
        toplevel: true,
        module: true,
      },
      format: {
        comments: false,
        ecma: 2022,
      },
      ecma: 2022,
      module: true,
      toplevel: true,
    });

    if (result.code) {
      await fs.writeFile(filePath, result.code, 'utf8');
      
      const originalSize = Buffer.byteLength(content, 'utf8');
      const minifiedSize = Buffer.byteLength(result.code, 'utf8');
      const savings = ((originalSize - minifiedSize) / originalSize * 100).toFixed(1);
      
      console.log(`  ${originalSize} → ${minifiedSize} bytes (${savings}% reduction)`);
    }
  } catch (error) {
    console.error(`Error minifying ${filePath}:`, error.message);
  }
}

async function main() {
  try {
    console.log('Starting minification process...');
    
    // Find all JS files in the dist directory
    const jsFiles = await glob(`${DIST_DIR}/**/*.js`, {
      ignore: EXCLUDE_PATTERNS.map(pattern => `${DIST_DIR}/**/${pattern}`),
    });

    console.log(`Found ${jsFiles.length} JavaScript files to minify`);

    // Process files in parallel with limited concurrency
    const concurrency = 4;
    for (let i = 0; i < jsFiles.length; i += concurrency) {
      const batch = jsFiles.slice(i, i + concurrency);
      await Promise.all(batch.map(minifyFile));
    }

    console.log('Minification completed successfully!');
  } catch (error) {
    console.error('Minification failed:', error);
    process.exit(1);
  }
}

main();