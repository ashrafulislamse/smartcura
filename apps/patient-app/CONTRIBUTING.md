# Contributing to SmartCura Patient App

Thank you for your interest in contributing to SmartCura! This document provides guidelines and instructions for contributing.

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Commit Guidelines](#commit-guidelines)
- [Pull Request Process](#pull-request-process)
- [Testing](#testing)

## 📜 Code of Conduct

- Be respectful and inclusive
- Welcome newcomers and help them learn
- Focus on constructive feedback
- Respect differing viewpoints and experiences

## 🚀 Getting Started

### Prerequisites

- Flutter SDK 3.24+
- Dart SDK 3.0+
- Git
- Android Studio / Xcode
- VS Code (recommended)

### Setup

1. Fork the repository
2. Clone your fork:
```bash
git clone https://github.com/YOUR_USERNAME/smartcura.git
cd smartcura/apps/patient-app
```

3. Add upstream remote:
```bash
git remote add upstream https://github.com/ashrafulislamse/smartcura.git
```

4. Install dependencies:
```bash
flutter pub get
```

5. Create `.env` file from `.env.example`

## 🔄 Development Workflow

### Branch Naming

- `feature/feature-name` - New features
- `bugfix/bug-description` - Bug fixes
- `hotfix/critical-fix` - Urgent fixes
- `refactor/what-changed` - Code refactoring
- `docs/what-changed` - Documentation updates

### Workflow Steps

1. **Create a branch**
```bash
git checkout -b feature/your-feature-name
```

2. **Make your changes**
   - Write clean, readable code
   - Follow coding standards
   - Add tests if applicable

3. **Commit your changes**
```bash
git add .
git commit -m "feat: add user authentication"
```

4. **Keep your branch updated**
```bash
git fetch upstream
git rebase upstream/main
```

5. **Push to your fork**
```bash
git push origin feature/your-feature-name
```

6. **Create Pull Request**
   - Go to GitHub
   - Click "New Pull Request"
   - Fill in the PR template

## 💻 Coding Standards

### Dart Style Guide

Follow the [Effective Dart](https://dart.dev/guides/language/effective-dart) guidelines:

```dart
// Good
class UserProfile {
  final String name;
  final int age;
  
  UserProfile({required this.name, required this.age});
}

// Bad
class user_profile {
  String Name;
  int AGE;
}
```

### File Organization

```
lib/
├── core/
│   ├── constants/     # App-wide constants
│   ├── theme/         # Theme configuration
│   ├── utils/         # Utility functions
│   └── widgets/       # Reusable widgets
├── features/
│   └── feature_name/
│       ├── data/      # Data layer (models, repositories)
│       ├── domain/    # Business logic
│       └── presentation/  # UI layer (screens, widgets)
└── main.dart
```

### Naming Conventions

- **Files**: `snake_case.dart`
- **Classes**: `PascalCase`
- **Variables**: `camelCase`
- **Constants**: `SCREAMING_SNAKE_CASE`
- **Private**: `_leadingUnderscore`

```dart
// File: user_profile_screen.dart
class UserProfileScreen extends StatelessWidget {
  static const String routeName = '/user-profile';
  final String userId;
  
  const UserProfileScreen({Key? key, required this.userId}) : super(key: key);
}
```

### Widget Structure

```dart
class MyWidget extends StatelessWidget {
  const MyWidget({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Container(
      // Widget tree
    );
  }
}
```

### State Management (Riverpod)

```dart
// Provider
final userProvider = StateNotifierProvider<UserNotifier, User>((ref) {
  return UserNotifier();
});

// Consumer
class MyScreen extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(userProvider);
    return Text(user.name);
  }
}
```

## 📝 Commit Guidelines

### Commit Message Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

### Examples

```bash
feat(auth): add biometric authentication

Implemented fingerprint and face ID authentication
for iOS and Android platforms.

Closes #123
```

```bash
fix(appointments): resolve booking date validation

Fixed issue where past dates could be selected
for appointment booking.

Fixes #456
```

## 🔀 Pull Request Process

### Before Submitting

- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] Comments added for complex code
- [ ] Documentation updated
- [ ] Tests added/updated
- [ ] All tests passing
- [ ] No merge conflicts

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
- [ ] Tests added
- [ ] Documentation updated
```

### Review Process

1. Automated checks must pass
2. At least one approval required
3. No unresolved conversations
4. Up to date with main branch

## 🧪 Testing

### Unit Tests

```dart
// test/features/auth/auth_test.dart
void main() {
  group('Authentication', () {
    test('should login successfully with valid credentials', () async {
      // Arrange
      final authService = AuthService();
      
      // Act
      final result = await authService.login('test@example.com', 'password');
      
      // Assert
      expect(result.isSuccess, true);
    });
  });
}
```

### Widget Tests

```dart
void main() {
  testWidgets('Login button should be disabled when fields are empty', 
    (WidgetTester tester) async {
    await tester.pumpWidget(MyApp());
    
    final button = find.byType(ElevatedButton);
    expect(tester.widget<ElevatedButton>(button).enabled, false);
  });
}
```

### Running Tests

```bash
# All tests
flutter test

# Specific test
flutter test test/features/auth/auth_test.dart

# With coverage
flutter test --coverage
```

## 📚 Additional Resources

- [Flutter Documentation](https://docs.flutter.dev/)
- [Dart Language Tour](https://dart.dev/guides/language/language-tour)
- [Effective Dart](https://dart.dev/guides/language/effective-dart)
- [Flutter Best Practices](https://flutter.dev/docs/development/best-practices)

## ❓ Questions?

- Open an issue for bugs
- Start a discussion for questions
- Join our community chat

## 🙏 Thank You!

Your contributions make SmartCura better for everyone!

---

© 2026 SmartCura. All Rights Reserved.
