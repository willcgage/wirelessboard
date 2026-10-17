/**
 * How much of a photograph to show inside a card (#172).
 *
 * The board draws a photo with `object-fit: cover`, which fills the card and
 * throws away whatever does not fit. On a wall that is twelve columns wide the
 * card is about 160px across and the venue's photographs are 1920x1080, so
 * cover scales by height and **688px goes off each side — you see 10% of the
 * picture**. Measured on the venue board, not estimated.
 *
 * ⭐ The maintainer asked for the treatment ProPresenter uses: show the whole
 * photograph, and fill the space around it with a blurred, darkened copy of
 * itself rather than a black bar. With one qualification, in their words:
 * *"I'm ok with a little cropping."*
 *
 * That qualification is this module. Pure `contain` never crops but leaves the
 * subject small; `cover` fills but cuts faces. `photoScale` returns a
 * multiplier applied on top of `contain`, capped so a picture can never lose
 * more than `MAX_CROP` of a dimension:
 *
 *     maxCrop 0     nothing cropped, the most blurred filler
 *     maxCrop 0.29  the default -- a little cropping, as asked for
 *     maxCrop 1     exactly today's behaviour
 *
 * ⭐ It depends only on the two **aspect ratios**, never on absolute pixels,
 * which is what lets it be decided here and tested without a browser.
 */

/**
 * ⛔⛔ **A cap on the crop, not a blend toward it.** The first version of this
 * pushed a fixed fraction of the way from `contain` to `cover`, and its own
 * test caught why that cannot work: the right fraction is not the same for
 * every card. On the two-row card 0.45 of the way was ideal; on the one-row
 * card — the one the dock rule actually produces — the shapes disagree by
 * **9.6x**, so 0.45 of the way is still a 4.9x scale and still shows **21%** of
 * the picture. One number cannot serve both.
 *
 * Capping the crop does serve both, and says something an operator can hold:
 * **a photograph never loses more than this fraction of a dimension.** Past
 * that it is shown whole and the gap is filled with a blurred copy.
 *
 * ⭐ A happy consequence: a picture already close to the card's shape never
 * reaches the cap, so it fills the card exactly as it does today and no blur
 * appears at all. The treatment only shows up where it is earned.
 */
export const MAX_CROP = 0.29;

function ratio(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return null;
  }
  return w / h;
}

/**
 * How badly the picture and the card disagree, as `cover / contain`.
 *
 * 1 means they are the same shape and cover crops nothing. 2 means cover throws
 * away half of one dimension.
 */
export function aspectMismatch(imgW, imgH, boxW, boxH) {
  const image = ratio(imgW, imgH);
  const box = ratio(boxW, boxH);
  if (image === null || box === null) {
    return null;
  }
  return Math.max(box / image, image / box);
}

/**
 * The multiplier to apply on top of `object-fit: contain`.
 *
 * ⛔ Never a fixed number. A 1.45 scale on everything would crop a photograph
 * whose shape already matches the card *more than `cover` does* — the exact
 * fault being fixed, reintroduced on the pictures that were fine.
 */
export function photoScale(imgW, imgH, boxW, boxH, maxCrop = MAX_CROP) {
  const mismatch = aspectMismatch(imgW, imgH, boxW, boxH);
  if (mismatch === null) {
    return 1;
  }
  const c = Number(maxCrop);
  const safe = Number.isFinite(c) ? Math.min(Math.max(c, 0), 0.95) : MAX_CROP;
  // Losing `safe` of a dimension means drawing it 1/(1-safe) times too wide.
  const cap = 1 / (1 - safe);
  return Math.min(mismatch, cap);
}

/**
 * How much of the picture's width survives, 0..1. Reporting only — it is what
 * makes "you see 10% of the photograph" a measurement rather than a complaint.
 */
export function visibleFraction(imgW, imgH, boxW, boxH, maxCrop = MAX_CROP) {
  const image = ratio(imgW, imgH);
  const box = ratio(boxW, boxH);
  if (image === null || box === null) {
    return 1;
  }
  const scale = photoScale(imgW, imgH, boxW, boxH, maxCrop);
  // Width of the drawn image relative to the card, once contain and the scale
  // above are applied. Anything over 1 is cropped off the sides.
  const drawn = (image >= box ? 1 : image / box) * scale;
  return drawn <= 1 ? 1 : 1 / drawn;
}

/**
 * The blur radius for the filler, in pixels.
 *
 * ⚠️ Proportional to the card, not fixed: 18px reads as a soft wash on a
 * 320px card and as fog on a 160px one. Clamped so a very large card does not
 * blur so far that the filler becomes a flat colour.
 */
export function blurRadius(boxW, boxH) {
  const w = Number(boxW);
  const h = Number(boxH);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return 16;
  }
  return Math.min(48, Math.max(6, Math.min(w, h) * 0.06));
}
