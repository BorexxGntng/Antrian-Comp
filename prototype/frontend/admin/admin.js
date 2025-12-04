const auth = firebase.auth();
const db = firebase.firestore();
const functions = firebase.functions();

auth.onAuthStateChanged(user => {
    if (!user) window.location.href = 'login.html';
});

const today = new Date().toISOString().split('T')[0];
const stateRef = db.doc('queue/state');

document.getElementById('currentDate').textContent = new Date().toLocaleDateString('id-ID');

document.getElementById('callNextBtn').addEventListener('click', async () => {
    const callNext = httpsCallable(functions, 'callNext');
    await callNext({ setDone: true });
    showNotification('Nomor berikutnya dipanggil & ditandai selesai');
});

document.getElementById('skipBtn').addEventListener('click', async () => {
    const callNext = httpsCallable(functions, 'callNext');
    await callNext({ setDone: false });
    showNotification('Nomor dilewati (Missed)');
});

document.getElementById('resetBtn').addEventListener('click', async () => {
    if (confirm('Yakin reset antrian hari ini?')) {
        const resetQueue = httpsCallable(functions, 'resetQueue');
        await resetQueue();
        showNotification('Antrian telah direset');
    }
});

function showNotification(msg) {
    const notif = document.getElementById('notification');
    document.getElementById('notificationText').textContent = msg;
    notif.style.display = 'block';
    setTimeout(() => notif.style.display = 'none', 3000);
}

// Realtime update
stateRef.onSnapshot(doc => {
    const state = doc.data() || { currentNumber: 0 };
    document.getElementById('currentCalled').textContent = state.currentNumber;

    db.collection('tickets').where('date', '==', today).onSnapshot(snap => {
        let waiting = 0, called = 0, missed = 0, done = 0;
        snap.forEach(d => {
            const t = d.data();
            const status = t.done ? 'done' : 
                          t.number < state.currentNumber ? 'missed' :
                          t.number === state.currentNumber ? 'called' : 'waiting';
            if (status === 'waiting') waiting++;
            if (status === 'called') called++;
            if (status === 'missed') missed++;
            if (status === 'done') done++;
        });
        document.getElementById('waitingCount').textContent = waiting;
        document.getElementById('calledCount').textContent = called;
        document.getElementById('missingCount').textContent = missed;
        document.getElementById('doneCount').textContent = done;
    });
});