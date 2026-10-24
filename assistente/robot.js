/* O rosto do robô: pisca, segue o dedo/mouse, mexe a boca enquanto fala e muda de expressão.
   Robot.mood('idle' | 'listening' | 'thinking' | 'happy' | 'sad' | 'sleep'), Robot.talk(true|false), Robot.word() */
const Robot = (() => {
  const el = document.getElementById('robot');
  let mood = 'idle', talking = false, mouthTimer = null, moodTimer = null;

  function setMood(m, ms) {
    clearTimeout(moodTimer);
    mood = m;
    el.classList.remove('idle', 'listening', 'thinking', 'happy', 'sad', 'sleep');
    el.classList.add(m);
    if (ms) moodTimer = setTimeout(() => setMood('idle'), ms);
  }

  /* piscadas aleatórias (às vezes duplas) */
  (function blinkLoop() {
    setTimeout(() => {
      if (!['happy', 'sleep'].includes(mood)) {
        el.classList.add('blink'); setTimeout(() => el.classList.remove('blink'), 130);
        if (Math.random() < 0.25) setTimeout(() => { el.classList.add('blink'); setTimeout(() => el.classList.remove('blink'), 120); }, 260);
      }
      blinkLoop();
    }, 2200 + Math.random() * 3200);
  })();

  /* os olhos acompanham o dedo/mouse; parado, olha em volta de vez em quando */
  let idleLook = null;
  function look(x, y) {
    const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height * 0.45;
    const dx = Math.max(-1, Math.min(1, (x - cx) / (r.width * 1.2))), dy = Math.max(-1, Math.min(1, (y - cy) / (r.height * 1.2)));
    el.style.setProperty('--lx', `${(dx * 10).toFixed(1)}px`); el.style.setProperty('--ly', `${(dy * 7).toFixed(1)}px`);
    clearTimeout(idleLook); idleLook = setTimeout(center, 2500);
  }
  function center() { el.style.setProperty('--lx', '0px'); el.style.setProperty('--ly', '0px'); }
  window.addEventListener('pointermove', e => look(e.clientX, e.clientY), { passive: true });
  window.addEventListener('pointerdown', e => look(e.clientX, e.clientY), { passive: true });
  setInterval(() => {
    if (mood !== 'idle' || talking) return;
    const r = el.getBoundingClientRect();
    look(r.left + Math.random() * r.width * 2 - r.width / 2, r.top + Math.random() * r.height);
  }, 6000);

  /* boca: abre e fecha enquanto fala; cada palavra dita dá um "pulo" maior */
  function talk(on) {
    talking = on; el.classList.toggle('talking', on);
    clearInterval(mouthTimer);
    if (on) mouthTimer = setInterval(() => el.style.setProperty('--open', (0.15 + Math.random() * 0.75).toFixed(2)), 110);
    else el.style.setProperty('--open', '0');
  }
  function word() { if (talking) el.style.setProperty('--open', '1'); }

  /* dança: balança no ritmo (bpm) e solta notas musicais */
  let dancando = false, notasTimer = null;
  function dance(on, bpm = 110) {
    bpm = Math.max(70, Math.min(170, bpm || 110));
    el.style.setProperty('--beat', `${(60 / bpm).toFixed(3)}s`);
    if (on === dancando) return;
    dancando = on; el.classList.toggle('dancing', on);
    clearInterval(notasTimer);
    if (on) notasTimer = setInterval(nota, 60000 / bpm * 2);
  }
  function nota() {
    const n = document.createElement('span'); n.className = 'note'; n.textContent = Math.random() < 0.5 ? '♪' : '♫';
    n.style.left = `${15 + Math.random() * 70}%`; n.style.setProperty('--dx', `${(Math.random() * 60 - 30).toFixed(0)}px`);
    el.appendChild(n); setTimeout(() => n.remove(), 2200);
  }

  return { mood: setMood, talk, word, dance, get current() { return mood; }, get dancando() { return dancando; } };
})();
