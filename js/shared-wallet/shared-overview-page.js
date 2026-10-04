import { initializeMoneyOverviewTransactions } from "../money/mymoney-transactions.js";

const contributionColors = ["#0f9d92", "#8057c7", "#14869e", "#c95336", "#5c8f19", "#d59423"];

// Repayments are money in, but only income records count as member contributions.
export function buildMemberContributions(transactions, members) {
    const people = new Map(members.map(member => [member.id || member.uid, {
        uid: member.id || member.uid, name: member.name || member.displayName || member.email || "Member",
        active: true, amountCents: 0
    }]));
    for (const transaction of transactions) {
        if (transaction.type !== "income") continue;
        if (!people.has(transaction.ownerUid)) people.set(transaction.ownerUid, {
            uid: transaction.ownerUid, name: transaction.ownerName || "Former member", active: false, amountCents: 0
        });
        people.get(transaction.ownerUid).amountCents += transaction.amountCents;
    }
    const totalCents = [...people.values()].reduce((sum, person) => sum + person.amountCents, 0);
    return { totalCents, people: [...people.values()]
        .sort((a, b) => b.amountCents - a.amountCents || a.name.localeCompare(b.name))
        .map(person => ({ ...person, share: totalCents ? person.amountCents / totalCents * 100 : 0 })) };
}

export function createSharedOverviewView(root, signal, { section, services }) {
    const sharedAmount = cents => globalThis.window?.CurrencyDisplay?.format(cents / 100, root)
        || (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const container = root.querySelector("[data-shared-overview-container]");
    if (section !== "overview" || !container) return null;
    container.hidden = false;
    const active = () => !signal.aborted && root.isConnected;
    let wallet, current, items = null, members = null, itemError = "", memberError = "";
    const template = fetch("pages/shared-overview.html", { signal }).then(response => {
        if (!response.ok) throw new Error("Unable to open the wallet overview. Refresh and try again.");
        return response.text();
    });
    template.catch(() => {});
    const canManage = () => ["creator", "admin"].includes(wallet?.role);
    const element = (tag, className, text) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    };
    function dispose() {
        current?.lifetime.abort();
        current = undefined;
    }
    function renderCategories() {
        if (!active() || !current?.updateCategories) return;
        current.favorites.clear();
        (items || []).forEach(item => current.favorites.set(item.id, Boolean(item.favorite)));
        current.updateCategories(items, itemError);
    }
    function renderContributions() {
        if (!active() || !current?.page) return;
        const target = current.page.querySelector("[data-shared-overview-contributions]");
        if (current.transactions === null || members === null) {
            target.replaceChildren(element("p", "overview-empty", current.transactionError || memberError
                || (current.transactions === null ? "Loading contributions…" : "Loading members…")));
            return;
        }
        const model = buildMemberContributions(current.transactions, members);
        if (!model.totalCents) {
            target.replaceChildren(element("p", "overview-empty", "No contributions yet."));
            return;
        }
        const total = element("div", "shared-contributions__total");
        total.append(element("span", "", "Total contributed"), element("strong", "", sharedAmount(model.totalCents)));
        globalThis.window?.CurrencyDisplay?.setAmount(total.querySelector("strong"), model.totalCents, globalThis.window?.CurrencyDisplay.base(root));
        const list = element("ul", "shared-contributions__list");
        model.people.forEach((person, index) => {
            const row = element("li"); row.dataset.memberUid = person.uid;
            row.style.setProperty("--category-color", contributionColors[index % contributionColors.length]);
            const heading = element("div", "shared-contributions__member");
            const name = element("span", "", person.name + (person.active ? "" : " · Former member"));
            heading.append(name, element("strong", "", sharedAmount(person.amountCents)));
            globalThis.window?.CurrencyDisplay?.setAmount(heading.querySelector("strong"), person.amountCents, globalThis.window?.CurrencyDisplay.base(root));
            const progress = element("progress");
            progress.max = model.totalCents; progress.value = person.amountCents;
            progress.setAttribute("aria-label", `${person.name}: ${sharedAmount(person.amountCents)} contributed, ${person.share.toFixed(1)}% of total`);
            row.append(heading, progress, element("small", "", person.share.toFixed(1) + "%"));
            list.append(row);
        });
        target.replaceChildren(total, list);
    }
    async function setWallet(next) {
        if (!active()) return;
        if (wallet?.id === next?.id && current) { wallet = next; renderCategories(); return; }
        dispose(); wallet = next; items = members = null; itemError = memberError = "";
        container.replaceChildren();
        if (!wallet) return;
        const walletId = wallet.id;
        const view = { lifetime: new AbortController(), favorites: new Map(), transactions: null, transactionError: "" };
        current = view;
        const live = () => active() && !view.lifetime.signal.aborted && current === view;
        try {
            const html = await template;
            if (!live()) return;
            container.innerHTML = html; view.page = container.firstElementChild;
            view.updateCategories = window.MyMoneyOverview.mount(view.page, {
                signal: view.lifetime.signal, favorites: view.favorites, shared: true,
                canFavorite: () => live() && canManage(),
                onFavorite: (id, value) => services.setSharedMoneyFavorite(walletId, id, value)
            });
            initializeMoneyOverviewTransactions(view.page, view.lifetime.signal, {
                async watchTransactions(onChange, onError) {
                    const fail = failure => {
                        if (!live()) return;
                        view.transactions = null; view.transactionError = "Unable to load contributions: " + failure.message;
                        onError(failure); renderContributions();
                    };
                    try {
                        return await services.watchSharedTransactions(walletId, records => {
                            if (!live()) return;
                            view.transactions = records; view.transactionError = "";
                            onChange(records); renderContributions();
                        }, fail);
                    } catch (failure) { fail(failure); return () => {}; }
                }
            }, { shared: true });
            renderCategories(); renderContributions();
        } catch (failure) {
            if (!live()) return;
            dispose();
            container.replaceChildren(element("p", "money-empty", failure.message));
        }
    }
    signal.addEventListener("abort", dispose, { once: true });
    return { setWallet,
        renderItems(records, message = "") { items = records; itemError = message; renderCategories(); },
        renderMembers(records, message = "") { members = records; memberError = message; renderContributions(); }
    };
}
