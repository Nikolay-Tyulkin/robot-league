import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Package only Git-visible files; ignored credentials, attachments and caches stay out.
const listing = spawnSync('git', ['-c', `safe.directory=${process.cwd().replaceAll('\\','/')}`, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], {encoding:'utf8'});
if (listing.status) throw new Error('Cannot enumerate repository files');
const files = [...new Set(listing.stdout.split('\0').filter(Boolean))].sort();
const forbidden = /(^|\/)(?:\.git|\.codex(?:-remote-attachments)?|\.agents|node_modules|work|dist|\.server-build|\.wrangler|\.docker-local)(?:\/|$)|(^|\/)\.env(?:\.|$)|\.(?:pem|key|b64)$/;
for (const file of files) {
  if (file !== '.env.example' && forbidden.test(file)) throw new Error(`Refusing private/generated path: ${file}`);
  if (path.isAbsolute(file) || file.split('/').includes('..')) throw new Error('Unsafe archive path');
}
fs.mkdirSync('work',{recursive:true});
fs.writeFileSync('work/release-files.txt',files.join('\n')+'\n');
const result = spawnSync('tar',['-czf','work/robot-league-source.tar.gz','-T','work/release-files.txt'],{stdio:'inherit'});
if(result.status)process.exit(result.status);
console.log(`Packaged ${files.length} reviewed Git-visible files; credentials and attachments excluded.`);
