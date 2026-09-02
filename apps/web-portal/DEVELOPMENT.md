# SmartCura Admin Portal - Development Guide

## 🚀 Quick Start

The first 4 screens are now implemented and running locally!

### Running the Application

```bash
cd apps/web-portal
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## 📱 Implemented Screens

### 1. Login Screen (`/login`)
- Email and password authentication
- Form validation
- Remember me checkbox
- Password visibility toggle
- Security notice

**Demo Credentials:**
- Email: `admin@smartcura.app`
- Password: `password123`

### 2. 2FA Verification (`/2fa`)
- 6-digit code input with auto-focus
- 5-minute expiration timer
- Resend code functionality (30s cooldown)
- Auto-submit when code is complete

**Demo 2FA Code:** `123456`

### 3. Role Selection (`/role-select`)
- Displays available roles for multi-role users
- Three role options:
  - Administrator (full access)
  - Pharmacy Manager (pharmacy operations)
  - Emergency Operations (emergency handling)

### 4. Dashboard (`/dashboard`)
- KPI cards (Users, Doctors, Appointments, Revenue)
- Recent activity feed
- Pending actions with priority badges
- System health status
- Logout functionality

## 🎨 Features Implemented

### UI Components (Shadcn/ui)
- ✅ Button
- ✅ Input
- ✅ Label
- ✅ Card
- ✅ Checkbox
- ✅ Toast notifications

### State Management
- ✅ Zustand store for authentication
- ✅ Persistent auth state (localStorage)
- ✅ Session management

### Mock Data
- ✅ Mock admin users (3 users with different roles)
- ✅ Mock credentials
- ✅ Mock 2FA code
- ✅ Mock dashboard data (KPIs, activity, pending actions)

### Authentication Flow
- ✅ Login with email/password
- ✅ 2FA verification
- ✅ Role selection (for multi-role users)
- ✅ Redirect to dashboard
- ✅ Logout functionality

## 🎯 User Flow

1. **Start** → Navigate to http://localhost:3000
2. **Login** → Enter credentials (admin@smartcura.com / password123)
3. **2FA** → Enter code (123456)
4. **Role Selection** → Select "Administrator" role
5. **Dashboard** → View KPIs, activity, and system health

## 📁 Project Structure

```
apps/web-portal/
├── src/
│   ├── app/
│   │   ├── login/page.tsx          # Screen 1: Login
│   │   ├── 2fa/page.tsx            # Screen 2: 2FA Verification
│   │   ├── role-select/page.tsx    # Screen 3: Role Selection
│   │   ├── dashboard/page.tsx      # Screen 4: Dashboard
│   │   ├── layout.tsx              # Root layout
│   │   └── page.tsx                # Home (redirects to login)
│   ├── components/
│   │   └── ui/                     # Shadcn/ui components
│   ├── hooks/
│   │   └── use-toast.ts            # Toast hook
│   ├── lib/
│   │   ├── utils.ts                # Utility functions
│   │   └── mock-data.ts            # Mock data
│   ├── store/
│   │   └── authStore.ts            # Zustand auth store
│   ├── types/
│   │   └── auth.ts                 # TypeScript types
│   └── styles/
│       └── globals.css             # Global styles
```

## 🎨 Design System

### Colors
- **Primary:** Blue-800 (#1E40AF) - Professional, trustworthy
- **Secondary:** Teal-700 (#0F766E) - Healthcare, medical
- **Success:** Green-500 (#10B981)
- **Warning:** Amber-500 (#F59E0B)
- **Error:** Red-600 (#DC2626)

### Typography
- **Font Family:** Inter
- **Headings:** Bold
- **Body:** Regular

### Components
- All components use Shadcn/ui
- Tailwind CSS for styling
- Responsive design (desktop-first)

## 🔐 Mock Users

### Admin User (Multi-role)
- **Email:** admin@smartcura.com
- **Password:** password123
- **Roles:** Admin, Pharmacy, Emergency
- **2FA Code:** 123456

### Pharmacy Manager
- **Email:** pharmacy@smartcura.com
- **Password:** password123
- **Roles:** Pharmacy
- **2FA Code:** 123456

### Emergency Operator
- **Email:** emergency@smartcura.com
- **Password:** password123
- **Roles:** Emergency
- **2FA Code:** 123456

## 🚧 Next Steps

The following screens are planned for implementation:

### User Management (Screens 5-9)
- Patients List
- Patient Details
- Doctors List
- Doctor Verification Queue
- Doctor Details

### Appointments (Screens 10-11)
- Appointments List
- Appointment Details

### Finance (Screens 12-14)
- Finance Dashboard
- Transactions List
- Doctor Payouts

And 16 more screens...

## 📝 Notes

- All data is currently mocked (no database connection)
- Authentication is simulated (no real API calls)
- Session persists in localStorage
- 2FA code is always "123456" for demo purposes
- All screens are fully responsive

## 🐛 Known Issues

None at the moment! 🎉

## 📞 Support

For questions or issues, contact:
- **Email:** ashrafulislamse@gmail.com
- **GitHub:** [@ashrafulislamse](https://github.com/ashrafulislamse)

---

**© 2026 SmartCura. All Rights Reserved.**
