import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getDatabase, ref, onValue, set, update, get
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { firebaseConfig, GM_UID } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

const rootRef = ref(db, "schichttor");
const isGMPage = document.body.dataset.mode === "gm";

const ringIds = ["ring-outer", "ring-middle", "ring-inner"];
let currentState = null;
let remoteApplying = false;
let controlsAttached = false;
let gmControlsAttached = false;
let gmAuthorized = false;

function el(id) {
  return document.getElementById(id);
}

function randomAngle() {
  return Math.floor(Math.random() * 360);
}

function blankState() {
  return {
    version: 1,
    targets: [randomAngle(), randomAngle(), randomAngle()],
    rotations: [0, 0, 0],
    locked: [false, false, false],
    markers: {
      target: false,
      outer: false,
      middle: false,
      inner: false
    },
    solved: false
  };
}

function normalizeState(s) {
  const fallback = blankState();

  if (!s || typeof s !== "object") return fallback;

  return {
    version: 1,
    targets: Array.isArray(s.targets)
      ? s.targets.map(Number).slice(0, 3)
      : fallback.targets,
    rotations: Array.isArray(s.rotations)
      ? s.rotations.map(Number).slice(0, 3)
      : [0, 0, 0],
    locked: Array.isArray(s.locked)
      ? s.locked.map(Boolean).slice(0, 3)
      : [false, false, false],
    markers: {
      target: !!s.markers?.target,
      outer: !!s.markers?.outer,
      middle: !!s.markers?.middle,
      inner: !!s.markers?.inner
    },
    solved: !!s.solved
  };
}

async function ensureState() {
  const snap = await get(rootRef);
  if (!snap.exists() && gmAuthorized) {
    await set(rootRef, blankState());
  }
}

function applyRotation(i, sliderValue) {
  if (!currentState) return;

  const total =
    (Number(currentState.targets[i]) + Number(sliderValue)) % 360;

  el(ringIds[i])?.setAttribute(
    "transform",
    `rotate(${total} 340 210)`
  );
}

function isAligned(i) {
  if (!currentState) return false;

  const total =
    (Number(currentState.targets[i]) +
      Number(currentState.rotations[i])) %
    360;

  const diff = Math.min(total, 360 - total);
  return diff <= 6;
}

function setMarker(key, show) {
  const marker =
    key === "target"
      ? el("target-marker")
      : el(`notch-${key}`);

  if (marker) {
    marker.style.opacity = show ? "1" : "0";
  }
}

function render(state) {
  currentState = normalizeState(state);
  remoteApplying = true;

  for (let i = 0; i < 3; i++) {
    const slider = el(`slider-${i}`);
    const lock = el(`lock-${i}`);
    const status = el(`status-${i}`);

    if (!slider || !lock || !status) continue;

    slider.value = String(currentState.rotations[i] ?? 0);
    applyRotation(i, slider.value);

    const locked = !!currentState.locked[i];

    slider.disabled = locked;
    lock.textContent = locked ? "🔒" : "🔓";
    lock.disabled =
      locked || (i > 0 && !currentState.locked[i - 1]);

    status.textContent = locked ? "Ausgerichtet" : "";
  }

  setMarker("target", currentState.markers.target);
  setMarker(0, currentState.markers.outer);
  setMarker(1, currentState.markers.middle);
  setMarker(2, currentState.markers.inner);

  const solved = currentState.solved;

  if (el("solved-msg")) {
    el("solved-msg").style.display = solved ? "block" : "none";
  }

  for (const id of ringIds) {
    const ring = el(id);
    if (!ring) continue;

    ring.style.transition = "opacity 1.2s";
    ring.style.opacity = solved ? "0.15" : "1";
  }

  const glow = el("center-glow");
  if (glow) {
    glow.style.opacity = solved ? "1" : "0";
    glow.classList.toggle("on", solved);
  }

  if (isGMPage && gmAuthorized) {
    if (el("toggle-target"))
      el("toggle-target").checked = currentState.markers.target;
    if (el("toggle-0"))
      el("toggle-0").checked = currentState.markers.outer;
    if (el("toggle-1"))
      el("toggle-1").checked = currentState.markers.middle;
    if (el("toggle-2"))
      el("toggle-2").checked = currentState.markers.inner;
  }

  remoteApplying = false;
}

async function changeRotation(i, value) {
  if (!currentState || currentState.locked[i]) return;

  try {
    await set(
      ref(db, `schichttor/rotations/${i}`),
      Number(value)
    );
  } catch (err) {
    console.error("Rotation abgelehnt:", err);
  }
}

async function tryLock(i) {
  if (!currentState) return;
  if (i > 0 && !currentState.locked[i - 1]) return;

  if (isAligned(i)) {
    try {
      await set(ref(db, `schichttor/locked/${i}`), true);

      if (i === 2) {
        await set(ref(db, "schichttor/solved"), true);
      }
    } catch (err) {
      console.error("Lock abgelehnt:", err);
      if (el(`status-${i}`)) {
        el(`status-${i}`).textContent = "Aktion abgelehnt";
      }
    }
  } else {
    const row = el(`row-${i}`);

    if (row) {
      row.classList.remove("shake");
      void row.offsetWidth;
      row.classList.add("shake");
    }

    if (el(`status-${i}`)) {
      el(`status-${i}`).textContent =
        "Noch nicht ausgerichtet";
    }

    setTimeout(() => {
      if (
        currentState &&
        !currentState.locked[i] &&
        el(`status-${i}`)
      ) {
        el(`status-${i}`).textContent = "";
      }
    }, 1600);
  }
}

function attachPuzzleControls() {
  if (controlsAttached) return;
  controlsAttached = true;

  for (let i = 0; i < 3; i++) {
    const slider = el(`slider-${i}`);
    const lock = el(`lock-${i}`);

    if (!slider || !lock) continue;

    slider.addEventListener("input", (event) => {
      if (remoteApplying) return;

      applyRotation(i, event.target.value);
      changeRotation(i, event.target.value);
    });

    lock.addEventListener("click", () => tryLock(i));
  }

  onValue(rootRef, (snap) => {
    if (snap.exists()) {
      render(snap.val());
    }
  });

  onValue(ref(db, ".info/connected"), (snap) => {
    const connected = snap.val() === true;

    el("connection-dot")?.classList.toggle(
      "on",
      connected
    );

    if (el("connection-text")) {
      el("connection-text").textContent = connected
        ? "Live verbunden"
        : "Keine Verbindung";
    }
  });
}

function attachGMControls() {
  if (gmControlsAttached) return;
  gmControlsAttached = true;

  const markerMap = {
    "toggle-target": "target",
    "toggle-0": "outer",
    "toggle-1": "middle",
    "toggle-2": "inner"
  };

  for (const [id, key] of Object.entries(markerMap)) {
    el(id)?.addEventListener("change", async (event) => {
      try {
        await set(
          ref(db, `schichttor/markers/${key}`),
          !!event.target.checked
        );
      } catch (err) {
        console.error(err);
        alert(
          "Firebase hat diese GM-Aktion abgelehnt."
        );
      }
    });
  }

  el("new-puzzle")?.addEventListener(
    "click",
    async () => {
      try {
        await set(rootRef, blankState());
      } catch (err) {
        console.error(err);
        alert(
          "Firebase hat das Neu-Mischen abgelehnt."
        );
      }
    }
  );

  el("reset-positions")?.addEventListener(
    "click",
    async () => {
      try {
        await update(rootRef, {
          rotations: [0, 0, 0],
          locked: [false, false, false],
          solved: false
        });
      } catch (err) {
        console.error(err);
        alert(
          "Firebase hat das Zurücksetzen abgelehnt."
        );
      }
    }
  );

  el("hide-markers")?.addEventListener(
    "click",
    async () => {
      try {
        await set(
          ref(db, "schichttor/markers"),
          {
            target: false,
            outer: false,
            middle: false,
            inner: false
          }
        );
      } catch (err) {
        console.error(err);
        alert(
          "Firebase hat diese GM-Aktion abgelehnt."
        );
      }
    }
  );

  el("logout")?.addEventListener(
    "click",
    () => signOut(auth)
  );
}

if (!isGMPage) {
  attachPuzzleControls();
} else {
  const form = el("login-form");

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const errorBox = el("auth-error");
    const submitButton =
      form.querySelector('button[type="submit"]');

    if (errorBox) {
      errorBox.style.display = "none";
      errorBox.textContent = "";
    }

    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "Anmeldung läuft …";
    }

    try {
      await signInWithEmailAndPassword(
        auth,
        el("gm-email").value.trim(),
        el("gm-password").value
      );
    } catch (err) {
      console.error("Firebase-Loginfehler:", err);

      if (errorBox) {
        errorBox.textContent =
          `Anmeldung fehlgeschlagen (${err.code ?? "unbekannter Fehler"}).`;
        errorBox.style.display = "block";
      }
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = "Anmelden";
      }
    }
  });

  attachGMControls();

  onAuthStateChanged(auth, async (user) => {
    const loginCard = el("login-card");
    const gmContent = el("gm-content");
    const errorBox = el("auth-error");

    gmAuthorized =
      !!user && user.uid === GM_UID;

    if (gmAuthorized) {
      loginCard?.classList.add("hidden");
      gmContent?.classList.remove("hidden");

      if (el("gm-user")) {
        el("gm-user").textContent =
          `Angemeldet als ${user.email}`;
      }

      attachPuzzleControls();

      try {
        await ensureState();
      } catch (err) {
        console.error(
          "Initialisierung fehlgeschlagen:",
          err
        );
      }

      return;
    }

    gmContent?.classList.add("hidden");
    loginCard?.classList.remove("hidden");

    if (user) {
      console.warn(
        "Nicht freigegebene UID:",
        user.uid
      );

      if (errorBox) {
        errorBox.textContent =
          "Dieser Firebase-Benutzer ist nicht als GM freigegeben.";
        errorBox.style.display = "block";
      }

      await signOut(auth);
    }
  });
}
