// Exercise the browser's complete selection gesture. A synthetic pointerup
// after changing Selection skips focus, hit testing and native selection.
export async function dragPdfText(page, word) {
  await word.hover(); // Wait for a visible, stable target and scroll it into view.
  const box = await word.boundingBox();
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 0.5, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 0.5, y, { steps: 8 });
  await page.mouse.up();
}
