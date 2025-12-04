//import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-functions-compat.js";

const db = firebase.firestore();
const functions = firebase.functions();

const today = new Date().toISOString().split('T')[0];
const stateRef = db.doc('queue/state');

// Elements dari index.html asli kamu
const takeQueueBtn = document.getElementById('takeQueueBtn');
const userTicketInfo = document.getElementById('userTicketInfo');
const userTicketNumber = document.getElementById('userTicketNumber');
const userTicketStatus = document.getElementById('userTicketStatus');
const userQueuePosition = document.getElementById('userQueuePosition');

const queueDisplay = document.getElementById('queueDisplay');
const waitingCount = document.getElementById('waitingCount');
const calledCount = document.getElementById('calledCount');
const missingCount = document.getElementById('missingCount');
const doneCount = document.getElementById('doneCount');

const notification = document.getElementById('notification');
const notificationText = document.getElementById('notificationText');

// Tanggal otomatis
const currentDateEl = document.getElementById("currentDate");
if (currentDateEl) {
    currentDateEl.textContent = new Date().toLocaleDateString("id-ID", {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

// Notifikasi sederhana
function showNotification(msg, duration = 3000) {
    if (!notification || !notificationText) return;
    notificationText.textContent = msg;
    notification.style.display = 'block';
    setTimeout(() => {
        notification.style.display = 'none';
    }, duration);
}

//Logika Status Ticket
function computeStatus(ticket, current) {
    if (ticket.done) return 'done';
    if (ticket.number < current) return 'missed';
    if (ticket.number === current) return 'called';
    return 'waiting';
}

// Hitung Posisi Antrian
function calculateQueuePosition(myNumber, allTickets, current) {
    let count = 0;
    allTickets.forEach(t => {
        if (typeof t.number !== 'number') return;
        if (t.done) return;
        if (t.number < myNumber && t.number > current) {
            count++;
        }
    });
    return count;
}

//Update Status UI Pelanggan
function updateCustomerTicketStatus(ticket, current, allTickets = []) {
    if (!ticket) return;

    const status = computeStatus(ticket, current);
    userTicketStatus.textContent = status.toUpperCase();

    const colors = {
        waiting: ["#E0F2FE", "#0369a1"],
        called: ["#FEF9C3", "#854d0e"],
        done: ["#DCFCE7", "#166534"],
        missed: ["#FEE2E2", "#b91c1c"],
    };

    const bg = colors[status] ? colors[status][0] : "#ffffff";
    const fg = colors[status] ? colors[status][1] : "#000000";

    userTicketStatus.style.background = bg;
    userTicketStatus.style.color = fg;
    userTicketStatus.style.padding = "8px 12px";
    userTicketStatus.style.borderRadius = "8px";
    userTicketStatus.style.display = "inline-block";

    // Posisi antrian
    if (status === "waiting") {
        const pos = calculateQueuePosition(ticket.number, allTickets, current);
        userQueuePosition.textContent = pos === 0 ? "Sebentar lagi" : `${pos} orang sebelum Anda`;
    } else if (status === "called") {
        userQueuePosition.textContent = "Sedang dipanggil";
    } else {
        userQueuePosition.textContent = "-";
    }
}

// Check user ticket dari localStorage
let userTicketUnsubscribe = null;
function checkUserTicket() {
    const ticketId = localStorage.getItem('userTicketId');
    if (!ticketId) {
        // pastikan tampilan reset
        userTicketInfo.style.display = 'none';
        takeQueueBtn.style.display = 'inline-block';
        return;
    }

    // jika sudah ada listener sebelumnya, lepaskan
    if (typeof userTicketUnsubscribe === 'function') {
        userTicketUnsubscribe();
        userTicketUnsubscribe = null;
    }

    // pasang listener realtime pada dokumen tiket user
    userTicketUnsubscribe = db.collection('tickets').doc(ticketId).onSnapshot(doc => {
        if (!doc.exists) {
            // ticket dihapus/ga ada => bersihkan localStorage
            localStorage.removeItem('userTicketId');
            showNotification('Tiket tidak ditemukan. Silakan ambil nomor lagi.');
            userTicketInfo.style.display = 'none';
            takeQueueBtn.style.display = 'inline-block';
            return;
        }

        const ticket = doc.data();
        // tampilkan nomor
        if (typeof ticket.number !== 'undefined') {
            userTicketNumber.textContent = ticket.number;
            userTicketInfo.style.display = 'block';
            takeQueueBtn.style.display = 'none';
        } else {
            userTicketInfo.style.display = 'none';
            takeQueueBtn.style.display = 'inline-block';
        }
        // NOTE: status/position akan diupdate dari central listener (state+allTickets)
        // namun kita bisa juga update partial di sini jika ingin (kosong)
    });
}

// Ambil nomor antrian
takeQueueBtn.addEventListener('click', async () => {
    takeQueueBtn.disabled = true;
    const prevText = takeQueueBtn.textContent;
    takeQueueBtn.textContent = 'Memproses...';

    try {
        // gunakan compat callable
        const generateTicketCallable = functions.httpsCallable('generateTicket');
        const result = await generateTicketCallable();
        // result.data expected: { ticketId, number }
        const { ticketId, number } = result.data || {};

        if (!ticketId) throw new Error('Tidak menerima ticketId');

        localStorage.setItem('userTicketId', ticketId);
        showNotification(`Nomor Antrian Anda: ${number}`, 4000);
        checkUserTicket();
    } catch (err) {
        console.error('Error mengambil nomor:', err);
        showNotification('Gagal mengambil nomor. Coba lagi.');
    } finally {
        takeQueueBtn.disabled = false;
        takeQueueBtn.textContent = prevText || 'Ambil Nomor Antrian';
    }
});

// Realtime update dashboard
let ticketsUnsubscribe = null;

stateRef.onSnapshot(stateDoc => {
    const state = stateDoc.exists ? (stateDoc.data() || {}) : { currentNumber: 0, nextNumber: 1 };
    const current = typeof state.currentNumber === 'number' ? state.currentNumber : (state.currentNumber ? Number(state.currentNumber) : 0);

    // pastikan kita tidak memasang lebih dari satu listener untuk collection tickets
    if (typeof ticketsUnsubscribe === 'function') {
        ticketsUnsubscribe();
        ticketsUnsubscribe = null;
    }

    ticketsUnsubscribe = db.collection('tickets').where('date', '==', today).onSnapshot(snap => {
        // kumpulkan semua tickets
        const allTickets = [];
        let waiting = 0, called = 0, missed = 0, done = 0;

        snap.forEach(doc => {
            const t = doc.data();
            // ensure number is Number
            if (t && typeof t.number !== 'undefined') {
                t.number = typeof t.number === 'number' ? t.number : Number(t.number);
                allTickets.push(t);

                const status = computeStatus(t, current);
                if (status === 'waiting') waiting++;
                else if (status === 'called') called++;
                else if (status === 'missed') missed++;
                else if (status === 'done') done++;
            }
        });

        // update dashboard counts
        if (waitingCount) waitingCount.textContent = waiting;
        if (calledCount) calledCount.textContent = called;
        if (missingCount) missingCount.textContent = missed;
        if (doneCount) doneCount.textContent = done;

        // tampilkan nextNumber - 1 sebagai current display (sama seperti sebelumnya)
        if (queueDisplay) {
            if (typeof state.nextNumber === 'number') {
                queueDisplay.textContent = state.nextNumber > 0 ? (state.nextNumber - 1) : 0;
            } else {
                queueDisplay.textContent = (state.nextNumber ? (Number(state.nextNumber) - 1) : 0);
            }
        }

        // Update Status Pelanggan jika ada ticketId di localStorage
        const myId = localStorage.getItem('userTicketId');
        if (myId) {
            db.collection('tickets').doc(myId).get().then(myDoc => {
                if (myDoc.exists) {
                    const myTicket = myDoc.data();
                    updateCustomerTicketStatus(myTicket, current, allTickets);
                } else {
                    // tiket tidak ditemukan (mungkin sudah dihapus)
                    userTicketInfo.style.display = 'none';
                    takeQueueBtn.style.display = 'inline-block';
                    localStorage.removeItem('userTicketId');
                }
            }).catch(err => {
                console.error('Gagal mengambil tiket user:', err);
            });
        }
    }, err => {
        console.error('Snapshot tickets error:', err);
    });
});

// Inisialisasi awal pengecekan tiket user
checkUserTicket();