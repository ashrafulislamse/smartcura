/// All UI strings in one place
/// 
/// Makes localization easy and prevents hardcoded strings
class AppStrings {
  // App
  static const String appName = 'SmartCura Doctor';
  static const String appTagline = 'Professional Healthcare Platform';
  
  // Common
  static const String ok = 'OK';
  static const String cancel = 'Cancel';
  static const String save = 'Save';
  static const String delete = 'Delete';
  static const String edit = 'Edit';
  static const String done = 'Done';
  static const String next = 'Next';
  static const String back = 'Back';
  static const String skip = 'Skip';
  static const String retry = 'Retry';
  static const String loading = 'Loading...';
  static const String error = 'Error';
  static const String success = 'Success';
  static const String warning = 'Warning';
  static const String info = 'Information';
  static const String confirm = 'Confirm';
  static const String yes = 'Yes';
  static const String no = 'No';
  static const String search = 'Search';
  static const String filter = 'Filter';
  static const String sort = 'Sort';
  static const String viewAll = 'View All';
  static const String seeMore = 'See More';
  static const String seeLess = 'See Less';
  
  // Authentication
  static const String login = 'Login';
  static const String logout = 'Logout';
  static const String register = 'Register';
  static const String email = 'Email';
  static const String password = 'Password';
  static const String confirmPassword = 'Confirm Password';
  static const String forgotPassword = 'Forgot Password?';
  static const String resetPassword = 'Reset Password';
  static const String emailAddress = 'Email Address';
  static const String enterEmail = 'Enter your email';
  static const String enterPassword = 'Enter your password';
  static const String rememberMe = 'Remember me';
  static const String dontHaveAccount = "Don't have an account?";
  static const String alreadyHaveAccount = 'Already have an account?';
  static const String signUp = 'Sign Up';
  static const String signIn = 'Sign In';
  
  // Dashboard
  static const String dashboard = 'Dashboard';
  static const String welcome = 'Welcome';
  static const String goodMorning = 'Good Morning';
  static const String goodAfternoon = 'Good Afternoon';
  static const String goodEvening = 'Good Evening';
  static const String todaySchedule = "Today's Schedule";
  static const String upcomingAppointments = 'Upcoming Appointments';
  static const String recentPatients = 'Recent Patients';
  static const String quickActions = 'Quick Actions';
  static const String notifications = 'Notifications';
  
  // Appointments
  static const String appointments = 'Appointments';
  static const String appointmentDetails = 'Appointment Details';
  static const String schedule = 'Schedule';
  static const String mySchedule = 'My Schedule';
  static const String pending = 'Pending';
  static const String confirmed = 'Confirmed';
  static const String completed = 'Completed';
  static const String cancelled = 'Cancelled';
  static const String accept = 'Accept';
  static const String reject = 'Reject';
  static const String reschedule = 'Reschedule';
  static const String startConsultation = 'Start Consultation';
  static const String endConsultation = 'End Consultation';
  static const String noAppointments = 'No appointments';
  static const String noUpcomingAppointments = 'No upcoming appointments';
  
  // Consultations
  static const String consultation = 'Consultation';
  static const String videoCall = 'Video Call';
  static const String audioCall = 'Audio Call';
  static const String chat = 'Chat';
  static const String consultationNotes = 'Consultation Notes';
  static const String createPrescription = 'Create Prescription';
  static const String prescription = 'Prescription';
  static const String prescriptions = 'Prescriptions';
  static const String diagnosis = 'Diagnosis';
  static const String treatment = 'Treatment';
  static const String medications = 'Medications';
  static const String addMedication = 'Add Medication';
  static const String dosage = 'Dosage';
  static const String frequency = 'Frequency';
  static const String duration = 'Duration';
  static const String instructions = 'Instructions';
  
  // Patients
  static const String patients = 'Patients';
  static const String myPatients = 'My Patients';
  static const String patientDetails = 'Patient Details';
  static const String patientInfo = 'Patient Information';
  static const String medicalHistory = 'Medical History';
  static const String vitals = 'Vitals';
  static const String allergies = 'Allergies';
  static const String currentMedications = 'Current Medications';
  static const String pastConsultations = 'Past Consultations';
  static const String noPatients = 'No patients';
  
  // Profile
  static const String profile = 'Profile';
  static const String myProfile = 'My Profile';
  static const String editProfile = 'Edit Profile';
  static const String settings = 'Settings';
  static const String helpSupport = 'Help & Support';
  static const String about = 'About';
  static const String privacyPolicy = 'Privacy Policy';
  static const String termsConditions = 'Terms & Conditions';
  static const String version = 'Version';
  static const String contactUs = 'Contact Us';
  static const String faq = 'FAQ';
  
  // Doctor Info
  static const String fullName = 'Full Name';
  static const String specialty = 'Specialty';
  static const String qualification = 'Qualification';
  static const String experience = 'Experience';
  static const String licenseNumber = 'License Number';
  static const String consultationFee = 'Consultation Fee';
  static const String availability = 'Availability';
  static const String bio = 'Bio';
  
  // Validation Messages
  static const String fieldRequired = 'This field is required';
  static const String invalidEmail = 'Invalid email address';
  static const String invalidPassword = 'Password must be at least 8 characters';
  static const String passwordMismatch = 'Passwords do not match';
  static const String invalidPhone = 'Invalid phone number';
  static const String invalidLicense = 'Invalid license number';
  
  // Error Messages
  static const String errorOccurred = 'An error occurred';
  static const String networkError = 'Network error. Please check your connection';
  static const String serverError = 'Server error. Please try again later';
  static const String authError = 'Authentication error. Please login again';
  static const String notFound = 'Not found';
  static const String accessDenied = 'Access denied';
  static const String sessionExpired = 'Session expired. Please login again';
  
  // Success Messages
  static const String loginSuccess = 'Login successful';
  static const String logoutSuccess = 'Logout successful';
  static const String saveSuccess = 'Saved successfully';
  static const String updateSuccess = 'Updated successfully';
  static const String deleteSuccess = 'Deleted successfully';
  static const String prescriptionCreated = 'Prescription created successfully';
  static const String appointmentAccepted = 'Appointment accepted';
  static const String appointmentRejected = 'Appointment rejected';
  
  // Confirmation Messages
  static const String confirmLogout = 'Are you sure you want to logout?';
  static const String confirmDelete = 'Are you sure you want to delete?';
  static const String confirmReject = 'Are you sure you want to reject this appointment?';
  static const String confirmEndConsultation = 'Are you sure you want to end this consultation?';
  
  // Empty States
  static const String noData = 'No data available';
  static const String noResults = 'No results found';
  static const String noNotifications = 'No notifications';
  static const String noPrescriptions = 'No prescriptions';
  static const String noMedications = 'No medications';
  
  // Time
  static const String today = 'Today';
  static const String yesterday = 'Yesterday';
  static const String tomorrow = 'Tomorrow';
  static const String thisWeek = 'This Week';
  static const String thisMonth = 'This Month';
  static const String morning = 'Morning';
  static const String afternoon = 'Afternoon';
  static const String evening = 'Evening';
  static const String night = 'Night';
}
