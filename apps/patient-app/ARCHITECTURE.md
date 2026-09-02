# 🏗️ SmartCura Patient App - Architecture

**Production-Grade Clean Architecture**

---

## 📐 Architecture Pattern

### Clean Architecture + Feature-First Structure

```
lib/
├── core/                          # Core functionality (shared across features)
│   ├── constants/                 # App-wide constants
│   │   ├── app_constants.dart     # App configuration
│   │   ├── app_strings.dart       # ✅ All UI strings (localization ready)
│   │   ├── api_constants.dart     # API endpoints
│   │   └── route_constants.dart   # Navigation routes
│   ├── theme/                     # Design system
│   │   ├── app_colors.dart        # Color palette
│   │   ├── app_theme.dart         # Theme configuration
│   │   └── design_tokens.dart     # ✅ Spacing, sizing, animations
│   ├── utils/                     # Utility functions
│   │   ├── validators.dart        # Form validation
│   │   ├── formatters.dart        # Data formatting
│   │   ├── date_utils.dart        # Date/time helpers
│   │   └── helpers.dart           # General helpers
│   ├── widgets/                   # Reusable widgets
│   │   ├── buttons/
│   │   │   ├── primary_button.dart
│   │   │   ├── secondary_button.dart
│   │   │   └── text_button.dart
│   │   ├── inputs/
│   │   │   ├── text_field.dart
│   │   │   ├── password_field.dart
│   │   │   └── search_field.dart
│   │   ├── cards/
│   │   │   ├── base_card.dart
│   │   │   ├── doctor_card.dart
│   │   │   └── appointment_card.dart
│   │   ├── loading_indicator.dart
│   │   ├── error_view.dart
│   │   ├── empty_state.dart
│   │   └── bottom_nav_bar.dart    # ✅ Custom bottom navigation
│   └── extensions/                # Dart extensions
│       ├── context_extensions.dart
│       ├── string_extensions.dart
│       └── date_extensions.dart
│
├── features/                      # Feature modules (Clean Architecture)
│   ├── auth/                      # Authentication feature
│   │   ├── data/                  # Data layer
│   │   │   ├── models/            # Data models
│   │   │   │   ├── user_model.dart
│   │   │   │   └── auth_response_model.dart
│   │   │   ├── repositories/      # Repository implementations
│   │   │   │   └── auth_repository_impl.dart
│   │   │   └── datasources/       # Data sources (API, local)
│   │   │       ├── auth_remote_datasource.dart
│   │   │       └── auth_local_datasource.dart
│   │   ├── domain/                # Business logic layer
│   │   │   ├── entities/          # Business entities
│   │   │   │   └── user.dart
│   │   │   ├── repositories/      # Repository interfaces
│   │   │   │   └── auth_repository.dart
│   │   │   └── usecases/          # Use cases
│   │   │       ├── login_usecase.dart
│   │   │       ├── signup_usecase.dart
│   │   │       └── logout_usecase.dart
│   │   └── presentation/          # UI layer
│   │       ├── providers/         # Riverpod providers
│   │       │   └── auth_provider.dart
│   │       ├── screens/           # Screens
│   │       │   ├── splash_screen.dart
│   │       │   ├── login_screen.dart
│   │       │   ├── signup_screen.dart
│   │       │   └── forgot_password_screen.dart
│   │       └── widgets/           # Feature-specific widgets
│   │           ├── login_form.dart
│   │           └── social_login_buttons.dart
│   │
│   ├── home/                      # Home feature
│   │   ├── data/
│   │   ├── domain/
│   │   └── presentation/
│   │       ├── providers/
│   │       ├── screens/
│   │       │   ├── home_screen.dart
│   │       │   └── notifications_screen.dart
│   │       └── widgets/
│   │           ├── quick_actions.dart
│   │           ├── health_summary_card.dart
│   │           └── upcoming_appointments_widget.dart
│   │
│   ├── appointments/              # Appointments feature
│   │   ├── data/
│   │   ├── domain/
│   │   └── presentation/
│   │       ├── providers/
│   │       ├── screens/
│   │       │   ├── appointments_screen.dart
│   │       │   ├── find_doctor_screen.dart
│   │       │   ├── doctor_profile_screen.dart
│   │       │   ├── book_appointment_screen.dart
│   │       │   └── appointment_details_screen.dart
│   │       └── widgets/
│   │
│   ├── consultations/             # Video call & chat feature
│   │   ├── data/
│   │   ├── domain/
│   │   └── presentation/
│   │       ├── providers/
│   │       ├── screens/
│   │       │   ├── video_call_screen.dart
│   │       │   └── chat_screen.dart
│   │       └── widgets/
│   │
│   ├── health/                    # Health records feature
│   │   ├── data/
│   │   ├── domain/
│   │   └── presentation/
│   │       ├── providers/
│   │       ├── screens/
│   │       │   ├── health_dashboard_screen.dart
│   │       │   ├── prescriptions_screen.dart
│   │       │   ├── prescription_details_screen.dart
│   │       │   ├── health_records_screen.dart
│   │       │   └── vitals_screen.dart
│   │       └── widgets/
│   │
│   ├── emergency/                 # Emergency SOS feature
│   │   ├── data/
│   │   ├── domain/
│   │   └── presentation/
│   │       ├── providers/
│   │       ├── screens/
│   │       │   ├── emergency_screen.dart
│   │       │   └── emergency_contacts_screen.dart
│   │       └── widgets/
│   │
│   └── profile/                   # Profile & settings feature
│       ├── data/
│       ├── domain/
│       └── presentation/
│           ├── providers/
│           ├── screens/
│           │   ├── profile_screen.dart
│           │   ├── edit_profile_screen.dart
│           │   ├── settings_screen.dart
│           │   ├── notification_settings_screen.dart
│           │   └── help_support_screen.dart
│           └── widgets/
│
├── data/                          # Shared data layer
│   ├── models/                    # Shared models
│   ├── repositories/              # Shared repositories
│   └── services/                  # Shared services
│       ├── api_service.dart       # HTTP client (Dio)
│       ├── auth_service.dart      # Authentication service
│       ├── storage_service.dart   # Local storage (SharedPreferences)
│       ├── secure_storage_service.dart  # Secure storage (FlutterSecureStorage)
│       ├── notification_service.dart    # Push notifications
│       └── location_service.dart  # Location services
│
└── main.dart                      # App entry point
```

---

## 🎯 Key Architectural Decisions

### 1. Clean Architecture

**Why?**
- ✅ Separation of concerns
- ✅ Testable code
- ✅ Independent of frameworks
- ✅ Independent of UI
- ✅ Independent of database

**Layers:**
```
Presentation (UI) → Domain (Business Logic) → Data (External)
```

**Dependencies:**
```
Presentation depends on Domain
Domain depends on nothing (pure Dart)
Data depends on Domain
```

---

### 2. Feature-First Structure

**Why?**
- ✅ Scalable (easy to add new features)
- ✅ Maintainable (related code together)
- ✅ Team-friendly (parallel development)
- ✅ Modular (features can be extracted)

**Example:**
```
features/auth/  ← All authentication code here
  ├── data/     ← API calls, models
  ├── domain/   ← Business logic
  └── presentation/  ← UI screens, widgets
```

---

### 3. Riverpod for State Management

**Why Riverpod?**
- ✅ Compile-time safety
- ✅ No BuildContext needed
- ✅ Easy testing
- ✅ Better than Provider
- ✅ Supports async operations

**Example:**
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

---

### 4. String Files (Localization Ready)

**Why?**
- ✅ Easy to translate
- ✅ Consistent text
- ✅ No hardcoded strings
- ✅ Easy to update

**Usage:**
```dart
// ❌ Bad
Text('Login')

// ✅ Good
Text(AppStrings.login)
```

---

### 5. Design Tokens

**Why?**
- ✅ Consistent spacing
- ✅ Consistent sizing
- ✅ Easy to update
- ✅ Design system compliance

**Usage:**
```dart
// ❌ Bad
SizedBox(height: 16)
BorderRadius.circular(12)

// ✅ Good
SizedBox(height: DesignTokens.spaceMd)
BorderRadius.circular(DesignTokens.radiusMd)
```

---

### 6. Edge-to-Edge Design

**Implementation:**
```dart
// Remove default padding
Scaffold(
  extendBodyBehindAppBar: true,
  extendBody: true,
  body: SafeArea(
    child: YourContent(),
  ),
)
```

**Benefits:**
- ✅ Modern look
- ✅ More screen space
- ✅ Immersive experience
- ✅ Follows Material Design 3

---

### 7. Responsive Design

**Breakpoints:**
```dart
Mobile:  < 480px
Tablet:  480px - 768px
Desktop: > 768px
```

**Implementation:**
```dart
LayoutBuilder(
  builder: (context, constraints) {
    if (constraints.maxWidth < DesignTokens.breakpointMobile) {
      return MobileLayout();
    } else if (constraints.maxWidth < DesignTokens.breakpointTablet) {
      return TabletLayout();
    } else {
      return DesktopLayout();
    }
  },
)
```

---

## 🔄 Data Flow

### Request Flow

```
UI (Screen)
  ↓
Provider (Riverpod)
  ↓
UseCase (Business Logic)
  ↓
Repository Interface (Domain)
  ↓
Repository Implementation (Data)
  ↓
DataSource (API/Local)
  ↓
External Service (Backend API)
```

### Response Flow

```
External Service (Backend API)
  ↓
DataSource (API/Local)
  ↓
Repository Implementation (Data)
  ↓
Repository Interface (Domain)
  ↓
UseCase (Business Logic)
  ↓
Provider (Riverpod)
  ↓
UI (Screen) - Updates automatically
```

---

## 🧪 Testing Strategy

### Unit Tests
```
test/
├── core/
│   ├── utils/
│   └── validators/
├── features/
│   ├── auth/
│   │   ├── data/
│   │   ├── domain/
│   │   └── presentation/
│   └── ...
```

### Widget Tests
```
test/
├── widgets/
│   ├── buttons/
│   ├── inputs/
│   └── cards/
```

### Integration Tests
```
integration_test/
├── app_test.dart
├── auth_flow_test.dart
└── appointment_flow_test.dart
```

---

## 📦 Dependency Injection

### Using Riverpod

```dart
// Service Provider
final apiServiceProvider = Provider<ApiService>((ref) {
  return ApiService();
});

// Repository Provider
final authRepositoryProvider = Provider<AuthRepository>((ref) {
  final apiService = ref.watch(apiServiceProvider);
  return AuthRepositoryImpl(apiService);
});

// UseCase Provider
final loginUseCaseProvider = Provider<LoginUseCase>((ref) {
  final repository = ref.watch(authRepositoryProvider);
  return LoginUseCase(repository);
});
```

---

## 🔐 Security Best Practices

### 1. Secure Storage
```dart
// Sensitive data (tokens, passwords)
FlutterSecureStorage().write(key: 'token', value: token);

// Non-sensitive data
SharedPreferences.setString('theme', 'dark');
```

### 2. API Security
```dart
// Always use HTTPS
static const String baseUrl = 'https://api.smartcura.app';

// Add authentication headers
headers: {
  'Authorization': 'Bearer $token',
  'Content-Type': 'application/json',
}
```

### 3. Input Validation
```dart
// Always validate user input
if (!EmailValidator.validate(email)) {
  return AppStrings.invalidEmail;
}
```

---

## 🚀 Performance Optimization

### 1. Lazy Loading
```dart
// Load data only when needed
final doctorsProvider = FutureProvider.autoDispose<List<Doctor>>((ref) async {
  return await ref.watch(doctorRepositoryProvider).getDoctors();
});
```

### 2. Caching
```dart
// Cache API responses
final cachedDoctorsProvider = FutureProvider<List<Doctor>>((ref) async {
  final cache = ref.watch(cacheServiceProvider);
  final cached = await cache.get('doctors');
  if (cached != null) return cached;
  
  final doctors = await ref.watch(doctorRepositoryProvider).getDoctors();
  await cache.set('doctors', doctors);
  return doctors;
});
```

### 3. Image Optimization
```dart
// Use cached network images
CachedNetworkImage(
  imageUrl: doctor.photoUrl,
  placeholder: (context, url) => CircularProgressIndicator(),
  errorWidget: (context, url, error) => Icon(Icons.error),
)
```

---

## 📱 Platform-Specific Code

### iOS vs Android

```dart
import 'dart:io';

if (Platform.isIOS) {
  // iOS-specific code
} else if (Platform.isAndroid) {
  // Android-specific code
}
```

### Adaptive Widgets

```dart
// Use platform-specific widgets
Platform.isIOS
  ? CupertinoButton(...)
  : ElevatedButton(...)
```

---

## 🎨 Theming

### Light & Dark Mode

```dart
MaterialApp(
  theme: AppTheme.lightTheme,
  darkTheme: AppTheme.darkTheme,
  themeMode: ThemeMode.system, // Follow system setting
)
```

---

## 📊 Analytics & Monitoring

### Firebase Analytics

```dart
// Track screen views
FirebaseAnalytics.instance.logScreenView(
  screenName: 'HomeScreen',
);

// Track events
FirebaseAnalytics.instance.logEvent(
  name: 'book_appointment',
  parameters: {'doctor_id': doctorId},
);
```

### Crashlytics

```dart
// Log errors
FirebaseCrashlytics.instance.recordError(error, stackTrace);
```

---

## ✅ Code Quality Standards

### 1. Naming Conventions
- Files: `snake_case.dart`
- Classes: `PascalCase`
- Variables: `camelCase`
- Constants: `SCREAMING_SNAKE_CASE`
- Private: `_leadingUnderscore`

### 2. Comments
```dart
/// Public API documentation
/// 
/// Explains what the function does
String formatDate(DateTime date) {
  // Implementation comment
  return DateFormat('yyyy-MM-dd').format(date);
}
```

### 3. Error Handling
```dart
try {
  final result = await apiService.login(email, password);
  return Right(result);
} catch (e) {
  return Left(Failure(e.toString()));
}
```

---

## 🔄 CI/CD Pipeline

### GitHub Actions

```yaml
- Run tests
- Check code formatting
- Analyze code
- Build APK/IPA
- Deploy to Firebase App Distribution
```

---

## 📚 Documentation

### Code Documentation
- All public APIs documented
- Complex logic explained
- Examples provided

### Architecture Documentation
- This file (ARCHITECTURE.md)
- DESIGN_SYSTEM.md
- API_INTEGRATION.md

---

**Last Updated:** January 25, 2026  
**Version:** 1.0  
**Status:** ✅ Production Ready

© 2026 SmartCura. All Rights Reserved.
