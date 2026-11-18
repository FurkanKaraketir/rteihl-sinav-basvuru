import { collection, doc, getDocs, updateDoc } from 'firebase/firestore';
import { db } from '$lib/firebase';

/**
 * Admin-only: recompute `studentCount` on every exam hall from its
 * `students` subcollection.
 *
 * The public application form claims seats by incrementing `studentCount`
 * inside a transaction (the rules check it), because applicants are not
 * allowed to list other students. Admin tools add/move/delete students
 * directly, so call this after admin changes to keep the counter accurate.
 */
export async function syncHallCounts(): Promise<number> {
    let fixed = 0;
    const schoolsSnap = await getDocs(collection(db, 'schools'));
    for (const schoolDoc of schoolsSnap.docs) {
        const hallsSnap = await getDocs(collection(db, 'schools', schoolDoc.id, 'examHalls'));
        for (const hallDoc of hallsSnap.docs) {
            const studentsSnap = await getDocs(
                collection(db, 'schools', schoolDoc.id, 'examHalls', hallDoc.id, 'students')
            );
            if (hallDoc.data().studentCount !== studentsSnap.size) {
                await updateDoc(doc(db, 'schools', schoolDoc.id, 'examHalls', hallDoc.id), {
                    studentCount: studentsSnap.size
                });
                fixed++;
            }
        }
    }
    return fixed;
}
