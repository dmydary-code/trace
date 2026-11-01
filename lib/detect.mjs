import {readFile, lstat} from 'node:fs/promises';
import {join, dirname, relative, sep} from 'node:path';
import {classify, getLayers, profiles} from '../dist/core.mjs';

// Detection is evidence-based, per package. Unknown code stays visible without an invented stack.
export async function detectRoutes(repo, files) {
  const cache = new Map();
  async function manifest(dir) {
    if (cache.has(dir)) return cache.get(dir);
    const result = [];
    for (const name of ['package.json', 'pyproject.toml', 'requirements.txt', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'pubspec.yaml', 'Package.swift']) {
      try {
        const path = join(dir, name), stat = await lstat(path);
        if (!stat.isFile() || stat.size > 512000) continue;
        const text = await readFile(path, 'utf8');
        const evidence = relative(repo, path).split(sep).join('/');
        let dependencies = {};
        if (name === 'package.json') { const p = JSON.parse(text); dependencies = {...p.dependencies, ...p.devDependencies, ...p.peerDependencies}; }
        const add = (profile, stack) => result.push({profile, stack, root: relative(repo, dir).split(sep).join('/') || '.', evidence});
        if (dependencies['@angular/core']) add('frontend', 'angular');
        if (dependencies.vue) add('frontend', 'vue');
        if (dependencies.react || dependencies.next) add('frontend', 'react');
        if (dependencies['@nestjs/core']) add('backend', 'nestjs');
        if ((name === 'requirements.txt' || name === 'pyproject.toml') && /\bfastapi\b/i.test(text)) add('backend', 'fastapi');
        if (/pom.xml|build.gradle/.test(name) && /org\.springframework|spring-boot/.test(text)) add('backend', 'spring');
        if (/build.gradle/.test(name) && /com\.android\.(application|library)/.test(text)) add('mobile', 'android');
        if (name === 'pubspec.yaml' && /\bflutter\s*:/.test(text)) add('mobile', 'flutter');
        if (name === 'Package.swift' && /\.iOS\b|SwiftUI/.test(text)) add('mobile', 'ios');
      } catch {} // Missing/invalid manifests supply no detection evidence.
    }
    cache.set(dir, result); return result;
  }
  return Promise.all(files.map(async file => {
    const text = file.lines.map(l => l.text).join('\n'), p = file.path.toLowerCase();
    let candidates = [], dir = dirname(join(repo, file.path));
    while (true) {
      const found = await manifest(dir);
      if (found.length) { candidates = found; break; }
      if (dir === repo) break;
      const parent = dirname(dir); if (parent === dir || !parent.startsWith(repo)) break; dir = parent;
    }
    let explicit;
    const source = /\.(?:[cm]?[jt]sx?|vue|java|kt|kts|swift|dart|py)$/.test(p);
    if (/\.vue$/.test(p)) explicit = ['frontend', 'vue'];
    else if (/\.component\.(ts|html|s?css)$/.test(p) || source && /^\s*(?:import[^\n]*['"]@angular\/|@Component\s*\()/m.test(text)) explicit = ['frontend', 'angular'];
    else if (source && /^\s*(?:import|export)[^\n]*from ['"]react['"]/m.test(text)) explicit = ['frontend', 'react'];
    else if (/\.(tsx|jsx)$/.test(p) && !candidates.some(c => c.stack === 'vue')) explicit = ['frontend', 'react'];
    else if (source && /^\s*import[^\n]*['"]@nestjs\//m.test(text)) explicit = ['backend', 'nestjs'];
    else if (/\.py$/.test(p) && /^\s*(?:from fastapi\b|import fastapi\b)/m.test(text)) explicit = ['backend', 'fastapi'];
    else if (/\.(java|kt)$/.test(p) && /^\s*import org\.springframework/m.test(text)) explicit = ['backend', 'spring'];
    else if (/\.swift$/.test(p) && /^\s*import (SwiftUI|UIKit)\b/m.test(text)) explicit = ['mobile', 'ios'];
    else if (/\.dart$/.test(p) && /^\s*import ['"]package:flutter\//m.test(text)) explicit = ['mobile', 'flutter'];
    else if (/\.(java|kt)$/.test(p) && /^\s*import androidx?\./m.test(text)) explicit = ['mobile', 'android'];
    const chosen = explicit ? candidates.find(c => c.stack === explicit[1]) || {profile: explicit[0], stack: explicit[1], root: candidates[0]?.root || '.', evidence: file.path} : candidates.length === 1 ? candidates[0] : null;
    if (!chosen) return {root: '.', group: 'Other changes', layer: 'Other changes', rank: 999, evidence: 'No unambiguous framework evidence'};
    // Architecture lenses require multiple matching roles within the package, not a language guess.
    const related = files.filter(f => chosen.root === '.' || f.path.startsWith(chosen.root + '/')).map(f => f.path.toLowerCase()).join('\n');
    let pattern = chosen.profile === 'frontend' ? 'feature' : chosen.profile === 'mobile' ? 'mvvm' : 'layered';
    if (chosen.profile === 'backend' && /(^|\/)domain\//m.test(related) && /(usecase|use_case|\/ports?\/)/.test(related) && /(adapter|infrastructure)/.test(related)) pattern = 'clean';
    else if (chosen.profile === 'backend' && /(event|schema)/.test(related) && /(producer|publisher)/.test(related) && /(consumer|subscriber)/.test(related)) pattern = 'events';
    else if (chosen.profile === 'mobile' && /(reducer|action|intent)/.test(related)) pattern = 'udf';
    const layer = classify(file.path, chosen.profile, chosen.stack, pattern, text), layers = [...getLayers(chosen.profile, pattern, chosen.stack), 'Other changes'];
    return {...chosen, pattern, layer, rank: layers.indexOf(layer), group: (chosen.root === '.' ? '' : chosen.root + ' · ') + profiles[chosen.profile].stacks[chosen.stack]};
  }));
}
