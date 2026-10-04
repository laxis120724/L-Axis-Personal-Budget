import { formatCurrency, getRate, getCurrencies, fallbackCurrencies, convertCents, automaticCurrency, LEGACY_CURRENCY } from "./currency.js";
import { applyTheme } from "../settings/appearance.js";

export function startCurrencyDisplay(user, signal, { load, save, saveTheme: persistTheme }) {
    let preferences = { currency: LEGACY_CURRENCY, theme: document.documentElement.dataset.theme || "light",
        showConverted: false, automatic: true, secondaryCurrency: "USD", locked: true };
    let loaded = false, error = "", revision = 0;
    const listeners = new Set();
    let writes = Promise.resolve();
    function write(task) {
        const result = writes.then(() => {
            if (signal.aborted) throw new Error("Your account session ended.");
            return task();
        });
        writes = result.catch(() => {});
        return result;
    }
    const base = node => node?.closest?.("[data-currency]")?.dataset.currency || preferences.currency;
    const secondary = () => preferences.automatic ? automaticCurrency() : preferences.secondaryCurrency;
    const walletConverted = wallet => {
        try { const saved = localStorage.getItem(`laxis.walletCurrency.${user.uid}.${wallet.id}`); if (saved !== null) return saved === "true"; } catch {}
        return Boolean(wallet.showConverted);
    };
    function notify() { for (const listener of listeners) listener({ ...preferences, loaded, error }); }
    async function update(node) {
        if (signal.aborted || !node.isConnected) return;
        const cents = Number(node.dataset.currencyCents), code = node.dataset.amountCurrency;
        if (!Number.isSafeInteger(cents) || !code) return;
        const current = revision, original = String(cents) + code;
        const main = document.createElement("span"); main.textContent = formatCurrency(cents, code);
        node.replaceChildren(main);
        const wallet = node.closest("[data-shared-currency]");
        const enabled = node.dataset.convertEnabled !== undefined ? node.dataset.convertEnabled === "true"
            : wallet ? wallet.dataset.showConverted === "true" : preferences.showConverted;
        const target = node.dataset.convertTo || (wallet ? preferences.currency : secondary());
        if (!enabled || target === code) return;
        const small = document.createElement("small"); small.className = "currency-equivalent";
        small.textContent = "Converting…"; node.append(small);
        try {
            const rate = await getRate(code, target);
            if (signal.aborted || current !== revision || !small.isConnected || String(node.dataset.currencyCents) + node.dataset.amountCurrency !== original) return;
            small.textContent = "≈ " + formatCurrency(convertCents(cents, rate.rate), target);
            small.title = "Frankfurter · rate date " + rate.date;
        } catch {
            if (!signal.aborted && current === revision && small.isConnected) small.textContent = "Conversion unavailable";
        }
    }
    function refresh() { revision++; document.querySelectorAll("[data-currency-cents]").forEach(update); notify(); }
    const api = {
        base, format: (value, node) => formatCurrency(Math.round(value * 100), typeof node === "string" ? node : base(node)),
        setAmount(node, cents, code = base(node)) {
            if (!node) return;
            if (!Number.isSafeInteger(cents)) {
                delete node.dataset.currencyCents; delete node.dataset.amountCurrency;
                node.textContent = "—"; return node;
            }
            node.dataset.currencyCents = String(cents); node.dataset.amountCurrency = code; update(node);
            if (!node.isConnected) node.textContent = formatCurrency(cents, code);
            return node;
        },
        get: () => ({ ...preferences, loaded, error }), secondary, automaticCurrency: () => automaticCurrency(), currencies: getCurrencies, fallbackCurrencies, walletConverted,
        setWalletConverted(wallet, enabled) {
            try { localStorage.setItem(`laxis.walletCurrency.${user.uid}.${wallet.id}`, String(Boolean(enabled))); } catch {}
        },
        watch(callback) { listeners.add(callback); callback(api.get()); return () => listeners.delete(callback); },
        async save(values) {
            if (!loaded || error) throw new Error("Settings are unavailable. Reload and try again.");
            const saved = await write(() => save({ ...values, theme: preferences.theme }));
            preferences = { ...saved, theme: preferences.theme };
            if (!signal.aborted) { applyTheme(preferences.theme); refresh(); }
            return api.get();
        },
        async saveTheme(value) {
            if (!loaded || error || signal.aborted) throw new Error("Settings are unavailable. Reload and try again.");
            if (!persistTheme) throw new Error("Theme saving is unavailable. Reload and try again.");
            const previous = preferences.theme;
            const theme = value === "dark" ? "dark" : "light";
            preferences = { ...preferences, theme };
            applyTheme(theme); notify();
            try { await write(() => persistTheme(theme)); }
            catch (failure) {
                if (!signal.aborted) { preferences = { ...preferences, theme: previous }; applyTheme(previous); notify(); }
                throw failure;
            }
            return api.get();
        },
        async ensurePrimary() {
            await ready;
            if (signal.aborted) throw new Error("Your account session ended.");
            if (error) throw new Error("Unable to check your currency. Reload and try again.");
            if (!preferences.locked) await api.save(preferences);
            return preferences.currency;
        }, refresh
    };
    window.CurrencyDisplay = api;
    const observer = new MutationObserver(changes => {
        for (const change of changes) for (const node of change.addedNodes) {
            if (node.nodeType !== 1) continue;
            if (node.dataset.currencyCents !== undefined) update(node);
            node.querySelectorAll("[data-currency-cents]").forEach(update);
        }
    });
    observer.observe(document.getElementById("app-shell"), { childList: true, subtree: true });
    const ready = load().then(values => {
        if (signal.aborted) return;
        preferences = values; loaded = true; applyTheme(values.theme); refresh();
    }).catch(() => { if (!signal.aborted) { loaded = true; error = "Unable to load currency settings. Reload to try again."; notify(); } });
    signal.addEventListener("abort", () => { observer.disconnect(); listeners.clear(); if (window.CurrencyDisplay === api) delete window.CurrencyDisplay; }, { once: true });
    return api;
}
