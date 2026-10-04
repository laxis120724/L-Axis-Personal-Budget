const messages = {
    "auth/invalid-credential": "The email or password is incorrect. Please try again.",
    "auth/wrong-password": "The email or password is incorrect. Please try again.",
    "auth/user-not-found": "The email or password is incorrect. Please try again.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/missing-password": "Enter your password.",
    "auth/invalid-display-name": "Enter your full name using 1–80 characters.",
    "auth/email-already-in-use": "An account already uses this email. Switch to Log in.",
    "auth/credential-already-in-use": "This account already exists. Switch to Log in to continue.",
    "auth/account-exists-with-different-credential": "Use the sign-in method you originally used for this email.",
    "auth/weak-password": "Choose a stronger password with at least 8 characters.",
    "auth/password-does-not-meet-requirements": "This password does not meet the account password requirements.",
    "auth/operation-not-allowed": "This sign-in method is not enabled yet. Please contact the app owner.",
    "auth/unauthorized-domain": "Sign-in is not enabled for this website address yet. Please contact the app owner.",
    "auth/popup-blocked": "Allow the Google sign-in pop-up in your browser, then try again.",
    "auth/popup-closed-by-user": "Google sign-in was cancelled. You can try again when ready.",
    "auth/cancelled-popup-request": "Google sign-in was cancelled. Please try again.",
    "auth/network-request-failed": "Check your internet connection and try again.",
    "auth/too-many-requests": "Too many attempts. Please wait a little and try again.",
    "auth/user-disabled": "This account is unavailable. Please contact the app owner."
};

export function initializeAuth(root, signal, services, { initialMode = "login", onSuccess = () => {}, onModeChange = () => {}, onBusyChange = () => {} } = {}) {
    const find = selector => root.querySelector(selector);
    const form = find("[data-auth-form]");
    const field = name => form.elements.namedItem(name);
    const tabs = [...root.querySelectorAll("[data-auth-mode]")];
    const submit = find("[data-auth-submit]");
    const google = find("[data-auth-google]");
    const resetDialog = find("[data-auth-reset-dialog]");
    const resetForm = find("[data-auth-reset-form]");
    const resetSubmit = find("[data-auth-reset-submit]");
    const toggleButtons = [...root.querySelectorAll("[data-auth-password-toggle]")];
    let mode = "login";
    let busy = false;
    let resetting = false;
    const active = () => !signal.aborted && root.isConnected;
    const feedback = (selector, message = "", error = false) => {
        const target = find(selector);
        target.textContent = message;
        target.hidden = !message;
        target.dataset.error = String(error);
        target.dataset.kind = error ? "error" : "success";
    };
    const errorMessage = error => messages[error.code] || (error.code
        ? "We couldn’t complete that request. Please try again." : error.message);

    function resetEyes() {
        for (const button of toggleButtons) {
            field(button.dataset.authPasswordTarget).type = "password";
            button.setAttribute("aria-pressed", "false");
            button.setAttribute("aria-label", button.dataset.authPasswordTarget === "password" ? "Show password" : "Show password confirmation");
            button.setAttribute("title", button.getAttribute("aria-label"));
            button.querySelector('[data-auth-eye="show"]').hidden = false;
            button.querySelector('[data-auth-eye="hide"]').hidden = true;
        }
    }

    function setMode(next) {
        if (busy) return;
        mode = next === "register" ? "register" : "login";
        const registering = mode === "register";
        const email = field("email").value;
        form.reset();
        field("email").value = email;
        field("name").disabled = field("confirmPassword").disabled = !registering;
        field("name").required = field("confirmPassword").required = registering;
        field("confirmPassword").setCustomValidity("");
        field("password").minLength = registering ? 8 : 1;
        field("password").setAttribute("autocomplete", registering ? "new-password" : "current-password");
        find("[data-auth-name-field]").hidden = find("[data-auth-confirm-field]").hidden = !registering;
        find("[data-auth-forgot]").hidden = registering;
        tabs.forEach(tab => tab.setAttribute("aria-pressed", String(tab.dataset.authMode === mode)));
        find("[data-auth-title]").textContent = registering ? "Create an account." : "Welcome back.";
        find("[data-auth-intro]").textContent = registering ? "Enter your details to get started." : "Log in to your account.";
        submit.textContent = registering ? "Create account" : "Log in";
        find("[data-auth-google-label]").textContent = "Continue with Google";
        resetEyes();
        feedback("[data-auth-message]");
    }

    function lock(locked) {
        busy = locked;
        form.querySelectorAll("input, button").forEach(control => { control.disabled = locked; });
        tabs.forEach(tab => { tab.disabled = locked; });
        google.disabled = find("[data-auth-forgot]").disabled = locked;
        if (!locked) field("name").disabled = field("confirmPassword").disabled = mode !== "register";
    }

    async function authenticate(operation, label) {
        if (busy) return;
        const oldLabel = submit.textContent;
        lock(true);
        onBusyChange(true);
        submit.textContent = label;
        feedback("[data-auth-message]");
        try {
            const result = await operation();
            if (active()) onSuccess(result?.user);
        } catch (error) {
            if (active()) feedback("[data-auth-message]", errorMessage(error), true);
        } finally {
            onBusyChange(false);
            if (active()) {
                lock(false);
                submit.textContent = oldLabel;
            }
        }
    }

    tabs.forEach(tab => tab.addEventListener("click", () => {
        setMode(tab.dataset.authMode);
        if (!busy) onModeChange(mode);
    }, { signal }));
    toggleButtons.forEach(button => button.addEventListener("click", () => {
        const target = field(button.dataset.authPasswordTarget);
        const visible = target.type === "password";
        target.type = visible ? "text" : "password";
        button.setAttribute("aria-pressed", String(visible));
        const label = button.dataset.authPasswordTarget === "password" ? "password" : "password confirmation";
        button.setAttribute("aria-label", (visible ? "Hide " : "Show ") + label);
        button.setAttribute("title", button.getAttribute("aria-label"));
        button.querySelector('[data-auth-eye="show"]').hidden = visible;
        button.querySelector('[data-auth-eye="hide"]').hidden = !visible;
    }, { signal }));
    const checkConfirmation = () => field("confirmPassword").setCustomValidity(mode === "register"
        && field("confirmPassword").value !== field("password").value ? "Passwords must match." : "");
    for (const name of ["password", "confirmPassword"]) field(name).addEventListener("input", checkConfirmation, { signal });
    form.addEventListener("submit", event => {
        event.preventDefault();
        if (busy) return;
        checkConfirmation();
        if (!form.reportValidity()) return;
        const email = field("email").value.trim();
        const password = field("password").value;
        const name = field("name").value.trim();
        authenticate(() => mode === "register" ? services.registerWithEmail(name, email, password)
            : services.loginWithEmail(email, password), mode === "register" ? "Creating account…" : "Signing in…");
    }, { signal });
    google.addEventListener("click", () => authenticate(() => services.signInWithGoogle(mode), "Connecting to Google…"), { signal });
    find("[data-auth-forgot]").addEventListener("click", () => {
        if (busy) return;
        resetForm.reset();
        resetForm.elements.namedItem("email").value = field("email").value.trim();
        feedback("[data-auth-reset-message]");
        resetDialog.showModal();
    }, { signal });
    root.querySelectorAll("[data-auth-reset-close]").forEach(button => button.addEventListener("click", () => {
        if (!resetting) resetDialog.close();
    }, { signal }));
    resetDialog.addEventListener("cancel", event => { if (resetting) event.preventDefault(); }, { signal });
    resetForm.addEventListener("submit", async event => {
        event.preventDefault();
        if (resetting || !resetForm.reportValidity()) return;
        const email = resetForm.elements.namedItem("email").value.trim();
        resetting = true;
        resetDialog.querySelectorAll("input, button").forEach(control => { control.disabled = true; });
        resetSubmit.textContent = "Sending…";
        feedback("[data-auth-reset-message]");
        try {
            await services.sendPasswordReset(email);
            if (active()) feedback("[data-auth-reset-message]", "If an account uses this email, you’ll receive a password reset link. Check your inbox and spam folder.");
        } catch (error) {
            if (active()) {
                if (error.code === "auth/user-not-found") feedback("[data-auth-reset-message]", "If an account uses this email, you’ll receive a password reset link. Check your inbox and spam folder.");
                else feedback("[data-auth-reset-message]", errorMessage(error), true);
            }
        } finally {
            resetting = false;
            if (active()) {
                resetDialog.querySelectorAll("input, button").forEach(control => { control.disabled = false; });
                resetSubmit.textContent = "Send reset link";
            }
        }
    }, { signal });
    signal.addEventListener("abort", () => { resetDialog.close(); }, { once: true });
    setMode(initialMode);
}
