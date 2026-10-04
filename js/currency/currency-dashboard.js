import { getRate, convertCents } from "./currency.js";

export async function convertDashboardSources(sources, target, lookup = getRate) {
    return Promise.all(sources.map(async source => {
        const base = source.currency || "AED";
        if (base === target) return source;
        const rate = await lookup(base, target);
        const convert = value => convertCents(value, rate.rate);
        return { ...source, currency: target,
            transactions: source.transactions?.map(record => ({ ...record, amountCents: convert(record.amountCents) })) ?? null,
            items: source.items?.map(item => ({ ...item, amountCents: convert(item.amountCents), completedCents: convert(item.completedCents) })) ?? null };
    }));
}
