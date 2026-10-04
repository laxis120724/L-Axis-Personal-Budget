// Theme is available before sign-in; currency preferences belong to an account.
export function getTheme() {
    return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function applyTheme(theme = "light") {
    const value = theme === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = value;
    try { localStorage.setItem("laxis.theme", value); localStorage.removeItem("laxis.appearance"); } catch {}
    return value;
}
let initialTheme = "light";
try { initialTheme = localStorage.getItem("laxis.theme"); } catch {}
applyTheme(initialTheme);
