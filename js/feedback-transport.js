// Uses the existing Firestore database; no callable Functions or new service.
export function createFeedbackWriter({ db, auth, collection, doc, setDoc, serverTimestamp }) {
  return async function submitFeedback(input = {}, expectedOwnerId) {
    const ownerId = String(auth?.currentUser?.uid || 'guest');
    if (expectedOwnerId && ownerId !== expectedOwnerId) {
      throw Object.assign(new Error('Feedback account changed.'), { code: 'feedback/auth-changed' });
    }
    const rating = Number(input.rating);
    const message = String(input.message || '').trim();
    const optionalName = ownerId === 'guest' ? String(input.optionalName || '').trim() : '';
    if (!Number.isInteger(rating) || rating < 1 || rating > 5 || message.length > 1600 || optionalName.length > 80) {
      throw Object.assign(new Error('Invalid feedback.'), { code: 'feedback/invalid-input' });
    }
    if (!db) throw Object.assign(new Error('Feedback unavailable.'), { code: 'feedback/unavailable' });
    const reference = doc(collection(db, 'feedback'));
    await setDoc(reference, {
      schemaVersion: 2,
      rating,
      message,
      optionalName,
      ownerId,
      submittedAt: serverTimestamp(),
    });
    return { accepted: true, id: reference.id, ownerId };
  };
}
