const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
admin.initializeApp();

/**
 * Resolves a username to whatever email should currently be used to sign in with it.
 * Runs with Admin SDK privileges (bypasses Firestore rules) so it works whether the
 * account is still on its synthetic @ascension.local address or has since verified a
 * real one - the client never needs to know which.
 *
 * Deliberately does not distinguish "no such username" from "found" in its response
 * shape, and never returns anything beyond the single resolved email string.
 */
exports.resolveLoginEmail = onCall(async (request) => {
  const username = ((request.data && request.data.username) || '').trim().toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/.test(username)) {
    throw new HttpsError('invalid-argument', 'Invalid username format.');
  }
  const fallback = username + '@ascension.local';
  try {
    const snap = await admin.firestore()
      .collection('users')
      .where('username', '==', username)
      .limit(1)
      .get();
    if (snap.empty) return { email: fallback };
    const uid = snap.docs[0].id;
    const userRecord = await admin.auth().getUser(uid);
    return { email: userRecord.email || fallback };
  } catch (e) {
    return { email: fallback };
  }
});
