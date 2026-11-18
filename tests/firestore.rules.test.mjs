// Firestore security rules tests. Run with:  npm run test:rules
// Uses the local emulator and a throwaway "demo-" project — never production.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import {
    initializeTestEnvironment,
    assertFails,
    assertSucceeds
} from '@firebase/rules-unit-testing';
import {
    doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection,
    runTransaction, serverTimestamp, Timestamp
} from 'firebase/firestore';

const TC = '10000000146'; // valid checksum, not a real person
const TC2 = '10000000078';
const PHONE = '5321234567';
const HOUR = 3600 * 1000;
// Same format as entryKey() in src/lib/security.ts
const entryKey = (tc, phone) => createHash('sha256').update(`rteihl-entry:v1:${tc}:${phone}`).digest('hex');

let env;

before(async () => {
    env = await initializeTestEnvironment({
        projectId: 'demo-exam-rules',
        firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 }
    });
});

after(async () => {
    await env?.cleanup();
});

async function seed({ applicationEnabled = true, resultsEnabled = false, releaseInMs = HOUR, capacity = 2, studentCount = 0 } = {}) {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore();
        await setDoc(doc(db, 'admins/admin-uid'), { note: 'test admin' });
        await setDoc(doc(db, 'system/settings'), {
            applicationEnabled,
            resultsEnabled,
            currentYear: 2026,
            applicationStartAt: Timestamp.fromMillis(Date.now() - HOUR),
            applicationDeadlineAt: Timestamp.fromMillis(Date.now() + HOUR),
            resultsReleaseAt: Timestamp.fromMillis(Date.now() + releaseInMs)
        });
        await setDoc(doc(db, 'schools/s1'), { id: 's1', name: 'Okul A', weight: 0 });
        await setDoc(doc(db, 'schools/s1/examHalls/h1'), { id: 'h1', name: 'Salon 1', capacity, studentCount });
        await setDoc(doc(db, 'results/abc123hash'), { year: 2026, row: ['AD SOYAD', TC, 10] });
        await setDoc(doc(db, 'events/e1'), { name: 'Etkinlik', enabled: true });
        await setDoc(doc(db, 'events/e-off'), { name: 'Kapalı', enabled: false });
    });
}

const anon = () => env.unauthenticatedContext().firestore();
const admin = () => env.authenticatedContext('admin-uid').firestore();
const randomUser = () => env.authenticatedContext('not-an-admin').firestore();

/** The same transaction the public form runs (src/routes/+page.svelte). */
function claimSeat(db, { tc = TC, override = {}, countOverride, skipHall = false, skipApp = false, entryKeyOverride } = {}) {
    return runTransaction(db, async (tx) => {
        const hallRef = doc(db, 'schools/s1/examHalls/h1');
        const appRef = doc(db, 'examApplications', tc);
        const studentRef = doc(db, 'schools/s1/examHalls/h1/students', tc);
        const entryRef = doc(db, 'entryDocs', entryKeyOverride ?? entryKey(tc, override.phoneNumber ?? PHONE));
        await tx.get(appRef);
        const hall = (await tx.get(hallRef)).data();
        const orderNumber = countOverride ?? (hall.studentCount ?? 0) + 1;
        const data = {
            tcId: tc,
            studentFullName: 'ÖĞRENCİ ADI',
            studentSchoolName: 'NEVŞEHİR - MERKEZ - Okul',
            parentFullName: 'VELİ ADI',
            phoneNumber: PHONE,
            schoolId: 's1',
            schoolName: 'Okul A',
            hallId: 'h1',
            hallName: 'Salon 1',
            orderNumber,
            assignedAt: serverTimestamp(),
            ...override
        };
        if (!skipHall) tx.update(hallRef, { studentCount: orderNumber, lastAssignedTc: tc });
        tx.set(studentRef, data);
        if (!skipApp) tx.set(appRef, data);
        tx.set(entryRef, data);
    });
}

describe('personal data is not publicly listable', () => {
    beforeEach(() => seed());

    test('anonymous cannot list applications, students, results, past years', async () => {
        await assertFails(getDocs(collection(anon(), 'examApplications')));
        await assertFails(getDocs(collection(anon(), 'schools/s1/examHalls/h1/students')));
        await assertFails(getDocs(collection(anon(), 'results')));
        await assertFails(getDocs(collection(anon(), 'pastYears')));
        await assertFails(getDocs(collection(anon(), 'eventApplications')));
    });

    test('a signed-in user without an admins/{uid} doc is not an admin', async () => {
        await assertFails(getDocs(collection(randomUser(), 'examApplications')));
        await assertFails(setDoc(doc(randomUser(), 'system/settings'), { applicationEnabled: true }));
        await assertFails(getDoc(doc(randomUser(), 'admins/admin-uid')));
    });

    test('admin can list and write', async () => {
        await assertSucceeds(getDocs(collection(admin(), 'examApplications')));
        await assertSucceeds(getDocs(collection(admin(), 'results')));
        await assertSucceeds(updateDoc(doc(admin(), 'system/settings'), { resultsEnabled: true }));
        await assertSucceeds(getDoc(doc(admin(), 'admins/admin-uid')));
    });

    test('public config is readable, not writable', async () => {
        await assertSucceeds(getDoc(doc(anon(), 'system/settings')));
        await assertSucceeds(getDocs(collection(anon(), 'schools')));
        await assertSucceeds(getDocs(collection(anon(), 'schools/s1/examHalls')));
        await assertFails(setDoc(doc(anon(), 'system/settings'), { applicationEnabled: true }));
        await assertFails(updateDoc(doc(anon(), 'schools/s1/examHalls/h1'), { capacity: 999 }));
    });
});

describe('results', () => {
    test('hidden before the release time even if enabled', async () => {
        await seed({ resultsEnabled: true, releaseInMs: HOUR });
        await assertFails(getDoc(doc(anon(), 'results/abc123hash')));
        await assertSucceeds(getDoc(doc(admin(), 'results/abc123hash')));
    });

    test('hidden after release time if results are disabled', async () => {
        await seed({ resultsEnabled: false, releaseInMs: -HOUR });
        await assertFails(getDoc(doc(anon(), 'results/abc123hash')));
    });

    test('a single document is readable after release when enabled', async () => {
        await seed({ resultsEnabled: true, releaseInMs: -HOUR });
        await assertSucceeds(getDoc(doc(anon(), 'results/abc123hash')));
        await assertFails(getDocs(collection(anon(), 'results')));
        await assertFails(setDoc(doc(anon(), 'results/x'), { row: [] }));
    });
});

describe('public seat claim', () => {
    test('succeeds while applications are open', async () => {
        await seed();
        await assertSucceeds(claimSeat(anon()));
        await env.withSecurityRulesDisabled(async (ctx) => {
            const hall = (await getDoc(doc(ctx.firestore(), 'schools/s1/examHalls/h1'))).data();
            if (hall.studentCount !== 1) throw new Error('studentCount not incremented');
        });
    });

    test('a T.C. number alone does not reveal an application', async () => {
        await seed();
        await claimSeat(anon());
        await assertFails(getDoc(doc(anon(), 'examApplications', TC)));
        await assertFails(getDocs(collection(anon(), 'entryDocs')));
        // ...but checking a T.C. that has NOT applied is allowed (duplicate check)
        await assertSucceeds(getDoc(doc(anon(), 'examApplications', TC2)));
    });

    test('applicant reads their entry document with T.C. + phone', async () => {
        await seed();
        await claimSeat(anon());
        const snap = await assertSucceeds(getDoc(doc(anon(), 'entryDocs', entryKey(TC, PHONE))));
        if (snap.data()?.hallName !== 'Salon 1') throw new Error('entry doc content mismatch');
        await assertSucceeds(getDoc(doc(anon(), 'entryDocs', entryKey(TC, '5999999999'))));
        if ((await getDoc(doc(anon(), 'entryDocs', entryKey(TC, '5999999999')))).exists()) {
            throw new Error('wrong phone must not find the entry doc');
        }
    });

    test('entry doc must be stored under the correct hash', async () => {
        await seed();
        await assertFails(claimSeat(anon(), { entryKeyOverride: entryKey(TC2, PHONE) }));
        await assertFails(claimSeat(anon(), { entryKeyOverride: 'attacker-chosen-id' }));
    });

    test('entry doc cannot be created or changed on its own', async () => {
        await seed();
        await assertFails(setDoc(doc(anon(), 'entryDocs', entryKey(TC, PHONE)), { tcId: TC, phoneNumber: PHONE }));
        await claimSeat(anon());
        await assertFails(updateDoc(doc(anon(), 'entryDocs', entryKey(TC, PHONE)), { hallName: 'X' }));
        await assertFails(deleteDoc(doc(anon(), 'entryDocs', entryKey(TC, PHONE))));
        await assertSucceeds(getDocs(collection(admin(), 'entryDocs')));
    });

    test('fails when applications are closed', async () => {
        await seed({ applicationEnabled: false });
        await assertFails(claimSeat(anon()));
    });

    test('cannot apply twice with the same T.C.', async () => {
        await seed();
        await claimSeat(anon());
        await assertFails(claimSeat(anon()));
    });

    test('cannot exceed hall capacity', async () => {
        await seed({ capacity: 1, studentCount: 1 });
        await assertFails(claimSeat(anon()));
    });

    test('cannot write the student record without bumping the counter', async () => {
        await seed();
        await assertFails(claimSeat(anon(), { skipHall: true }));
    });

    test('cannot bump the counter without creating a student', async () => {
        await seed();
        await assertFails(updateDoc(doc(anon(), 'schools/s1/examHalls/h1'), { studentCount: 1, lastAssignedTc: TC }));
    });

    test('cannot skip a seat number', async () => {
        await seed();
        await assertFails(claimSeat(anon(), { countOverride: 2 }));
    });

    test('cannot create the student record without the application', async () => {
        await seed();
        await assertFails(claimSeat(anon(), { skipApp: true }));
    });

    test('rejects extra fields, bad phone, bad T.C., wrong hall name', async () => {
        await seed();
        await assertFails(claimSeat(anon(), { override: { isAdmin: true } }));
        await assertFails(claimSeat(anon(), { override: { phoneNumber: '123' } }));
        await assertFails(claimSeat(anon(), { tc: '00000000000' }));
        await assertFails(claimSeat(anon(), { override: { hallName: 'Başka Salon' } }));
    });

    test('public cannot update or delete applications', async () => {
        await seed();
        await claimSeat(anon());
        await assertFails(updateDoc(doc(anon(), 'examApplications', TC), { phoneNumber: '5000000000' }));
        await assertFails(deleteDoc(doc(anon(), 'examApplications', TC)));
        await assertFails(setDoc(doc(anon(), 'examApplications', TC2), { tcId: TC2 }));
    });
});

describe('event applications', () => {
    beforeEach(() => seed());

    test('public can submit to an enabled event', async () => {
        await assertSucceeds(setDoc(doc(collection(anon(), 'eventApplications')), {
            ad: 'X', eventId: 'e1', eventName: 'Etkinlik', submittedAt: serverTimestamp()
        }));
    });

    test('rejected for unknown or disabled events, and cannot be read back', async () => {
        await assertFails(setDoc(doc(collection(anon(), 'eventApplications')), {
            eventId: 'nope', submittedAt: serverTimestamp()
        }));
        await assertFails(setDoc(doc(collection(anon(), 'eventApplications')), {
            eventId: 'e-off', submittedAt: serverTimestamp()
        }));
        await assertFails(getDocs(collection(anon(), 'eventApplications')));
    });
});
