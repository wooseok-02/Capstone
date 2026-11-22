const pet = document.getElementById('pet');
const tip = document.getElementById('pet-tip');
let drag = null;
let tipTimer = null;

function showMessage(message, duration = 2600) {
  tip.textContent = message;
  tip.classList.add('visible');
  clearTimeout(tipTimer);
  tipTimer = setTimeout(() => tip.classList.remove('visible'), duration);
}

pet.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  drag = { x: event.screenX, y: event.screenY, moved: false };
  pet.setPointerCapture(event.pointerId);
});

pet.addEventListener('pointermove', (event) => {
  if (!drag) return;
  const dx = event.screenX - drag.x;
  const dy = event.screenY - drag.y;
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
  if (drag.moved && (dx || dy)) {
    pet.classList.add('dragging');
    window.koko?.movePet(dx, dy);
  }
  drag.x = event.screenX;
  drag.y = event.screenY;
});

pet.addEventListener('pointerup', (event) => {
  if (!drag) return;
  const moved = drag.moved;
  drag = null;
  pet.classList.remove('dragging');
  if (pet.hasPointerCapture(event.pointerId)) pet.releasePointerCapture(event.pointerId);
  if (!moved) window.koko?.openAuth();
});

pet.addEventListener('pointercancel', () => { drag = null; pet.classList.remove('dragging'); });
pet.addEventListener('contextmenu', (event) => { event.preventDefault(); window.koko?.showPetMenu(); });
window.koko?.onPetMessage((message) => showMessage(message));
setTimeout(() => showMessage('저를 눌러주세요!', 3500), 600);
