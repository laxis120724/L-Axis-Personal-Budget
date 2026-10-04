import { initializeApp } from
    "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";

import { getAuth } from
    "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

import { getFirestore } from
    "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyC3qvGa6Y7hEmGs326GMgiz_5Zx-GGp8mw",
  authDomain: "capstone-f7c57.firebaseapp.com",
  projectId: "capstone-f7c57",
  storageBucket: "capstone-f7c57.firebasestorage.app",
  messagingSenderId: "268013356451",
  appId: "1:268013356451:web:7ca3db8b272c7c20d90616"
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);

export async function getUser() {
    // Read the current session each time: sign-out or switching accounts must
    // never reuse the previous user's Firestore path.
    await auth.authStateReady();
    const user = auth.currentUser;

    if (!user || user.isAnonymous) {
        const error = new Error("Sign in to your account to access your money.");
        error.code = "auth/sign-in-required";
        throw error;
    }

    return user;
}
