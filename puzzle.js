import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getDatabase, ref, onValue, set, update, get, onDisconnect
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const rootRef = ref(db, "schichttor");
const mode = document.body.dataset.mode || "player";
const isGM = mode === "gm";

const ringIds = ["ring-outer", "ring-middle", "ring-inner"];
let currentState = null;
let remoteApplying = false;

function blankState() {
  return {
    version: 1,
    targets: [randomAngle(), randomAngle(), randomAngle()],
    rotations: [0,0,0],
    locked: [false,false,false],
    markers: { target:false, outer:false, middle:false, inner:false },
    solved: false
  };
}
function randomAngle(){ return Math.floor(Math.random()*360); }

function normalizeState(s){
  const b = blankState();
  if(!s || typeof s !== "object") return b;
  return {
    version: 1,
    targets: Array.isArray(s.targets) ? s.targets.map(Number).slice(0,3) : b.targets,
    rotations: Array.isArray(s.rotations) ? s.rotations.map(Number).slice(0,3) : b.rotations,
    locked: Array.isArray(s.locked) ? s.locked.map(Boolean).slice(0,3) : b.locked,
    markers: {
      target: !!s.markers?.target,
      outer: !!s.markers?.outer,
      middle: !!s.markers?.middle,
      inner: !!s.markers?.inner
    },
    solved: !!s.solved
  };
}

async function ensureState(){
  const snap = await get(rootRef);
  if(!snap.exists()){
    await set(rootRef, blankState());
  }
}

function applyRotation(i, sliderValue){
  if(!currentState) return;
  const total = (Number(currentState.targets[i]) + Number(sliderValue)) % 360;
  document.getElementById(ringIds[i]).setAttribute("transform", `rotate(${total} 340 210)`);
}

function aligned(i){
  if(!currentState) return false;
  const total = (Number(currentState.targets[i]) + Number(currentState.rotations[i])) % 360;
  const diff = Math.min(total, 360-total);
  return diff <= 6;
}

function render(state){
  currentState = normalizeState(state);
  remoteApplying = true;

  for(let i=0;i<3;i++){
    const slider = document.getElementById(`slider-${i}`);
    const lock = document.getElementById(`lock-${i}`);
    const status = document.getElementById(`status-${i}`);

    slider.value = String(currentState.rotations[i] ?? 0);
    applyRotation(i, slider.value);

    const isLocked = !!currentState.locked[i];
    slider.disabled = isLocked;
    lock.textContent = isLocked ? "🔒" : "🔓";
    lock.disabled = isLocked || (i>0 && !currentState.locked[i-1]);
    status.textContent = isLocked ? "Ausgerichtet" : "";
  }

  setMarker("target", currentState.markers.target);
  setMarker(0, currentState.markers.outer);
  setMarker(1, currentState.markers.middle);
  setMarker(2, currentState.markers.inner);

  const solved = currentState.solved;
  document.getElementById("solved-msg").style.display = solved ? "block" : "none";
  for(const id of ringIds){
    document.getElementById(id).style.transition = "opacity 1.2s";
    document.getElementById(id).style.opacity = solved ? "0.15" : "1";
  }
  const glow = document.getElementById("center-glow");
  glow.style.opacity = solved ? "1" : "0";
  glow.classList.toggle("on", solved);

  if(isGM){
    document.getElementById("toggle-target").checked = currentState.markers.target;
    document.getElementById("toggle-0").checked = currentState.markers.outer;
    document.getElementById("toggle-1").checked = currentState.markers.middle;
    document.getElementById("toggle-2").checked = currentState.markers.inner;
  }

  remoteApplying = false;
}

function setMarker(key, show){
  const el = key === "target"
    ? document.getElementById("target-marker")
    : document.getElementById(`notch-${key}`);
  if(el) el.style.opacity = show ? "1" : "0";
}

async function changeRotation(i, value){
  if(!currentState || currentState.locked[i]) return;
  await set(ref(db, `schichttor/rotations/${i}`), Number(value));
}

async function tryLock(i){
  if(!currentState) return;
  if(i>0 && !currentState.locked[i-1]) return;

  if(aligned(i)){
    const patch = {};
    patch[`locked/${i}`] = true;
    if(i === 2) patch["solved"] = true;
    await update(rootRef, patch);
  } else {
    const row = document.getElementById(`row-${i}`);
    row.classList.remove("shake");
    void row.offsetWidth;
    row.classList.add("shake");
    document.getElementById(`status-${i}`).textContent = "Noch nicht ausgerichtet";
    setTimeout(()=>{
      if(currentState && !currentState.locked[i]){
        document.getElementById(`status-${i}`).textContent = "";
      }
    }, 1600);
  }
}

for(let i=0;i<3;i++){
  const slider = document.getElementById(`slider-${i}`);
  slider.addEventListener("input", e => {
    if(remoteApplying) return;
    applyRotation(i, e.target.value); // sofort lokal
    changeRotation(i, e.target.value); // dann synchronisieren
  });
  document.getElementById(`lock-${i}`).addEventListener("click", ()=>tryLock(i));
}

if(isGM){
  const markerMap = {
    "toggle-target": "target",
    "toggle-0": "outer",
    "toggle-1": "middle",
    "toggle-2": "inner"
  };
  for(const [id,key] of Object.entries(markerMap)){
    document.getElementById(id).addEventListener("change", async e=>{
      await set(ref(db, `schichttor/markers/${key}`), !!e.target.checked);
    });
  }

  document.getElementById("new-puzzle").addEventListener("click", async ()=>{
    await set(rootRef, blankState());
  });

  document.getElementById("reset-positions").addEventListener("click", async ()=>{
    await update(rootRef, {
      rotations:[0,0,0],
      locked:[false,false,false],
      solved:false
    });
  });

  document.getElementById("hide-markers").addEventListener("click", async ()=>{
    await set(ref(db, "schichttor/markers"), {
      target:false, outer:false, middle:false, inner:false
    });
  });
}

onValue(rootRef, snap=>{
  if(snap.exists()) render(snap.val());
});

const connectedRef = ref(db, ".info/connected");
onValue(connectedRef, snap=>{
  const connected = snap.val() === true;
  document.getElementById("connection-dot").classList.toggle("on", connected);
  document.getElementById("connection-text").textContent = connected ? "Live verbunden" : "Keine Verbindung";
});

ensureState().catch(err=>{
  console.error(err);
  document.getElementById("connection-text").textContent = "Firebase-Fehler – Konsole prüfen";
});
