import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import JavaScriptObfuscator from 'javascript-obfuscator';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const srcDir = path.join(rootDir, 'src');
const coreDir = path.join(rootDir, 'core');
const backupDir = path.join(rootDir, '.build_backup');

function copyRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function getJsFiles(dir) {
  let results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(getJsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.js') && !entry.name.includes('test')) {
      results.push(fullPath);
    }
  }
  return results;
}

console.log('>>> [1/5] Backing up clean source tree...');
if (fs.existsSync(backupDir)) {
  fs.rmSync(backupDir, { recursive: true, force: true });
}
fs.mkdirSync(backupDir, { recursive: true });
copyRecursive(srcDir, path.join(backupDir, 'src'));
copyRecursive(coreDir, path.join(backupDir, 'core'));

try {
  console.log('>>> [2/5] Applying advanced source obfuscation & anti-tamper encoding...');
  const filesToObfuscate = [...getJsFiles(srcDir), ...getJsFiles(coreDir)];

  for (const file of filesToObfuscate) {
    const relPath = path.relative(rootDir, file);
    console.log(`    Obfuscating: ${relPath}`);
    const originalCode = fs.readFileSync(file, 'utf-8');
    const obfuscated = JavaScriptObfuscator.obfuscate(originalCode, {
      compact: true,
      controlFlowFlattening: true,
      controlFlowFlatteningThreshold: 0.75,
      identifierNamesGenerator: 'hexadecimal',
      numbersToExpressions: true,
      simplify: true,
      splitStrings: true,
      stringArray: true,
      stringArrayEncoding: ['base64', 'rc4'],
      stringArrayThreshold: 0.8,
      transformObjectKeys: true
    });
    fs.writeFileSync(file, obfuscated.getObfuscatedCode(), 'utf-8');
  }

  console.log('>>> [3/5] Packaging closed-source Electron binaries for macOS and Windows...');
  execSync('node ./node_modules/.bin/electron-builder build --mac --win', { cwd: rootDir, stdio: 'inherit', env: process.env });

  console.log('>>> [4/5] Syncing release packages to outputs/...');
  const outputsDir = path.resolve(rootDir, '../outputs');
  fs.mkdirSync(outputsDir, { recursive: true });

  const macDmg = path.join(rootDir, 'dist/SubFuse-1.0.0-arm64.dmg');
  const macZip = path.join(rootDir, 'dist/SubFuse-1.0.0-arm64-mac.zip');
  const winZip = path.join(rootDir, 'dist/SubFuse-1.0.0-win.zip');

  if (fs.existsSync(macDmg)) {
    fs.copyFileSync(macDmg, path.join(outputsDir, 'SubFuse-1.0.0-arm64.dmg'));
    console.log('    ✓ Synced SubFuse-1.0.0-arm64.dmg');
  }
  if (fs.existsSync(macZip)) {
    fs.copyFileSync(macZip, path.join(outputsDir, 'SubFuse-1.0.0-mac.zip'));
    console.log('    ✓ Synced SubFuse-1.0.0-mac.zip');
  }
  if (fs.existsSync(winZip)) {
    fs.copyFileSync(winZip, path.join(outputsDir, 'SubFuse-1.0.0-win-x64.zip'));
    console.log('    ✓ Synced SubFuse-1.0.0-win-x64.zip');
  }

} finally {
  console.log('>>> [5/5] Restoring clean source tree from backup...');
  copyRecursive(path.join(backupDir, 'src'), srcDir);
  copyRecursive(path.join(backupDir, 'core'), coreDir);
  fs.rmSync(backupDir, { recursive: true, force: true });
  console.log('>>> Build complete. Distributed binaries are fully protected and closed-source.');
}
