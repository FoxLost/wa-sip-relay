export const copyText = async (value: string): Promise<void> => {
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Fall through to the legacy path while the click still has user activation.
    }
  }

  const input = document.createElement("textarea");
  input.value = value;
  input.readOnly = true;
  input.style.position = "fixed";
  input.style.inset = "0 auto auto -9999px";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.focus();
  input.select();
  input.setSelectionRange(0, value.length);

  try {
    if (!document.execCommand("copy")) throw new Error("Copy command was rejected");
  } finally {
    input.remove();
  }
};
