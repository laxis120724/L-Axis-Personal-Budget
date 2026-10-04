import { calendarAmount, calendarDateLabel, calendarMonthDays } from "./calendar-model.js";

const calendarNode = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

export function renderCalendarPreview(container, records, signal, onOpen, emptyMessage) {
    const rows = records.map(record => {
        const link = calendarNode("a", "calendar-due-preview");
        link.setAttribute("href", record.href); link.dataset.kind = record.kind;
        const text = calendarNode("div");
        text.append(calendarNode("strong", "", record.name), calendarNode("span", "", record.categoryLabel + " · " + record.walletName));
        const amount = calendarNode("div", "calendar-due-preview__amount");
        amount.append(calendarNode("strong", "", calendarAmount(record.amountCents)), calendarNode("span", "", record.amountLabel));
        if (record.walletId) { link.dataset.sharedCurrency = "true"; link.dataset.showConverted = String(record.showConverted); }
        globalThis.window?.CurrencyDisplay?.setAmount(amount.querySelector("strong"), record.amountCents, record.currency || globalThis.window?.CurrencyDisplay?.get().currency);
        link.append(text, amount);
        link.addEventListener("click", event => { event.preventDefault(); onOpen(record); }, { signal });
        return link;
    });
    container.replaceChildren(...(rows.length ? rows : [calendarNode("p", "calendar-empty", emptyMessage)]));
}

export function renderCalendarMonth(container, month, records, today, selected, signal, onDay) {
    const byDay = new Map();
    for (const record of records) {
        if (!byDay.has(record.date)) byDay.set(record.date, []);
        byDay.get(record.date).push(record);
    }
    const cells = calendarMonthDays(month).map(day => {
        const due = byDay.get(day.date) || [];
        const cell = calendarNode("button", "calendar-day");
        cell.setAttribute("type", "button"); cell.dataset.calendarDay = day.date;
        cell.disabled = !calendarDateLabel(day.date);
        cell.dataset.outside = String(!day.inMonth);
        cell.dataset.selected = String(day.date === selected);
        cell.setAttribute("aria-pressed", String(day.date === selected));
        cell.setAttribute("aria-label", calendarDateLabel(day.date) + (day.date === today ? ", today" : "")
            + ", " + due.length + " due " + (due.length === 1 ? "item" : "items"));
        if (day.date === today) cell.setAttribute("aria-current", "date");
        const number = calendarNode("span", "calendar-day__number", String(day.day));
        cell.append(number);
        if (due.length) {
            const entries = calendarNode("span", "calendar-day__entries");
            for (const record of due.slice(0, 2)) {
                const entry = calendarNode("span", "calendar-day__entry", record.name);
                entry.dataset.kind = record.kind; entries.append(entry);
            }
            if (due.length > 2) entries.append(calendarNode("span", "calendar-day__more", "+" + (due.length - 2) + " more"));
            const count = calendarNode("span", "calendar-day__count", String(due.length));
            count.setAttribute("aria-hidden", "true");
            cell.append(entries, count);
        }
        cell.addEventListener("click", () => onDay(day.date), { signal });
        return cell;
    });
    container.replaceChildren(...cells);
}

export function renderCalendarDay(container, records, today, signal, onOpen, emptyMessage) {
    const cycles = { weekly: "Weekly", monthly: "Monthly", quarterly: "Every 3 months", yearly: "Yearly" };
    const cards = records.map(record => {
        const card = calendarNode("article", "calendar-detail-card"); card.dataset.kind = record.kind;
        if (record.walletId) { card.dataset.sharedCurrency = "true"; card.dataset.showConverted = String(record.showConverted); }
        const heading = calendarNode("div", "calendar-detail-card__heading");
        const title = calendarNode("div");
        title.append(calendarNode("span", "calendar-detail-card__category", record.categoryLabel + " · " + record.walletName),
            calendarNode("h3", "", record.name));
        const status = calendarNode("span", "calendar-detail-card__status", record.date < today ? "Overdue" : record.date === today ? "Due today" : "Upcoming");
        status.dataset.overdue = String(record.date < today); heading.append(title, status);
        const fields = calendarNode("dl", "calendar-detail-fields");
        const field = (name, value) => {
            const pair = calendarNode("div"); pair.append(calendarNode("dt", "", name), calendarNode("dd", "", value)); fields.append(pair);
        };
        const moneyField = (name, value) => {
            field(name, calendarAmount(value));
            globalThis.window?.CurrencyDisplay?.setAmount(fields.lastElementChild.querySelector("dd"), value, record.currency || globalThis.window?.CurrencyDisplay?.get().currency);
        };
        field(record.kind === "savings" ? "Target date" : "Due date", calendarDateLabel(record.date, { month: "short", day: "numeric", year: "numeric" }));
        moneyField(record.amountLabel, record.amountCents);
        if (record.kind !== "subscriptions") {
            moneyField(record.kind === "savings" ? "Goal target" : "Original amount", record.totalCents);
            moneyField({ savings: "Saved", debt: "Paid", lend: "Repaid" }[record.kind], record.completedCents);
        }
        if (record.details.creditor) field("Creditor", record.details.creditor);
        if (record.details.borrower) field("Borrower", record.details.borrower);
        if (record.kind === "subscriptions") {
            if (cycles[record.details.cycle]) field("Billing cycle", cycles[record.details.cycle]);
            field("Renewal", record.details.autoRenew ? "Automatic" : "Manual");
        }
        card.append(heading, fields);
        if (record.description) card.append(calendarNode("p", "calendar-detail-card__note", record.description));
        const link = calendarNode("a", "calendar-detail-link", "Go to " + record.categoryLabel + " →");
        link.setAttribute("href", record.href);
        link.addEventListener("click", event => { event.preventDefault(); onOpen(record); }, { signal });
        card.append(link); return card;
    });
    container.replaceChildren(...(cards.length ? cards : [calendarNode("p", "calendar-empty", emptyMessage)]));
}
