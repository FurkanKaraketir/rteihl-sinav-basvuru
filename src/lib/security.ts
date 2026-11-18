import { doc, getDoc } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '$lib/firebase';

/**
 * Full T.C. Kimlik No validation (both checksum digits).
 * - 11 digits, first digit not 0
 * - d10 = ((d1+d3+d5+d7+d9) * 7 - (d2+d4+d6+d8)) mod 10
 * - d11 = (d1 + ... + d10) mod 10
 */
export function validateTCID(tcId: string): boolean {
    if (!/^[1-9]\d{10}$/.test(tcId)) return false;
    const d = tcId.split('').map(Number);
    const odd = d[0] + d[2] + d[4] + d[6] + d[8];
    const even = d[1] + d[3] + d[5] + d[7];
    const d10 = (((odd * 7 - even) % 10) + 10) % 10;
    if (d[9] !== d10) return false;
    const sum10 = d.slice(0, 10).reduce((a, b) => a + b, 0);
    return d[10] === sum10 % 10;
}

/** Turkish-aware uppercase (i → İ, ı → I for every occurrence). */
export function toTurkishUpperCase(str: string): string {
    return str.toLocaleUpperCase('tr-TR');
}

/**
 * Normalises a Turkish mobile number to 10 digits starting with 5
 * (accepts "0532...", "+90 532...", "(532) 123 45 67"). Returns '' if invalid.
 */
export function normalizePhone(input: string | number | null | undefined): string {
    let digits = String(input ?? '').replace(/\D/g, '');
    if (digits.length === 12 && digits.startsWith('90')) digits = digits.slice(2);
    digits = digits.replace(/^0+/, '');
    return /^5\d{9}$/.test(digits) ? digits : '';
}

async function sha256Hex(text: string): Promise<string> {
    const bytes = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

/**
 * Document ID for a student's result in the `results` collection.
 * Requires both the T.C. number and the phone number given at application,
 * so knowing a T.C. number alone is not enough to read someone's result.
 */
export async function resultKey(year: number, tcId: string, phone: string): Promise<string> {
    return sha256Hex(`rteihl-results:v1:${year}:${tcId}:${normalizePhone(phone)}`);
}

/**
 * Document ID in `entryDocs` (public copy of an application, used by the
 * exam entry document page). Needs T.C. + phone, like results. The Firestore
 * rules recompute this exact hash when an applicant creates their entry doc,
 * so keep the format in sync with firestore.rules (entryKeyFor).
 */
export async function entryKey(tcId: string, phone: string): Promise<string> {
    return sha256Hex(`rteihl-entry:v1:${tcId}:${normalizePhone(phone)}`);
}

/**
 * A user is an admin only if a document exists at `admins/{uid}`.
 * Admin documents are created by hand in the Firebase console; the
 * Firestore rules use the same check, so this is only for the UI.
 */
export async function checkIsAdmin(user: User | null): Promise<boolean> {
    if (!user) return false;
    try {
        const snap = await getDoc(doc(db, 'admins', user.uid));
        return snap.exists();
    } catch {
        return false;
    }
}
