/// Driver-scoped API endpoint path constants.
///
/// All paths are relative to the API base (`https://api.smartcura.app/api/v1`).
/// The [ApiClient] prepends the base, so these constants carry only the path
/// after `/api/v1`. Path-parameter helpers return interpolated strings so the
/// compiler can catch a missing id at the call site rather than at runtime.
class ApiEndpoints {
  ApiEndpoints._();

  // ---- Sessions ----------------------------------------------------------
  static const sessions = '/sessions';
  static const sessionsCurrent = '/sessions/current';
  static const sessionsRefresh = '/sessions/refresh';
  static const sessionsStepUp = '/sessions/step-up';
  static const sessionsActiveRole = '/sessions/current/active-role';

  // ---- Profiles ----------------------------------------------------------
  static const profilesMe = '/profiles/me';
  static const profilesMeAvatar = '/profiles/me/avatar';

  // ---- Dispatch - offers -------------------------------------------------
  static const dispatchOffers = '/dispatch/offers';
  static String dispatchOffer(String offerId) => '/dispatch/offers/$offerId';
  static String dispatchOfferAccept(String offerId) =>
      '/dispatch/offers/$offerId/acceptance';

  // ---- Dispatch - assignments --------------------------------------------
  static String dispatchAssignment(String assignmentId) =>
      '/dispatch/assignments/$assignmentId';
  static String dispatchAssignmentStatus(String assignmentId) =>
      '/dispatch/assignments/$assignmentId/status';
  static String dispatchAssignmentRecipient(String assignmentId) =>
      '/dispatch/assignments/$assignmentId/recipient';
  static String dispatchAssignmentStops(String assignmentId) =>
      '/dispatch/assignments/$assignmentId/stops';
  static String dispatchAssignmentWaypoints(String assignmentId) =>
      '/dispatch/assignments/$assignmentId/waypoints';

  // ---- Drivers - self ----------------------------------------------------
  static const driversMeEarnings = '/drivers/me/earnings';
  static const driversMeBankAccounts = '/drivers/me/bank-accounts';
  static const driversMeWithdrawals = '/drivers/me/withdrawals';
  static const driversMeVehicles = '/drivers/me/vehicles';
  static const driversMeRatings = '/drivers/me/ratings';
  static const driversMeAssignments = '/drivers/me/assignments';

  // ---- Deliveries - rating -----------------------------------------------
  static String deliveryRating(String deliveryId) =>
      '/deliveries/$deliveryId/rating';

  // ---- Notifications -----------------------------------------------------
  static const notifications = '/notifications';
  static String notificationRead(String id) =>
      '/notifications/$id/read'; // path param is `notification_id`
  static const notificationsReadAll = '/notifications/read-all';
  static const notificationPreferences = '/notifications/preferences/me';
  // Push-device registration so the worker can address this install over FCM.
  // The POST response carries `push_device_id`, which the revocation path needs.
  static const pushDevices = '/notifications/push-devices';
  static String pushDeviceRevocation(String pushDeviceId) =>
      '/notifications/push-devices/$pushDeviceId/revocation';

  // ---- Support -----------------------------------------------------------
  static const supportTickets = '/support/tickets';
}
