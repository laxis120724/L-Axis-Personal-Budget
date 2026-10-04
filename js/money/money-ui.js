const format = value => Number(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
});

const colors = [
    "#0f9d92", "#8057c7", "#ef9b49", "#5c8f19", "#14869e"
];

const periods = {
    weekly: "Weekly",
    monthly: "Monthly",
    yearly: "Yearly"
};

const cycles = {
    weekly: "/ week",
    monthly: "/ month",
    quarterly: "/ 3 months",
    yearly: "/ year"
};

const labels = {
    budget: ["Limit", "spent", "left", "Starts", "startDate"],
    savings: ["Target amount", "saved", "to reach your goal", "Target", "targetDate"],
    debt: ["Original amount", "paid", "still owed", "Due", "due"],
    lend: ["Amount lent", "repaid", "still to receive", "Due", "due"]
};

function element(tag, text) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
}

function emptyMessage(text, className = "money-empty") {
    const node = element("p", text);
    node.className = className;
    node.setAttribute("role", "status");
    return node;
}

function time(value) {
    const node = element("time");
    const date = new Date(value + "T12:00:00");

    node.textContent = value && !Number.isNaN(date.getTime())
        ? date.toLocaleDateString("en-US", {
            day: "numeric", month: "short", year: "numeric"
        })
        : "—";

    if (value) node.dateTime = value;
    return node;
}

export function createMoneyRenderer(root, kind) {
    const amount = (target, value) => {
        if (globalThis.window?.CurrencyDisplay) globalThis.window?.CurrencyDisplay.setAmount(target, Math.round(value * 100), globalThis.window?.CurrencyDisplay.base(root));
        else target.textContent = format(value);
    };
    const prefix = kind === "budget" ? "budget" : "money";
    const grid = root.querySelector(`.${prefix}-grid`);
    const template = root.querySelector("[data-money-card-template]")
        .content.querySelector(`.${prefix}-card`);
    const stats = [...root.querySelectorAll(`.${prefix}-stat > strong`)];
    const bar = root.querySelector(`.${prefix}-allocation__bar`);
    const legend = root.querySelector(`.${prefix}-allocation__legend`);
    const allocationStatus = emptyMessage("", "money-empty money-empty--allocation");
    root.querySelector(`.${prefix}-allocation`).append(allocationStatus);

    function card(item) {
        const node = template.cloneNode(true);
        const details = item.details;

        const put = (selector, text) => {
            const target = node.querySelector(selector);
            if (target) target.textContent = text;
        };

        node.dataset.moneyId = item.id;
        put("h2", item.name);
        put(`.${prefix}-card__description`,
            item.description || "No description.");

        const actions = node.querySelector(`.${prefix}-card__actions`);
        const favorite = actions.querySelector(`.${prefix}-card__favorite`);

        favorite.setAttribute("aria-pressed", String(item.favorite));
        favorite.setAttribute("aria-label", "Favorite " + item.name);
        favorite.title = item.favorite
            ? "Remove from favorites" : "Add to favorites";
        favorite.querySelector("span").textContent = item.favorite ? "★" : "☆";

        const menuToggle = actions.querySelector("[data-money-menu-toggle]");
        menuToggle.setAttribute("aria-label", "More options for " + item.name);
        const menu = actions.querySelector("[data-money-menu]");
        menu.id = "money-menu-" + kind + "-" + item.id;
        menuToggle.setAttribute("aria-controls", menu.id);
        menu.querySelector('[data-money-action="notifications"]')
            .setAttribute("aria-checked", String(item.alerts));
        menu.querySelector("[data-money-notification-state]")
            .textContent = item.alerts ? "On" : "Off";

        const alert = node.querySelector(`.${prefix}-alert`);
        alert.textContent = item.alerts ? "Alerts on" : "Alerts off";
        alert.classList.toggle(`${prefix}-alert--off`, !item.alerts);

        const footer = node.querySelector(`.${prefix}-card__footer > span`);
        const person = node.querySelector(".money-card__person");

        if (person) {
            const personName = kind === "debt" ? details.creditor
                : kind === "lend" ? details.borrower : details.category;

            person.replaceChildren(
                kind === "debt" ? "Creditor: "
                    : kind === "lend" ? "Borrower: " : "",
                element("strong", personName || "")
            );

            person.hidden = !personName;
        }

        if (kind === "subscriptions") {
            node.dataset.billingCycle = item.cycle;
            amount(node.querySelector(".subscription-card__price strong"), item.amount);
            put(".subscription-card__price > span", cycles[item.cycle]);

            const values = node.querySelectorAll(".subscription-card__details dd");
            values[0].replaceChildren(time(details.nextPaymentDate));
            amount(values[1], item.total);
            values[2].textContent = details.autoRenew ? "Automatic" : "Manual";
            footer.textContent = "Active";
        } else {
            const [limit, done, left, dateLabel, dateKey] = labels[kind];

            put(`.${prefix}-card__limit > span`, limit);
            amount(node.querySelector(`.${prefix}-card__limit strong`), item.total);
            put(`.${prefix}-card__progress-label > span`,
                `${format(item.completed)} ${done}`);
            put(`.${prefix}-card__progress-label > strong`,
                `${(item.completed / item.total * 100).toFixed(0)}%`);

            const progress = node.querySelector("progress");
            progress.max = item.total > 0 ? item.total : 1;
            progress.value = item.completed;
            progress.setAttribute("aria-label", `${item.name}: ${done}`);

            const remaining = item.total - item.completed;
            node.querySelector(`.${prefix}-card__remaining`).replaceChildren(
                element("strong", format(Math.abs(remaining))),
                remaining < 0 ? " over budget" : " " + left
            );

            amount(node.querySelector(`.${prefix}-card__remaining strong`), Math.abs(remaining));
            footer.replaceChildren(
                (kind === "budget" ? periods[details.period] + " · " : "")
                    + dateLabel + " ",
                time(details[dateKey])
            );

            const warning = kind === "budget"
                && item.completed >= item.total * 0.8;

            node.classList.toggle(`${prefix}-card--warning`, warning);
            alert.classList.toggle(`${prefix}-alert--warning`,
                warning && item.alerts);

            if (warning && item.alerts) alert.textContent = "⚠ Near limit";
        }

        return node;
    }

    return (records, error = "") => {
        bar.replaceChildren();
        legend.replaceChildren();

        if (records === null) {
            stats.forEach(node => {
                delete node.dataset.currencyCents; delete node.dataset.amountCurrency; node.textContent = "—";
            });
            grid.replaceChildren(emptyMessage(error || "Loading your items…"));
            bar.hidden = true;
            legend.hidden = true;
            allocationStatus.hidden = false;
            allocationStatus.textContent = error
                ? "Allocation unavailable." : "Loading your allocation…";
            bar.setAttribute("aria-label", "Allocation unavailable");
            return;
        }

        const items = records.filter(item => item.kind === kind);
        const total = items.reduce((sum, item) => sum + item.total, 0);
        const done = items.reduce((sum, item) => sum + item.completed, 0);

        let values = [
            String(items.length),
            format(total),
            format(done),
            format(total - done)
        ];

        if (kind === "subscriptions") {
            const next = items.map(item => item.details.nextPaymentDate)
                .filter(Boolean).sort()[0];

            values = [
                String(items.length),
                format(total),
                format(total * 12),
                next ? time(next) : "—"
            ];
        }

        stats.forEach((node, index) => {
            node.replaceChildren(values[index]);
            if (index > 0 && !(kind === "subscriptions" && index === 3)) amount(node,
                kind === "subscriptions" ? (index === 1 ? total : total * 12) : [items.length, total, done, total - done][index]);
        });

        grid.replaceChildren(...(items.length
            ? items.map(card)
            : [emptyMessage("No items yet. Use the New button to create one.")]));

        bar.hidden = !items.length;
        legend.hidden = !items.length;
        allocationStatus.hidden = Boolean(items.length);
        allocationStatus.textContent = "No allocation yet.";

        const descriptions = [];

        items.forEach((item, index) => {
            const share = total > 0 ? item.total / total * 100 : 0;
            const color = colors[index % colors.length];

            const segment = element("span");
            segment.style.setProperty("--share", share + "%");
            segment.style.setProperty("--segment", color);
            bar.append(segment);

            const entry = element("li");
            entry.style.setProperty("--segment", color);
            entry.append(
                element("span", item.name),
                element("strong", format(item.total))
            );
            amount(entry.querySelector("strong"), item.total);
            legend.append(entry);

            descriptions.push(`${item.name} ${share.toFixed(1)}%`);
        });

        bar.setAttribute("aria-label",
            descriptions.join(", ") || "No allocation yet");
    };
}
