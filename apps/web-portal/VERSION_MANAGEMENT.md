# Version Management Guide

**Project:** SmartCura Web Portal  
**Current Version:** 1.0.0  
**Versioning:** Semantic Versioning (SemVer)

---

## 📋 Quick Reference

### Version Format: MAJOR.MINOR.PATCH

- **MAJOR** (1.0.0 → 2.0.0): Breaking changes, major features
- **MINOR** (1.0.0 → 1.1.0): New features, backward compatible
- **PATCH** (1.0.0 → 1.0.1): Bug fixes, small improvements

### Development Versions

- **dev**: Development branch (1.0.1-dev.1, 1.0.1-dev.2)
- **alpha**: Alpha testing (1.1.0-alpha.1)
- **beta**: Beta testing (1.1.0-beta.1)
- **rc**: Release candidate (1.1.0-rc.1)

---

## 🚀 How to Use

### 1. Development (Daily Work)

When you're developing new features:

```bash
# Make your changes
git add .
git commit -m "feat: add new feature"

# Bump dev version (1.0.0 → 1.0.1-dev.1)
npm run version:dev

# Push to dev branch
npm run push:dev
```

**What happens:**
- ✅ VERSION file updated
- ✅ package.json updated
- ✅ Git commit created
- ❌ NO tag created (dev versions don't get tags)

---

### 2. Bug Fixes (Patch Release)

When you fix bugs:

```bash
# Fix the bug
git add .
git commit -m "fix: resolve login issue"

# Bump patch version (1.0.0 → 1.0.1)
npm run version:patch

# Push with tags
npm run push
```

**What happens:**
- ✅ VERSION file updated (1.0.1)
- ✅ package.json updated
- ✅ CHANGELOG.md updated
- ✅ Git commit created
- ✅ Git tag created (v1.0.1)

---

### 3. New Features (Minor Release)

When you add new features:

```bash
# Add the feature
git add .
git commit -m "feat: add pharmacy module"

# Bump minor version (1.0.0 → 1.1.0)
npm run version:minor

# Push with tags
npm run push
```

**What happens:**
- ✅ VERSION file updated (1.1.0)
- ✅ package.json updated
- ✅ CHANGELOG.md updated
- ✅ Git commit created
- ✅ Git tag created (v1.1.0)

---

### 4. Breaking Changes (Major Release)

When you make breaking changes:

```bash
# Make breaking changes
git add .
git commit -m "feat!: redesign authentication system"

# Bump major version (1.0.0 → 2.0.0)
npm run version:major

# Push with tags
npm run push
```

**What happens:**
- ✅ VERSION file updated (2.0.0)
- ✅ package.json updated
- ✅ CHANGELOG.md updated
- ✅ Git commit created
- ✅ Git tag created (v2.0.0)

---

## 📦 Available Commands

| Command | Description | Example |
|---------|-------------|---------|
| `npm run version:dev` | Bump dev version | 1.0.0 → 1.0.1-dev.1 |
| `npm run version:patch` | Bump patch version | 1.0.0 → 1.0.1 |
| `npm run version:minor` | Bump minor version | 1.0.0 → 1.1.0 |
| `npm run version:major` | Bump major version | 1.0.0 → 2.0.0 |
| `npm run push` | Push to main with tags | - |
| `npm run push:dev` | Push to dev branch | - |

---

## 🔄 Typical Workflow

### Daily Development

```bash
# 1. Work on feature
git checkout dev
# ... make changes ...

# 2. Commit changes
git add .
git commit -m "feat: add user profile"

# 3. Bump dev version
npm run version:dev

# 4. Push to dev branch
npm run push:dev
```

### Release to Production

```bash
# 1. Merge dev to main
git checkout main
git merge dev

# 2. Bump version (patch/minor/major)
npm run version:minor

# 3. Push with tags
npm run push

# 4. Create GitHub release (optional)
# Go to GitHub → Releases → Create new release
```

---

## 📝 Commit Message Convention

Follow [Conventional Commits](https://www.conventionalcommits.org/):

### Format
```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting)
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `test`: Adding tests
- `chore`: Maintenance tasks

### Examples
```bash
git commit -m "feat(auth): add 2FA support"
git commit -m "fix(sidebar): resolve navigation bug"
git commit -m "docs: update README"
git commit -m "chore: bump version to 1.1.0"
```

---

## 🏷️ Git Tags

### Viewing Tags
```bash
# List all tags
git tag

# List tags with messages
git tag -n

# Show specific tag
git show v1.0.0
```

### Creating Tags Manually
```bash
# Create annotated tag
git tag -a v1.0.0 -m "Release v1.0.0"

# Push specific tag
git push origin v1.0.0

# Push all tags
git push origin --tags
```

### Deleting Tags
```bash
# Delete local tag
git tag -d v1.0.0

# Delete remote tag
git push origin :refs/tags/v1.0.0
```

---

## 📊 Version History

### Current Version: 1.0.0

| Version | Date | Type | Description |
|---------|------|------|-------------|
| 1.0.0 | 2026-01-24 | Major | Initial MVP release (30 screens) |

### Planned Versions

| Version | Type | Description |
|---------|------|-------------|
| 1.1.0 | Minor | Phase 1.5 features (error pages, search) |
| 1.2.0 | Minor | Phase 1.6 features (advanced operations) |
| 2.0.0 | Major | Phase 2 (IoT integration) |
| 3.0.0 | Major | Phase 3 (AI integration) |
| 4.0.0 | Major | Phase 4 (complete platform) |

---

## 🔍 Checking Current Version

### In Code
```typescript
// Read from VERSION file
import fs from 'fs';
const version = fs.readFileSync('VERSION', 'utf8').trim();
console.log(`Version: ${version}`);
```

### In Terminal
```bash
# Read VERSION file
cat VERSION

# Check package.json
npm version

# Check git tags
git describe --tags
```

---

## 🌿 Branch Strategy

### Main Branches
- `main`: Production-ready code (stable releases)
- `dev`: Development branch (active development)

### Feature Branches
- `feature/user-management`
- `feature/pharmacy-module`
- `fix/login-bug`

### Workflow
```bash
# 1. Create feature branch from dev
git checkout dev
git checkout -b feature/new-feature

# 2. Work on feature
# ... make changes ...

# 3. Commit changes
git add .
git commit -m "feat: add new feature"

# 4. Merge to dev
git checkout dev
git merge feature/new-feature

# 5. Bump dev version
npm run version:dev

# 6. Push to dev
npm run push:dev

# 7. When ready for release, merge dev to main
git checkout main
git merge dev
npm run version:minor
npm run push
```

---

## 📦 GitHub Releases

### Creating a Release

1. **Push with tags:**
   ```bash
   npm run version:minor
   npm run push
   ```

2. **Go to GitHub:**
   - Navigate to your repository
   - Click "Releases"
   - Click "Create a new release"

3. **Fill in details:**
   - Tag: Select the tag (e.g., v1.1.0)
   - Title: "SmartCura v1.1.0"
   - Description: Copy from CHANGELOG.md
   - Attach binaries (if any)

4. **Publish release**

---

## 🛠️ Troubleshooting

### Version script not working?

```bash
# Make script executable
chmod +x scripts/version.js

# Or run with node directly
node scripts/version.js patch
```

### Git tag already exists?

```bash
# Delete local tag
git tag -d v1.0.0

# Delete remote tag
git push origin :refs/tags/v1.0.0

# Create new tag
npm run version:patch
```

### Wrong version bumped?

```bash
# Undo last commit (keeps changes)
git reset --soft HEAD~1

# Delete tag
git tag -d v1.0.1

# Fix VERSION file manually
echo "1.0.0" > VERSION

# Try again
npm run version:patch
```

---

## 📚 Best Practices

### 1. Always Use Scripts
❌ Don't manually edit VERSION file  
✅ Use `npm run version:*` commands

### 2. Commit Before Versioning
❌ Don't version with uncommitted changes  
✅ Commit your work first, then version

### 3. Use Conventional Commits
❌ `git commit -m "fixed stuff"`  
✅ `git commit -m "fix(auth): resolve login timeout"`

### 4. Update CHANGELOG
❌ Don't forget to document changes  
✅ CHANGELOG.md is auto-updated for releases

### 5. Test Before Release
❌ Don't release untested code  
✅ Run `npm run build` and test before versioning

---

## 🎯 Quick Commands Cheat Sheet

```bash
# Daily development
npm run version:dev && npm run push:dev

# Bug fix release
npm run version:patch && npm run push

# Feature release
npm run version:minor && npm run push

# Major release
npm run version:major && npm run push

# Check current version
cat VERSION

# View all tags
git tag -n

# View commit history
git log --oneline --decorate
```

---

## 📞 Need Help?

- **Semantic Versioning:** https://semver.org/
- **Conventional Commits:** https://www.conventionalcommits.org/
- **Git Tags:** https://git-scm.com/book/en/v2/Git-Basics-Tagging

---

**Last Updated:** January 24, 2026  
**Current Version:** 1.0.0  
**Status:** Active Development
