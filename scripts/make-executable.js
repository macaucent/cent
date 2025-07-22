#!/usr/bin/env node

/**
 * @fileoverview Makes dist files executable by adding proper shebang lines and setting file permissions.
 * This script ensures that built files can be executed directly from the command line.
 */

import fs from 'fs/promises';
import path from 'path';

/**
 * Files to make executable and their corresponding shebang lines.
 */
const EXECUTABLE_FILES = [
  {
    path: 'dist/index.js',
    shebang: '#!/usr/bin/env node\n\n'
  },
  {
    path: 'dist/agent/cli/boot.js',
    shebang: '#!/usr/bin/env node\n\n'
  }
];

/**
 * Makes a file executable by adding a shebang line and setting permissions.
 * @param {string} filePath - Path to the file to make executable
 * @param {string} shebang - Shebang line to add to the file
 */
async function makeExecutable(filePath, shebang) {
  try {
    // Check if file exists
    await fs.access(filePath);
    
    // Read current content
    const content = await fs.readFile(filePath, 'utf8');
    
    // Add shebang if not already present
    if (!content.startsWith('#!')) {
      await fs.writeFile(filePath, shebang + content, 'utf8');
    }
    
    // Set executable permissions (755)
    await fs.chmod(filePath, 0o755);
    
    console.log(`Successfully made executable: ${filePath}`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.warn(`File not found: ${filePath}`);
    } else {
      console.error(`Error making ${filePath} executable:`, error.message);
    }
  }
}

/**
 * Main function to process all executable files.
 */
async function main() {
  console.log('Attempting to make files executable:', EXECUTABLE_FILES.map(f => f.path).join(', '));
  
  for (const file of EXECUTABLE_FILES) {
    await makeExecutable(file.path, file.shebang);
  }
  
  console.log('All targeted files processed successfully.');
}

main().catch(error => {
  console.error('Error in make-executable script:', error);
  process.exit(1);
});