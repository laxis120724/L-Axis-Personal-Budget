import { buildDashboardModel } from "./dashboard-model.js";
import { createDashboardRenderer } from "./dashboard-ui.js";
import { convertDashboardSources } from "../currency/currency-dashboard.js";

// Listeners belong to this page and the selected scope, including setup promises
// that finish after a wallet is deselected, membership is removed, or logout occurs.
export function initializeDashboard(root, signal, services) {
    const renderView = createDashboardRenderer(root);
    const picker = root.querySelector("[data-dashboard-wallet]");
    const sources = new Map();
    let selection = "overall";
    let wallets = null;
    let walletsError = "";
    let stopWallets = () => {};
    const active = () => !signal.aborted && root.isConnected;
    let renderRevision = 0;

    function render() {
        if (!active()) return;
        const revision = ++renderRevision;
        const scopeSources = [...sources.values()];
        const personalCurrency = globalThis.window?.CurrencyDisplay?.get().currency || "AED";
        const currency = selection.startsWith("shared:") ? scopeSources[0]?.currency || "AED" : personalCurrency;
        root.dataset.currency = currency;
        const membershipReady = selection !== "overall" || Array.isArray(wallets);
        const scope = selection === "overall" ? "Overall wallets"
            : selection === "personal" ? "My Money" : scopeSources[0]?.label || "Shared Wallet";
        const errors = scopeSources.flatMap(source => [source.transactionsError, source.itemsError]).filter(Boolean);
        if (selection === "overall" && walletsError) errors.unshift(walletsError);
        const finish = (converted, conversionStatus = "") => {
            if (!active() || revision !== renderRevision) return;
            const model = buildDashboardModel(converted, { membershipReady });
            renderView(model, { scope: scope + " · " + currency, overall: selection === "overall", shared: selection.startsWith("shared:"),
            status: conversionStatus || (errors.length ? "Some records are unavailable. Choose a wallet or reload to try again."
                : !model.cash || !model.categories ? "Loading wallet records…" : "") });
        };
        if (scopeSources.some(source => (source.currency || "AED") !== currency) && typeof convertDashboardSources === "function") {
            finish(scopeSources.map(source => ({ ...source, items: null, transactions: null })), "Converting wallet balances…");
            convertDashboardSources(scopeSources, currency).then(converted => finish(converted)).catch(() =>
                finish(scopeSources.map(source => ({ ...source, items: null, transactions: null })), "Conversion unavailable. Select one wallet to see its original balances."));
        } else finish(scopeSources);
    }

    function subscribe(source, field, watch) {
        let stop = () => {};
        source.controller.signal.addEventListener("abort", () => stop(), { once: true });
        const current = () => active() && !source.controller.signal.aborted && sources.get(source.key) === source;
        const fail = error => {
            if (!current()) return;
            source[field] = null;
            source[field + "Error"] = error.message || "Unable to load records.";
            render();
        };
        Promise.resolve().then(() => {
            if (!current()) return () => {};
            return watch(records => {
                if (!current()) return;
                source[field] = records;
                source[field + "Error"] = "";
                render();
            }, fail);
        }).then(unsubscribe => {
            if (!current()) unsubscribe();
            else stop = unsubscribe;
        }).catch(fail);
    }

    function reconcile() {
        if (!active()) return;
        const desired = selection === "overall"
            ? [{ key: "personal", label: "My Money", shared: false, currency: globalThis.window?.CurrencyDisplay?.get().currency || "AED" }, ...(wallets || []).map(wallet => ({
                key: "shared:" + wallet.id, label: wallet.name, shared: true, walletId: wallet.id, currency: wallet.currency || "AED" }))]
            : selection === "personal" ? [{ key: "personal", label: "My Money", shared: false, currency: globalThis.window?.CurrencyDisplay?.get().currency || "AED" }]
                : (wallets || []).filter(wallet => "shared:" + wallet.id === selection).map(wallet => ({
                    key: "shared:" + wallet.id, label: wallet.name, shared: true, walletId: wallet.id, currency: wallet.currency || "AED" }));
        for (const [key, source] of sources) {
            if (desired.some(wallet => wallet.key === key)) continue;
            source.controller.abort();
            sources.delete(key);
        }
        for (const wallet of desired) {
            if (sources.has(wallet.key)) { Object.assign(sources.get(wallet.key), { label: wallet.label, currency: wallet.currency }); continue; }
            const source = { ...wallet, controller: new AbortController(), transactions: null, items: null };
            sources.set(wallet.key, source);
            subscribe(source, "transactions", (change, error) => wallet.shared
                ? services.watchSharedTransactions(wallet.walletId, change, error) : services.watchTransactions(change, error));
            subscribe(source, "items", (change, error) => wallet.shared
                ? services.watchSharedMoneyItems(wallet.walletId, change, error) : services.watchMoneyItems(change, error));
        }
        render();
    }

    function updatePicker() {
        const options = [["overall", "Overall wallets"], ["personal", "My Money"],
            ...(wallets || []).map(wallet => ["shared:" + wallet.id, "Shared Wallet · " + wallet.name])];
        picker.replaceChildren(...options.map(([value, label]) => {
            const option = document.createElement("option");
            option.value = value; option.textContent = label;
            return option;
        }));
        picker.value = selection;
    }
    picker.addEventListener("change", () => {
        const requested = picker.value;
        if (!["overall", "personal"].includes(requested)
            && !(wallets || []).some(wallet => "shared:" + wallet.id === requested)) return;
        selection = requested;
        reconcile();
    }, { signal });
    signal.addEventListener("abort", () => {
        stopWallets();
        for (const source of sources.values()) source.controller.abort();
        sources.clear();
    }, { once: true });
    reconcile();
    const failWallets = error => {
        if (!active()) return;
        wallets = null; walletsError = error.message || "Unable to load wallets.";
        // A failed membership feed must not retain financial data from old memberships.
        if (selection.startsWith("shared:")) selection = "overall";
        updatePicker(); reconcile();
    };
    Promise.resolve().then(() => active() ? services.watchSharedWallets(records => {
        if (!active()) return;
        wallets = [...records].sort((a, b) => a.name.localeCompare(b.name)); walletsError = "";
        if (selection.startsWith("shared:") && !wallets.some(wallet => "shared:" + wallet.id === selection)) selection = "personal";
        updatePicker(); reconcile();
    }, failWallets) : () => {}).then(stop => {
        if (!active()) stop();
        else stopWallets = stop;
    }).catch(failWallets);
}
