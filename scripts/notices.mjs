import fs from 'node:fs';
import path from 'node:path';

// Capture actual installed license texts for all non-dev packages recorded in the lockfile.
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
const sections = ['Robot League dependency license notices\n\nRobot model terms are separate: see /models/<id>/NOTICE.md and the repository LICENSES.md.'];
for (const [location, info] of Object.entries(lock.packages)) {
  if (!location || info.dev || !fs.existsSync(location)) continue;
  const metadataPath = path.join(location, 'package.json');
  if (!fs.existsSync(metadataPath)) continue;
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  const files = fs.readdirSync(location).filter(name => /^(licen[cs]e|copying|notice)([.-].*)?$/i.test(name) && fs.statSync(path.join(location, name)).isFile());
  const texts = files.map(name => `${name}\n${fs.readFileSync(path.join(location, name), 'utf8')}`);
  sections.push(`${metadata.name}@${metadata.version}\nDeclared license: ${metadata.license ?? info.license ?? 'See upstream'}\n${texts.join('\n\n') || 'No top-level license text in installed package; consult upstream package metadata.'}`);
}
fs.mkdirSync('public/licenses', { recursive: true });
fs.writeFileSync('public/licenses/THIRD_PARTY.txt', sections.join('\n\n' + '='.repeat(72) + '\n\n') + '\n');
console.log(`Wrote notices for ${sections.length - 1} installed dependency packages.`);
