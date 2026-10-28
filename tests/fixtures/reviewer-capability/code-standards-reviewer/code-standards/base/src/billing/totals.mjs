import {sumOf} from '../platform/amounts.mjs';

const BASIS = 10_000;

export const roundedTax = (taxable, basisPoints) => Math.floor((taxable * basisPoints + BASIS / 2) / BASIS);

export const invoiceTotals = (lineItems, credits, basisPoints) => {
    const subtotal = sumOf(lineItems.map((item) => item.amount));
    const available = sumOf(credits.map((credit) => credit.amount));
    const credit = Math.min(available, subtotal);
    const taxable = subtotal - credit;
    const tax = roundedTax(taxable, basisPoints);
    return {subtotal, credit, creditRemaining: available - credit, tax, total: taxable + tax};
};

const NUMBER_DIGITS = 6;

export const invoiceNumber = (id) => `INV-${String(id).padStart(NUMBER_DIGITS, '0')}`;
