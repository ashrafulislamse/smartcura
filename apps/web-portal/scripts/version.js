#!/usr/bin/env node

/**
 * Version Management Script
 * 
 * Usage:
 *   npm run version:patch    # 1.0.0 -> 1.0.1
 *   npm run version:minor    # 1.0.0 -> 1.1.0
 *   npm run version:major    # 1.0.0 -> 2.0.0
 *   npm run version:dev      # 1.0.0 -> 1.0.1-dev.1
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const VERSION_FILE = path.join(__dirname, '..', 'VERSION');
const PACKAGE_FILE = path.join(__dirname, '..', 'package.json');
const CHANGELOG_FILE = path.join(__dirname, '..', 'CHANGELOG.md');

// Read current version
function getCurrentVersion() {
  return fs.readFileSync(VERSION_FILE, 'utf8').trim();
}

// Parse version
function parseVersion(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
  if (!match) throw new Error(`Invalid version format: ${version}`);
  
  return {
    major: parseInt(match[1]),
    minor: parseInt(match[2]),
    patch: parseInt(match[3]),
    prerelease: match[4] || null
  };
}

// Increment version
function incrementVersion(current, type) {
  const v = parseVersion(current);
  
  switch (type) {
    case 'major':
      return `${v.major + 1}.0.0`;
    case 'minor':
      return `${v.major}.${v.minor + 1}.0`;
    case 'patch':
      return `${v.major}.${v.minor}.${v.patch + 1}`;
    case 'dev':
      const newPatch = v.major + '.' + v.minor + '.' + (v.patch + 1);
      if (v.prerelease && v.prerelease.startsWith('dev.')) {
        const devNum = parseInt(v.prerelease.split('.')[1]) + 1;
        return `${v.major}.${v.minor}.${v.patch}-dev.${devNum}`;
      }
      return `${newPatch}-dev.1`;
    default:
      throw new Error(`Unknown version type: ${type}`);
  }
}

// Update VERSION file
function updateVersionFile(version) {
  fs.writeFileSync(VERSION_FILE, version + '\n');
  console.log(`✅ Updated VERSION file: ${version}`);
}

// Update package.json
function updatePackageJson(version) {
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_FILE, 'utf8'));
  pkg.version = version;
  fs.writeFileSync(PACKAGE_FILE, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`✅ Updated package.json: ${version}`);
}

// Update CHANGELOG.md
function updateChangelog(version) {
  const changelog = fs.readFileSync(CHANGELOG_FILE, 'utf8');
  const date = new Date().toISOString().split('T')[0];
  
  const updated = changelog.replace(
    '## [Unreleased]',
    `## [Unreleased]\n\n### Added\n- Development in progress\n\n---\n\n## [${version}] - ${date}`
  );
  
  fs.writeFileSync(CHANGELOG_FILE, updated);
  console.log(`✅ Updated CHANGELOG.md: ${version}`);
}

// Git operations
function gitCommitAndTag(version, isDev) {
  try {
    // Stage files
    execSync('git add VERSION package.json CHANGELOG.md', { stdio: 'inherit' });
    
    // Commit
    const message = isDev 
      ? `chore: bump version to ${version} [dev]`
      : `chore: release version ${version}`;
    execSync(`git commit -m "${message}"`, { stdio: 'inherit' });
    console.log(`✅ Git commit created: ${message}`);
    
    // Create tag (only for non-dev versions)
    if (!isDev) {
      execSync(`git tag -a v${version} -m "Release v${version}"`, { stdio: 'inherit' });
      console.log(`✅ Git tag created: v${version}`);
    }
    
    return true;
  } catch (error) {
    console.error('❌ Git operation failed:', error.message);
    return false;
  }
}

// Main function
function main() {
  const type = process.argv[2];
  
  if (!type || !['major', 'minor', 'patch', 'dev'].includes(type)) {
    console.error('Usage: node version.js [major|minor|patch|dev]');
    process.exit(1);
  }
  
  try {
    const currentVersion = getCurrentVersion();
    const newVersion = incrementVersion(currentVersion, type);
    const isDev = type === 'dev';
    
    console.log(`\n🚀 Version Bump: ${currentVersion} → ${newVersion}\n`);
    
    // Update files
    updateVersionFile(newVersion);
    updatePackageJson(newVersion);
    
    if (!isDev) {
      updateChangelog(newVersion);
    }
    
    // Git commit and tag
    const gitSuccess = gitCommitAndTag(newVersion, isDev);
    
    if (gitSuccess) {
      console.log(`\n✅ Version bump complete: ${newVersion}`);
      
      if (!isDev) {
        console.log(`\n📦 To push to GitHub with tags:`);
        console.log(`   git push origin main --tags`);
      } else {
        console.log(`\n📦 To push to GitHub:`);
        console.log(`   git push origin dev`);
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
