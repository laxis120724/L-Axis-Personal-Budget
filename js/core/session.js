import * as accountServices from "../auth/auth-service.js";
import { initializeAuth } from "../auth/auth-page.js";

export function initializeSession({
    services = accountServices,
    mountAuth = initializeAuth,
    loadApp = () => import("./app.js"),
    loadAuth = async signal => {
        const response = await fetch("pages/auth.html", { signal });
        if (!response.ok) throw new Error("The account screen could not be loaded.");
        return response.text();
    }
} = {}) {
    const shell = document.getElementById("app-shell");
    const authView = document.getElementById("auth-view");
    const loading = document.getElementById("session-loading");
    const lifetime = new AbortController();
    let viewController;
    let stopApp = () => {};
    let stateKey;
    let revision = 0;
    let authenticating = false;
    let pendingUser;

    async function applyAccount(user, force = false) {
        const signedIn = Boolean(user && !user.isAnonymous);
        const key = signedIn ? user.uid : "signed-out";
        if (lifetime.signal.aborted || (!force && key === stateKey)) return;
        stateKey = key;
        const current = ++revision;
        authenticating = false;
        pendingUser = undefined;
        viewController?.abort();
        viewController = new AbortController();
        const signal = viewController.signal;
        stopApp();
        stopApp = () => {};
        shell.hidden = authView.hidden = true;
        authView.replaceChildren();
        for (const id of ["header", "sidebar", "content"]) document.getElementById(id)?.replaceChildren();
        loading.textContent = "Opening L-Axis…";
        loading.hidden = false;
        const active = () => !signal.aborted && !lifetime.signal.aborted && current === revision;
        try {
            if (signedIn) {
                if (force || !window.location.hash || ["#login", "#register"].includes(window.location.hash)) {
                    window.history.replaceState(null, "", "#dashboard");
                }
                const app = await loadApp();
                if (!active()) return;
                shell.hidden = false;
                loading.hidden = true;
                stopApp = app.startApp({ user, onSignOut: services.logoutAccount });
            } else {
                const mode = window.location.hash === "#register" ? "register" : "login";
                window.history.replaceState(null, "", "#" + mode);
                const html = await loadAuth(signal);
                if (!active()) return;
                authView.innerHTML = html;
                authView.hidden = false;
                loading.hidden = true;
                mountAuth(authView.firstElementChild, signal, services, {
                    initialMode: mode,
                    onModeChange: next => { if (active()) window.history.replaceState(null, "", "#" + next); },
                    onSuccess: account => { if (active() && account && !account.isAnonymous) applyAccount(account, true); },
                    onBusyChange: busy => {
                        if (!active()) return;
                        authenticating = busy;
                        if (!busy && pendingUser !== undefined) {
                            const account = pendingUser;
                            pendingUser = undefined;
                            applyAccount(account);
                        }
                    }
                });
            }
        } catch {
            if (active()) {
                loading.textContent = "We couldn’t open L-Axis. Check your connection and reload the page.";
                loading.hidden = false;
            }
        }
    }

    const unsubscribe = services.watchAccount(user => {
        if (authenticating) pendingUser = user;
        else applyAccount(user);
    }, () => {
        if (!lifetime.signal.aborted) {
            ++revision;
            stateKey = undefined;
            authenticating = false;
            pendingUser = undefined;
            viewController?.abort();
            shell.hidden = authView.hidden = true;
            stopApp();
            stopApp = () => {};
            authView.replaceChildren();
            for (const id of ["header", "sidebar", "content"]) document.getElementById(id)?.replaceChildren();
            loading.hidden = false;
            loading.textContent = "We couldn’t check your account. Please reload the page.";
        }
    });
    return () => {
        if (lifetime.signal.aborted) return;
        lifetime.abort();
        viewController?.abort();
        stopApp();
        unsubscribe();
        shell.hidden = authView.hidden = true;
    };
}

initializeSession();
