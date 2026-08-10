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
const mode = document.body.dataset.mode || "player";
const isGM = mode === "gm";
let gmAuthorized = false;

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
  if(!snap.exists() && gmAuthorized){
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

  function attachPuzzleControls(){
  for(let i=0;i<3;i++){
    const slider=document.getElementById(`slider-${i}`);
    const lock=document.getElementById(`lock-${i}`);
    if(!slider || !lock) continue;
    slider.addEventListener("input", e => {
      if(remoteApplying) return;
      applyRotation(i, e.target.value);
      changeRotation(i, e.target.value);
    });
    lock.addEventListener("click", ()=>tryLock(i));
  }

  onValue(rootRef, snap=>{ if(snap.exists()) render(snap.val()); });
  const connectedRef=ref(db, ".info/connected");
  onValue(connectedRef, snap=>{
    const connected=snap.val()===true;
    const dot=document.getElementById("connection-dot");
    const txt=document.getElementById("connection-text");
    if(dot) dot.classList.toggle("on", connected);
    if(txt) txt.textContent=connected?"Live verbunden":"Keine Verbindung";
  });
}

function attachGMControls(){
  const markerMap={"toggle-target":"target","toggle-0":"outer","toggle-1":"middle","toggle-2":"inner"};
  for(const [id,key] of Object.entries(markerMap)){
    document.getElementById(id)?.addEventListener("change", async e=>{
      try { await set(ref(db, `schichttor/markers/${key}`), !!e.target.checked); }
      catch(err){ console.error(err); alert("Firebase hat diese GM-Aktion abgelehnt."); }
    });
  }
  document.getElementById("new-puzzle")?.addEventListener("click", async ()=>{
    try { await set(rootRef, blankState()); }
    catch(err){ console.error(err); alert("Firebase hat das Neu-Mischen abgelehnt."); }
  });
  document.getElementById("reset-positions")?.addEventListener("click", async ()=>{
    try { await update(rootRef,{rotations:[0,0,0],locked:[false,false,false],solved:false}); }
    catch(err){ console.error(err); alert("Firebase hat das Zurücksetzen abgelehnt."); }
  });
  document.getElementById("hide-markers")?.addEventListener("click", async ()=>{
    try { await set(ref(db,"schichttor/markers"),{target:false,outer:false,middle:false,inner:false}); }
    catch(err){ console.error(err); alert("Firebase hat diese GM-Aktion abgelehnt."); }
  });
  document.getElementById("logout")?.addEventListener("click", ()=>signOut(auth));
}

if(!isGM){
  attachPuzzleControls();
}else{
  attachGMControls();
  const form=document.getElementById("login-form");
  form?.addEventListener("submit", async e=>{
    e.preventDefault();
    const box=document.getElementById("auth-error");
    box.style.display="none";
    try {
      await signInWithEmailAndPassword(auth, document.getElementById("gm-email").value.trim(), document.getElementById("gm-password").value);
    } catch(err) {
      console.error(err);
      box.textContent="Anmeldung fehlgeschlagen. Prüfe E-Mail-Adresse und Passwort.";
      box.style.display="block";
    }
  });

  onAuthStateChanged(auth, async user=>{
    const login=document.getElementById("login-card");
    const content=document.getElementById("gm-content");
    const box=document.getElementById("auth-error");
    gmAuthorized=!!user && user.uid===GM_UID;
    if(gmAuthorized){
      login.classList.add("hidden");
      content.classList.remove("hidden");
      document.getElementById("gm-user").textContent=`Angemeldet als ${user.email}`;
      attachPuzzleControls();
      await ensureState();
    }else{
      content.classList.add("hidden");
      login.classList.remove("hidden");
      if(user){
        box.textContent="Dieser Firebase-Benutzer ist nicht als GM freigegeben.";
        box.style.display="block";
        await signOut(auth);
      }
    }
  });
}
