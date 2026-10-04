import { invitationNotifications, moneyAlertNotifications, walletActivityNotifications, sortNotifications, createNotificationReadState } from "./notifications-model.js";
import { renderNotificationList } from "./notification-ui.js";

export function initializeSharedWalletNotifications(header, signal, user, services, onAccepted = () => {}, options = {}) {
    const toggle = header.querySelector("[data-invitations-toggle]");
    const panel = header.querySelector("[data-invitations-panel]");
    if (!toggle || !panel) return;
    const count = header.querySelector("[data-invitations-count]");
    const views = new Set();
    const feeds = new Map();
    const errors = new Map();
    const pending = new Set();
    const resolved = new Map();
    const alertTimes = new Map();
    const moneyObservers = new Set();
    let moneySnapshot;
    let storage;
    try { storage = options.storage ?? window.localStorage; } catch { /* Read status can work in memory. */ }
    const readState = createNotificationReadState(user?.uid || "", storage);
    let invitations = [];
    let invitationLoading = true;
    let personalItems = [];
    let walletLoading = Boolean(services.watchSharedWallets);
    let message = "", messageError = false;
    const active = () => !signal.aborted && header.isConnected;
    const close = () => { panel.hidden = true; toggle.setAttribute("aria-expanded", "false"); };
    const feedback = (text, error = false) => { message = text; messageError = error; render(); };

    function subscribe(key, method, onChange, parent = signal) {
        const controller = new AbortController();
        const entry = { controller, stop: () => {}, loading: true };
        feeds.set(key, entry);
        const current = () => active() && !controller.signal.aborted && feeds.get(key) === entry;
        const release = () => controller.abort();
        parent.addEventListener("abort", release, { once: true });
        controller.signal.addEventListener("abort", () => {
            entry.stop();
            parent.removeEventListener("abort", release);
        }, { once: true });
        const fail = error => {
            if (!current()) return;
            errors.set(key, "Unable to load " + key.split(":")[0] + ": " + error.message);
            entry.loading = false;
            onChange(null);
            render();
        };
        Promise.resolve().then(() => current() ? method(records => {
            if (!current()) return;
            entry.loading = false; errors.delete(key); onChange(records); render();
        }, fail) : () => {}).then(stop => {
            if (!current()) stop(); else entry.stop = stop;
        }).catch(fail);
        return entry;
    }
    const wallets = new Map();
    // Calendar and notifications share the same saved categories and listeners.
    function publishMoneySources() {
        const snapshot = {
            personalItems,
            wallets: [...wallets.values()].map(wallet => ({ id: wallet.id, name: wallet.name, items: wallet.items,
                currency: wallet.currency || "AED", showConverted: globalThis.window?.CurrencyDisplay?.walletConverted(wallet) ?? Boolean(wallet.showConverted) })),
            loading: walletLoading || [...feeds.entries()].some(([key, feed]) =>
                (key === "personal alerts" || key.startsWith("wallet alerts:")) && feed.loading),
            errors: [...errors.entries()].filter(([key]) => key === "wallets" || key === "personal alerts" || key.startsWith("wallet alerts:"))
                .map(([, message]) => message)
        };
        if (moneySnapshot && moneySnapshot.personalItems === snapshot.personalItems
            && moneySnapshot.loading === snapshot.loading && moneySnapshot.errors.join("\n") === snapshot.errors.join("\n")
            && moneySnapshot.wallets.length === snapshot.wallets.length
            && moneySnapshot.wallets.every((wallet, index) => wallet.id === snapshot.wallets[index].id
                && wallet.name === snapshot.wallets[index].name && wallet.items === snapshot.wallets[index].items
                && wallet.currency === snapshot.wallets[index].currency && wallet.showConverted === snapshot.wallets[index].showConverted)) return;
        moneySnapshot = snapshot;
        for (const observer of moneyObservers) observer(snapshot);
    }
    function recordList() {
        const records = invitationNotifications(invitations.map(invitation => resolved.has(invitation.id)
            ? { ...invitation, status: resolved.get(invitation.id) } : invitation));
        const alerts = moneyAlertNotifications(personalItems);
        for (const wallet of wallets.values()) {
            alerts.push(...moneyAlertNotifications(wallet.items, { walletId: wallet.id, walletName: wallet.name, currency: wallet.currency || "AED" }));
            records.push(...walletActivityNotifications(wallet.activity, wallet));
        }
        for (const alert of alerts) {
            if (!alertTimes.has(alert.id)) alertTimes.set(alert.id, alert.created);
            records.push({ ...alert, created: alertTimes.get(alert.id) });
        }
        return sortNotifications(records, readState.ids);
    }
    function mark(record, read) {
        if (!active()) return;
        readState.mark([record], read); render();
    }
    function open(record) {
        if (!active()) return;
        mark(record, true); close();
        if (options.onOpen) options.onOpen(record);
        else {
            if (record.walletId) onAccepted(record.walletId);
            if (window.location) window.location.hash = record.href;
        }
    }
    async function respond(record, accept) {
        const invitation = record.invitation;
        if (!active() || pending.has(invitation.id) || resolved.has(invitation.id)) return;
        pending.add(invitation.id); feedback("");
        try {
            const result = await services.respondSharedWalletInvitation(invitation.id, accept);
            if (!active()) return;
            resolved.set(invitation.id, accept ? "accepted" : "declined");
            readState.mark([record]);
            feedback(accept ? "Invitation accepted." : "Invitation declined.");
            if (accept) { close(); onAccepted(result.walletId); }
        } catch (error) { if (active()) feedback(error.message, true); }
        finally { pending.delete(invitation.id); if (active()) render(); }
    }
    function render() {
        if (!active()) return;
        publishMoneySources();
        const records = recordList();
        const unread = records.filter(record => !record.read).length;
        count.textContent = unread > 99 ? "99+" : String(unread); count.hidden = !unread;
        toggle.setAttribute("aria-label", "Open notifications" + (unread ? ", " + unread + " unread" : ""));
        for (const view of views) {
            if (view.signal.aborted || !view.root.isConnected) continue;
            const find = selector => view.root.querySelector(selector);
            const loading = invitationLoading || walletLoading || [...feeds.values()].some(feed => feed.loading);
            const rows = view.all ? records.filter(record => view.filter !== "unread" || !record.read) : records.slice(0, 5);
            renderNotificationList(find("[data-invitations-list]"), rows, {
                signal: view.signal, pending, onRead: mark, onOpen: open, onRespond: respond,
                emptyMessage: loading ? "Loading notifications…" : view.filter === "unread" ? "No unread notifications." : "No notifications yet."
            });
            const status = find("[data-invitations-status]");
            const text = message || [...errors.values()].join(" ");
            status.textContent = text; status.hidden = !text; status.dataset.error = String(messageError || errors.size > 0);
            const markAll = find("[data-notifications-read-all]");
            if (markAll) markAll.disabled = !unread;
            const total = find("[data-notifications-total]");
            if (total) total.textContent = records.length + " total · " + unread + " unread";
            view.root.querySelectorAll("[data-notifications-filter]").forEach(button => {
                button.setAttribute("aria-pressed", String(button.dataset.notificationsFilter === view.filter));
            });
        }
    }
    function mount(root, lifetime, all) {
        if (!active() || lifetime.aborted || [...views].some(view => view.root === root && !view.signal.aborted)) return;
        const view = { root, signal: lifetime, all, filter: "all" };
        views.add(view);
        root.querySelector("[data-notifications-read-all]")?.addEventListener("click", () => {
            if (!active()) return;
            readState.mark(recordList()); render();
        }, { signal: lifetime });
        root.querySelectorAll("[data-notifications-filter]").forEach(button => button.addEventListener("click", () => {
            view.filter = button.dataset.notificationsFilter; render();
        }, { signal: lifetime }));
        lifetime.addEventListener("abort", () => views.delete(view), { once: true });
        render();
    }
    mount(panel, signal, false);
    toggle.addEventListener("click", () => {
        panel.hidden = !panel.hidden; toggle.setAttribute("aria-expanded", String(!panel.hidden));
    }, { signal });
    panel.querySelector("[data-notifications-view-all]")?.addEventListener("click", close, { signal });
    window.addEventListener("click", event => {
        // Read actions replace a card before this click bubbles to window.
        // The original event path still identifies it as a click inside the panel.
        if (!event.composedPath?.().includes(panel) && !event.target.closest(".header__invitations")) close();
    }, { signal });
    window.addEventListener("keydown", event => {
        if (event.key === "Escape" && !panel.hidden) { close(); toggle.focus(); }
    }, { signal });
    window.addEventListener("storage", event => {
        if (event.key === readState.key && active()) { readState.refresh(); render(); }
    }, { signal });
    subscribe("invitations", (change, error) => (services.watchNotificationInvitations || services.watchSharedWalletInvitations)(change, error), records => {
        invitations = records || []; invitationLoading = false;
    });
    if (services.watchNotificationMoneyItems) subscribe("personal alerts", services.watchNotificationMoneyItems, records => { personalItems = records || []; });
    if (services.watchSharedWallets) subscribe("wallets", services.watchSharedWallets, records => {
        walletLoading = false;
        const updated = records || [];
        for (const [id, wallet] of wallets) if (!updated.some(next => next.id === id)) {
            wallet.controller.abort(); wallets.delete(id);
            for (const key of ["wallet activity:" + id, "wallet alerts:" + id]) {
                feeds.delete(key); errors.delete(key);
            }
        }
        for (const data of updated) {
            if (wallets.has(data.id)) { Object.assign(wallets.get(data.id), { name: data.name, currency: data.currency, showConverted: data.showConverted }); continue; }
            const wallet = { ...data, items: [], activity: [], controller: new AbortController() };
            wallets.set(data.id, wallet);
            if (services.watchNotificationSharedMoneyItems) subscribe("wallet alerts:" + data.id,
                (change, error) => services.watchNotificationSharedMoneyItems(data.id, change, error),
                items => { wallet.items = items || []; }, wallet.controller.signal);
            if (services.watchNotificationActivity) subscribe("wallet activity:" + data.id,
                (change, error) => services.watchNotificationActivity(data.id, change, error),
                activity => { wallet.activity = activity || []; }, wallet.controller.signal);
        }
    });
    // Due-date reminders change with the calendar, even without a new snapshot.
    const timer = window.setInterval?.(() => { if (active()) render(); }, 60000);
    signal.addEventListener("abort", () => {
        for (const entry of feeds.values()) entry.controller.abort();
        for (const wallet of wallets.values()) wallet.controller.abort();
        if (timer !== undefined) window.clearInterval(timer);
        views.clear(); close();
        moneyObservers.clear();
    }, { once: true });
    return {
        mountPage(root, lifetime) { close(); mount(root, lifetime, true); },
        watchMoneySources(onChange) {
            if (!active()) return () => {};
            moneyObservers.add(onChange);
            if (moneySnapshot) onChange(moneySnapshot);
            return () => moneyObservers.delete(onChange);
        }
    };
}
