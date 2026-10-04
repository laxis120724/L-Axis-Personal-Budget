import { calendarDueRecords, calendarDateKey, calendarDateLabel, parseCalendarDate, shiftCalendarMonth } from "./calendar-model.js";
import { renderCalendarPreview, renderCalendarMonth, renderCalendarDay } from "./calendar-ui.js";

export function initializeCalendar(header, signal, sources, options = {}) {
    const toggle = header.querySelector("[data-calendar-toggle]");
    const panel = header.querySelector("[data-calendar-panel]");
    if (!toggle || !panel) return;
    const views = new Set();
    let snapshot = { personalItems: [], wallets: [], loading: true, errors: [] };
    let records = [];
    let stop = () => {};
    const now = () => options.now?.() || new Date();
    const active = () => !signal.aborted && header.isConnected;
    const close = () => { panel.hidden = true; toggle.setAttribute("aria-expanded", "false"); };
    const statusText = () => snapshot.errors.length ? "Some due dates could not be loaded. " + snapshot.errors.join(" ")
        : snapshot.loading ? "Loading due dates…" : "";
    function showStatus(node) {
        node.textContent = statusText(); node.hidden = !node.textContent;
        node.dataset.error = String(snapshot.errors.length > 0);
    }
    function open(record) {
        if (!active()) return;
        close();
        for (const view of views) view.dialog.close();
        if (options.onOpen) options.onOpen(record);
        else window.location.hash = record.href;
    }
    function scoped(view) {
        return records.filter(record => view.scope === "all" || (view.scope === "personal" ? !record.walletId : "shared:" + record.walletId === view.scope));
    }
    function renderDay(view) {
        const today = calendarDateKey(now());
        view.root.querySelector("[data-calendar-day-title]").textContent = calendarDateLabel(view.date);
        showStatus(view.root.querySelector("[data-calendar-day-status]"));
        renderCalendarDay(view.root.querySelector("[data-calendar-day-list]"), scoped(view).filter(record => record.date === view.date),
            today, view.signal, open, snapshot.loading ? "Loading due dates…" : "No due dates on this day.");
    }
    function openDay(view, date) {
        if (!parseCalendarDate(date) || view.signal.aborted || !active()) return;
        view.date = date; view.month = date.slice(0, 7); renderPage(view); renderDay(view);
        if (!view.dialog.open) view.dialog.showModal();
        document.documentElement.classList.add("calendar-modal-open");
    }
    function renderPage(view) {
        if (view.signal.aborted || !view.root.isConnected) return;
        const find = selector => view.root.querySelector(selector);
        const today = calendarDateKey(now());
        const wallet = find("[data-calendar-wallet]");
        const choices = [{ value: "all", label: "All wallets" }, { value: "personal", label: "My Money" },
            ...snapshot.wallets.map(item => ({ value: "shared:" + item.id, label: item.name }))];
        if (!choices.some(item => item.value === view.scope)) view.scope = "all";
        wallet.replaceChildren(...choices.map(item => {
            const option = document.createElement("option"); option.setAttribute("value", item.value); option.textContent = item.label; return option;
        }));
        wallet.value = view.scope;
        const items = scoped(view);
        const reliable = !snapshot.loading && !snapshot.errors.length;
        find("[data-calendar-today-count]").textContent = reliable ? String(items.filter(item => item.date === today).length) : "—";
        find("[data-calendar-month-count]").textContent = reliable ? String(items.filter(item => item.date.startsWith(view.month + "-")).length) : "—";
        find("[data-calendar-overdue-count]").textContent = reliable ? String(items.filter(item => item.date < today).length) : "—";
        showStatus(find("[data-calendar-status]"));
        find("[data-calendar-month-label]").textContent = calendarDateLabel(view.month + "-01", { month: "long", year: "numeric" });
        find("[data-calendar-month]").value = view.month;
        find("[data-calendar-date]").value = view.date;
        find("[data-calendar-prev]").disabled = view.month === "1000-01";
        find("[data-calendar-next]").disabled = view.month === "9999-12";
        renderCalendarMonth(find("[data-calendar-grid]"), view.month, items, today, view.date, view.signal, date => openDay(view, date));
        if (view.dialog.open) renderDay(view);
    }
    function render() {
        if (!active()) return;
        const today = calendarDateKey(now());
        const due = records.filter(record => record.date === today);
        header.querySelector("[data-calendar-today-label]").textContent = calendarDateLabel(today, { weekday: "short", month: "short", day: "numeric" });
        const badge = header.querySelector("[data-calendar-count]");
        badge.textContent = due.length > 99 ? "99+" : String(due.length); badge.hidden = !due.length;
        toggle.setAttribute("aria-label", "Open calendar" + (due.length ? ", " + due.length + " due today" : ""));
        showStatus(header.querySelector("[data-calendar-preview-status]"));
        renderCalendarPreview(header.querySelector("[data-calendar-preview-list]"), due, signal, open,
            snapshot.loading ? "Loading due dates…" : "Nothing due today.");
        for (const view of views) renderPage(view);
    }
    function mountPage(root, lifetime) {
        close();
        if (!active() || lifetime.aborted || [...views].some(view => view.root === root && !view.signal.aborted)) return;
        const today = calendarDateKey(now());
        const view = { root, signal: lifetime, scope: "all", month: today.slice(0, 7), date: today,
            dialog: root.querySelector("[data-calendar-dialog]") };
        views.add(view);
        const find = selector => root.querySelector(selector);
        function setMonth(month) {
            if (!parseCalendarDate(month + "-01")) return;
            const currentDay = calendarDateKey(now());
            view.month = month; view.date = month === currentDay.slice(0, 7) ? currentDay : month + "-01"; renderPage(view);
        }
        find("[data-calendar-prev]").addEventListener("click", () => setMonth(shiftCalendarMonth(view.month, -1)), { signal: lifetime });
        find("[data-calendar-next]").addEventListener("click", () => setMonth(shiftCalendarMonth(view.month, 1)), { signal: lifetime });
        find("[data-calendar-today]").addEventListener("click", () => {
            view.date = calendarDateKey(now()); view.month = view.date.slice(0, 7); renderPage(view);
        }, { signal: lifetime });
        find("[data-calendar-month]").addEventListener("change", event => setMonth(event.target.value), { signal: lifetime });
        find("[data-calendar-date]").addEventListener("change", event => openDay(view, event.target.value), { signal: lifetime });
        find("[data-calendar-wallet]").addEventListener("change", event => { view.scope = event.target.value; renderPage(view); }, { signal: lifetime });
        root.querySelectorAll("[data-calendar-close]").forEach(button => button.addEventListener("click", () => view.dialog.close(), { signal: lifetime }));
        view.dialog.addEventListener("close", () => {
            document.documentElement.classList.remove("calendar-modal-open");
            if (!lifetime.aborted) root.querySelector('[data-calendar-day="' + view.date + '"]')?.focus();
        }, { signal: lifetime });
        lifetime.addEventListener("abort", () => {
            views.delete(view); view.dialog.close(); document.documentElement.classList.remove("calendar-modal-open");
        }, { once: true });
        renderPage(view);
    }
    toggle.addEventListener("click", () => {
        panel.hidden = !panel.hidden; toggle.setAttribute("aria-expanded", String(!panel.hidden)); render();
    }, { signal });
    panel.querySelector("[data-calendar-view-all]").addEventListener("click", close, { signal });
    window.addEventListener("click", event => {
        if (!event.composedPath?.().includes(panel) && !event.target.closest(".header__calendar")) close();
    }, { signal });
    window.addEventListener("keydown", event => {
        if (event.key === "Escape" && !panel.hidden) { close(); toggle.focus(); }
    }, { signal });
    Promise.resolve().then(() => active() ? sources.watchMoneySources(data => {
        if (!active()) return;
        snapshot = data; records = calendarDueRecords(data); render();
    }) : () => {}).then(unsubscribe => { if (!active()) unsubscribe(); else stop = unsubscribe; }).catch(error => {
        if (active()) { snapshot = { personalItems: [], wallets: [], loading: false, errors: [error.message] }; records = []; render(); }
    });
    const timer = window.setInterval?.(render, 60000);
    signal.addEventListener("abort", () => {
        stop(); close(); if (timer !== undefined) window.clearInterval(timer);
        for (const view of views) view.dialog.close();
        views.clear(); document.documentElement.classList.remove("calendar-modal-open");
    }, { once: true });
    render();
    return { mountPage };
}
