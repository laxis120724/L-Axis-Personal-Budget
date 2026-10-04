import { getTransactionType } from "../transactions/transaction-model.js";

const plainDashboardFormat = cents => cents === undefined || cents === null ? "—" : (cents / 100)
    .toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dashboardCompact = cents => (cents / 100).toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 });
const node = (tag, className = "", text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
};
const svgNode = (tag, attributes = {}, text) => {
    const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
    if (text !== undefined) element.textContent = text;
    return element;
};
const empty = text => node("p", "dashboard-empty", text);

export function createDashboardRenderer(root) {
    const dashboardFormat = cents => cents === undefined || cents === null ? "—"
        : globalThis.window?.CurrencyDisplay?.format(cents / 100, root) || plainDashboardFormat(cents);
    const moneyNode = (tag, className, cents) => {
        const target = node(tag, className, dashboardFormat(cents));
        if (cents !== undefined && cents !== null) globalThis.window?.CurrencyDisplay?.setAmount(target, cents, globalThis.window?.CurrencyDisplay.base(root));
        return target;
    };
    const find = name => root.querySelector(`[data-dashboard-${name}]`);
    function panel(title, caption, chart) {
        const section = node("section", "dashboard-panel dashboard-chart");
        section.dataset.dashboardChart = chart;
        section.append(node("h3", "", title), node("p", "dashboard-caption", caption));
        return section;
    }
    function legend(rows) {
        const list = node("div", "dashboard-legend");
        rows.forEach(([label, color]) => {
            const item = node("span", "", label);
            item.style.setProperty("--legend-color", color);
            list.append(item);
        });
        return list;
    }
    function stat(key, label, value, caption, symbol, color) {
        const card = node("section", "dashboard-panel dashboard-stat");
        card.dataset.dashboardStat = key;
        card.style.setProperty("--stat-color", color);
        const heading = node("div", "dashboard-stat__heading");
        const icon = node("span", "dashboard-stat__icon", symbol);
        icon.setAttribute("aria-hidden", "true");
        heading.append(node("h2", "", label), icon);
        card.append(heading, moneyNode("strong", "dashboard-stat__value", value));
        if (caption) card.append(node("p", "dashboard-caption", caption));
        return card;
    }
    function renderSummary(model, context) {
        const current = stat("balance", "Current Money", model.cash?.netCents,
            "", "↗", "#0f8b7e");
        current.classList.add("dashboard-current");
        if (model.cash?.netCents < 0) current.dataset.negative = "true";
        const flows = node("div", "dashboard-current__flows");
        for (const [label, value, symbol] of [["Money in", model.cash?.incomeCents, "+"], ["Money out", model.cash?.outgoingCents, "−"]]) {
            const detail = node("div");
            detail.append(node("span", "", label), node("strong", "", symbol + " " + dashboardFormat(value)));
            flows.append(detail);
        }
        current.append(flows);
        const savings = model.categories?.savings;
        const goal = stat("savings", "Savings", savings?.completedCents,
            savings ? `${savings.count} ${savings.count === 1 ? "goal" : "goals"} · ${dashboardFormat(savings.targetCents)} target` : "Goal progress unavailable", "☆", "#6d9640");
        goal.classList.add("dashboard-savings");
        const progress = node("progress", "dashboard-progress");
        progress.max = savings?.targetCents || 1; progress.value = savings?.completedCents || 0;
        progress.setAttribute("aria-label", savings ? `${dashboardFormat(savings.completedCents)} saved of ${dashboardFormat(savings.targetCents)}` : "Savings unavailable");
        if (savings) {
            const percent = savings.targetCents ? savings.completedCents / savings.targetCents * 100 : 0;
            goal.append(progress, node("span", "dashboard-savings__detail", `${percent.toFixed(0)}% saved · ${dashboardFormat(savings.remainingCents)} to go`));
        }
        find("main").replaceChildren(current, goal);
        const categories = model.categories;
        const budget = categories?.budget;
        find("stats").replaceChildren(
            stat("expenses", "Expenses", model.monthly?.expenseCents, "This month · savings excluded", "↘", "#d17645"),
            stat("budget", budget?.remainingCents < 0 ? "Over budget" : "Budget left", budget ? Math.abs(budget.remainingCents) : undefined,
                budget ? `${dashboardFormat(budget.targetCents)} allocated` : "Category totals unavailable", "▤", "#159b90"),
            stat("debt", "Debt remaining", categories?.debt.remainingCents,
                categories ? `${categories.debt.count} ${categories.debt.count === 1 ? "debt" : "debts"}` : "Category totals unavailable", "⇣", "#bf665e"),
            stat("lend", context.shared ? "Loans to receive" : "Lend / loans", categories?.lend.remainingCents,
                "Outstanding repayments", "⇡", "#8270c8"),
            stat("subscriptions", "Subscriptions", categories?.subscriptions.monthlyCents,
                "Estimated per month", "⟳", "#3797b5")
        );
    }

    function renderSpending(model, context) {
        const section = panel("Spending by category", model.month + " · expenses", "spending");
        if (!model.spending) { section.append(empty("Transactions unavailable or loading.")); return section; }
        if (!model.spending.length) { section.append(empty("No expenses this month.")); return section; }
        const body = node("div", "dashboard-spending");
        const ring = node("div", "dashboard-donut");
        let start = 0;
        ring.style.setProperty("--dashboard-ring", "conic-gradient(" + model.spending.map(item => {
            const end = start + item.share;
            const stop = `${item.color} ${start}% ${end}%`; start = end; return stop;
        }).join(",") + ")");
        ring.setAttribute("role", "img");
        ring.setAttribute("aria-label", model.spending.map(item => `${item.label}${context.overall && item.walletLabel ? " (" + item.walletLabel + ")" : ""}: ${dashboardFormat(item.amountCents)}, ${item.share.toFixed(1)}%`).join("; "));
        const center = node("div", "dashboard-donut__center");
        center.append(node("span", "", "This month"), moneyNode("strong", "", model.monthly.expenseCents), node("small", "", "expenses"));
        ring.append(center);
        const list = node("ul", "dashboard-spending__legend");
        for (const row of model.spending) {
            const item = node("li"); item.style.setProperty("--legend-color", row.color);
            const label = node("div", "dashboard-row-label");
            label.append(node("strong", "", row.label));
            if (context.overall && row.walletLabel) label.append(node("small", "", row.walletLabel));
            const amount = node("div", "dashboard-row-amount");
            amount.append(moneyNode("strong", "", row.amountCents), node("small", "", row.share.toFixed(1) + "%"));
            item.append(node("span", "dashboard-dot"), label, amount); list.append(item);
        }
        body.append(ring, list);
        section.append(body);
        return section;
    }

    function renderTrend(model) {
        const section = panel("Income vs expenses", "Last 6 months · income includes repayments", "trend");
        if (!model.months) { section.append(empty("Transactions unavailable or loading.")); return section; }
        if (!model.months.some(month => month.incomeCents || month.expenseCents)) {
            section.append(empty("No income or expenses in the last 6 months.")); return section;
        }
        section.append(legend([["Income / repayments", "#16a394"], ["Expenses", "#ec9866"]]));
        const svg = svgNode("svg", { viewBox: "0 0 550 228", class: "dashboard-line", role: "img", "aria-label": "Monthly income and expenses. Exact amounts are available in Monthly values below." });
        const max = Math.max(...model.months.flatMap(month => [month.incomeCents, month.expenseCents])) * 1.12;
        const left = 52, right = 532, top = 14, bottom = 191;
        const x = index => left + index * (right - left) / 5;
        const y = amount => bottom - amount / max * (bottom - top);
        for (let index = 0; index <= 4; index++) {
            const value = max * index / 4;
            svg.append(svgNode("line", { x1: left, x2: right, y1: y(value), y2: y(value), class: "dashboard-line__grid" }),
                svgNode("text", { x: left - 9, y: y(value) + 4, "text-anchor": "end", class: "dashboard-line__label" }, dashboardCompact(value)));
        }
        model.months.forEach((month, index) => svg.append(svgNode("text", { x: x(index), y: 219, "text-anchor": "middle", class: "dashboard-line__label" }, month.label)));
        for (const [key, color] of [["incomeCents", "#16a394"], ["expenseCents", "#ec9866"]]) {
            const points = model.months.map((month, index) => `${x(index)},${y(month[key])}`).join(" ");
            svg.append(svgNode("polyline", { points, fill: "none", stroke: color, "stroke-width": 3, "stroke-linejoin": "round", "stroke-linecap": "round" }));
            model.months.forEach((month, index) => {
                const circle = svgNode("circle", { cx: x(index), cy: y(month[key]), r: 4, fill: color, stroke: "white", "stroke-width": 2 });
                circle.append(svgNode("title", {}, `${month.fullLabel}: ${dashboardFormat(month[key])} ${key === "incomeCents" ? "income / repayments" : "expenses"}`));
                svg.append(circle);
            });
        }
        section.append(svg);
        const details = node("details", "dashboard-values");
        details.append(node("summary", "", "Monthly values"));
        const table = node("table");
        const head = node("thead"); const header = node("tr");
        for (const label of ["Month", "Income", "Expenses"]) { const th = node("th", "", label); th.setAttribute("scope", "col"); header.append(th); }
        head.append(header); const body = node("tbody");
        for (const month of model.months) {
            const row = node("tr"); const label = node("th", "", month.fullLabel); label.setAttribute("scope", "row");
            row.append(label, node("td", "", dashboardFormat(month.incomeCents)), node("td", "", dashboardFormat(month.expenseCents))); body.append(row);
        }
        table.append(head, body); details.append(table); section.append(details);
        return section;
    }

    function renderBudgets(model, context, variance = false) {
        const section = panel(variance ? "Budget variance" : "Planned vs spent",
            "Current category limits · recorded progress", variance ? "variance" : "planned");
        if (!model.budgets) { section.append(empty("Categories unavailable or loading.")); return section; }
        if (!model.budgets.length) { section.append(empty("No budget categories yet.")); return section; }
        section.append(legend(variance ? [["Under budget", "#16a394"], ["Over budget", "#e68070"]]
            : [["Spent", "#16a394"], ["Remaining", "#dce9e5"], ["Over", "#e68070"]]));
        const list = node("ul", "dashboard-budget-list");
        list.tabIndex = 0;
        list.setAttribute("aria-label", variance ? "Budget differences; scroll for more categories" : "Planned budgets and actual spending; scroll for more categories");
        const max = Math.max(1, ...model.budgets.map(row => variance ? Math.abs(row.varianceCents) : Math.max(row.plannedCents, row.spentCents)));
        for (const row of model.budgets) {
            const item = node("li", "dashboard-budget-row");
            const heading = node("div", "dashboard-budget-row__heading");
            const label = node("div", "dashboard-row-label");
            label.append(node("strong", "", row.label));
            if (context.overall) label.append(node("small", "", row.walletLabel));
            heading.append(label, node("span", "dashboard-budget-row__value", variance
                ? `${dashboardFormat(Math.abs(row.varianceCents))} ${row.varianceCents > 0 ? "over" : row.varianceCents < 0 ? "under" : "on target"}`
                : `${dashboardFormat(row.spentCents)} / ${dashboardFormat(row.plannedCents)}`));
            const track = node("div", variance ? "dashboard-variance-track" : "dashboard-stack");
            track.setAttribute("role", "img");
            track.setAttribute("aria-label", variance ? `${row.label}: ${dashboardFormat(Math.abs(row.varianceCents))} ${row.varianceCents > 0 ? "over budget" : row.varianceCents < 0 ? "under budget" : "on target"}`
                : `${row.label}: ${dashboardFormat(row.plannedCents)} planned, ${dashboardFormat(row.spentCents)} spent, ${dashboardFormat(row.remainingCents)} remaining, ${dashboardFormat(row.overCents)} over`);
            if (variance) {
                const bar = node("span", "dashboard-variance-bar");
                bar.dataset.direction = row.varianceCents > 0 ? "over" : "under";
                bar.style.setProperty("--bar-width", Math.abs(row.varianceCents) / max * 50 + "%");
                track.append(bar);
            } else {
                for (const [kind, amount] of [["spent", Math.min(row.spentCents, row.plannedCents)], ["remaining", row.remainingCents], ["over", row.overCents]]) {
                    const bar = node("span", "dashboard-stack__" + kind);
                    bar.style.setProperty("--bar-width", amount / max * 100 + "%"); track.append(bar);
                }
            }
            item.append(heading, track); list.append(item);
        }
        section.append(list, node("p", "dashboard-chart-note", variance
            ? `${model.overspentCount} ${model.overspentCount === 1 ? "category" : "categories"} over budget · zero is the center line`
            : `Periods may differ · scroll for all ${model.budgets.length} categories`));
        return section;
    }

    function renderLists(model, context) {
        const balances = node("ul", "dashboard-wallet-list");
        for (const wallet of model.balances) {
            const row = node("li");
            const label = node("div", "dashboard-row-label");
            label.append(node("strong", "", wallet.label), node("small", "", wallet.shared ? "Shared Wallet · group balance" : "Personal wallet"));
            const amount = moneyNode("strong", "dashboard-wallet-value", wallet.cash?.netCents);
            if (wallet.cash?.netCents < 0) amount.dataset.negative = "true";
            row.append(label, amount); balances.append(row);
        }
        find("balances").replaceChildren(balances);
        const recent = node("ul", "dashboard-recent");
        for (const record of model.recent || []) {
            const incoming = getTransactionType(record.type)?.direction === "in";
            const row = node("li");
            const icon = node("span", "dashboard-recent__icon", incoming ? "↗" : "↘");
            icon.dataset.direction = incoming ? "in" : "out"; icon.setAttribute("aria-hidden", "true");
            const label = node("div", "dashboard-row-label");
            label.append(node("strong", "", record.itemName || (record.shared && record.type === "income" ? "Contribution / income" : getTransactionType(record.type)?.label || "Transaction")),
                node("small", "", [context.overall ? record.walletLabel : "", record.shared ? record.ownerName : ""].filter(Boolean).join(" · ") || getTransactionType(record.type)?.label || "Transaction"));
            const amount = node("div", "dashboard-row-amount");
            const value = node("strong", "", (incoming ? "+" : "−") + dashboardFormat(record.amountCents));
            value.dataset.direction = incoming ? "in" : "out";
            const date = node("time", "", new Date(record.date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }));
            date.setAttribute("datetime", record.date);
            amount.append(value, date); row.append(icon, label, amount); recent.append(row);
        }
        find("recent").replaceChildren(model.recent?.length ? recent : empty(model.recent ? "No transactions yet." : "Transactions unavailable or loading."));
    }

    return (model, context) => {
        find("scope").textContent = context.shared ? "Shared Wallet · " + context.scope : context.scope;
        find("period").textContent = model.month;
        find("chart-scope").textContent = context.overall ? "Personal + shared wallets" : context.shared ? "Shared Wallet" : "My Money";
        find("status").textContent = context.status; find("status").hidden = !context.status;
        renderSummary(model, context);
        find("charts").replaceChildren(renderSpending(model, context), renderTrend(model), renderBudgets(model, context), renderBudgets(model, context, true));
        renderLists(model, context);
    };
}
