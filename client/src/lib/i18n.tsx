import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Language = "en" | "id";

type Values = Record<string, string | number>;
type LanguageContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (english: string, values?: Values) => string;
};

const STORAGE_KEY = "wa-sip-relay.language";

const indonesian: Record<string, string> = {
  "Language": "Bahasa",
  "English": "Inggris",
  "Indonesian": "Indonesia",
  "Copy": "Salin",
  "Copy {{label}}": "Salin {{label}}",
  "Copied": "Tersalin",
  "Could not copy": "Tidak dapat menyalin",
  "Operation failed": "Operasi gagal",
  "WhatsApp voice accounts bridged to SIP.": "Akun suara WhatsApp yang dihubungkan ke SIP.",
  "Add account": "Tambah akun",
  "Account limit reached ({{count}})": "Batas akun tercapai ({{count}})",
  "Create a WhatsApp relay account": "Buat akun relay WhatsApp",
  "Each linked account receives independent SIP credentials and routing.": "Setiap akun tertaut mendapatkan kredensial dan perutean SIP tersendiri.",
  "Create account": "Buat akun",
  "WhatsApp accounts": "Akun WhatsApp",
  "Not linked": "Belum tertaut",
  "Online": "Online",
  "Pair": "Tautkan",
  "WhatsApp connected": "WhatsApp terhubung",
  "Pairing required": "Perlu ditautkan",
  "No linked number": "Tidak ada nomor tertaut",
  "Unlink": "Putuskan tautan",
  "Delete": "Hapus",
  "Delete {{name}} and its stored WhatsApp device?": "Hapus {{name}} beserta perangkat WhatsApp yang tersimpan?",
  "Add WhatsApp account": "Tambah akun WhatsApp",
  "A separate QR code and SIP identity will be generated for this account.": "Kode QR dan identitas SIP terpisah akan dibuat untuk akun ini.",
  "Account name": "Nama akun",
  "Cancel": "Batal",
  "Create": "Buat",
  "{{name}} created": "{{name}} dibuat",
  "Sign in with the administration password.": "Masuk dengan kata sandi administrasi.",
  "Administration password": "Kata sandi administrasi",
  "Enter your password": "Masukkan kata sandi Anda",
  "Invalid password": "Kata sandi tidak valid",
  "Error {{status}}": "Kesalahan {{status}}",
  "Could not connect to the provided URL": "Tidak dapat terhubung ke URL yang diberikan",
  "Sign in": "Masuk",
  "SIP relay": "Relay SIP",
  "Direct registrar or external PBX registration.": "Registrar langsung atau pendaftaran PBX eksternal.",
  "Refresh relay status": "Perbarui status relay",
  "SIP listener ready": "Listener SIP siap",
  "SIP listener unavailable": "Listener SIP tidak tersedia",
  "{{count}} registered endpoint": "{{count}} endpoint terdaftar",
  "{{count}} registered endpoints": "{{count}} endpoint terdaftar",
  "No registered endpoint": "Tidak ada endpoint terdaftar",
  "{{count}} active call": "{{count}} panggilan aktif",
  "{{count}} active calls": "{{count}} panggilan aktif",
  "Unknown SIP client": "Klien SIP tidak dikenal",
  "Remote phonebook": "Buku telepon jarak jauh",
  "WhatsApp contacts with resolved telephone numbers.": "Kontak WhatsApp dengan nomor telepon yang terdeteksi.",
  "Loading phonebook URLs": "Memuat URL buku telepon",
  "Routing behavior": "Perilaku perutean",
  "WhatsApp to SIP": "WhatsApp ke SIP",
  "The WhatsApp call is accepted only after the SIP endpoint answers.": "Panggilan WhatsApp diterima hanya setelah endpoint SIP menjawab.",
  "SIP to WhatsApp": "SIP ke WhatsApp",
  "Dial an international number without the plus sign, for example 628123456789.": "Panggil nomor internasional tanpa tanda plus, misalnya 628123456789.",
  "Could not load relay status": "Tidak dapat memuat status relay",
  "Call history": "Riwayat panggilan",
  "No previous calls": "Belum ada panggilan",
  "Completed incoming and outgoing calls appear here.": "Panggilan masuk dan keluar yang selesai akan muncul di sini.",
  "Incoming": "Masuk",
  "Outgoing": "Keluar",
  "This account uses a passkey": "Akun ini menggunakan passkey",
  "WhatsApp requires the account owner to approve this linked device.": "WhatsApp mengharuskan pemilik akun menyetujui perangkat tertaut ini.",
  "WA SIP Relay passkey extension not found": "Ekstensi passkey WA SIP Relay tidak ditemukan",
  "Install the extension in the account owner's browser to approve the connection:": "Pasang ekstensi di browser pemilik akun untuk menyetujui koneksi:",
  "1. Download and extract the file below.": "1. Unduh dan ekstrak berkas di bawah ini.",
  "2. Open chrome://extensions and enable Developer mode.": "2. Buka chrome://extensions dan aktifkan mode Developer.",
  "3. Select Load unpacked and choose the extracted folder.": "3. Pilih Load unpacked dan pilih folder hasil ekstraksi.",
  "4. Return here and restart pairing.": "4. Kembali ke sini dan mulai ulang penautan.",
  "Download extension (.zip)": "Unduh ekstensi (.zip)",
  "Waiting for approval in the WhatsApp tab…": "Menunggu persetujuan di tab WhatsApp…",
  "Failed: {{error}}": "Gagal: {{error}}",
  "Try again": "Coba lagi",
  "Approve with passkey": "Setujui dengan passkey",
  "On the phone, open WhatsApp → Linked devices → Link a device → Link with phone number instead, then enter:": "Di ponsel, buka WhatsApp → Perangkat tertaut → Tautkan perangkat → Tautkan dengan nomor telepon, lalu masukkan:",
  "Waiting for confirmation on the phone…": "Menunggu konfirmasi di ponsel…",
  "Generate a new code": "Buat kode baru",
  "Enter the number with country code, for example 15551234567, to generate a linking code.": "Masukkan nomor beserta kode negara, misalnya 15551234567, untuk membuat kode penautan.",
  "Generating…": "Membuat…",
  "Generate code": "Buat kode",
  "Connect {{name}}": "Hubungkan {{name}}",
  "Open WhatsApp → Linked devices → Link a device, then scan this code.": "Buka WhatsApp → Perangkat tertaut → Tautkan perangkat, lalu pindai kode ini.",
  "QR Code": "Kode QR",
  "Phone code": "Kode telepon",
  "Disconnected — select Pair above to generate a new QR code": "Terputus — pilih Tautkan di atas untuk membuat kode QR baru",
  "Waiting for a QR code…": "Menunggu kode QR…",
  "Registered": "Terdaftar",
  "Registering…": "Mendaftarkan…",
  "Failed": "Gagal",
  "Enter the PBX host and username": "Masukkan host dan nama pengguna PBX",
  "PBX registration saved — connecting…": "Pendaftaran PBX disimpan — menghubungkan…",
  "PBX registration disabled": "Pendaftaran PBX dinonaktifkan",
  "SIP / PBX integration": "Integrasi SIP / PBX",
  "Choose whether phones register with this relay or the relay registers with an external PBX.": "Pilih apakah telepon mendaftar ke relay ini atau relay mendaftar ke PBX eksternal.",
  "PBX registers here": "PBX mendaftar di sini",
  "Register with PBX": "Daftar ke PBX",
  "The phone, softphone, or PBX registers with this relay using the credentials below. Numbers dialed through this account are sent to WhatsApp.": "Telepon, softphone, atau PBX mendaftar ke relay ini menggunakan kredensial di bawah. Nomor yang dipanggil melalui akun ini diteruskan ke WhatsApp.",
  "SIP server (host:port)": "Server SIP (host:port)",
  "Domain / realm": "Domain / realm",
  "SIP username": "Nama pengguna SIP",
  "SIP password": "Kata sandi SIP",
  "Hide password": "Sembunyikan kata sandi",
  "Show password": "Tampilkan kata sandi",
  "Copy password": "Salin kata sandi",
  "SIP username must be 3-64 characters using letters, numbers, dot, dash, or underscore": "Nama pengguna SIP harus 3-64 karakter dan hanya menggunakan huruf, angka, titik, tanda hubung, atau garis bawah",
  "SIP password must be 8-128 characters": "Kata sandi SIP harus 8-128 karakter",
  "SIP credentials saved": "Kredensial SIP disimpan",
  "SIP username is already used by another account": "Nama pengguna SIP sudah digunakan oleh akun lain",
  "Changing either credential disconnects existing SIP registrations. Update the phone or PBX and register again.": "Mengubah salah satu kredensial akan memutus registrasi SIP yang aktif. Perbarui telepon atau PBX lalu daftarkan kembali.",
  "Save credentials": "Simpan kredensial",
  "Phone or PBX setup": "Pengaturan telepon atau PBX",
  "Transport: UDP on port {{port}}; codec: G.711 PCMU or PCMA.": "Transport: UDP pada port {{port}}; codec: G.711 PCMU atau PCMA.",
  "On FreePBX, create a PJSIP trunk with the SIP username and server shown above.": "Di FreePBX, buat trunk PJSIP menggunakan nama pengguna SIP dan server di atas.",
  "Dial international numbers without a plus sign, for example 15551234567.": "Panggil nomor internasional tanpa tanda plus, misalnya 15551234567.",
  "Keep these credentials private; they authorize calls through this WhatsApp account.": "Jaga kerahasiaan kredensial ini; kredensial tersebut mengizinkan panggilan melalui akun WhatsApp ini.",
  "Register with an external PBX": "Daftar ke PBX eksternal",
  "WA SIP Relay becomes a registered extension on Asterisk, FreePBX, 3CX, or another SIP PBX.": "WA SIP Relay menjadi ekstensi terdaftar pada Asterisk, FreePBX, 3CX, atau PBX SIP lainnya.",
  "PBX host": "Host PBX",
  "Port": "Port",
  "Outbound proxy — optional": "Proxy keluar — opsional",
  "For example sip.provider.com:5060; blank uses the PBX host": "Misalnya sip.provider.com:5060; kosongkan untuk menggunakan host PBX",
  "Set this when SIP messages must be sent to a server other than the PBX domain. This is common with hosted trunks and some FreePBX deployments.": "Atur ini bila pesan SIP harus dikirim ke server selain domain PBX. Hal ini umum pada trunk hosted dan beberapa konfigurasi FreePBX.",
  "Username / extension": "Nama pengguna / ekstensi",
  "Password": "Kata sandi",
  "Extension password": "Kata sandi ekstensi",
  "Authentication username (Auth ID) — optional": "Nama pengguna autentikasi (Auth ID) — opsional",
  "Leave blank to use the extension": "Kosongkan untuk menggunakan ekstensi",
  "Use this when the PBX authenticates with an ID different from the extension. On 3CX, enter the extension's Authentication ID here.": "Gunakan ini jika PBX melakukan autentikasi dengan ID yang berbeda dari ekstensi. Pada 3CX, masukkan Authentication ID ekstensi di sini.",
  "Destination for incoming WhatsApp calls — optional": "Tujuan panggilan WhatsApp masuk — opsional",
  "For example 600 for a queue or extension": "Misalnya 600 untuk antrean atau ekstensi",
  "How it works": "Cara kerja",
  "Create an extension on the PBX and enter its credentials here.": "Buat ekstensi pada PBX dan masukkan kredensialnya di sini.",
  "PBX → WhatsApp: route the call to this extension with the destination in international format, for example 15551234567.": "PBX → WhatsApp: arahkan panggilan ke ekstensi ini dengan tujuan dalam format internasional, misalnya 15551234567.",
  "WhatsApp → PBX: incoming calls ring the destination configured above.": "WhatsApp → PBX: panggilan masuk membunyikan tujuan yang dikonfigurasi di atas.",
  "Codec: G.711 PCMU or PCMA; transport: UDP.": "Codec: G.711 PCMU atau PCMA; transport: UDP.",
  "Save": "Simpan"
};

const interpolate = (text: string, values?: Values): string => {
  if (!values) return text;
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{{${key}}}`, String(value)),
    text,
  );
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export const LanguageProvider = ({ children }: { children: ReactNode }) => {
  const [language, setLanguageState] = useState<Language>(() =>
    localStorage.getItem(STORAGE_KEY) === "id" ? "id" : "en",
  );

  const setLanguage = useCallback((next: Language) => {
    localStorage.setItem(STORAGE_KEY, next);
    setLanguageState(next);
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const t = useCallback(
    (english: string, values?: Values) => interpolate(language === "id" ? indonesian[english] ?? english : english, values),
    [language],
  );

  const value = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
};

export const useLanguage = (): LanguageContextValue => {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguage must be used inside LanguageProvider");
  return context;
};
