import { createMoneyRenderer } from "../money/money-ui.js";
import { initializeMoneyActions } from "../money/money-actions.js";

const kinds = { budget: "budget", goals: "savings", debt: "debt", loans: "lend", subscriptions: "subscriptions" };

// The same card templates serve personal and shared pages. Services supplied
// here always include the selected wallet ID and never write personal data.
export function createSharedMoneyView(root, signal, { section, services }) {
    const container = root.querySelector("[data-shared-money-container]");
    const pageActions = root.querySelector("[data-shared-wallet-page-actions]");
    const kind = kinds[section];
    if (!kind || !container) return null;
    container.hidden = false;
    let wallet, records = null, error = "", current;
    const active = () => !signal.aborted && root.isConnected;
    const response = fetch("pages/" + kind + ".html", { signal }).then(async result => {
        if (!result.ok) throw new Error("Unable to open this category page. Refresh and try again.");
        return result.text();
    });
    // A page may be cancelled before a wallet is selected.
    response.catch(() => {});

    function dispose() {
        current?.page?.querySelectorAll("dialog[open]").forEach(dialog => dialog.close());
        current?.lifetime.abort();
        if (current?.action && pageActions.contains(current.action)) pageActions.replaceChildren();
        current = undefined;
        document.documentElement.classList.toggle("money-modal-open", Boolean(document.querySelector("dialog[open]")));
    }

    function render() {
        if (!current?.render || !active()) return;
        const focus = document.activeElement;
        current.render(records, error);
        current.actions(records, focus);
        const canManage = ["creator", "admin"].includes(wallet?.role);
        if (records && !records.some(item => item.kind === kind)) {
            current.page.querySelector(".budget-grid .money-empty, .money-grid .money-empty").textContent = canManage
                ? "No shared categories yet. Use the New button to create one." : "No shared categories yet.";
        }
        if (!canManage) current.page.querySelectorAll("dialog[open]").forEach(dialog => dialog.close());
        current.page.querySelectorAll(".money-card__favorite, .budget-card__favorite").forEach(button => {
            button.disabled = current.pendingFavorites.has(button.closest("[data-money-id]").dataset.moneyId);
        });
    }

    async function setWallet(next) {
        if (!active()) return;
        if (wallet?.id === next?.id && current) { wallet = next; render(); return; }
        dispose();
        wallet = next;
        records = null;
        error = "";
        container.replaceChildren();
        if (!wallet) return;
        const lifetime = new AbortController();
        const view = { lifetime, pendingFavorites: new Set() };
        current = view;
        const walletId = wallet.id;
        try {
            const html = await response;
            if (!active() || lifetime.signal.aborted || current !== view) return;
            container.innerHTML = html;
            const page = container.firstElementChild;
            view.page = page;
            // The shared page provides the title and its action row.
            const heading = page.querySelector(".budget-heading, .money-heading");
            view.action = heading.querySelector("[data-open-money-dialog]");
            heading.replaceChildren(view.action);
            page.setAttribute("aria-labelledby", "shared-wallet-title");
            const status = document.createElement("p");
            status.className = "money-form__error";
            status.hidden = true;
            status.setAttribute("role", "alert");
            page.append(status);
            const form = page.querySelector("[data-money-form]");
            // Existing progress belongs to recorded transactions. Keep these
            // fields hidden and zero for new categories; edits retain progress.
            const completed = form.elements.namedItem({ savings: "saved", debt: "paid", lend: "repaid" }[kind]);
            if (completed) {
                completed.value = "0";
                completed.defaultValue = "0";
                completed.setAttribute("value", "0");
                completed.closest(".money-field").hidden = true;
            }
            const canManage = () => wallet?.id === walletId && ["creator", "admin"].includes(wallet?.role);
            view.render = createMoneyRenderer(page, kind);
            view.actions = initializeMoneyActions(page, kind, lifetime.signal, {
                canManage,
                addMoneyItem: (type, form) => services.addSharedMoneyItem(walletId, type, form),
                updateMoneyItem: (type, id, form) => services.updateSharedMoneyItem(walletId, type, id, form),
                deleteMoneyItem: id => services.deleteSharedMoneyItem(walletId, id),
                setMoneyAlerts: (id, enabled) => services.setSharedMoneyAlerts(walletId, id, enabled)
            });
            heading.replaceChildren();
            heading.hidden = true;
            pageActions.append(view.action);
            page.addEventListener("click", async event => {
                const button = event.target.closest(".money-card__favorite, .budget-card__favorite");
                if (!button || !canManage()) return;
                const id = button.closest("[data-money-id]").dataset.moneyId;
                if (view.pendingFavorites.has(id)) return;
                view.pendingFavorites.add(id);
                button.disabled = true;
                status.hidden = true;
                try { await services.setSharedMoneyFavorite(walletId, id, button.getAttribute("aria-pressed") !== "true"); }
                catch (error) {
                    if (active() && !lifetime.signal.aborted) { status.textContent = error.message; status.hidden = false; }
                } finally {
                    view.pendingFavorites.delete(id);
                    if (active() && !lifetime.signal.aborted) render();
                }
            }, { signal: lifetime.signal });
            render();
        } catch (failure) {
            if (active() && !lifetime.signal.aborted) {
                dispose();
                const message = document.createElement("p");
                message.className = "money-empty";
                message.textContent = failure.message;
                container.replaceChildren(message);
            }
        }
    }

    signal.addEventListener("abort", dispose, { once: true });
    return { setWallet, renderItems(items, message = "") { records = items; error = message; render(); } };
}
