import type { CallStatus } from "@/types/call";

// Extract a phone number from a WhatsApp JID, including device and LID suffixes. Format recognized
// Brazilian numbers as +55 (area) number and return other numbers as +digits.
export const phoneFromJid = (jid: string): string => {
  if (!jid) return "";
  const user = jid.split("@")[0].split(":")[0].split(".")[0];
  const d = user.replace(/\D/g, "");
  if (!d) return "";
  // Brazil: 55 + two-digit area code + eight or nine digits.
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) {
    const ddd = d.slice(2, 4);
    const rest = d.slice(4);
    const mid = rest.length === 9 ? `${rest.slice(0, 5)}-${rest.slice(5)}` : `${rest.slice(0, 4)}-${rest.slice(4)}`;
    return `+55 (${ddd}) ${mid}`;
  }
  return `+${d}`;
};

export const formatCallDuration = (startedAt: number, status: CallStatus): string => {
  if (status !== "connected") return status;
  const s = Math.floor((Date.now() - startedAt) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
