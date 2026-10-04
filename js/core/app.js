import {
    setMoneyFavorite,
    watchMoneyItems
} from "../money/money-store.js";

import { createMoneyRenderer } from "../money/money-ui.js";
import { initializeMoneyActions } from "../money/money-actions.js";
import { initializeTransactions } from "../transactions/transaction-page.js";
import { initializeMoneyOverviewTransactions } from "../money/mymoney-transactions.js";
import { initializeDashboard } from "../dashboard/dashboard-page.js";
import { addTransaction, updateTransaction, deleteTransaction, watchTransactions } from "../transactions/transaction-store.js";
import * as sharedWalletServices from "../shared-wallet/shared-wallet-store.js";
import * as sharedMoneyServices from "../shared-wallet/shared-money-store.js";
import * as sharedTransactionServices from "../shared-wallet/shared-transaction-store.js";
import { createSharedWalletSession } from "../shared-wallet/shared-wallet-session.js";
import { initializeSharedWalletNotifications } from "../notifications/shared-wallet-notifications.js";
import * as notificationServices from "../notifications/notification-services.js";
import { initializeCalendar } from "../calendar/calendar-page.js";
import { startCurrencyDisplay } from "../currency/currency-session.js";
import { initializeSettings } from "../settings/settings-page.js";

let unsubscribeMoney = () => {};

const moneyPages = {
    budget: "pages/budget.html",
    savings: "pages/savings.html",
    debt: "pages/debt.html",
    lend: "pages/lend.html",
    subscriptions: "pages/subscriptions.html"
};

const pageFiles = {
    ...moneyPages,
    dashboard: "pages/dashboard.html",
    mymoney: "pages/mymoney.html",
    setting: "pages/settings.html",
    notifications: "pages/notifications.html",
    calendar: "pages/calendar.html",
    transaction: "pages/transaction.html",
    sharedwallet: "pages/sharedwallet.html"
};

// Each shared wallet section uses the same wallet controls.
const sharedWalletPages = {
    "sharedwallet-transaction": "Transaction",
    "sharedwallet-info": "Wallet Info",
    "sharedwallet-budget": "Budget",
    "sharedwallet-goals": "Goals",
    "sharedwallet-debt": "Debt",
    "sharedwallet-loans": "Loans",
    "sharedwallet-subscriptions": "Subscription"
};

// Current favorite flags are refreshed from saved Firestore records.
const favorites = new Map();
let navigationController;
let applicationController;
let stopApplication = () => {};
let sharedWalletSession;
let notificationSession;
let calendarSession;
let currentAccount = {};

async function loadComponent(id, file, signal) {
    const container = document.getElementById(id);
    if (!container) {
        console.error("Missing container: #" + id);
        return false;
    }

    try {
        const response = await fetch(file, { signal });
        if (!response.ok) {
            throw new Error("Failed to load " + file + ": " + response.status);
        }
        const html = await response.text();
        if (signal?.aborted) return false;
        container.innerHTML = html;
        return true;
    } catch (error) {
        if (error.name === "AbortError" || signal?.aborted) return false;
        console.error(error);
        container.textContent = "Unable to load this section.";
        return false;
    }
}

function currentPage() {
    const page = window.location.hash.slice(1) || "dashboard";
    return page === "loans" ? "lend" : page;
}

async function initializeHeader(signal, account) {
    if (!await loadComponent("header", "components/header.html", signal)) return;
    if (signal.aborted) return;
    const header = document.getElementById("header");
    const observer = new ResizeObserver(() => {
        document.documentElement.style.setProperty(
            "--header-height", header.getBoundingClientRect().height + "px"
        );
    });
    observer.observe(header);
    signal.addEventListener("abort", () => observer.disconnect(), { once: true });
    initializeAccountMenu(header, signal, account);
    const openMoneyRecord = record => {
        if (record.walletId) sharedWalletSession?.select(record.walletId);
        window.location.hash = record.href;
    };
    notificationSession = initializeSharedWalletNotifications(header, signal, account.user, {
        ...sharedWalletServices, ...notificationServices, watchSharedWallets: sharedWalletSession.watchWallets
    }, walletId => {
        sharedWalletSession?.select(walletId);
        window.location.hash = "#sharedwallet-info";
    }, { onOpen: openMoneyRecord });
    calendarSession = initializeCalendar(header, signal, notificationSession, { onOpen: openMoneyRecord });
    const notificationRoot = document.getElementById("content").querySelector("[data-notifications-page]");
    if (currentPage() === "notifications" && notificationRoot && !navigationController.signal.aborted) {
        notificationSession?.mountPage(notificationRoot, navigationController.signal);
    }
    const calendarRoot = document.getElementById("content").querySelector("[data-calendar-page]");
    if (currentPage() === "calendar" && calendarRoot && !navigationController.signal.aborted) {
        calendarSession?.mountPage(calendarRoot, navigationController.signal);
    }
}

function initializeAccountMenu(header, signal, { user, onSignOut }) {
    const toggle = header.querySelector("[data-account-toggle]");
    const menu = header.querySelector("[data-account-menu]");
    if (!toggle || !menu) return;
    menu.querySelector("[data-account-name]").textContent = user?.displayName || "Your account";
    menu.querySelector("[data-account-email]").textContent = user?.email || "";
    const close = () => {
        menu.hidden = true;
        toggle.setAttribute("aria-expanded", "false");
    };
    toggle.addEventListener("click", () => {
        menu.hidden = !menu.hidden;
        toggle.setAttribute("aria-expanded", String(!menu.hidden));
    }, { signal });
    window.addEventListener("click", event => {
        if (!event.target.closest(".header__account")) close();
    }, { signal });
    window.addEventListener("keydown", event => {
        if (event.key === "Escape" && !menu.hidden) {
            close();
            toggle.focus();
        }
    }, { signal });
    const button = menu.querySelector("[data-account-signout]");
    button.disabled = !onSignOut;
    button.addEventListener("click", async () => {
        if (button.disabled) return;
        button.disabled = true;
        const status = menu.querySelector("[data-account-status]");
        status.hidden = true;
        try {
            await onSignOut();
        } catch {
            if (!signal.aborted) {
                status.textContent = "Unable to sign out. Please try again.";
                status.hidden = false;
            }
        } finally {
            if (!signal.aborted) button.disabled = false;
        }
    }, { signal });
}

function updateSidebar() {
    const sidebar = document.getElementById("sidebar");
    if (!sidebar) return;
    const page = currentPage();
    sidebar.querySelectorAll("a").forEach(link => {
        if (link.getAttribute("href") === "#" + page) {
            link.setAttribute("aria-current", "page");
        } else {
            link.removeAttribute("aria-current");
        }
    });
    // Reveal whichever submenu contains the selected page.
    sidebar.querySelectorAll(".sidebar__toggle").forEach(toggle => {
        const menu = document.getElementById(toggle.getAttribute("aria-controls"));
        if (menu?.querySelector('a[aria-current="page"]')) {
            toggle.setAttribute("aria-expanded", "true");
            menu.hidden = false;
        }
    });
}

async function initializeSidebar(signal) {
    if (!await loadComponent("sidebar", "components/sidebar.html", signal)) return;
    if (signal.aborted) return;
    const sidebar = document.getElementById("sidebar");
    sidebar.querySelectorAll(".sidebar__toggle").forEach(toggle => {
        const menu = document.getElementById(toggle.getAttribute("aria-controls"));
        if (!menu) return;
        toggle.addEventListener("click", () => {
            const expanded = toggle.getAttribute("aria-expanded") === "true";
            toggle.setAttribute("aria-expanded", String(!expanded));
            menu.hidden = expanded;
        }, { signal });
    });
    updateSidebar();
}

function initializeMoneyFavorites(root, signal) {
    // Delegation also handles cards created after the page first loads.
    root.addEventListener("click", async event => {
        const button = event.target.closest(
            ".money-card__favorite, .budget-card__favorite"
        );
        if (!button) return;

        const id = button.closest("[data-money-id]").dataset.moneyId;
        const selected = button.getAttribute("aria-pressed") !== "true";

        button.disabled = true;

        try {
            await setMoneyFavorite(id, selected);
        } catch (error) {
            if (!signal.aborted) {
                alert("Unable to save favorite: " + error.message);
            }
        } finally {
            button.disabled = false;
        }
    }, { signal });
}

function showUnbuiltPage() {
    const content = document.getElementById("content");
    const section = document.createElement("section");
    section.className = "money-page";
    const heading = document.createElement("h1");
    heading.textContent = "Page not found";
    heading.tabIndex = -1;
    section.append(heading);
    const message = document.createElement("p");
    message.className = "money-empty";
    message.textContent = "This section is not available yet.";
    section.append(message);
    content.replaceChildren(section);
}

async function navigate(focusHeading = false) {
    if (!applicationController || applicationController.signal.aborted) return;
    navigationController?.abort();
    unsubscribeMoney();
    unsubscribeMoney = () => {};
    const controller = new AbortController();
    navigationController = controller;
    const content = document.getElementById("content");
    content.querySelector("dialog[open]")?.close();
    document.documentElement.classList.remove("money-modal-open");
    const page = currentPage();
    updateSidebar();

    const file = Object.hasOwn(sharedWalletPages, page) ? pageFiles.sharedwallet
        : Object.hasOwn(pageFiles, page) ? pageFiles[page] : null;
    if (file) {
        if (!await loadComponent("content", file, controller.signal)) return;
    } else {
        showUnbuiltPage();
    }
    if (controller.signal.aborted) return;
    if (page === "setting") initializeSettings(content.firstElementChild, controller.signal);
    if (page === "notifications") {
        notificationSession?.mountPage(content.firstElementChild, controller.signal);
    }
    if (page === "calendar") {
        calendarSession?.mountPage(content.firstElementChild, controller.signal);
    }
    if (page === "dashboard") {
        initializeDashboard(content.firstElementChild, controller.signal, {
            watchMoneyItems, watchTransactions,
            watchSharedWallets: sharedWalletSession.watchWallets,
            watchSharedMoneyItems: sharedMoneyServices.watchSharedMoneyItems,
            watchSharedTransactions: sharedTransactionServices.watchSharedTransactions
        });
    }
    if (page === "sharedwallet" || Object.hasOwn(sharedWalletPages, page)) {
        sharedWalletSession.mount(content.firstElementChild, controller.signal, {
            title: page === "sharedwallet" ? "Shared Wallet" : "Shared Wallet — " + sharedWalletPages[page],
            section: page === "sharedwallet" ? "overview" : page.slice("sharedwallet-".length),
            user: currentAccount.user
        });
    }
    if (page === "transaction") {
        initializeTransactions(content.firstElementChild, controller.signal, {
            addTransaction, updateTransaction, deleteTransaction, watchTransactions, watchMoneyItems
        });
    }
    if (page === "mymoney" || Object.hasOwn(moneyPages, page)) {
        const root = content.firstElementChild;
        if (page === "mymoney") {
            initializeMoneyOverviewTransactions(root, controller.signal, { watchTransactions });
        }

        const renderCards = page === "mymoney"
            ? window.MyMoneyOverview.mount(root, {
                favorites,
                onFavorite: setMoneyFavorite,
                signal: controller.signal
            })
            : createMoneyRenderer(root, page);

        let updateActions = () => {};
        if (page !== "mymoney") {
            initializeMoneyFavorites(root, controller.signal);
            updateActions = initializeMoneyActions(root, page, controller.signal);
        }

        const render = (records, error) => {
            const focusedElement = document.activeElement;
            renderCards(records, error);
            updateActions(records, focusedElement);
        };
        render(null);

        try {
            const stop = await watchMoneyItems(records => {
                if (controller.signal.aborted || !root.isConnected) return;

                favorites.clear();
                records.forEach(item => {
                    favorites.set(item.id, Boolean(item.favorite));
                });

                render(records);
            }, error => {
                if (controller.signal.aborted || !root.isConnected) return;
                render(null, "Unable to load saved items: " + error.message);
            });

            if (controller.signal.aborted) {
                stop();
                return;
            }

            unsubscribeMoney = stop;
        } catch (error) {
            if (controller.signal.aborted || !root.isConnected) return;
            render(null, "Unable to connect: " + error.message);
        }
    }
    if (focusHeading) {
        window.scrollTo({ top: 0, behavior: "instant" });
        const heading = content.querySelector("h1");
        if (heading) {
            heading.tabIndex = -1;
            heading.focus({ preventScroll: true });
        }
    }
}

export function startApp(account = {}) {
    stopApplication();
    const controller = new AbortController();
    applicationController = controller;
    currentAccount = account;
    if (typeof startCurrencyDisplay === "function") {
        const currencyDisplay = startCurrencyDisplay(account.user, controller.signal);
        let currency = "AED";
        currencyDisplay.watch(values => {
            if (values.currency !== currency) { currency = values.currency; navigate(); }
        });
    }
    sharedWalletSession = createSharedWalletSession(controller.signal, { ...sharedWalletServices, ...sharedMoneyServices, ...sharedTransactionServices });
    window.addEventListener("hashchange", () => navigate(true), { signal: controller.signal });
    initializeHeader(controller.signal, account);
    initializeSidebar(controller.signal);
    navigate();
    stopApplication = () => {
        if (controller.signal.aborted) return;
        controller.abort();
        navigationController?.abort();
        unsubscribeMoney();
        unsubscribeMoney = () => {};
        favorites.clear();
        currentAccount = {};
        sharedWalletSession = undefined;
        notificationSession = undefined;
        calendarSession = undefined;
        document.querySelectorAll("dialog[open]").forEach(dialog => dialog.close());
        document.documentElement.classList.remove("money-modal-open");
    };
    return stopApplication;
}
