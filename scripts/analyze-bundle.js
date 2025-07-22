#!/usr/bin/env node

/**
 * Bundle analyzer script to identify the largest files and optimization opportunities.
 * Provides detailed size analysis and suggestions for bundle optimization.
 */

import fs from 'fs/promises';
import path from 'path';
import { glob } from 'glob';

const DIST_DIR = './dist';

async function getFileSize(filePath) {
  try {
    const stats = await fs.stat(filePath);
    return stats.size;
  } catch (error) {
    return 0;
  }
}

async function analyzeFile(filePath) {
  const size = await getFileSize(filePath);
  const relativePath = path.relative(DIST_DIR, filePath);
  
  return {
    path: relativePath,
    fullPath: filePath,
    size,
    sizeKB: (size / 1024).toFixed(2),
    sizeMB: (size / (1024 * 1024)).toFixed(2),
  };
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function generateOptimizationSuggestions(files) {
  const suggestions = [];
  
  // Find large files
  const largeFiles = files.filter(f => f.size > 50 * 1024); // > 50KB
  if (largeFiles.length > 0) {
    suggestions.push({
      type: 'Large Files',
      description: 'Consider lazy loading or splitting these large files:',
      items: largeFiles.slice(0, 5).map(f => `${f.path} (${f.sizeKB} KB)`),
    });
  }
  
  // Find duplicate patterns
  const patterns = {};
  files.forEach(f => {
    const dir = path.dirname(f.path);
    patterns[dir] = (patterns[dir] || 0) + f.size;
  });
  
  const heavyDirs = Object.entries(patterns)
    .filter(([_, size]) => size > 100 * 1024) // > 100KB
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
    
  if (heavyDirs.length > 0) {
    suggestions.push({
      type: 'Heavy Directories',
      description: 'These directories contain large amounts of code:',
      items: heavyDirs.map(([dir, size]) => `${dir}/ (${formatBytes(size)})`),
    });
  }
  
  // Suggest optimizations based on file types
  const jsFiles = files.filter(f => f.path.endsWith('.js'));
  const totalJSSize = jsFiles.reduce((sum, f) => sum + f.size, 0);
  
  if (totalJSSize > 1024 * 1024) { // > 1MB
    suggestions.push({
      type: 'Bundle Size',
      description: 'Total JavaScript bundle is large. Consider:',
      items: [
        'Implementing code splitting',
        'Using dynamic imports for heavy dependencies',
        'Tree shaking unused code',
        'Minifying production builds',
      ],
    });
  }
  
  return suggestions;
}

async function main() {
  try {
    console.log('🔍 Analyzing bundle size...\n');
    
    // Find all files in the dist directory
    const allFiles = await glob(`${DIST_DIR}/**/*`, {
      nodir: true,
    });

    console.log(`Found ${allFiles.length} files to analyze\n`);

    // Analyze each file
    const fileAnalysis = await Promise.all(allFiles.map(analyzeFile));
    
    // Sort by size (largest first)
    fileAnalysis.sort((a, b) => b.size - a.size);
    
    // Calculate totals
    const totalSize = fileAnalysis.reduce((sum, file) => sum + file.size, 0);
    const jsFiles = fileAnalysis.filter(f => f.path.endsWith('.js'));
    const totalJSSize = jsFiles.reduce((sum, file) => sum + file.size, 0);
    const dtsFiles = fileAnalysis.filter(f => f.path.endsWith('.d.ts'));
    const totalDTSSize = dtsFiles.reduce((sum, file) => sum + file.size, 0);
    
    // Display summary
    console.log('📊 BUNDLE ANALYSIS SUMMARY');
    console.log('═'.repeat(50));
    console.log(`Total bundle size: ${formatBytes(totalSize)}`);
    console.log(`JavaScript files: ${jsFiles.length} (${formatBytes(totalJSSize)})`);
    console.log(`TypeScript declarations: ${dtsFiles.length} (${formatBytes(totalDTSSize)})`);
    console.log(`Other files: ${allFiles.length - jsFiles.length - dtsFiles.length}`);
    console.log('');
    
    // Display largest files
    console.log('📈 LARGEST FILES (Top 10)');
    console.log('═'.repeat(50));
    fileAnalysis.slice(0, 10).forEach((file, index) => {
      const icon = file.path.endsWith('.js') ? '📜' : 
                   file.path.endsWith('.d.ts') ? '📝' : '📄';
      console.log(`${(index + 1).toString().padStart(2)}. ${icon} ${file.path.padEnd(40)} ${file.sizeKB.padStart(8)} KB`);
    });
    console.log('');
    
    // Display file type breakdown
    const fileTypes = {};
    fileAnalysis.forEach(file => {
      const ext = path.extname(file.path) || 'no-extension';
      if (!fileTypes[ext]) {
        fileTypes[ext] = { count: 0, size: 0 };
      }
      fileTypes[ext].count++;
      fileTypes[ext].size += file.size;
    });
    
    console.log('📋 FILE TYPE BREAKDOWN');
    console.log('═'.repeat(50));
    Object.entries(fileTypes)
      .sort((a, b) => b[1].size - a[1].size)
      .forEach(([ext, data]) => {
        const percentage = ((data.size / totalSize) * 100).toFixed(1);
        console.log(`${ext.padEnd(15)} ${data.count.toString().padStart(3)} files  ${formatBytes(data.size).padStart(10)} (${percentage}%)`);
      });
    console.log('');
    
    // Generate optimization suggestions
    const suggestions = generateOptimizationSuggestions(fileAnalysis);
    
    if (suggestions.length > 0) {
      console.log('💡 OPTIMIZATION SUGGESTIONS');
      console.log('═'.repeat(50));
      suggestions.forEach((suggestion, index) => {
        console.log(`${index + 1}. ${suggestion.type}:`);
        console.log(`   ${suggestion.description}`);
        suggestion.items.forEach(item => {
          console.log(`   • ${item}`);
        });
        console.log('');
      });
    }
    
    // Performance insights
    console.log('⚡ PERFORMANCE INSIGHTS');
    console.log('═'.repeat(50));
    
    if (totalJSSize > 2 * 1024 * 1024) {
      console.log('⚠️  Large bundle size detected (>2MB)');
    } else if (totalJSSize > 1024 * 1024) {
      console.log('⚠️  Medium bundle size (>1MB) - monitor growth');
    } else {
      console.log('✅ Bundle size is reasonable');
    }
    
    const avgFileSize = totalSize / fileAnalysis.length;
    if (avgFileSize > 100 * 1024) {
      console.log('⚠️  High average file size - consider splitting large modules');
    } else {
      console.log('✅ Average file size is good');
    }
    
    console.log(`📦 Average file size: ${formatBytes(avgFileSize)}`);
    console.log(`🎯 Bundle efficiency: ${((totalJSSize / totalSize) * 100).toFixed(1)}% JavaScript`);
    
  } catch (error) {
    console.error('❌ Bundle analysis failed:', error);
    process.exit(1);
  }
}

main();