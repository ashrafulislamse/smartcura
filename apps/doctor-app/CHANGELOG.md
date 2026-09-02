# Changelog

All notable changes to the SmartCura Doctor App will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-02-05

### Added - MVP Phase 1 Complete ✅

#### Authentication (6 screens)
- Splash screen with animated gradient and logo
- Onboarding tutorial with 3 swipeable slides
- Login screen with email/password and Remember Me
- Registration screen with medical license upload
- Verification pending screen with 3-step progress
- Forgot password screen with email reset

#### Dashboard & Core (2 screens)
- Dashboard with stats cards and quick actions
- Notifications center with categorized alerts

#### Appointments (3 screens)
- Appointments list with tabs (Pending, Today, Upcoming, Done)
- Appointment details with patient information
- My Schedule with calendar view and availability management

#### Consultations (4 screens)
- Video consultation UI and workflow placeholders (media connectivity is not yet integrated)
- Chat consultation with real-time messaging
- Consultation notes with auto-save functionality
- E-prescription creation with digital signature

#### Messaging (1 screen)
- Messages list with centralized inbox and unread indicators

#### Patients (2 screens)
- Patients list with search and filtering
- Patient details with vitals, medical history, medications

#### Profile & Settings (4 screens)
- Profile screen with stats and menu items
- Edit profile with photo upload and professional details
- Settings screen with iOS-style toggles and preferences
- Help & support center with FAQs and contact options

### Technical Features
- Clean Architecture with feature-first structure
- go_router with ShellRoute for persistent bottom navigation
- 5-tab bottom navigation (Home, Schedule, Chat, Patients, Profile)
- Riverpod for state management
- SharedPreferences for local storage
- Custom teal theme (#0F766E)
- Edge-to-edge design with no white flash
- Responsive design for all screen sizes
- Material Design 3 components

### Developer Experience
- Professional folder structure
- Comprehensive documentation
- Type-safe navigation
- Reusable widgets
- Consistent design system

---

## [Unreleased]

### Planned - Phase 2: IoT Integration (10 screens)
- Real-time patient vitals monitoring
- IoT device management
- Automated alerts system
- Historical data analysis
- Multi-patient monitoring dashboard

### Planned - Phase 3: AI Integration (10 screens)
- AI diagnosis assistant
- Clinical decision support
- Treatment recommendations
- Risk prediction models
- Practice analytics

### Planned - Phase 4: Advanced Features (5 screens)
- Advanced analytics dashboard
- Referral management
- Prescription templates
- Medical records access
- Detailed earnings tracking

### Planned - Backend Integration
- REST API connection
- Firebase authentication
- Real-time WebSocket chat
- Self-hosted LiveKit media integration for video calls
- Push notifications
- Cloud storage

---

## Version History

- **1.0.0** (2026-02-05) - MVP Complete - 22 screens
- **0.1.0** (2026-01-20) - Initial project setup

---

**Note:** Version 1.0.0 records completion of the 22-screen UI milestone. Backend persistence, Firebase identity, LiveKit media connectivity and production hardening are not yet implemented.
