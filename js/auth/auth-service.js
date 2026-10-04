import { auth } from "../core/firebase.js";
import {
    onAuthStateChanged,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    EmailAuthProvider,
    GoogleAuthProvider,
    linkWithCredential,
    linkWithPopup,
    signInWithPopup,
    updateProfile,
    sendPasswordResetEmail,
    signOut
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

function inputError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function validEmail(value) {
    const email = typeof value === "string" ? value.trim() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw inputError("Enter a valid email address.", "auth/invalid-email");
    }
    return email;
}

function validPassword(value, registering = false) {
    if (typeof value !== "string" || !value.length) {
        throw inputError("Enter your password.", "auth/missing-password");
    }
    if (registering && value.length < 8) {
        throw inputError("Use a password with at least 8 characters.", "auth/weak-password");
    }
    // Spaces may be part of a password, so do not trim it.
    return value;
}

export function watchAccount(onChange, onError) {
    return onAuthStateChanged(auth, onChange, onError);
}

export async function loginWithEmail(email, password) {
    const address = validEmail(email);
    const secret = validPassword(password);
    await auth.authStateReady();
    return signInWithEmailAndPassword(auth, address, secret);
}

export async function registerWithEmail(name, email, password) {
    const displayName = typeof name === "string" ? name.trim() : "";
    if (!displayName || displayName.length > 80) {
        throw inputError("Enter your name using 1 to 80 characters.", "auth/invalid-display-name");
    }
    const address = validEmail(email);
    const secret = validPassword(password, true);
    await auth.authStateReady();

    const anonymousUser = auth.currentUser?.isAnonymous ? auth.currentUser : null;
    const result = anonymousUser
        ? await linkWithCredential(anonymousUser, EmailAuthProvider.credential(address, secret))
        : await createUserWithEmailAndPassword(auth, address, secret);

    // Linking keeps the anonymous UID, preserving this browser's saved money.
    // A link conflict is surfaced to the form instead of silently switching users.
    await updateProfile(result.user, { displayName });
    return result;
}

export async function signInWithGoogle(mode = "login") {
    if (mode !== "login" && mode !== "register") {
        throw inputError("Choose login or registration.", "auth/invalid-mode");
    }
    await auth.authStateReady();
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });

    if (mode === "register" && auth.currentUser?.isAnonymous) {
        return linkWithPopup(auth.currentUser, provider);
    }
    return signInWithPopup(auth, provider);
}

export async function sendPasswordReset(email) {
    const address = validEmail(email);
    await auth.authStateReady();
    return sendPasswordResetEmail(auth, address);
}

export async function logoutAccount() {
    await auth.authStateReady();
    return signOut(auth);
}
