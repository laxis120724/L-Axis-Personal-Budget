import {
    transactionTypes, getTransactionType, filterTransactions, paginateTransactions, summarizeTransactions
} from "./transaction-model.js";
import { initializeTransactionCurrency } from "../currency/currency-form.js";

const format = (cents, grouped = true) => {
    const digits = String(Math.abs(cents)).padStart(3, "0");
    const whole = digits.slice(0, -2);
    const fraction = digits.slice(-2);
    return (cents < 0 ? "-" : "")
        + (grouped ? Number(whole).toLocaleString("en-US") : whole) + "." + fraction;
};
const itemLabels = {
    budget: "budget", savings: "savings goal", debt: "debt",
    lend: "lend", subscriptions: "subscription"
};

function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
}

function today() {
    const date = new Date();
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")].join("-");
}

export function initializeTransactions(root, signal, services, options = {}) {
    const find = selector => root.querySelector(selector);
    const dialog = find("[data-transaction-dialog]");
    const form = find("[data-transaction-form]");
    const submit = form.querySelector('[type="submit"]');
    const type = form.elements.namedItem("type");
    const itemSelect = find("[data-transaction-item]");
    const amount = form.elements.namedItem("amount");
    const deleteDialog = find("[data-transaction-delete-dialog]");
    const deleteForm = find("[data-transaction-delete-form]");
    const deleteSubmit = deleteForm.querySelector('[type="submit"]');
    const openButton = find("[data-open-transaction]");
    const rows = find("[data-transaction-rows]");
    const search = find("[data-transaction-search]");
    const typeFilter = find("[data-transaction-type-filter]");
    const from = find("[data-transaction-from]");
    const to = find("[data-transaction-to]");
    const sort = find("[data-transaction-sort]");
    const memberFilter = find("[data-transaction-member-filter]");
    const ownerSelect = find("[data-transaction-owner]");
    const canEdit = record => !options.canEdit || options.canEdit(record);
    const canCreate = () => !options.canCreate || options.canCreate();
    const availableItems = () => options.filterItems ? options.filterItems(moneyItems || []) : moneyItems || [];
    const labelFor = value => options.typeLabel?.(value) || getTransactionType(value).label;
    const currency = () => globalThis.window?.CurrencyDisplay?.base(root) || "AED";
    const currencyForm = typeof initializeTransactionCurrency === "function"
        ? initializeTransactionCurrency(form, signal, currency, options.shared) : null;
    const money = (target, cents) => {
        if (globalThis.window?.CurrencyDisplay) globalThis.window?.CurrencyDisplay.setAmount(target, cents, currency());
        else target.textContent = format(cents);
    };
    let transactions = null;
    let moneyItems = null;
    let transactionError = "";
    let moneyError = "";
    let page = 1;
    let editingId = null;
    let deletingId = null;
    let saving = false;
    let deleting = false;
    let opener = openButton;
    const active = () => !signal.aborted && root.isConnected;
    const currentRecord = id => transactions?.find(record => record.id === id);
    const feedback = (selector, message = "") => {
        const target = find(selector);
        target.textContent = message;
        target.hidden = !message;
    };

    function row(record) {
        const config = getTransactionType(record.type);
        const tr = node("tr");
        tr.dataset.transactionId = record.id;
        const dateCell = node("td");
        const time = node("time", new Date(record.date + "T12:00:00").toLocaleDateString("en-US", {
            day: "numeric", month: "short", year: "numeric"
        }));
        time.dateTime = record.date;
        dateCell.append(time);
        const typeCell = node("td");
        typeCell.append(node("span", labelFor(record.type),
            "transaction-type transaction-type--" + (config.direction === "in" ? "income" : "outgoing")));
        const itemCell = node("td");
        itemCell.append(node("span", record.itemName || "General", "transaction-table__name"));
        const descriptionCell = node("td");
        descriptionCell.append(node("span", record.description || "—", "transaction-table__description"));
        descriptionCell.title = record.description || "";
        const income = node("td", config.direction === "in" ? format(record.amountCents) : "—",
            "transaction-amount" + (config.direction === "in" ? " transaction-amount--income" : ""));
        const outgoing = node("td", config.direction === "out" ? format(record.amountCents) : "—",
            "transaction-amount" + (config.direction === "out" ? " transaction-amount--outgoing" : ""));
        money(config.direction === "in" ? income : outgoing, record.amountCents);
        const actions = node("td");
        const buttons = node("div", undefined, "transaction-row-actions");
        for (const action of canEdit(record) ? ["edit", "delete"] : []) {
            const label = action === "edit" ? "Edit" : "Delete";
            const button = node("button", label,
                "transaction-action" + (action === "delete" ? " transaction-action--delete" : ""));
            button.type = "button";
            button.dataset.transactionAction = action;
            button.setAttribute("aria-label", `${label} ${record.itemName || config.label} on ${record.date}`);
            buttons.append(button);
        }
        actions.append(buttons);
        tr.append(dateCell, typeCell, itemCell, descriptionCell, income, outgoing, actions);
        if (options.shared) tr.insertBefore(node("td", record.ownerName || "Member", "transaction-member"), typeCell);
        return tr;
    }

    function emptyRow(message) {
        const tr = node("tr");
        const td = node("td", message, "transaction-empty-row");
        td.colSpan = options.shared ? 8 : 7;
        tr.append(td);
        return tr;
    }

    function render() {
        if (!active()) return;
        const previousAction = document.activeElement?.closest("[data-transaction-action]");
        const previousId = previousAction?.closest("[data-transaction-id]")?.dataset.transactionId;
        const invalidRange = from.value && to.value && from.value > to.value;
        const filtered = transactions === null || invalidRange ? [] : filterTransactions(transactions.filter(record =>
            !memberFilter || memberFilter.value === "all" || record.ownerUid === memberFilter.value), {
            search: search.value, type: typeFilter.value, from: from.value, to: to.value, sort: sort.value
        });
        const summary = summarizeTransactions(filtered, moneyItems || []);
        for (const [selector, value] of [
            ["[data-transaction-income]", summary.incomeCents],
            ["[data-transaction-outgoing]", summary.outgoingCents],
            ["[data-transaction-net]", summary.netCents]
        ]) {
            find(selector).textContent = transactions === null ? "—" : format(value);
            if (transactions !== null) money(find(selector), value);
            else { delete find(selector).dataset.currencyCents; delete find(selector).dataset.amountCurrency; }
        }
        find("[data-transaction-budget]").textContent = moneyItems === null ? "—" : format(summary.budgetAvailableCents);
        if (moneyItems !== null) money(find("[data-transaction-budget]"), summary.budgetAvailableCents);
        else { delete find("[data-transaction-budget]").dataset.currencyCents; delete find("[data-transaction-budget]").dataset.amountCurrency; }
        const allocationBar = find("[data-transaction-allocation-bar]");
        const legend = find("[data-transaction-allocation-legend]");
        allocationBar.replaceChildren();
        legend.replaceChildren();
        for (const part of summary.allocation) {
            const segment = node("span");
            segment.style.setProperty("--share", part.share + "%");
            segment.style.setProperty("--segment", part.color);
            allocationBar.append(segment);
            const entry = node("li");
            entry.style.setProperty("--segment", part.color);
            entry.append(node("span", options.typeLabel?.(part.type) || part.label), node("strong", format(part.amountCents)));
            money(entry.querySelector("strong"), part.amountCents);
            legend.append(entry);
        }
        allocationBar.hidden = legend.hidden = !summary.allocation.length;
        allocationBar.setAttribute("aria-label", summary.allocation.map(part =>
            `${options.typeLabel?.(part.type) || part.label}: ${format(part.amountCents)}, ${part.share.toFixed(1)}%`).join("; ") || "No category payments");
        const allocationEmpty = find("[data-transaction-allocation-empty]");
        allocationEmpty.hidden = Boolean(summary.allocation.length);
        allocationEmpty.textContent = transactions === null
            ? "Your allocation will appear when transactions load."
            : "No category payments in this view.";
        const result = paginateTransactions(filtered, page, 50);
        page = result.page;
        const message = transactions === null ? transactionError || "Loading transactions…"
            : invalidRange ? "Choose a start date before the end date."
            : transactions.length ? "No transactions match your filters." : "No transactions yet. Add your first transaction.";
        rows.replaceChildren(...(result.items.length ? result.items.map(row) : [emptyRow(message)]));
        find("[data-transaction-range]").textContent = transactions === null
            ? (transactionError ? "Transactions unavailable" : "Loading…")
            : `${result.start}–${result.end} of ${result.total} transactions`;
        find("[data-transaction-page]").textContent = `Page ${result.page} of ${result.pages}`;
        find("[data-transaction-prev]").disabled = transactions === null || result.page === 1;
        find("[data-transaction-next]").disabled = transactions === null || result.page === result.pages;
        openButton.disabled = transactions === null || !canCreate();
        feedback("[data-transaction-status]", transactionError || (invalidRange
            ? "The start date must be before the end date." : moneyError));
        if (previousId) {
            const replacement = [...rows.querySelectorAll("[data-transaction-id]")]
                .find(element => element.dataset.transactionId === previousId);
            replacement?.querySelector(`[data-transaction-action="${previousAction.dataset.transactionAction}"]`)
                ?.focus({ preventScroll: true });
        }
    }

    function syncItemField(selectedId = itemSelect.value) {
        const config = transactionTypes[type.value];
        const linked = Boolean(config?.moneyKind);
        find("[data-transaction-item-field]").hidden = !linked;
        itemSelect.required = linked;
        itemSelect.disabled = !linked || saving;
        itemSelect.setCustomValidity("");
        itemSelect.replaceChildren();
        const matches = availableItems().filter(item => item.kind === config?.moneyKind);
        const placeholder = node("option", linked ? "Choose a " + itemLabels[config.moneyKind] : "Not required");
        placeholder.value = "";
        itemSelect.append(placeholder);
        for (const item of matches) {
            const option = node("option", item.name);
            option.value = item.id;
            itemSelect.append(option);
        }
        const editing = currentRecord(editingId);
        if (selectedId && !matches.some(item => item.id === selectedId)
            && editing?.itemId === selectedId && editing.type === type.value) {
            const removed = node("option", (editing.itemName || "Previous item") + " (removed)");
            removed.value = selectedId;
            itemSelect.append(removed);
            itemSelect.setCustomValidity("This item was removed. Choose another item.");
        }
        itemSelect.value = [...itemSelect.options].some(option => option.value === selectedId) ? selectedId : "";
        submit.disabled = saving || (linked && !matches.length);
        updateHint();
    }

    function updateHint() {
        const config = transactionTypes[type.value];
        const item = moneyItems?.find(record => record.id === itemSelect.value);
        itemSelect.setCustomValidity(itemSelect.value && !item ? "Choose an existing category item." : "");
        const hint = find("[data-transaction-form-hint]");
        if (!config) {
            hint.textContent = "Choose a transaction type to update this record.";
        } else if (!config.moneyKind) {
            hint.textContent = options.shared ? "Records income or a contribution to this shared wallet."
                : "Records income without changing a My Money card.";
        } else if (moneyItems === null) {
            hint.textContent = moneyError || "Loading your category items…";
        } else if (!availableItems().some(record => record.kind === config.moneyKind)) {
            hint.textContent = options.shared ? "No available categories. Ask the Creator or Admin to create or assign one."
                : "Create a " + itemLabels[config.moneyKind] + " in My Money first.";
        } else if (config.progress) {
            const available = item ? format(item.amountCents - item.completedCents) : null;
            hint.textContent = config.moneyKind === "budget"
                ? "Adds to this budget’s spending." + (available ? " Currently available: " + available + "." : "")
                : "Updates the saved or repaid amount on the selected card." + (available ? " Remaining: " + available + "." : "");
        } else {
            hint.textContent = "Records this subscription payment. Its recurring price stays the same.";
        }
    }

    function openForm(record = null) {
        if (saving || (record ? !canEdit(record) : !canCreate())) return;
        form.reset();
        editingId = record?.id || null;
        type.value = record ? (Object.hasOwn(transactionTypes, record.type) ? record.type : "") : "income";
        amount.value = record ? format(record.amountCents, false) : "";
        form.elements.namedItem("date").value = record?.date || today();
        form.elements.namedItem("description").value = record?.description || "";
        find("[data-transaction-form-title]").textContent = record ? "Edit transaction" : "Add transaction";
        submit.textContent = record ? "Update transaction" : "Save transaction";
        feedback("[data-transaction-form-error]");
        if (ownerSelect) { ownerSelect.value = record?.ownerUid || options.userId; syncOwnerField(record); }
        syncItemField(record?.itemId || "");
        currencyForm?.open(record);
        dialog.showModal();
        document.documentElement.classList.add("money-modal-open");
    }

    function closeModal(target) {
        target.close();
        document.documentElement.classList.toggle("money-modal-open", dialog.open || deleteDialog.open);
    }

    function lockForm(locked) {
        form.querySelectorAll("input, select, textarea, button").forEach(control => { control.disabled = locked; });
        dialog.querySelectorAll("[data-close-transaction]").forEach(button => { button.disabled = locked; });
        if (!locked) { syncItemField(); if (ownerSelect) syncOwnerField(currentRecord(editingId)); }
    }

    function syncOwnerField(record = null) {
        const selected = record?.ownerUid || ownerSelect.value || options.userId;
        ownerSelect.replaceChildren();
        const members = options.members?.() || [];
        for (const member of members) {
            const option = node("option", member.displayName || member.name || member.email || "Member");
            option.value = member.uid || member.id;
            ownerSelect.append(option);
        }
        if (record && !members.some(member => (member.uid || member.id) === record.ownerUid)) {
            const option = node("option", record.ownerName + " (former member)");
            option.value = record.ownerUid;
            ownerSelect.append(option);
        }
        ownerSelect.value = [...ownerSelect.options].some(option => option.value === selected) ? selected : options.userId;
        ownerSelect.disabled = saving || Boolean(record) || !options.canChooseOwner?.();
        ownerSelect.closest(".money-field").hidden = !options.canChooseOwner?.();
    }

    function syncMemberFilter() {
        if (!memberFilter) return;
        const selected = memberFilter.value || "all";
        const members = new Map((options.members?.() || []).map(member =>
            [member.uid || member.id, member.displayName || member.name || member.email || "Member"]));
        for (const record of transactions || []) if (!members.has(record.ownerUid)) members.set(record.ownerUid, record.ownerName || "Former member");
        const all = node("option", "All members"); all.value = "all";
        memberFilter.replaceChildren(all);
        for (const [uid, name] of members) {
            const option = node("option", name); option.value = uid; memberFilter.append(option);
        }
        memberFilter.value = selected === "all" || members.has(selected) ? selected : "all";
    }

    openButton.addEventListener("click", () => { opener = openButton; openForm(); }, { signal });
    type.addEventListener("change", () => syncItemField(""), { signal });
    itemSelect.addEventListener("change", updateHint, { signal });
    find(".transaction-filters").addEventListener("submit", event => event.preventDefault(), { signal });
    for (const control of [search, typeFilter, from, to, sort, memberFilter].filter(Boolean)) {
        control.addEventListener(control === search ? "input" : "change", () => {
            page = 1;
            render();
            rows.closest("table").parentElement.scrollTop = 0;
        }, { signal });
    }
    find("[data-transaction-reset]").addEventListener("click", () => {
        search.value = from.value = to.value = "";
        typeFilter.value = "all";
        sort.value = "newest";
        page = 1;
        if (memberFilter) memberFilter.value = "all";
        render();
    }, { signal });
    for (const [selector, step] of [["[data-transaction-prev]", -1], ["[data-transaction-next]", 1]]) {
        find(selector).addEventListener("click", () => {
            page += step;
            render();
            rows.closest("table").parentElement.scrollTop = 0;
        }, { signal });
    }
    dialog.querySelectorAll("[data-close-transaction]").forEach(button => {
        button.addEventListener("click", () => { if (!saving) closeModal(dialog); }, { signal });
    });
    deleteDialog.querySelectorAll("[data-close-transaction-delete]").forEach(button => {
        button.addEventListener("click", () => { if (!deleting) closeModal(deleteDialog); }, { signal });
    });
    for (const target of [dialog, deleteDialog]) {
        target.addEventListener("cancel", event => {
            if (target === dialog ? saving : deleting) event.preventDefault();
            else document.documentElement.classList.remove("money-modal-open");
        }, { signal });
        target.addEventListener("close", () => {
            document.documentElement.classList.toggle("money-modal-open", dialog.open || deleteDialog.open);
            if (active()) (opener?.isConnected ? opener : openButton).focus({ preventScroll: true });
        }, { signal });
    }

    form.addEventListener("submit", async event => {
        event.preventDefault();
        if (saving || (editingId ? !canEdit(currentRecord(editingId)) : !canCreate()) || !form.reportValidity()) return;
        // Capture enabled controls before locking them; disabled fields are omitted by FormData.
        const data = new FormData(form);
        saving = true;
        const label = submit.textContent;
        lockForm(true);
        submit.textContent = editingId ? "Updating…" : "Saving…";
        feedback("[data-transaction-form-error]");
        try {
            if (editingId) await services.updateTransaction(editingId, data);
            else await services.addTransaction(data);
            if (active()) closeModal(dialog);
        } catch (error) {
            if (active()) feedback("[data-transaction-form-error]", "Unable to save: " + error.message);
        } finally {
            saving = false;
            lockForm(false);
            submit.textContent = label;
        }
    }, { signal });

    deleteForm.addEventListener("submit", async event => {
        event.preventDefault();
        if (deleting || !deletingId || !canEdit(currentRecord(deletingId))) return;
        deleting = true;
        deleteDialog.querySelectorAll("button").forEach(button => { button.disabled = true; });
        deleteSubmit.textContent = "Deleting…";
        feedback("[data-transaction-delete-error]");
        try {
            await services.deleteTransaction(deletingId);
            if (active()) closeModal(deleteDialog);
        } catch (error) {
            if (active()) feedback("[data-transaction-delete-error]", "Unable to delete: " + error.message);
        } finally {
            deleting = false;
            deleteDialog.querySelectorAll("button").forEach(button => { button.disabled = false; });
            deleteSubmit.textContent = "Confirm delete";
        }
    }, { signal });

    rows.addEventListener("click", event => {
        const button = event.target.closest("[data-transaction-action]");
        if (!button) return;
        const record = currentRecord(button.closest("[data-transaction-id]").dataset.transactionId);
        if (!record || !canEdit(record)) return;
        opener = button;
        if (button.dataset.transactionAction === "edit") openForm(record);
        else {
            deletingId = record.id;
            find("[data-transaction-delete-name]").textContent = `${record.itemName || getTransactionType(record.type).label} (${format(record.amountCents)})`;
            feedback("[data-transaction-delete-error]");
            deleteDialog.showModal();
            document.documentElement.classList.add("money-modal-open");
        }
    }, { signal });

    async function observe(loader, onChange, onError) {
        try {
            const stop = await loader(onChange, onError);
            if (signal.aborted) stop();
            else signal.addEventListener("abort", stop, { once: true });
        } catch (error) { onError(error); }
    }
    render();
    observe(services.watchTransactions, records => {
        if (!active()) return;
        transactions = records;
        transactionError = "";
        syncMemberFilter();
        render();
    }, error => {
        if (!active()) return;
        transactions = null;
        transactionError = "Unable to load transactions: " + error.message;
        render();
    });
    observe(services.watchMoneyItems, records => {
        if (!active()) return;
        moneyItems = records;
        moneyError = "";
        render();
        if (dialog.open && !saving) syncItemField();
    }, error => {
        if (!active()) return;
        moneyItems = null;
        moneyError = "Category balances are unavailable: " + error.message;
        render();
        if (dialog.open && !saving) syncItemField();
    });

    return { refreshAccess() {
        if (!active()) return;
        syncMemberFilter();
        render();
        if (dialog.open && !saving) {
            if (editingId ? !canEdit(currentRecord(editingId)) : !canCreate()) closeModal(dialog);
            else { syncItemField(); if (ownerSelect) syncOwnerField(currentRecord(editingId)); }
        }
        if (deleteDialog.open && !deleting && !canEdit(currentRecord(deletingId))) closeModal(deleteDialog);
    } };
}
