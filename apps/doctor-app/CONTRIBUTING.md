# Contributing to SmartCura Doctor App

Thank you for your interest in contributing to SmartCura Doctor App! We welcome contributions from the community.

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [How to Contribute](#how-to-contribute)
- [Coding Standards](#coding-standards)
- [Commit Guidelines](#commit-guidelines)
- [Pull Request Process](#pull-request-process)
- [Testing](#testing)
- [Documentation](#documentation)

---

## 📜 Code of Conduct

This project adheres to a Code of Conduct. By participating, you are expected to uphold this code. Please report unacceptable behavior to support@smartcura.app.

### Our Standards

- Be respectful and inclusive
- Welcome newcomers and help them learn
- Focus on what is best for the community
- Show empathy towards other community members

---

## 🚀 Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally
   ```bash
   git clone https://github.com/YOUR_USERNAME/smartcura.git
   cd smartcura/apps/doctor-app
   ```
3. **Add upstream remote**
   ```bash
   git remote add upstream https://github.com/ashrafulislamse/smartcura.git
   ```
4. **Install dependencies**
   ```bash
   flutter pub get
   ```

---

## 💻 Development Setup

### Prerequisites

- Flutter SDK 3.24+
- Dart SDK 3.0+
- Android Studio / VS Code
- Git

### IDE Setup

#### VS Code
Install these extensions:
- Flutter
- Dart
- Error Lens
- GitLens

#### Android Studio
- Flutter plugin
- Dart plugin

### Running the App

```bash
# Check Flutter setup
flutter doctor

# Run on connected device
flutter run

# Run with hot reload
flutter run --hot
```

---

## 🤝 How to Contribute

### Reporting Bugs

1. Check if the bug has already been reported in [Issues](https://github.com/ashrafulislamse/smartcura/issues)
2. If not, create a new issue with:
   - Clear title and description
   - Steps to reproduce
   - Expected vs actual behavior
   - Screenshots (if applicable)
   - Device/OS information
   - Flutter/Dart version

### Suggesting Features

1. Check [Issues](https://github.com/ashrafulislamse/smartcura/issues) for existing suggestions
2. Create a new issue with:
   - Clear feature description
   - Use case and benefits
   - Possible implementation approach
   - Mockups/wireframes (if applicable)

### Code Contributions

1. **Find an issue** to work on or create one
2. **Comment** on the issue to let others know you're working on it
3. **Create a branch** from `main`
   ```bash
   git checkout -b feature/your-feature-name
   ```
4. **Make your changes** following our coding standards
5. **Test your changes** thoroughly
6. **Commit** with clear messages
7. **Push** to your fork
8. **Create a Pull Request**

---

## 📝 Coding Standards

### Dart Style Guide

Follow [Effective Dart](https://dart.dev/guides/language/effective-dart) guidelines:

- Use `lowerCamelCase` for variables, methods, and parameters
- Use `UpperCamelCase` for classes and types
- Use `lowercase_with_underscores` for file names
- Prefer `const` over `final` when possible
- Use trailing commas for better formatting

### Code Organization

```dart
// 1. Imports (sorted)
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

// 2. Class definition
class MyScreen extends StatelessWidget {
  // 3. Constructor
  const MyScreen({super.key});

  // 4. Build method
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      // ...
    );
  }

  // 5. Private methods
  Widget _buildWidget() {
    // ...
  }
}
```

### Widget Guidelines

- Keep widgets small and focused
- Extract reusable widgets
- Use `const` constructors when possible
- Prefer composition over inheritance
- Use meaningful widget names

### State Management

- Use Riverpod for state management
- Keep business logic separate from UI
- Use providers for shared state
- Avoid unnecessary rebuilds

---

## 📝 Commit Guidelines

### Commit Message Format

```
type: subject

body (optional)

footer (optional)
```

### Types

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

### Examples

```bash
feat: add patient search functionality

- Add search bar to patients list
- Implement filtering by name and ID
- Add debouncing for better performance

Closes #123
```

```bash
feat: integrate self-hosted LiveKit video calls

- Add the LiveKit client SDK
- Connect to the self-hosted LiveKit deployment
- Add retry logic for failed connections

Fixes #456
```

---

## 🔄 Pull Request Process

### Before Submitting

1. **Update your branch** with latest main
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Run tests**
   ```bash
   flutter test
   ```

3. **Run analyzer**
   ```bash
   flutter analyze
   ```

4. **Format code**
   ```bash
   flutter format .
   ```

### PR Checklist

- [ ] Code follows project style guidelines
- [ ] Self-review completed
- [ ] Comments added for complex code
- [ ] Documentation updated (if needed)
- [ ] No new warnings or errors
- [ ] Tests added/updated
- [ ] All tests passing
- [ ] Screenshots added (for UI changes)

### PR Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
How has this been tested?

## Screenshots (if applicable)
Add screenshots here

## Checklist
- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] Tests added/updated
- [ ] Documentation updated
```

---

## 🧪 Testing

### Running Tests

```bash
# Run all tests
flutter test

# Run specific test file
flutter test test/features/auth/login_test.dart

# Run with coverage
flutter test --coverage
```

### Writing Tests

```dart
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('LoginScreen', () {
    test('should validate email format', () {
      // Arrange
      final email = 'invalid-email';
      
      // Act
      final isValid = validateEmail(email);
      
      // Assert
      expect(isValid, false);
    });
  });
}
```

### Test Coverage

- Aim for 80%+ code coverage
- Write unit tests for business logic
- Write widget tests for UI components
- Write integration tests for critical flows

---

## 📚 Documentation

### Code Documentation

```dart
/// Validates email format using regex pattern.
///
/// Returns `true` if email is valid, `false` otherwise.
///
/// Example:
/// ```dart
/// final isValid = validateEmail('user@example.com');
/// print(isValid); // true
/// ```
bool validateEmail(String email) {
  // Implementation
}
```

### README Updates

- Update README.md for new features
- Add screenshots for UI changes
- Update setup instructions if needed
- Keep dependencies list current

---

## 🎯 Areas for Contribution

### High Priority

- [ ] Backend API integration
- [ ] Firebase authentication
- [ ] Self-hosted LiveKit video calls
- [ ] Unit test coverage
- [ ] Integration tests

### Medium Priority

- [ ] Offline mode support
- [ ] Performance optimization
- [ ] Accessibility improvements
- [ ] Internationalization (i18n)
- [ ] Dark mode support

### Low Priority

- [ ] Additional animations
- [ ] Custom widgets library
- [ ] Developer tools
- [ ] Code generation scripts

---

## 💬 Communication

- **GitHub Issues:** Bug reports and feature requests
- **Pull Requests:** Code contributions
- **Email:** support@smartcura.app
- **Discussions:** GitHub Discussions (coming soon)

---

## 🏆 Recognition

Contributors will be recognized in:
- README.md contributors section
- Release notes
- Project documentation

---

## 📄 License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

## ❓ Questions?

If you have questions, feel free to:
- Open an issue
- Email support@smartcura.app
- Check existing documentation

---

**Thank you for contributing to SmartCura Doctor App! 🎉**
