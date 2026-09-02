/**
 * Fix email verification for the 6 new Firebase users.
 *
 * Usage: NODE_PATH=./apps/api/node_modules node tools/deploy/firebase-verify-emails.cjs
 */

const admin = require('firebase-admin');
const { getAuth } = require('firebase-admin/auth');
const fs = require('fs');
const path = require('path');

const SERVICE_ACCOUNT_PATH = path.join(
  process.env.USERPROFILE || process.env.HOME,
  'Downloads',
  'smartcura-platform-firebase-adminsdk-fbsvc-b2b234ba97.json'
);

const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));

const app = admin.initializeApp({
  credential: admin.cert(serviceAccount),
});

const auth = getAuth(app);

const NEW_USER_UIDS = [
  { email: 'imran.hafiz@smartcura.app', uid: 'XKgEopAPbebuaWdDNcvZIkkRHZ33' },
  { email: 'priya.krishnan@smartcura.app', uid: '4XELzIMzuPZflDHnEonQFy3JUkA3' },
  { email: 'farah.natasya@smartcura.app', uid: '2O3onBPRtphPZC9hxKd0zxhIQYg1' },
  { email: 'fahim.ahmed@smartcura.app', uid: '7cTuar3aBJe7ZevXKHxJgv7BpJs2' },
  { email: 'lee.cheekeong@smartcura.app', uid: 'kmXwCuQM9QOaSBRqcUq75eD5qNq2' },
  { email: 'nurul.huda@smartcura.app', uid: 'je5Gwa9VEdeKYCUwO1ZwhSKSSxv2' },
];

async function main() {
  console.log('=== Fix Email Verification for 6 New Users ===\n');

  for (const user of NEW_USER_UIDS) {
    try {
      await auth.updateUser(user.uid, { emailVerified: true });
      console.log('OK ' + user.email + ' -> emailVerified=true');
    } catch (err) {
      console.error('FAIL ' + user.email + ': ' + err.message);
    }
  }

  console.log('\nDone.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
