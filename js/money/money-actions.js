import {
    addMoneyItem, updateMoneyItem, deleteMoneyItem, setMoneyAlerts
} from "./money-store.js";

const categories = {
    budget: { label: "budget", amount: "amount" },
    savings: { label: "savings goal", amount: "target", completed: "saved" },
    debt: { label: "debt", amount: "amount", completed: "paid" },
    lend: { label: "lend", amount: "amount", completed: "repaid" },
    subscriptions: { label: "subscription", amount: "amount" }
};

export function initializeMoneyActions(root, kind, signal, {
    addMoneyItem: create = addMoneyItem,
    updateMoneyItem: update = updateMoneyItem,
    deleteMoneyItem: remove = deleteMoneyItem,
    setMoneyAlerts: alerts = setMoneyAlerts,
    canManage = () => true
} = {}) {
    if (!Object.hasOwn(categories, kind)) throw new Error("Unknown money category.");
    const category = categories[kind];
    const dialog = root.querySelector("[data-money-form-dialog]");
    const form = dialog.querySelector("[data-money-form]");
    const submit = form.querySelector('[type="submit"]');
    const title = dialog.querySelector("[data-money-form-title]");
    const description = dialog.querySelector("[data-money-form-description]");
    const formError = dialog.querySelector("[data-money-form-error]");
    const openButton = root.querySelector("[data-open-money-dialog]");
    const deleteDialog = root.querySelector("[data-money-delete-dialog]");
    const deleteForm = deleteDialog.querySelector("[data-money-delete-form]");
    const deleteSubmit = deleteForm.querySelector('[type="submit"]');
    const deleteError = deleteDialog.querySelector("[data-money-delete-error]");
    if (globalThis.window?.CurrencyDisplay) {
        const currencyNote = document.createElement("p"); currencyNote.className = "settings-note";
        currencyNote.textContent = "Amounts in " + globalThis.window?.CurrencyDisplay.base(root);
        form.prepend(currencyNote);
    }
    const createTitle = title.textContent;
    const createDescription = description.textContent;
    const createLabel = submit.textContent.trim();
    const records = new Map();
    const pendingAlerts = new Set();
    let openMenuId = null;
    let editingId = null;
    let deletingId = null;
    let saving = false;
    let deleting = false;

    const active = () => !signal.aborted && root.isConnected;
    const findCard = id => [...root.querySelectorAll("[data-money-id]")]
        .find(card => card.dataset.moneyId === id);
    const showError = (node, text = "") => {
        node.textContent = text;
        node.hidden = !text;
    };
    const lockButtons = (target, locked) => {
        target.querySelectorAll("button").forEach(button => {
            button.disabled = locked;
        });
    };

    function syncMenus() {
        openButton.hidden = !canManage();
        root.querySelectorAll("[data-money-id]").forEach(card => {
            const id = card.dataset.moneyId;
            const opened = canManage() && id === openMenuId;
            card.querySelector(".money-card__menu").hidden = !canManage();
            const favorite = card.querySelector(".money-card__favorite, .budget-card__favorite");
            if (favorite) favorite.hidden = !canManage();
            card.querySelector("[data-money-menu-toggle]")
                .setAttribute("aria-expanded", String(opened));
            card.querySelector("[data-money-menu]").hidden = !opened;
            card.querySelector('[data-money-action="notifications"]')
                .disabled = pendingAlerts.has(id);
        });
    }

    function closeMenu(restoreFocus = false) {
        const trigger = findCard(openMenuId)?.querySelector("[data-money-menu-toggle]");
        openMenuId = null;
        syncMenus();
        if (restoreFocus) trigger?.focus();
    }

    function openForm(item = null) {
        if (saving || !canManage()) return;
        closeMenu();
        form.reset();
        editingId = item?.id || null;
        title.textContent = item ? "Edit " + category.label : createTitle;
        description.textContent = item
            ? "Update the details for this " + category.label + "."
            : createDescription;
        submit.textContent = item ? "Update " + category.label : createLabel;
        dialog.querySelector("[data-close-money]").setAttribute("aria-label",
            (item ? "Close edit " : "Close new ") + category.label);
        showError(formError);
        if (item) {
            const values = {
                ...item.details,
                name: item.name,
                description: item.description || "",
                alerts: item.alerts,
                [category.amount]: (item.amountCents / 100).toFixed(2)
            };
            if (category.completed) {
                values[category.completed] = (item.completedCents / 100).toFixed(2);
            }
            if (kind === "debt") {
                values.payment = item.details.paymentCents == null
                    ? "" : (item.details.paymentCents / 100).toFixed(2);
            }
            for (const control of form.elements) {
                if (!control.name) continue;
                if (control.getAttribute("type") === "checkbox") {
                    control.checked = Boolean(values[control.name]);
                } else {
                    control.value = values[control.name] ?? "";
                }
            }
        }
        dialog.showModal();
        document.documentElement.classList.add("money-modal-open");
    }

    openButton.addEventListener("click", () => openForm(), { signal });
    dialog.querySelectorAll("[data-close-money]").forEach(button => {
        button.addEventListener("click", () => {
            if (!saving) dialog.close();
        }, { signal });
    });
    deleteDialog.querySelectorAll("[data-close-money-delete]").forEach(button => {
        button.addEventListener("click", () => {
            if (!deleting) deleteDialog.close();
        }, { signal });
    });

    for (const target of [dialog, deleteDialog]) {
        target.addEventListener("cancel", event => {
            if (target === dialog ? saving : deleting) event.preventDefault();
        }, { signal });
        target.addEventListener("close", () => {
            document.documentElement.classList.toggle("money-modal-open",
                dialog.open || deleteDialog.open);
            const id = target === dialog ? editingId : deletingId;
            if (target === dialog) editingId = null;
            else deletingId = null;
            if (active()) {
                (findCard(id)?.querySelector("[data-money-menu-toggle]") || openButton)
                    .focus({ preventScroll: true });
            }
        }, { signal });
    }

    form.addEventListener("submit", async event => {
        event.preventDefault();
        if (saving || !canManage() || !form.reportValidity()) return;
        saving = true;
        lockButtons(dialog, true);
        const label = submit.textContent;
        submit.textContent = editingId ? "Updating…" : "Saving…";
        showError(formError);
        try {
            if (editingId) await update(kind, editingId, form);
            else await create(kind, form);
            if (active()) {
                form.reset();
                dialog.close();
            }
        } catch (error) {
            if (active()) showError(formError, "Unable to save " + category.label + ": " + error.message);
        } finally {
            saving = false;
            lockButtons(dialog, false);
            submit.textContent = label;
        }
    }, { signal });

    deleteForm.addEventListener("submit", async event => {
        event.preventDefault();
        if (deleting || !deletingId || !canManage()) return;
        deleting = true;
        lockButtons(deleteDialog, true);
        deleteSubmit.textContent = "Deleting…";
        showError(deleteError);
        try {
            await remove(deletingId);
            if (active()) deleteDialog.close();
        } catch (error) {
            if (active()) showError(deleteError, "Unable to delete " + category.label + ": " + error.message);
        } finally {
            deleting = false;
            lockButtons(deleteDialog, false);
            deleteSubmit.textContent = "Confirm delete";
        }
    }, { signal });

    root.addEventListener("click", async event => {
        if (!canManage()) return;
        const trigger = event.target.closest("[data-money-menu-toggle]");
        if (trigger) {
            const id = trigger.closest("[data-money-id]").dataset.moneyId;
            openMenuId = openMenuId === id ? null : id;
            showError(trigger.closest("[data-money-id]").querySelector("[data-money-menu-error]"));
            syncMenus();
            return;
        }
        const button = event.target.closest("[data-money-action]");
        if (!button || button.disabled) return;
        const id = button.closest("[data-money-id]").dataset.moneyId;
        const item = records.get(id);
        if (!item) return;
        const action = button.dataset.moneyAction;
        if (action === "edit") {
            openForm(item);
        } else if (action === "delete") {
            closeMenu();
            deletingId = id;
            deleteDialog.querySelector("[data-money-delete-name]").textContent = item.name;
            showError(deleteError);
            deleteDialog.showModal();
            document.documentElement.classList.add("money-modal-open");
        } else if (action === "notifications" && !pendingAlerts.has(id)) {
            pendingAlerts.add(id);
            button.disabled = true;
            showError(button.closest("[data-money-menu]").querySelector("[data-money-menu-error]"));
            try {
                await alerts(id, !item.alerts);
            } catch (error) {
                if (active()) {
                    const message = findCard(id)?.querySelector("[data-money-menu-error]");
                    if (message) showError(message, "Unable to change notifications: " + error.message);
                }
            } finally {
                pendingAlerts.delete(id);
                if (active()) {
                    syncMenus();
                    if (openMenuId === id) findCard(id)
                        ?.querySelector('[data-money-action="notifications"]').focus();
                }
            }
        }
    }, { signal });

    document.addEventListener("click", event => {
        if (!event.target.closest(".money-card__menu")) closeMenu();
    }, { signal });
    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && openMenuId) {
            event.preventDefault();
            closeMenu(true);
        }
    }, { signal });

    // Keep actions tied to the latest saved records after cards are rendered again.
    return (items, focusedElement) => {
        if (!active()) return;
        records.clear();
        (items || []).filter(item => item.kind === kind)
            .forEach(item => records.set(item.id, item));
        if (!records.has(openMenuId)) openMenuId = null;
        syncMenus();
        const previousMenu = focusedElement?.closest(".money-card__menu");
        if (openMenuId && previousMenu?.closest("[data-money-id]")?.dataset.moneyId === openMenuId) {
            const action = focusedElement.closest("[data-money-action]")?.dataset.moneyAction;
            const selector = action ? `[data-money-action="${action}"]` : "[data-money-menu-toggle]";
            findCard(openMenuId)?.querySelector(selector)?.focus({ preventScroll: true });
        }
    };
}
