window.MyMoneyOverview = (() => {
    const categories = [
        { key: "budget", title: "Budget", noun: "budgets", color: "#0f9d92", tint: "#e0f7f1" },
        { key: "savings", title: "Savings", noun: "goals", color: "#5c8f19", tint: "#eef8d7" },
        { key: "debt", title: "Debt", noun: "debts", color: "#c95336", tint: "#fff0e8" },
        { key: "lend", title: "Lend", noun: "lends", color: "#8057c7", tint: "#f2eaff" },
        { key: "subscriptions", title: "Subscriptions", noun: "subscriptions", color: "#14869e", tint: "#e1f5fb" }
    ];
    const format = value => value.toLocaleString("en-US", {
        minimumFractionDigits: 2, maximumFractionDigits: 2
    });

    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function monthlyEquivalent(amount, cycle) {
        const factors = { weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 };
        if (!Object.hasOwn(factors, cycle)) throw new Error("Unknown billing cycle: " + cycle);
        return amount * factors[cycle];
    }

    function summarize(items) {
        const total = items.reduce((sum, item) => sum + item.total, 0);
        const completed = items.reduce((sum, item) => sum + item.completed, 0);
        return { count: items.length, total, completed, remaining: total - completed };
    }

    function choosePreview(items, favorites, onlyFavorites = false, limit = 3) {
        return items.map((item, index) => ({ item, index }))
            .filter(({ item }) => !onlyFavorites || favorites.get(item.id))
            .sort((a, b) => Number(Boolean(favorites.get(b.item.id)))
                - Number(Boolean(favorites.get(a.item.id))) || a.index - b.index)
            .slice(0, limit).map(({ item }) => item);
    }

    function progressBar(value, max, label) {
        const progress = element("progress");
        progress.max = max > 0 ? max : 1;
        progress.value = Math.max(0, value);
        progress.setAttribute("aria-label", label);
        return progress;
    }

    function categoryAmounts(model, formatValue = format) {
        const { total, completed, remaining } = model.stats;
        switch (model.key) {
            case "budget": return [total, "allocated", `${formatValue(completed)} spent · ${formatValue(Math.abs(remaining))} ${remaining < 0 ? "over budget" : "left"}`];
            case "savings": return [completed, "saved", `${formatValue(total)} target · ${formatValue(remaining)} still to save`];
            case "debt": return [remaining, "still owed", `${formatValue(completed)} paid of ${formatValue(total)}`];
            case "lend": return [remaining, "still to receive", `${formatValue(completed)} repaid of ${formatValue(total)} lent`];
            case "subscriptions": return [total, "per month", `${formatValue(total * 12)} estimated per year`];
        }
    }

    function itemAmounts(model, item) {
        switch (model.key) {
            case "budget": return [Math.abs(item.total - item.completed), item.completed > item.total ? "over budget" : "left"];
            case "savings": return [item.completed, "saved"];
            case "debt": return [item.total - item.completed, "owed"];
            case "lend": return [item.total - item.completed, "to receive"];
            case "subscriptions": return [item.amount, { weekly: "/ week", monthly: "/ month", quarterly: "/ 3 months", yearly: "/ year" }[item.cycle]];
        }
    }

    function renderCategories(root, models, favorites, onlyFavorites, canFavorite) {
        const panels = models.map(model => {
            const panel = element("section", "overview-category");
            panel.dataset.category = model.key;
            panel.style.setProperty("--category-color", model.color);
            panel.style.setProperty("--category-tint", model.tint);
            const heading = element("div", "overview-category__heading");
            const title = element("h3", "", model.title);
            title.id = "overview-category-" + model.key;
            panel.setAttribute("aria-labelledby", title.id);
            const link = element("a", "overview-category__link", "View all →");
            link.href = "#" + model.page;
            link.setAttribute("aria-label", "View all " + model.title.toLowerCase());
            heading.append(title, element("span", "overview-category__count",
                `${model.stats.count} ${model.stats.count === 1 ? model.noun.slice(0, -1) : model.noun}`), link);
            panel.append(heading);
            const [amount, label, detail] = categoryAmounts(model, value => globalThis.window?.CurrencyDisplay?.format(value, root) || format(value));
            const total = element("div", "overview-category__total");
            total.append(element("strong", "", format(amount)), element("span", "", label));
            globalThis.window?.CurrencyDisplay?.setAmount(total.querySelector("strong"), Math.round(amount * 100), globalThis.window?.CurrencyDisplay.base(root));
            panel.append(total, element("p", "overview-category__detail", detail));
            if (model.key !== "subscriptions" && model.items.length) {
                panel.append(progressBar(model.stats.completed, model.stats.total,
                    `${model.title}: ${format(model.stats.completed)} of ${format(model.stats.total)}`));
            }
            const selected = choosePreview(model.items, favorites, onlyFavorites);
            const list = element("ul", "overview-preview");
            for (const item of selected) {
                const row = element("li");
                const starred = Boolean(favorites.get(item.id));
                const button = element("button", "overview-preview__star");
                button.type = "button";
                button.disabled = !canFavorite();
                button.dataset.overviewFavorite = item.id;
                button.setAttribute("aria-pressed", String(starred));
                button.setAttribute("aria-label", "Favorite " + item.name);
                button.title = starred ? "Remove from favorites" : "Add to favorites";
                const icon = element("span", "", starred ? "\u2605" : "\u2606");
                icon.setAttribute("aria-hidden", "true");
                button.append(icon);
                const name = element("a", "overview-preview__name", item.name);
                name.href = "#" + model.page;
                name.title = item.name;
                const [value, valueLabel] = itemAmounts(model, item);
                const amountLabel = element("div", "overview-preview__amount");
                amountLabel.append(element("strong", "", format(value)), element("small", "", valueLabel));
                globalThis.window?.CurrencyDisplay?.setAmount(amountLabel.querySelector("strong"), Math.round(value * 100), globalThis.window?.CurrencyDisplay.base(root));
                row.append(button, name, amountLabel);
                list.append(row);
            }
            const eligible = onlyFavorites ? model.items.filter(item => favorites.get(item.id)).length : model.items.length;
            if (selected.length) {
                panel.append(list, element("p", "overview-category__hint",
                    `Showing ${selected.length} of ${eligible}${onlyFavorites ? eligible === 1 ? " favorite" : " favorites" : " · Favorites first"}`));
            } else {
                panel.append(element("p", "overview-empty", onlyFavorites
                    ? "No favorites yet. Star an item on its category page." : "No items yet."));
            }
            return panel;
        });
        root.querySelector("[data-overview-categories]").replaceChildren(...panels);
    }

    function mount(root, { favorites, onFavorite, signal, shared = false, canFavorite = () => true }) {
        let models = [];
        const definitions = categories.map(category => shared ? { ...category,
            title: { savings: "Goals", lend: "Loans" }[category.key] || category.title,
            noun: category.key === "lend" ? "loans" : category.noun,
            page: "sharedwallet-" + ({ savings: "goals", lend: "loans" }[category.key] || category.key)
        } : { ...category, page: category.key });
        const status = root.querySelector("[data-overview-status]");
        const filter = root.querySelector("[data-overview-favorites-only]");

        filter.addEventListener("change", () => {
            if (models.length) renderCategories(root, models, favorites, filter.checked, canFavorite);
        }, { signal });

        root.addEventListener("click", async event => {
            const button = event.target.closest("[data-overview-favorite]");
            if (!button || !canFavorite()) return;
            const id = button.dataset.overviewFavorite;
            const category = button.closest("[data-category]").dataset.category;
            button.disabled = true;

            try {
                await onFavorite(id, !Boolean(favorites.get(id)));
                if (signal?.aborted || !root.isConnected) return;
                const replacement = [...root.querySelectorAll("[data-overview-favorite]")]
                    .find(node => node.dataset.overviewFavorite === id);
                const panel = [...root.querySelectorAll("[data-category]")]
                    .find(node => node.dataset.category === category);
                (replacement || panel?.querySelector(".overview-category__link"))
                    ?.focus({ preventScroll: true });
            } catch (error) {
                if (signal?.aborted || !root.isConnected) return;
                status.hidden = false;
                status.textContent = "Unable to save favorite: " + error.message;
            } finally {
                button.disabled = false;
            }
        }, { signal });

        // Update the overview when its caller receives new saved records.
        return (records, error = "") => {
            if (signal?.aborted || !root.isConnected) return;
            filter.disabled = records === null;
            status.hidden = records !== null;

            if (records === null) {
                models = [];
                status.textContent = error || "Loading categories…";
                root.querySelector("[data-overview-categories]").replaceChildren();
                root.querySelector("[data-overview-count]").textContent = "—";
                return;
            }

            models = definitions.map(category => {
                const items = records.filter(item => item.kind === category.key);
                return { ...category, items, stats: summarize(items) };
            });
            const starred = records.filter(item => favorites.get(item.id)).length;
            root.querySelector("[data-overview-count]").textContent =
                `${records.length} items · ${models.length} categories · ${starred} ${starred === 1 ? "favorite" : "favorites"}`;
            renderCategories(root, models, favorites, filter.checked, canFavorite);
        };
    }

    return Object.freeze({ mount, choosePreview, summarize, monthlyEquivalent });
})();
