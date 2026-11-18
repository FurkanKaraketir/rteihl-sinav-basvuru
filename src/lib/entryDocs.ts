import { collection, doc, getDocs, writeBatch, Timestamp, type DocumentData } from 'firebase/firestore';
import { db } from '$lib/firebase';
import { entryKey, normalizePhone } from '$lib/security';

/** Comparable form of a document (Timestamps → millis, keys sorted). */
function canonical(value: unknown): unknown {
    if (value instanceof Timestamp) return { __ts: value.toMillis() };
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.keys(value as object).sort().map((k) => [k, canonical((value as Record<string, unknown>)[k])])
        );
    }
    return value;
}

const same = (a: DocumentData, b: DocumentData) =>
    JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/**
 * Admin-only: make `entryDocs` an exact mirror of `examApplications`,
 * keyed by hash(T.C. + phone). The public entry-document page can only read
 * an application through this mirror, so it must be refreshed after admin
 * edits (move hall, change phone, delete, add, reset, archive).
 * Only changed documents are written. Returns the number of writes.
 */
export async function syncEntryDocs(): Promise<number> {
    const [appsSnap, entrySnap] = await Promise.all([
        getDocs(collection(db, 'examApplications')),
        getDocs(collection(db, 'entryDocs'))
    ]);

    const desired = new Map<string, DocumentData>();
    for (const app of appsSnap.docs) {
        const phone = normalizePhone(app.data().phoneNumber);
        if (!phone) continue; // no valid phone → applicant cannot look it up anyway
        desired.set(await entryKey(app.id, phone), app.data());
    }

    const ops: ((b: ReturnType<typeof writeBatch>) => void)[] = [];
    const existing = new Map(entrySnap.docs.map((d) => [d.id, d.data()]));
    for (const [key, data] of desired) {
        const cur = existing.get(key);
        if (!cur || !same(cur, data)) ops.push((b) => b.set(doc(db, 'entryDocs', key), data));
    }
    for (const key of existing.keys()) {
        if (!desired.has(key)) ops.push((b) => b.delete(doc(db, 'entryDocs', key)));
    }

    for (let i = 0; i < ops.length; i += 400) {
        const batch = writeBatch(db);
        ops.slice(i, i + 400).forEach((op) => op(batch));
        await batch.commit();
    }
    return ops.length;
}
