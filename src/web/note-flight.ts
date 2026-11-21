// Notes moving in and out of a task fly there, so the reader sees where they
// went. Notes taken out of a task fly back to the My notes button, which then
// shows how many it received; on a phone the PDF view's button stands in while
// the PDF and its toolbar are hidden.
const settling = new WeakMap<HTMLElement, number>();

function visible(element: HTMLElement) {
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth;
}

function home() {
  return ['library', 'pdf'].flatMap(place => [...document.querySelectorAll<HTMLElement>(`[data-notes-home="${place}"]`)]).find(visible) || null;
}

function receive(target: HTMLElement, count: number) {
  clearTimeout(settling.get(target));
  target.classList.remove('notes-received');
  void target.offsetWidth; // Restart the pop when more notes arrive.
  target.dataset.received = `+${count}`;
  target.classList.add('notes-received');
  settling.set(target, window.setTimeout(() => { target.classList.remove('notes-received'); delete target.dataset.received; }, 1600));
}

// A copy of a card shrinks onto `destination` along a shallow arc.
function fly(ghost: HTMLElement, box: DOMRect, destination: DOMRect, delay = 0, direction: PlaybackDirection = 'normal') {
  const duration = 680;
  ghost.classList.add('note-flight');
  ghost.setAttribute('aria-hidden', 'true'); ghost.inert = true;
  // A popover's copy keeps its placement and entrance; the flight sets both.
  Object.assign(ghost.style, { left: '0', top: '0', width: `${box.width}px`, height: `${box.height}px`, maxHeight: 'none', visibility: 'visible', animation: 'none' });
  document.body.append(ghost);
  const scale = Math.min(destination.width / box.width, destination.height / box.height);
  const start = { x: box.left, y: box.top };
  const end = { x: destination.left + (destination.width - box.width * scale) / 2, y: destination.top + (destination.height - box.height * scale) / 2 };
  const arc = Math.min(110, Math.hypot(end.x - start.x, end.y - start.y) * .16 + 24);
  const frames = [0, .1, .3, .55, .8, 1].map(progress => {
    const travel = Math.max(0, (progress - .1) / .9), shrink = travel * travel;
    const x = start.x + (end.x - start.x) * travel;
    const y = Math.max(4, start.y + (end.y - start.y) * travel - Math.sin(travel * Math.PI) * arc);
    return { offset: progress, transform: `translate(${x}px, ${y}px) rotate(${-4 * Math.sin(travel * Math.PI)}deg) scale(${1 + (scale - 1) * shrink})`, opacity: 1 - .85 * Math.pow(travel, 5) };
  });
  const animation = ghost.animate(frames, { duration, delay, direction, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'both' });
  const land = () => ghost.remove();
  void animation.finished.then(land, land);
  // A hidden tab can hold the animation; never leave a card on screen.
  window.setTimeout(land, duration + delay + 1000);
  return animation;
}

function still() { return matchMedia('(prefers-reduced-motion: reduce)').matches; }

function pop(element: HTMLElement, name: string) {
  element.classList.remove(name);
  void element.offsetWidth; // Restart when another note arrives.
  element.classList.add(name);
  element.addEventListener('animationend', () => element.classList.remove(name), { once: true });
}

function copy(card: HTMLElement) {
  const ghost = card.cloneNode(true) as HTMLElement;
  // A clone keeps a textarea's initial text, not what was typed.
  const typed = card.querySelectorAll('textarea'), copies = ghost.querySelectorAll('textarea');
  typed.forEach((input, index) => { copies[index].value = input.value; });
  return ghost;
}

const references = () => [...document.querySelectorAll<HTMLElement>('.task-notes-panel [data-note]')];
const after = (then: () => void) => requestAnimationFrame(() => requestAnimationFrame(then));

// A note added to the task flies from its card to its place in the task, or
// to the New task tab when the task is out of view. Call this before the
// change and the returned function once the note is in the task.
export function noteToTask(card: HTMLElement) {
  const box = card.getBoundingClientRect(), ghost = copy(card), known = new Set(references().map(element => element.dataset.note));
  return () => after(() => {
    const arrived = references().find(element => !known.has(element.dataset.note));
    if (arrived && visible(arrived)) arrived.scrollIntoView({ block: 'nearest' });
    const target = arrived && visible(arrived) ? arrived : [...document.querySelectorAll<HTMLElement>('[data-task-home]')].find(visible);
    if (!target) return;
    const landed = () => { target.style.opacity = ''; pop(target, target === arrived ? 'note-arrived' : 'task-received'); };
    if (still() || !box.width) { landed(); return; }
    if (target === arrived) target.style.opacity = '0';
    void fly(ghost, box, target.getBoundingClientRect()).finished.then(landed, landed);
  });
}

// Taking a note back out from its card flies the task's copy back onto the
// card's button.
export function noteFromTask(id: string, card: HTMLElement) {
  const reference = references().find(element => element.dataset.note === id && visible(element));
  const button = card.querySelector<HTMLElement>('.note-send, .pdf-note-attach');
  const box = reference?.getBoundingClientRect(), ghost = reference && copy(reference);
  return () => after(() => {
    if (!button?.isConnected) return;
    const landed = () => pop(button, 'note-returned');
    if (!ghost || !box || still()) { landed(); return; }
    void fly(ghost, box, button.getBoundingClientRect()).finished.then(landed, landed);
  });
}

export function returnNotes(cards: HTMLElement[]) {
  const target = home();
  if (!target || !cards.length) return;
  if (still()) { receive(target, cards.length); return; }
  const destination = target.getBoundingClientRect();
  const flights = cards.slice(0, 5).flatMap((card, index) => {
    const box = card.getBoundingClientRect();
    return box.width && box.height ? [fly(card.cloneNode(true) as HTMLElement, box, destination, index * 70)] : [];
  });
  if (!flights.length) { receive(target, cards.length); return; }
  const arrive = () => receive(target, cards.length);
  void flights[0].finished.then(arrive, arrive);
}

const submittedFlights = new Map<string, Animation>();

// Both directions carry the annotation icon between the original note
// and the manuscript count, including when the review drawer shows the note.
export function animateSubmittedNote(key: string, source: HTMLElement, returned: boolean) {
  submittedFlights.get(key)?.cancel();
  const target = [...document.querySelectorAll<HTMLElement>('[data-notes-home="manuscript"]')].find(visible);
  if (!target || !visible(source)) return;
  if (still()) { if (returned) receive(target, 1); return; }
  const symbol = source.querySelector('.note-return-symbol');
  const icon = symbol?.querySelector(returned ? 'svg:first-child' : 'svg:last-child');
  if (!symbol || !icon) return;
  const card = document.createElement('div');
  card.className = 'submitted-note-flight';
  card.dataset.noteKey = key;
  card.append(icon.cloneNode(true));
  const rect = symbol.getBoundingClientRect();
  const box = new DOMRect(rect.left - 5, rect.top - 5, rect.width + 10, rect.height + 10);
  const count = target.querySelector('.manuscript-note-count') ?? target;
  const flight = fly(card, box, count.getBoundingClientRect(), 0, returned ? 'normal' : 'reverse');
  // Reveal the updated icon in its place when the moving copy arrives.
  const inTransit = symbol.animate({ opacity: [0, 0] }, { duration: flight.effect!.getTiming().duration });
  submittedFlights.set(key, flight);
  void flight.finished.then(() => { if (returned && target.isConnected) receive(target, 1); }, () => {}).finally(() => {
    inTransit.cancel();
    if (submittedFlights.get(key) === flight) submittedFlights.delete(key);
  });
}
