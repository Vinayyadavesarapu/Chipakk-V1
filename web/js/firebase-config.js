import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

// TODO: Replace with your Firebase project configuration
// 1. Go to console.firebase.google.com
// 2. Create a project
// 3. Add a Web App
// 4. Copy the firebaseConfig object here
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyB_0DEb67iAWglUi9a1XCbyOTQ6g2eVDzY",
  authDomain: "chipakk-77b99.firebaseapp.com",
  projectId: "chipakk-77b99",
  storageBucket: "chipakk-77b99.firebasestorage.app",
  messagingSenderId: "869954620444",
  appId: "1:869954620444:web:d12ace45869ad233ace3d9",
  measurementId: "G-EQBMDTE656"
};

// Initialize Firebase
let app, db, auth, storage;

try {
  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  auth = getAuth(app);
  storage = getStorage(app);
  console.log("Firebase initialized");
} catch (e) {
  console.error("Firebase initialization error. Make sure to add your config!", e);
}

export { db, auth, storage };
