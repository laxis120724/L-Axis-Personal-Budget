import { initializeTransactions } from "../transactions/transaction-page.js";

export function createSharedTransactionView(root, signal, { section, services, user = {} }) {
    const container = root.querySelector("[data-shared-transaction-container]");
    const pageActions = root.querySelector("[data-shared-wallet-page-actions]");
    if (section !== "transaction" || !container) return null;
    container.hidden = false;
    let wallet, current;
    const active = () => !signal.aborted && root.isConnected;
    const template = fetch("pages/transaction.html", { signal }).then(async response => {
        if (!response.ok) throw new Error("Unable to open transactions. Refresh and try again.");
        return response.text();
    });
    template.catch(() => {});
    const manager = () => ["creator", "admin"].includes(wallet?.role);
    const access = () => new Set(wallet?.members?.[user.uid]?.categoryIds || []);
    const members = () => Object.entries(wallet?.members || {}).map(([uid, member]) => ({ ...member, uid }));
    const canEdit = record => Boolean(record && wallet && (manager()
        || (record.ownerUid === user.uid && (record.type === "income" || access().has(record.itemId)))));

    function element(tag, text, className) {
        const node = document.createElement(tag);
        if (text !== undefined) node.textContent = text;
        if (className) node.className = className;
        return node;
    }
    function field(label, name, className, attribute) {
        const wrapper = element("div", undefined, className);
        const select = element("select");
        select.setAttribute("id", "shared-transaction-" + name);
        select.setAttribute("name", name);
        select.setAttribute(attribute, "");
        const title = element("label", label);
        title.setAttribute("for", select.id);
        wrapper.append(title, select);
        return wrapper;
    }
    function dispose() {
        current?.page?.querySelectorAll("dialog[open]").forEach(dialog => dialog.close());
        current?.lifetime.abort();
        if (current?.action && pageActions.contains(current.action)) pageActions.replaceChildren();
        current = undefined;
        document.documentElement.classList.toggle("money-modal-open", Boolean(document.querySelector("dialog[open]")));
    }
    function refresh() {
        if (!current?.controller || !active()) return;
        current.controller.refreshAccess();
    }
    async function setWallet(next) {
        if (!active()) return;
        if (wallet?.id === next?.id && current) { wallet = next; refresh(); return; }
        dispose();
        wallet = next;
        container.replaceChildren();
        if (!wallet) return;
        const walletId = wallet.id;
        const view = { lifetime: new AbortController() };
        current = view;
        try {
            const html = await template;
            if (!active() || view.lifetime.signal.aborted || current !== view) return;
            container.innerHTML = html;
            const page = container.firstElementChild;
            view.page = page;
            page.dataset.shared = "true";
            const heading = page.querySelector(".transaction-heading");
            view.action = heading.querySelector("[data-open-transaction]");
            heading.replaceChildren(view.action);
            page.setAttribute("aria-labelledby", "shared-wallet-title");
            page.querySelector(".transaction-stat--budget small").textContent = "Remaining across this wallet’s budgets";
            const tableHead = page.querySelector("thead tr");
            const memberHead = element("th", "Member"); memberHead.setAttribute("scope", "col");
            tableHead.insertBefore(memberHead, tableHead.children[1]);
            const form = page.querySelector("[data-transaction-form]");
            const owner = field("Recorded for", "ownerUid", "money-field money-field--full", "data-transaction-owner");
            form.insertBefore(owner, form.firstElementChild);
            owner.querySelector("select").required = true;
            const filters = page.querySelector(".transaction-filters");
            filters.insertBefore(field("Member", "member", "transaction-filter", "data-transaction-member-filter"),
                filters.querySelector("[data-transaction-reset]"));
            for (const select of page.querySelectorAll('[name="type"], [data-transaction-type-filter]')) {
                select.querySelector('[value="income"]').textContent = "Income / contribution";
                select.querySelector('[value="savings"]').textContent = "Goal deposit";
                select.querySelector('[value="lend"]').textContent = "Loan repayment";
            }
            view.controller = initializeTransactions(page, view.lifetime.signal, {
                addTransaction: data => services.addSharedTransaction(walletId, data),
                updateTransaction: (id, data) => services.updateSharedTransaction(walletId, id, data),
                deleteTransaction: id => services.deleteSharedTransaction(walletId, id),
                watchTransactions: (change, failure) => services.watchSharedTransactions(walletId, change, failure),
                watchMoneyItems: (change, failure) => services.watchSharedMoneyItems(walletId, change, failure)
            }, { shared: true, userId: user.uid, members,
                canCreate: () => wallet?.id === walletId,
                canChooseOwner: manager, canEdit,
                filterItems: items => manager() ? items : items.filter(item => access().has(item.id)),
                typeLabel: type => ({ income: "Income / contribution", savings: "Goal deposit", lend: "Loan repayment" }[type])
            });
            heading.replaceChildren();
            heading.hidden = true;
            pageActions.append(view.action);
            refresh();
        } catch (failure) {
            if (active() && !view.lifetime.signal.aborted) {
                dispose();
                const note = element("p", failure.message, "money-empty");
                container.replaceChildren(note);
            }
        }
    }
    signal.addEventListener("abort", dispose, { once: true });
    return { setWallet };
}
