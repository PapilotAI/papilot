// Each native UI scene acts out a short sequence without accepting user input.
// Timers run only while the example is visible; there are no API requests.
const scenes = {
  annotate: { steps: [1800, 2400, 1800, 1600] },
  review: { steps: [2400, 1200, 3000] },
  read: { steps: [2400, 2200, 2400] },
  commit: { steps: [1400, 1400, 2000, 1200, 1600] },
};
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

for (const demo of document.querySelectorAll('[data-demo]')) {
  const panels = [...demo.querySelectorAll('[data-scene]')];
  let scene = 0, phase = 0, visible = false, timer = null;
  let remaining = scenes[panels[0].dataset.scene].steps[0], deadline = 0;
  let typing = null, typingTimer = null;
  const originalText = new Map([...demo.querySelectorAll('.typed-copy [lang]')].map(span => [span, span.textContent]));

  function writeCharacters() {
    typingTimer = null;
    if (!typing) return;
    typing.step = reducedMotion.matches ? 30 : typing.step + 1;
    for (const span of typing.spans) {
      const full = originalText.get(span);
      span.textContent = full.slice(0, Math.ceil(full.length * typing.step / 30));
    }
    if (typing.step < 30) typingTimer = setTimeout(writeCharacters, 45);
    else typing = null;
  }

  function render() {
    clearTimeout(typingTimer);
    typingTimer = null;
    typing = null;
    for (const [span, full] of originalText) span.textContent = full;
    for (const [index, panel] of panels.entries()) {
      panel.hidden = index !== scene;
      panel.dataset.phase = index === scene ? phase : 0;
    }
    const key = panels[scene].dataset.scene;
    if ((key === 'annotate' && phase === 1) || (key === 'commit' && phase === 2)) {
      typing = { step: 0, spans: [...panels[scene].querySelectorAll('.typed-copy [lang]')] };
      for (const span of typing.spans) span.textContent = '';
    }
  }

  function advance() {
    timer = null;
    phase++;
    if (phase >= scenes[panels[scene].dataset.scene].steps.length) {
      phase = 0;
      scene = (scene + 1) % panels.length;
    }
    render();
    remaining = scenes[panels[scene].dataset.scene].steps[phase];
    schedule();
  }

  function schedule() {
    const running = visible && !document.hidden;
    demo.classList.toggle('is-playing', running);
    if (!running) {
      clearTimeout(typingTimer);
      typingTimer = null;
    } else if (typing && typingTimer === null) {
      writeCharacters();
    }
    if (!running && timer !== null) {
      remaining = Math.max(0, deadline - performance.now());
      clearTimeout(timer);
      timer = null;
    } else if (running && timer === null) {
      deadline = performance.now() + remaining;
      timer = setTimeout(advance, remaining);
    }
  }

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => {
      visible = entries[0].isIntersecting;
      schedule();
    }).observe(demo);
  } else {
    visible = true;
    schedule();
  }
  document.addEventListener('visibilitychange', schedule);
}
