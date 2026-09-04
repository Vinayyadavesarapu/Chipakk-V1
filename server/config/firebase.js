const admin = require('firebase-admin');
const dotenv = require('dotenv');

dotenv.config();

let firebaseApp = null;

const initializeFirebaseAdmin = () => {
  if (admin.apps.length > 0) {
    firebaseApp = admin.apps[0];
    return firebaseApp;
  }

  try {
    const projectId = process.env.FIREBASE_PROJECT_ID || 'chipakk-77b99';
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY
      ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      : null;

    if (clientEmail && privateKey) {
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          clientEmail,
          privateKey
        })
      });
      console.log('[Firebase Admin] Initialized with Service Account credentials');
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      firebaseApp = admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId
      });
      console.log('[Firebase Admin] Initialized with Application Default Credentials');
    } else {
      // Fallback initialization using project ID (token verification requires admin credentials in prod)
      firebaseApp = admin.initializeApp({
        projectId
      });
      console.warn('[Firebase Admin] Initialized with Project ID fallback. Set FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY for token verification.');
    }
  } catch (error) {
    console.error('[Firebase Admin Error] Initialization failed:', error.message);
  }

  return firebaseApp;
};

// Initialize Admin App
initializeFirebaseAdmin();

const getAuth = () => {
  if (!admin.apps.length) {
    initializeFirebaseAdmin();
  }
  return admin.auth();
};

module.exports = {
  admin,
  getAuth,
  initializeFirebaseAdmin
};
