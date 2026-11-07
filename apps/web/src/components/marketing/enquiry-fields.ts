/**
 * Contact form honeypot (PLAN §18.4): a field people never see (off-screen, no tab stop). Bots fill it; the action
 * then answers like a success and stores nothing. Shared by the form and the action (plain module, no 'use client').
 */
export const ENQUIRY_HONEYPOT = 'extra_details'
