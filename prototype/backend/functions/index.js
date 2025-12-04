const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.firestore();

// Helper: tanggal hari ini (YYYY-MM-DD)
const getToday = () => new Date().toISOString().split("T")[0];

/**
 * generateTicket() → Publik (dipanggil dari halaman pelanggan)
 */
exports.generateTicket = functions.https.onCall(async (data, context) => {
  const today = getToday();
  const stateRef = db.doc("queue/state");

  return db.runTransaction(async (transaction) => {
    const stateSnap = await transaction.get(stateRef);
    let state = stateSnap.exists ? stateSnap.data() : { date: "", nextNumber: 1, currentNumber: 0 };

    // Reset otomatis tiap hari baru
    if (state.date !== today) {
      state = { date: today, nextNumber: 1, currentNumber: 0 };
    }

    const number = state.nextNumber;
    const ticketId = `ticket_${Date.now()}`;
    const ticketRef = db.collection("tickets").doc(ticketId);

    // Buat tiket baru
    transaction.set(ticketRef, {
      number: number,
      date: today,
      done: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Update counter
    transaction.set(stateRef, {
      date: today,
      nextNumber: number + 1,
      currentNumber: state.currentNumber,
    });

    return { ticketId, number };
  });
});

/**
 * callNext() → Admin only
 * data.setDone = true  → tandai DONE lalu next
 * data.setDone = false → SKIP (Missed) lalu next
 */
exports.callNext = functions.https.onCall(async (data, context) => {
  // Cek admin (email harus admin@example.com)
  if (!context.auth || context.auth.token.email !== "admin@example.com") {
    throw new functions.https.HttpsError("permission-denied", "Hanya admin!");
  }

  const today = getToday();
  const stateRef = db.doc("queue/state");
  const setDone = data.setDone !== false; // default true

  return db.runTransaction(async (transaction) => {
    const stateSnap = await transaction.get(stateRef);
    if (!stateSnap.exists || stateSnap.data().date !== today) {
      throw new functions.https.HttpsError("failed-precondition", "Antrian belum dimulai hari ini");
    }

    const state = stateSnap.data();
    const currentNum = state.currentNumber;

    // Jika ada nomor saat ini dan minta "Done", tandai done
    if (setDone && currentNum > 0) {
      const ticketSnap = await db
        .collection("tickets")
        .where("date", "==", today)
        .where("number", "==", currentNum)
        .limit(1)
        .get();

      if (!ticketSnap.empty) {
        transaction.update(ticketSnap.docs[0].ref, { done: true });
      }
    }

    // Naikkan nomor yang dipanggil
    transaction.update(stateRef, { currentNumber: currentNum + 1 });

    return { success: true, newCurrentNumber: currentNum + 1 };
  });
});

/**
 * resetQueue() → Admin only (reset ke 0 untuk hari ini)
 */
exports.resetQueue = functions.https.onCall(async (data, context) => {
  if (!context.auth || context.auth.token.email !== "admin@example.com") {
    throw new functions.https.HttpsError("permission-denied", "Hanya admin!");
  }

  const today = getToday();
  await db.doc("queue/state").set({
    date: today,
    currentNumber: 0,
    nextNumber: 1,
  });

  return { success: true };
});