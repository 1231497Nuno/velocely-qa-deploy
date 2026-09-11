/** Impede valores negativos em <input type="number"> (preços, quantidades, tempos, …). */

const BLOCKED = new Set(["-", "+", "e", "E"]);

function isGuardedNumberInput(el) {
  return (
    el instanceof HTMLInputElement &&
    el.type === "number" &&
    el.dataset.allowNegative !== "true"
  );
}

function clampNegatives(el) {
  const raw = el.value;
  if (raw === "" || raw === ".") return;
  const n = Number(raw);
  if (Number.isFinite(n)) {
    if (n < 0) el.value = "0";
    return;
  }
  if (String(raw).includes("-")) el.value = "0";
}

export function installNonNegNumberInputs() {
  if (typeof document === "undefined" || document.documentElement.dataset.nonNegNumbers === "1") {
    return;
  }
  document.documentElement.dataset.nonNegNumbers = "1";

  document.addEventListener(
    "focusin",
    (e) => {
      if (!isGuardedNumberInput(e.target)) return;
      if (e.target.min === "") e.target.min = "0";
    },
    true,
  );

  document.addEventListener(
    "keydown",
    (e) => {
      if (!isGuardedNumberInput(e.target)) return;
      if (BLOCKED.has(e.key) || e.code === "Minus" || e.code === "NumpadSubtract") {
        e.preventDefault();
      }
    },
    true,
  );

  document.addEventListener(
    "beforeinput",
    (e) => {
      if (!isGuardedNumberInput(e.target)) return;
      const data = e.data;
      if (data && (data.includes("-") || data.includes("+") || /[eE]/.test(data))) {
        e.preventDefault();
      }
    },
    true,
  );

  document.addEventListener(
    "paste",
    (e) => {
      if (!isGuardedNumberInput(e.target)) return;
      const text = e.clipboardData?.getData("text") || "";
      const n = Number(text.replace(",", "."));
      if (Number.isFinite(n) && n < 0) {
        e.preventDefault();
        e.target.value = "0";
        e.target.dispatchEvent(new Event("input", { bubbles: true }));
      }
    },
    true,
  );

  document.addEventListener(
    "input",
    (e) => {
      if (!isGuardedNumberInput(e.target)) return;
      clampNegatives(e.target);
    },
    true,
  );
}
