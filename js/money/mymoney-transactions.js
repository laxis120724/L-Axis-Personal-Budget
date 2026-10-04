import { getTransactionType, summarizeTransactions } from "../transactions/transaction-model.js";

const monthKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
const monthLabel = date => date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
const plainFormat = cents => (cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2, maximumFractionDigits: 2
});
const createdTime = record => record.createdAt?.toMillis?.()
    ?? (record.createdAt instanceof Date ? record.createdAt.getTime()
        : (record.createdAt?.seconds || 0) * 1000 + (record.createdAt?.nanoseconds || 0) / 1e6);

// Category targets describe a plan. These totals use only recorded money movements.
export function buildTransactionOverview(records, now = new Date()) {
    const currentMonth = monthKey(now);
    const current = records.filter(record => record.date.startsWith(currentMonth + "-"));
    const months = Array.from({ length: 6 }, (_, index) => {
        const date = new Date(now.getFullYear(), now.getMonth() - 5 + index, 1);
        const key = monthKey(date);
        const summary = summarizeTransactions(records.filter(record => record.date.startsWith(key + "-")));
        return { key, label: date.toLocaleDateString("en-US", { month: "short" }),
            fullLabel: monthLabel(date), incomeCents: summary.incomeCents, outgoingCents: summary.outgoingCents };
    });
    const summary = summarizeTransactions(current);
    const amounts = new Map();
    current.forEach(record => {
        if (getTransactionType(record.type)?.direction === "out") {
            amounts.set(record.type, (amounts.get(record.type) || 0) + record.amountCents);
        }
    });
    const allocation = [...amounts].map(([type, amountCents]) => ({
        type, label: getTransactionType(type).label, color: getTransactionType(type).color || "#c95336",
        amountCents, share: amountCents / summary.outgoingCents * 100
    })).sort((a, b) => b.amountCents - a.amountCents);
    return { month: monthLabel(now), monthCount: current.length, summary, months, allocation,
        recent: [...records].sort((a, b) => b.date.localeCompare(a.date)
            || createdTime(b) - createdTime(a) || String(a.id).localeCompare(String(b.id))).slice(0, 5) };
}

export function initializeMoneyOverviewTransactions(root, signal, { watchTransactions }, { shared = false } = {}) {
    const format = cents => globalThis.window?.CurrencyDisplay?.format(cents / 100, root) || plainFormat(cents);
    const amountNode = cents => {
        const target = element("strong", "", format(cents));
        globalThis.window?.CurrencyDisplay?.setAmount(target, cents, globalThis.window?.CurrencyDisplay.base(root)); return target;
    };
    const find = selector => root.querySelector(selector);
    const active = () => !signal.aborted && root.isConnected;
    let unsubscribe = () => {};
    const typeLabel = type => (shared ? { income: "Income / contribution", savings: "Goal deposit", lend: "Loan repayment" }[type] : undefined)
        || getTransactionType(type)?.label || "Transaction";
    const element = (tag, className, text) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    };
    const panel = (title, subtitle, kind) => {
        const node = element("section", "overview-chart overview-chart--" + kind);
        node.dataset.overviewChart = kind;
        node.append(element("h3", "", title), element("p", "", subtitle));
        return node;
    };
    const empty = text => element("p", "overview-empty", text);

    function renderSummary(model) {
        const cards = [
            ["Money in", model?.summary.incomeCents, "#0f9d92", "↗"],
            ["Money out", model?.summary.outgoingCents, "#c95336", "↘"],
            ["Net cash flow", model?.summary.netCents, model?.summary.netCents < 0 ? "#c95336" : "#8057c7", "⇄"],
            ["Transactions", model?.monthCount, "#14869e", "≡"]
        ].map(([label, value, color, symbol]) => {
            const card = element("div", "overview-stat");
            card.style.setProperty("--category-color", color);
            const heading = element("div", "overview-stat__heading");
            const icon = element("span", "overview-stat__icon", symbol);
            icon.setAttribute("aria-hidden", "true");
            heading.append(element("span", "", label), icon);
            card.append(heading, element("strong", "", value === undefined ? "—"
                : label === "Transactions" ? String(value) : format(value)));
            if (value !== undefined && label !== "Transactions") globalThis.window?.CurrencyDisplay?.setAmount(card.querySelector("strong"), value, globalThis.window?.CurrencyDisplay.base(root));
            return card;
        });
        find("[data-overview-summary]").replaceChildren(...cards);
    }

    function renderCharts(model, message) {
        const flow = panel(shared ? "Wallet cash flow" : "Cash flow", "Last 6 months", "cashflow");
        const outgoing = panel("Money out", model?.month || monthLabel(new Date()), "outgoing");
        if (!model) {
            flow.append(empty(message)); outgoing.append(empty(message));
        } else {
            if (model.months.some(month => month.incomeCents || month.outgoingCents)) {
                const legend = element("div", "overview-flow-legend");
                legend.append(element("span", "overview-flow-legend__in", "Money in"),
                    element("span", "overview-flow-legend__out", "Money out"));
                const bars = element("div", "overview-flow");
                const maximum = Math.max(...model.months.flatMap(month => [month.incomeCents, month.outgoingCents]));
                for (const month of model.months) {
                    const group = element("div", "overview-flow__month");
                    const pair = element("div", "overview-flow__pair");
                    pair.setAttribute("role", "img");
                    pair.setAttribute("aria-label", `${month.fullLabel}: ${format(month.incomeCents)} in, ${format(month.outgoingCents)} out`);
                    for (const [kind, value] of [["in", month.incomeCents], ["out", month.outgoingCents]]) {
                        const bar = element("span", "overview-flow__bar overview-flow__bar--" + kind);
                        bar.style.setProperty("--bar-height", value / maximum * 100 + "%");
                        bar.title = `${month.fullLabel}: ${format(value)} ${kind}`;
                        pair.append(bar);
                    }
                    group.append(pair, element("span", "overview-flow__label", month.label));
                    bars.append(group);
                }
                flow.append(legend, bars);
            } else flow.append(empty("No transactions in the last 6 months."));

            if (model.allocation.length) {
                const ring = element("div", "overview-donut");
                let start = 0;
                const stops = model.allocation.map(item => {
                    const end = start + item.share;
                    const stop = `${item.color} ${start}% ${end}%`;
                    start = end;
                    return stop;
                });
                ring.style.setProperty("--overview-ring", `conic-gradient(${stops.join(", ")})`);
                ring.setAttribute("role", "img");
                ring.setAttribute("aria-label", model.allocation.map(item => `${typeLabel(item.type)}: ${format(item.amountCents)}, ${item.share.toFixed(1)}%`).join("; "));
                const center = element("div", "overview-donut__center");
                center.append(amountNode(model.summary.outgoingCents), element("span", "", "total out"));
                ring.append(center);
                const legend = element("ul", "overview-chart__legend");
                for (const item of model.allocation) {
                    const row = element("li"); row.style.setProperty("--legend-color", item.color);
                    row.append(element("span", "", typeLabel(item.type)), amountNode(item.amountCents));
                    legend.append(row);
                }
                const body = element("div", "overview-chart__body");
                body.append(ring, legend); outgoing.append(body);
            } else outgoing.append(empty("No outgoing transactions this month."));
        }
        find("[data-overview-charts]").replaceChildren(flow, outgoing);
    }

    function renderRecent(model, message) {
        const list = element("ul", "overview-transactions");
        for (const record of model?.recent || []) {
            const type = getTransactionType(record.type);
            const incoming = type?.direction === "in";
            const row = element("li", "overview-transaction");
            row.dataset.transactionId = record.id;
            const icon = element("span", "overview-transaction__icon", incoming ? "↗" : "↘");
            icon.style.setProperty("--transaction-color", type?.color || "#c95336");
            icon.setAttribute("aria-hidden", "true");
            const details = element("div", "overview-transaction__details");
            const detail = shared ? (record.ownerName || "Member")
                + (record.itemName ? " · " + typeLabel(record.type) : record.description ? " · " + record.description : "")
                : record.itemName ? typeLabel(record.type) : record.description || typeLabel(record.type);
            details.append(element("strong", "", record.itemName || typeLabel(record.type)), element("span", "", detail));
            const amount = element("div", "overview-transaction__amount");
            amount.dataset.direction = incoming ? "in" : "out";
            const date = element("time", "", new Date(record.date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }));
            date.setAttribute("datetime", record.date);
            amount.append(element("strong", "", (incoming ? "+" : "−") + format(record.amountCents)), date);
            globalThis.window?.CurrencyDisplay?.setAmount(amount.querySelector("strong"), (incoming ? 1 : -1) * record.amountCents, globalThis.window?.CurrencyDisplay.base(root));
            row.append(icon, details, amount); list.append(row);
        }
        find("[data-overview-recent]").replaceChildren(model?.recent.length ? list
            : empty(model ? "No transactions yet." : message));
    }

    function render(records, error = "") {
        if (!active()) return;
        const model = records === null ? null : buildTransactionOverview(records);
        const message = error || "Loading transactions…";
        const status = find("[data-overview-transaction-status]");
        status.hidden = records !== null;
        status.textContent = message;
        find("[data-overview-month]").textContent = model?.month || monthLabel(new Date());
        renderSummary(model); renderCharts(model, error ? "Transactions unavailable." : message); renderRecent(model, message);
    }

    render(null);
    signal.addEventListener("abort", () => unsubscribe(), { once: true });
    // Late subscriptions and snapshots must stop when the user changes page or account.
    async function subscribe() {
        try {
            const stop = await watchTransactions(records => render(records),
                error => render(null, "Unable to load transactions: " + error.message));
            if (!active()) stop();
            else unsubscribe = stop;
        } catch (error) { render(null, "Unable to load transactions: " + error.message); }
    }
    subscribe();
}
