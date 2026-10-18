import { Component, StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Activity,
  ArrowLeft,
  Check,
  ChevronLeft,
  Copy,
  Dumbbell,
  ExternalLink,
  FileText,
  Folder,
  Home,
  LogOut,
  Menu,
  Pencil,
  Plus,
  Printer,
  QrCode,
  Search,
  Settings,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import {
  authStatusLabel,
  readAdminRecord,
  signInAdmin,
  signOutUser,
  watchAuth,
  watchAdminRecord,
  type AdminRecord,
} from "./auth";
import { firebaseConfigured } from "./firebase";
import {
  backupLocalSnapshot,
  dedupeById,
  firebaseSyncError,
  readMemberProfile,
  readAdminData,
  readAdminMember,
  readAdminExercises,
  type SyncPayload,
  watchAdminData,
  watchPublicExercise,
  writeAdminData,
  reserveMemberPhone,
  releaseMemberPhone,
} from "./dataSync";
import {
  issueMemberPin,
  loginMemberWithPin,
  revokeMemberSession,
  revokeMemberAccess,
  pinServiceConfigured,
} from "./memberPin";
import { firebaseAuth } from "./firebase";
import { isSafeVideoUrl, safeVideoUrl } from "./videoUrl";
import { displayIraqiPhone, normalizeIraqiPhone } from "./phone";
import "./styles.css";

function MemberPinGate(){
  const [member,setMember]=useState<Member|null>(null);
  const [sessionToken,setSessionToken]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [phone,setPhone]=useState('');
  const [pin,setPin]=useState('');
  const signOut=async()=>{const token=sessionToken;setSessionToken('');setMember(null);try{await revokeMemberSession(token)}catch{}}
  if(!pinServiceConfigured)return <AuthNotice title="بوابة المشترك متوقفة بأمان" text="لم يتم ضبط عنوان خدمة PIN الموثوقة. لا يمكن تسجيل الدخول من المتصفح مباشرة."/>;
  if(!member)return <main className="auth-page member-login-page"><div className="member-login-shell"><header className="member-login-brand"><Logo s={defaults}/><span>AL ASAS FIT · بوابة المشترك</span></header><section className="panel auth-card member-login-card"><div className="member-login-icon"><Dumbbell size={25}/></div><span className="status">دخول المشتركين</span><h1>أهلاً بعودتك</h1><p>ادخل رقم هاتفك ورمز الدخول المكوّن من 4 أرقام الذي استلمته من الكابتن حتى تشوف جدول تمارينك.</p><form className="member-login-form" onSubmit={async(e)=>{e.preventDefault();if(busy||pin.length!==4||!phone.trim())return;setBusy(true);setError('');try{const result=await loginMemberWithPin(phone,pin);if(result.customToken){if(!firebaseAuth)throw new Error('Firebase غير مهيأ');const signed=await (await import('firebase/auth')).signInWithCustomToken(firebaseAuth,result.customToken);const profile=await readMemberProfile<Member>(signed.user.uid);if(!profile)throw new Error('لم يتم العثور على ملف العضوية بعد التحقق');setMember(profile);setSessionToken(result.customToken)}else if(result.member&&result.sessionToken){setMember(result.member as Member);setSessionToken(result.sessionToken)}else throw new Error('جلسة المشترك غير صالحة')}catch(err){setError(err instanceof Error?err.message:'تعذر تسجيل الدخول')}finally{setBusy(false)}}}><label htmlFor="member-phone">رقم الهاتف</label><input id="member-phone" type="tel" inputMode="tel" autoComplete="tel" dir="ltr" placeholder="07XXXXXXXXX" required value={phone} onChange={e=>setPhone(e.target.value)} /><label htmlFor="member-pin">رمز الدخول (4 أرقام)</label><input id="member-pin" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{4}" maxLength={4} dir="ltr" placeholder="••••" required value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,'').slice(0,4))}/><button className="member-login-submit" type="submit" disabled={busy||pin.length!==4||!phone.trim()}>{busy?'جارٍ التحقق…':'عرض كورسي التدريبي'} <ArrowLeft size={18}/></button>{error&&<p className="auth-error" role="alert">{error}</p>}</form><p className="auth-help">ما عندك رمز الدخول؟ تواصل ويا الكابتن حتى يفعّل عضويتك.</p></section><footer className="member-login-footer">الدخول برقم الهاتف والرمز فقط · حسابات Google للمدراء</footer></div></main>;
  return <MemberPortal s={defaults} member={member} onSignOut={signOut}/>;
}
type Exercise = {
  id: string;
  name: string;
  english?: string;
  muscle: string;
  sets: number | string;
  reps: string;
  rest: string;
  video?: string;
};
type MemberExercise = Exercise & { weight?: string };
type DayPlan = MemberExercise[];
type Member = {
  id: string;
  membershipId?: string;
  name: string;
  height: string;
  weight: string;
  createdAt: string;
  photo?: string;
  days: DayPlan[];
  active?: boolean;
  authUid?: string;
  /** Legacy field accepted on read only. New records use phoneE164/phoneDisplay. */
  phone?: string;
  phoneE164?: string;
  phoneDisplay?: string;
};
type ReadyCourse = { id: string; name: string; days: DayPlan[] };
type SettingsData = {
  coachName: string;
  gymName: string;
  phone: string;
  whatsapp: string;
  instagram: string;
  address: string;
  coachPhoto: string;
  hallPhoto: string;
  printCoachPhotoUrl: string;
  printHallPhotoUrl: string;
  logo: string;
  showHeight: boolean;
  showWeight: boolean;
  showDate: boolean;
  accent: string;
};
const muscles = [
  "تمارين الصدر",
  "تمارين الظهر",
  "تمارين الأرجل",
  "تمارين الأكتاف",
  "تمارين البايسبس",
  "تمارين الترايسبس",
  "تمارين البطن",
  "تمارين السواعد",
  "تمارين السمانة",
  "تمارين الكارديو",
];
const muscleAliases: Record<string, string> = {
  chest: muscles[0],
  صدر: muscles[0],
  back: muscles[1],
  ظهر: muscles[1],
  legs: muscles[2],
  leg: muscles[2],
  أرجل: muscles[2],
  shoulders: muscles[3],
  shoulder: muscles[3],
  أكتاف: muscles[3],
  biceps: muscles[4],
  بايسبس: muscles[4],
  triceps: muscles[5],
  ترايسبس: muscles[5],
  abs: muscles[6],
  abdomen: muscles[6],
  بطن: muscles[6],
  forearms: muscles[7],
  forearm: muscles[7],
  سواعد: muscles[7],
  calves: muscles[8],
  calf: muscles[8],
  سمانة: muscles[8],
  cardio: muscles[9],
  كارديو: muscles[9],
};
function normalizeMuscle(value: unknown) {
  const raw = String(value ?? "").trim();
  return muscleAliases[raw.toLowerCase()] || raw;
}
function normalizeExercise(exercise: Exercise): Exercise {
  return { ...exercise, muscle: normalizeMuscle(exercise.muscle) };
}
const seedExercises: Exercise[] = [
  {
    id: "bench-press",
    name: "بنش برس مستوي",
    english: "Barbell Bench Press",
    muscle: muscles[0],
    sets: 4,
    reps: "8–10",
    rest: "90 ثانية",
    video: "https://www.youtube.com/results?search_query=barbell+bench+press",
  },
  {
    id: "incline-dumbbell",
    name: "بنش دمبل مائل",
    english: "Incline Dumbbell Press",
    muscle: muscles[0],
    sets: 3,
    reps: "10–12",
    rest: "75 ثانية",
  },
  {
    id: "cable-fly",
    name: "تفتيح كيبل",
    english: "Cable Fly",
    muscle: muscles[0],
    sets: 3,
    reps: "12–15",
    rest: "60 ثانية",
  },
  {
    id: "lat-pulldown",
    name: "سحب أمامي",
    english: "Lat Pulldown",
    muscle: muscles[1],
    sets: 4,
    reps: "8–12",
    rest: "90 ثانية",
  },
  {
    id: "seated-row",
    name: "سحب كيبل جالس",
    english: "Seated Cable Row",
    muscle: muscles[1],
    sets: 3,
    reps: "10–12",
    rest: "75 ثانية",
  },
  {
    id: "squat",
    name: "سكوات بالبار",
    english: "Barbell Squat",
    muscle: muscles[2],
    sets: 4,
    reps: "8–10",
    rest: "120 ثانية",
  },
  {
    id: "shoulder-press",
    name: "ضغط أكتاف",
    english: "Shoulder Press",
    muscle: muscles[3],
    sets: 3,
    reps: "10–12",
    rest: "75 ثانية",
  },
  {
    id: "curl",
    name: "بايسبس دمبل",
    english: "Dumbbell Curl",
    muscle: muscles[4],
    sets: 3,
    reps: "12–15",
    rest: "60 ثانية",
  },
  {
    id: "triceps",
    name: "ترايسبس كيبل",
    english: "Cable Pushdown",
    muscle: muscles[5],
    sets: 3,
    reps: "12–15",
    rest: "60 ثانية",
  },
  {
    id: "plank",
    name: "بلانك",
    english: "Plank",
    muscle: muscles[6],
    sets: 3,
    reps: "30–45 ثانية",
    rest: "45 ثانية",
  },
];
const defaults: SettingsData = {
  coachName: "محمد عبدالرزاق",
  gymName: "AL ASAS FIT",
  phone: "",
  whatsapp: "",
  instagram: "",
  address: "",
  coachPhoto: `${import.meta.env.BASE_URL}assets/coach.webp`,
  hallPhoto: `${import.meta.env.BASE_URL}assets/hall.svg`,
  printCoachPhotoUrl: `${import.meta.env.BASE_URL}assets/coach.webp`,
  printHallPhotoUrl: `${import.meta.env.BASE_URL}assets/hall.svg`,
  logo: `${import.meta.env.BASE_URL}assets/logo.webp`,
  showHeight: true,
  showWeight: true,
  showDate: true,
  accent: "#b7ff2a",
};
const read = <T,>(key: string, fallback: T): T => {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const cloneDays = (days: unknown): DayPlan[] =>
  (Array.isArray(days) ? days : []).map((day) =>
    Array.isArray(day)
      ? day
          .filter((exercise): exercise is Record<string, unknown> => Boolean(exercise && typeof exercise === "object"))
          .map((exercise) => ({
            ...exercise,
            id: String(exercise.id ?? uid()),
            name: String(exercise.name ?? "تمرين بدون اسم"),
            muscle: normalizeMuscle(exercise.muscle),
            sets: typeof exercise.sets === "number" || typeof exercise.sets === "string" ? exercise.sets : 0,
            reps: String(exercise.reps ?? "—"),
            rest: String(exercise.rest ?? "—"),
          } as MemberExercise))
      : [],
  );
function normalizeMember(value: unknown): Member | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const id = String(raw.id ?? "").trim();
  if (!id) return null;
  const rawName = typeof raw.name === "string" ? raw.name.trim() : "";
  const legacyPhone = raw.phoneE164 ?? raw.phone;
  let phoneE164: string | undefined;
  let phoneDisplay: string | undefined;
  try {
    phoneE164 = normalizeIraqiPhone(legacyPhone);
    phoneDisplay = displayIraqiPhone(phoneE164);
  } catch {
    phoneE164 = undefined;
    phoneDisplay = undefined;
  }
  return {
    id,
    membershipId: raw.membershipId == null ? undefined : String(raw.membershipId),
    name: rawName,
    height: String(raw.height ?? ""),
    weight: String(raw.weight ?? ""),
    createdAt: String(raw.createdAt ?? "—"),
    // Member photos are intentionally unsupported in this release.
    photo: "",
    days: cloneDays(raw.days),
    active: raw.active !== false,
    authUid: raw.authUid == null ? undefined : String(raw.authUid),
    phoneE164,
    phoneDisplay,
  };
}

function memberPhoneE164(member: Pick<Member, "phoneE164" | "phoneDisplay" | "phone">) {
  return normalizeIraqiPhone(member.phoneE164 ?? member.phoneDisplay ?? member.phone);
}

function memberPhoneDisplay(member: Pick<Member, "phoneE164" | "phoneDisplay" | "phone">) {
  try { return displayIraqiPhone(member.phoneDisplay ?? member.phoneE164 ?? member.phone); }
  catch { return ""; }
}

function normalizeSettings(value: unknown): SettingsData {
  const raw = value && typeof value === "object" ? value as Partial<SettingsData> : {};
  const coachDefault = defaults.coachPhoto;
  const hallDefault = defaults.hallPhoto;
  const staticAsset = (candidate: unknown, fallback: string) =>
    typeof candidate === "string" && candidate === fallback ? candidate : fallback;
  const coachPhoto = staticAsset(raw.coachPhoto, coachDefault);
  const hallPhoto = staticAsset(raw.hallPhoto, hallDefault);
  const logo = staticAsset(raw.logo, defaults.logo);
  return {
    ...defaults,
    ...raw,
    coachPhoto,
    hallPhoto,
    logo,
    printCoachPhotoUrl: staticAsset(raw.printCoachPhotoUrl, coachPhoto),
    printHallPhotoUrl: staticAsset(raw.printHallPhotoUrl, hallPhoto),
  };
}
function normalizeMembers(value: unknown): Member[] {
  const items = Array.isArray(value) ? value : [];
  return dedupeById(items.map(normalizeMember).filter((member): member is Member => Boolean(member)));
}

function cleanMemberName(value: unknown) {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!name || name === "0" || /^\d+$/.test(name) || !/[A-Za-z\u0600-\u06FF]/.test(name))
    throw new Error("اسم المشترك إلزامي ويجب أن يحتوي على حروف، وليس رقماً فقط");
  return name;
}
function normalizeCourses(value: unknown): ReadyCourse[] {
  const items = Array.isArray(value) ? value : [];
  return dedupeById(
    items
      .filter((course): course is Record<string, unknown> => Boolean(course && typeof course === "object"))
      .map((course) => ({
        id: String(course.id ?? ""),
        name: String(course.name ?? "كورس بدون اسم"),
        days: cloneDays(course.days),
      }))
      .filter((course) => course.id),
  );
}
const blankDays = (count: number) =>
  Array.from({ length: count }, () => [] as DayPlan);
type Page =
  | "home"
  | "categories"
  | "barcodes"
  | "courses"
  | "members"
  | "settings";
function Logo({ s }: { s: SettingsData }) {
  return (
    <div className="brand">
      {s.logo ? (
        <img className="brand-logo" src={s.logo} alt="" />
      ) : (
        <div className="brand-mark" style={{ background: s.accent }}>
          <Dumbbell size={19} />
        </div>
      )}
      <div>
        <strong>{s.gymName || "الأساس فت"}</strong>
        <span>AL ASAS FIT</span>
      </div>
    </div>
  );
}
function Button({
  children,
  onClick,
  secondary = false,
  icon,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  secondary?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <button
      className={secondary ? "secondary-btn" : "primary-btn"}
      onClick={onClick}
    >
      {icon}
      {children}
    </button>
  );
}
function Empty({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="empty-state">
      {icon}
      <b>{title}</b>
      <span>{text}</span>
    </div>
  );
}
function Sidebar({
  page,
  setPage,
  s,
  role,
  onSignOut,
}: {
  page: Page;
  setPage: (p: Page) => void;
  s: SettingsData;
  role: AdminRecord["role"];
  onSignOut: () => void;
}) {
  const close = () =>
    document.querySelector(".sidebar-wrap")?.classList.remove("open");
  const items: [Page, string, typeof Home][] = [
    ["home", "الرئيسية", Home],
    ["categories", "الأقسام", Folder],
    ["barcodes", "باركودات التمارين", QrCode],
    ["courses", "الكورسات الجاهزة", FileText],
    ["members", "المشتركون", Users],
  ];
  return (
    <aside className="sidebar">
      <Logo s={s} />
      <nav>
        {role === "SUPER_ADMIN" && (
          <button
            className={`nav-item ${page === "settings" ? "active" : ""}`}
            onClick={() => {
              setPage("settings");
              close();
            }}
          >
            <Settings size={17} />
            <span>إعدادات الموقع</span>
          </button>
        )}
        {items.map(([p, label, Icon]) => (
          <button
            className={`nav-item ${page === p ? "active" : ""}`}
            onClick={() => {
              setPage(p);
              close();
            }}
            key={p}
          >
            <Icon size={17} />
            <span>{label}</span>
          </button>
        ))}
        {role === "SUPER_ADMIN" && (
          <button className="nav-item" type="button">
            <Users size={17} />
            <span>المدراء والصلاحيات</span>
          </button>
        )}
      </nav>
      <div className="sidebar-bottom">
        <div className="coach-mini">
          <div className="avatar lime">{s.coachName.slice(0, 1)}</div>
          <div>
            <b>{s.coachName}</b>
            <span>كابتن ومدير</span>
          </div>
        </div>
        <button className="logout-btn" type="button" onClick={onSignOut}>
          <LogOut size={17} />
          <span>تسجيل الخروج</span>
        </button>
      </div>
    </aside>
  );
}
function Topbar({ title, onMenu }: { title: string; onMenu: () => void }) {
  return (
    <header className="topbar">
      <button className="icon-btn mobile-menu" type="button" aria-label="فتح قائمة الإدارة" onClick={onMenu}>
        <Menu size={20} />
      </button>
      <div>
        <p className="eyebrow">AL ASAS FIT · لوحة تحكم الكابتن</p>
        <h1>{title}</h1>
      </div>
      <div className="top-actions">
        <div className="search-top">
          <Search size={16} />
          <span>البحث في المشتركين أو التمارين...</span>
        </div>
        <Activity size={18} />
      </div>
    </header>
  );
}
type AppPayload = SyncPayload<SettingsData, Exercise, Member, ReadyCourse>;
function CentralDataBridge({
  role,
  settings,
  exercises,
  members,
  courses,
  setSettings,
  setExercises,
  setMembers,
  setCourses,
}: {
  role: AdminRecord["role"];
  settings: SettingsData;
  exercises: Exercise[];
  members: Member[];
  courses: ReadyCourse[];
  setSettings: React.Dispatch<React.SetStateAction<SettingsData>>;
  setExercises: React.Dispatch<React.SetStateAction<Exercise[]>>;
  setMembers: React.Dispatch<React.SetStateAction<Member[]>>;
  setCourses: React.Dispatch<React.SetStateAction<ReadyCourse[]>>;
}) {
  const [remotePresent, setRemotePresent] = useState(false);
  const [remoteReady, setRemoteReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [backupKey, setBackupKey] = useState("");
  const hydrating = useRef(true);
  const lastRemote = useRef<AppPayload | null>(null);
  const localPayload: AppPayload = {
    schemaVersion: 1,
    settings,
    exercises,
    members,
    courses,
  };
  const imageSource = (value: string, fallback = "") =>
    /^(?:https?:\/\/|\/)/i.test(value) && !/^data:/i.test(value) ? value : fallback;
  const remoteSettings = {
    ...settings,
    logo: imageSource(settings.logo, defaults.logo),
    coachPhoto: imageSource(settings.coachPhoto, defaults.coachPhoto),
    hallPhoto: imageSource(settings.hallPhoto, defaults.hallPhoto),
    printCoachPhotoUrl: imageSource(settings.printCoachPhotoUrl, defaults.coachPhoto),
    printHallPhotoUrl: imageSource(settings.printHallPhotoUrl, defaults.hallPhoto),
  };
  const payload: AppPayload = { ...localPayload, settings: remoteSettings };
  useEffect(
    () =>
      watchAdminData<AppPayload>((remote) => {
        if (remote) {
          lastRemote.current = remote;
          hydrating.current = true;
          setSettings(normalizeSettings(remote.settings));
          setExercises(
            dedupeById((remote.exercises || []).map(normalizeExercise)),
          );
          setMembers(normalizeMembers(remote.members));
          setCourses(normalizeCourses(remote.courses));
          setRemotePresent(true);
        }
        setRemoteReady(true);
      }),
    [setSettings, setExercises, setMembers, setCourses],
  );
  useEffect(() => {
    const save = async (requestedPayload: AppPayload = payload): Promise<boolean> => {
      if (busy) return false;
      const nextPayload = requestedPayload;
      const previousForSave = lastRemote.current;
      const previousExercises = Array.isArray(previousForSave?.exercises)
        ? previousForSave.exercises
        : [];
      const changedExercises = nextPayload.exercises.filter((exercise) => {
        const old = previousExercises.find((item) => item.id === exercise.id);
        return !old || JSON.stringify(old) !== JSON.stringify(exercise);
      });
      const previousMembers = Array.isArray(previousForSave?.members)
        ? previousForSave.members
        : [];
      const changedMembers = nextPayload.members.filter((member) => {
        const old = previousMembers.find((item) => item.id === member.id);
        return !old || JSON.stringify(old) !== JSON.stringify(member);
      });
      const claimedPhones: Array<{ phone: string; memberId: string; oldPhone?: string }> = [];
      for (const member of changedMembers) {
        const name = cleanMemberName(member.name);
        let phone: string;
        try { phone = memberPhoneE164(member); } catch {
          // A member may be saved without a phone; issuing a PIN remains blocked below.
          continue;
        }
        const conflict = (Array.isArray(previousForSave?.members) ? previousForSave.members : [])
          .find((item) => {
            if (!item || item.id === member.id) return false;
            try { return memberPhoneE164(normalizeMember(item) as Member) === phone; } catch { return false; }
          });
        if (conflict)
          throw firebaseSyncError("update", "PHONE_CONFLICT", "رقم الهاتف مستخدم لمشترك آخر");
        await reserveMemberPhone(phone, member.id);
        claimedPhones.push({
          phone,
          memberId: member.id,
          oldPhone: (() => {
            const old = (previousForSave?.members as Array<Record<string, unknown>> | undefined)?.find((item) => item?.id === member.id);
            try { return old ? memberPhoneE164(normalizeMember(old) as Member) : undefined; } catch { return undefined; }
          })(),
        });
      }
      setBusy(true);
      setError("");
      window.dispatchEvent(
        new CustomEvent("alasas-save-status", { detail: "saving" }),
      );
      try {
        await writeAdminData(nextPayload, { role, previous: previousForSave });
        console.info("[firebase-save]", { phase: "update", result: "ok" });
        const check = await readAdminData<AppPayload>();
        console.info("[firebase-save]", {
          phase: "read",
          result: check ? "ok" : "empty",
        });
        if (!check)
          throw firebaseSyncError(
            "verify",
            "NOT_FOUND",
            "تعذر تأكيد قراءة إعدادات Firebase بعد الحفظ",
          );
        if (
          role === "SUPER_ADMIN" &&
          JSON.stringify(check.settings) !== JSON.stringify(nextPayload.settings)
        )
          throw firebaseSyncError(
            "verify",
            "SETTINGS_MISMATCH",
            "تعذر تأكيد قراءة إعدادات Firebase بعد الحفظ",
          );
        if (changedExercises.length) {
          const remoteExercises = await readAdminExercises<Exercise[]>();
          const remoteById = new Map(
            (Array.isArray(remoteExercises) ? remoteExercises : [])
              .filter((exercise) => exercise && typeof exercise.id === "string")
              .map((exercise) => [exercise.id, exercise]),
          );
          const missingId = changedExercises.find(
            (exercise) => !remoteById.has(exercise.id),
          );
          if (missingId)
            throw firebaseSyncError(
              "verify",
              "EXERCISE_MISSING",
              "تعذر تأكيد حفظ التمرين في Firebase RTDB",
            );
          const mismatched = changedExercises.find(
            (exercise) =>
              JSON.stringify(remoteById.get(exercise.id)) !==
              JSON.stringify(exercise),
          );
          if (mismatched)
            throw firebaseSyncError(
              "verify",
              "EXERCISE_MISMATCH",
              "تعذر تأكيد محتوى التمرين في Firebase RTDB",
            );
        }
        if (changedMembers.length) {
          for (const member of changedMembers) {
            const persisted = await readAdminMember<Member>(member.id);
            if (!persisted)
              throw firebaseSyncError("verify", "MEMBER_MISSING", `تعذر قراءة سجل المشترك ${member.id} بعد الحفظ`);
            if (JSON.stringify(persisted) !== JSON.stringify(member))
              throw firebaseSyncError("verify", "MEMBER_MISMATCH", `بيانات سجل المشترك ${member.id} لا تطابق المدخلات`);
          }
        }
        setRemotePresent(true);
        lastRemote.current = nextPayload;
        window.dispatchEvent(
          new CustomEvent("alasas-save-status", { detail: "saved" }),
        );
        for (const claim of claimedPhones) {
          if (claim.oldPhone && claim.oldPhone !== claim.phone) {
            try { await releaseMemberPhone(claim.oldPhone, claim.memberId); } catch (error) {
              console.warn("[firebase-save] old phone index cleanup failed", error);
            }
          }
        }
        return true;
      } catch (e) {
        for (const claim of claimedPhones) {
          if (!claim.oldPhone || claim.oldPhone !== claim.phone) {
            try { await releaseMemberPhone(claim.phone, claim.memberId); } catch { /* retain fail-closed lock */ }
          }
        }
        const syncError = e instanceof Error && "phase" in e && "code" in e
          ? (e as Error & { phase: string; code: string })
          : null;
        if (syncError)
          console.warn("[firebase-save]", {
            phase: syncError.phase,
            code: syncError.code,
          });
        const message = syncError
          ? `${syncError.message} [${syncError.phase}/${syncError.code}]`
          : e instanceof Error
            ? e.message
            : "تعذر حفظ RTDB";
        setError(message);
        window.dispatchEvent(
          new CustomEvent("alasas-save-status", { detail: message }),
        );
        return false;
      } finally {
        setBusy(false);
      }
    };
    const saveMember = (event: Event) => {
      const detail = (event as CustomEvent<{ payload: AppPayload; resolve: (ok: boolean) => void }>).detail;
      void save(detail.payload).then(detail.resolve).catch((error) => {
        const message = error instanceof Error ? error.message : "تعذر حفظ المشترك";
        window.dispatchEvent(new CustomEvent("alasas-save-status", { detail: message }));
        detail.resolve(false);
      });
    };
    const saveSettings = () => void save();
    window.addEventListener("alasas-save-settings", saveSettings);
    window.addEventListener("alasas-save-member", saveMember);
    return () => {
      window.removeEventListener("alasas-save-settings", saveSettings);
      window.removeEventListener("alasas-save-member", saveMember);
    };
  }, [payload, busy, remoteSettings, role]);
  const migrate = async () => {
    setBusy(true);
    setError("");
    try {
      const backup = backupLocalSnapshot(localPayload);
      setBackupKey(backup);
      await writeAdminData({
        ...payload,
        migratedAt: new Date().toISOString(),
      }, { role, previous: lastRemote.current });
      setRemotePresent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر ترحيل البيانات");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="data-status">
      <span>
        {remotePresent
          ? "مصدر البيانات: Firebase RTDB"
          : firebaseConfigured
            ? "لا توجد نسخة RTDB بعد — البيانات المحلية لم تُرحّل"
            : "وضع المعاينة: Firebase غير مهيأ"}
      </span>
      {firebaseConfigured && !remotePresent && (
        <button className="secondary-btn" disabled={busy} onClick={migrate}>
          {busy ? "جارٍ أخذ النسخة…" : "ترحيل نسخة محلية after أخذ Backup"}
        </button>
      )}
      <small>
        {backupKey
          ? `Backup: ${backupKey}`
          : error || "الحفظ يتم صراحةً من زر حفظ التعديلات."}
      </small>
    </div>
  );
}
function App({
  role,
  onSignOut,
}: {
  role: AdminRecord["role"];
  onSignOut: () => void;
}) {
  const [settings, setSettings] = useState(() =>
    normalizeSettings(read("alasas-settings", defaults)),
  );
  const [exercises, setExercises] = useState(() =>
    read<Exercise[]>("alasas-exercises", seedExercises).map(normalizeExercise),
  );
  // Members are authoritative in Firebase RTDB; localStorage is never used as their source.
  const [members, setMembers] = useState<Member[]>([]);
  const [courses, setCourses] = useState(() =>
    normalizeCourses(read<unknown>("alasas-courses", [])),
  );
  const [page, setPage] = useState<Page>("home");
  const [open, setOpen] = useState(false);
  const exerciseId = location.hash.startsWith("#/exercise/")
    ? decodeURIComponent(location.hash.slice(11))
    : "";
  useEffect(
    () => localStorage.setItem("alasas-settings", JSON.stringify(settings)),
    [settings],
  );
  useEffect(
    () => localStorage.setItem("alasas-exercises", JSON.stringify(exercises)),
    [exercises],
  );
  useEffect(
    () => localStorage.setItem("alasas-courses", JSON.stringify(courses)),
    [courses],
  );
  const title = {
    home: "الرئيسية",
    categories: "الأقسام",
    barcodes: "باركودات التمارين",
    courses: "الكورسات الجاهزة",
    members: "المشتركون",
    settings: "إعدادات الموقع",
  }[page];
  return (
    <div
      className="app-shell"
      style={{ "--accent": settings.accent } as React.CSSProperties}
    >
      {exerciseId ? (
        <PublicExerciseDetail
          exerciseId={exerciseId}
          fallback={
            adminRoute ? exercises.find((e) => e.id === exerciseId) : undefined
          }
        />
      ) : (
        <>
          {createPortal(
            <div className={open ? "sidebar-wrap open" : "sidebar-wrap"} onClick={() => setOpen(false)}>
              <div onClick={(e) => e.stopPropagation()}>
                <Sidebar page={page} setPage={(next) => { setPage(next); setOpen(false); }} s={settings} role={role} onSignOut={onSignOut}/>
              </div>
              {open && <button type="button" className="sidebar-mobile-close" aria-label="إغلاق القائمة" onClick={() => setOpen(false)}><X size={21}/></button>}
            </div>,
            document.body
          )}
          <div className="main-area">
            <Topbar title={title} onMenu={() => setOpen((current) => !current)} />
            <main className="content">
              <CentralDataBridge
                role={role}
                settings={settings}
                exercises={exercises}
                members={members}
                courses={courses}
                setSettings={setSettings}
                setExercises={setExercises}
                setMembers={setMembers}
                setCourses={setCourses}
              />
              {page === "home" && (
                <Dashboard
                  members={members}
                  exercises={exercises}
                  onAdd={() => setPage("members")}
                />
              )}{" "}
              {page === "categories" && (
                <Categories exercises={exercises} setExercises={setExercises} />
              )}{" "}
              {page === "barcodes" && (
                <Barcodes exercises={exercises} setExercises={setExercises} />
              )}{" "}
              {page === "courses" && (
                <Courses
                  exercises={exercises}
                  courses={courses}
                  setCourses={setCourses}
                />
              )}{" "}
              {page === "members" && (
                <MembersWithPin
                  exercises={exercises}
                  members={members}
                  courses={courses}
                  setMembers={setMembers}
                  settings={settings}
                />
              )}{" "}
              {page === "settings" && (
                <SettingsPage s={settings} setS={setSettings} />
              )}
            </main>
          </div>
        </>
      )}
    </div>
  );
}

function AuthNotice({
  title,
  text,
  action,
  actionLabel,
}: {
  title: string;
  text: string;
  action?: () => void;
  actionLabel?: string;
}) {
  return (
    <main className="auth-page">
      <Logo s={defaults} />
      <section className="panel auth-card">
        <span className="status">● {authStatusLabel()}</span>
        <h1>{title}</h1>
        <p>{text}</p>
        {action && <Button onClick={action}>{actionLabel || "متابعة"}</Button>}
      </section>
    </main>
  );
}
function AdminGate() {
  const [user, setUser] = useState<import("firebase/auth").User | null>(null);
  const [record, setRecord] = useState<AdminRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => watchAuth(setUser), []);
  useEffect(
    () => (user ? watchAdminRecord(user.uid, setRecord) : setRecord(null)),
    [user],
  );
  useEffect(() => {
    if (user)
      readAdminRecord(user.uid)
        .then(setRecord)
        .catch(() => setRecord(null));
  }, [user]);
  if (!firebaseConfigured)
    return (
      <AuthNotice
        title="لوحة الإدارة غير مهيأة"
        text="تم منع عرض بيانات الإدارة لأن Firebase غير مهيأ في هذه النسخة. أضف إعدادات VITE_FIREBASE_* ثم أعد البناء."
      />
    );
  if (!user)
    return (
      <main className="auth-page admin-login-page" dir="rtl">
        <div className="admin-login-layout">
          <aside className="admin-login-intro">
            <Logo s={defaults}/>
            <span className="admin-login-eyebrow">AL ASAS FIT / CONTROL CENTER</span>
            <h1>كل تفاصيل القاعة،<br/><em>بمكان واحد.</em></h1>
            <p>إدارة التمارين والمشتركين والكورسات بواجهة واضحة وسريعة ومخصصة للكابتن.</p>
            <div className="admin-login-points"><span><Dumbbell size={18}/> مكتبة التمارين</span><span><Users size={18}/> إدارة المشتركين</span><span><QrCode size={18}/> باركود لكل تمرين</span></div>
          </aside>
          <section className="panel admin-login-card">
            <span className="admin-login-lock"><Settings size={23}/></span>
            <span className="admin-login-eyebrow">بوابة الإدارة الآمنة</span>
            <h2>تسجيل دخول المدراء</h2>
            <p>سجّل بحساب Google المخوّل لإدارة القاعة. صلاحيات الوصول تُفحص بعد تسجيل الدخول.</p>
            <button type="button" className="admin-google-button" disabled={busy} onClick={async () => {setBusy(true);setError("");try{await signInAdmin()}catch(e){setError(e instanceof Error?e.message:"تعذر تسجيل الدخول")}finally{setBusy(false)}}}>
              <span className="google-mark">G</span>{busy?"جارٍ تسجيل الدخول…":"المتابعة باستخدام Google"} <ArrowLeft size={18}/>
            </button>
            {error&&<p role="alert" className="auth-error">{error}</p>}
            <div className="admin-login-note"><Check size={17}/> متاح للمدراء المصرّح لهم فقط</div>
          </section>
        </div>
      </main>
    );
  if (!user.emailVerified || !record?.active)
    return (
      <AuthNotice
        title="الوصول غير مصرح"
        text={
          !user.emailVerified
            ? "البريد الإلكتروني غير موثق. لم تُعرض بيانات الإدارة."
            : "تم تسجيل الدخول، لكن هذا الحساب ليس مديراً فعالاً. لم تُعرض بيانات الإدارة."
        }
        action={() => signOutUser()}
        actionLabel="تسجيل الخروج"
      />
    );
  return <App role={record.role} onSignOut={signOutUser} />;
}
function MemberGate() { return <MemberPinGate />; }
function Stat({label,value,icon:Icon}:{label:string;value:string;icon:typeof Users}){return <div className="stat-card"><div className="stat-icon"><Icon size={18}/></div><div><span>{label}</span><strong>{value}</strong><small>من البيانات الحالية</small></div></div>}
function Dashboard({members,exercises,onAdd}:{members:Member[];exercises:Exercise[];onAdd:()=>void}){return <><section className="welcome-row"><div><h2>مرحباً بك في لوحة الإدارة</h2><p>أنشئ خططاً واضحة، وخصصها لكل مشترك من مكان واحد.</p></div><Button onClick={onAdd} icon={<Plus size={17}/>}>إضافة مشترك</Button></section><section className="stats-grid"><Stat label="المشتركون" value={String(members.length)} icon={Users}/><Stat label="المشتركون النشطون" value={String(members.length)} icon={Activity}/><Stat label="الكورسات المنشأة" value="—" icon={FileText}/><Stat label="تمارين المكتبة" value={String(exercises.length)} icon={Dumbbell}/></section><div className="dashboard-grid"><section className="panel table-panel"><div className="panel-head"><div><h2>آخر المشتركين</h2><p>البيانات المحفوظة على هذا الجهاز</p></div></div>{members.length?<table><thead><tr><th>الاسم</th><th>الطول</th><th>الوزن</th><th>الأيام</th></tr></thead><tbody>{members.slice(-5).reverse().map(m=><tr key={m.id}><td><div className="member-cell"><div className="avatar">{m.name.slice(0,1)}</div><b>{m.name}</b></div></td><td>{m.height||'—'} سم</td><td>{m.weight||'—'} كغم</td><td>{m.days.length} أيام</td></tr>)}</tbody></table>:<div className="empty-with-action"><Empty icon={<Users size={28}/>} title="لا يوجد مشتركون بعد" text="ابدأ بإضافة أول مشترك لبناء كورسه."/><Button onClick={onAdd} icon={<Plus size={16}/>}>إضافة أول مشترك</Button></div>}</section><section className="panel quick-panel"><h2>مسار سريع</h2><p>خطوات إنشاء كورس مخصص</p><div className="steps"><span><b>1</b>أضف بيانات المشترك</span><span><b>2</b>حدد أيام التدريب</span><span><b>3</b>اختر العضلات والتمارين</span><span><b>4</b>راجع واطبع الكورس</span></div><Button onClick={onAdd} icon={<Plus size={16}/>}>بدء إنشاء كورس</Button></section></div></>}
function Categories({
  exercises,
  setExercises,
}: {
  exercises: Exercise[];
  setExercises: React.Dispatch<React.SetStateAction<Exercise[]>>;
}) {
  const [muscle, setMuscle] = useState(muscles[0]);
  const [editing, setEditing] = useState<Exercise | null>(null);
  const [show, setShow] = useState(false);
  const list = exercises.filter((e) => e.muscle === muscle);
  const save = (e: Exercise) => {
    setExercises((x) =>
      x.some((a) => a.id === e.id)
        ? x.map((a) => (a.id === e.id ? e : a))
        : [...x, e],
    );
    setShow(false);
  };
  return (
    <>
      <section className="section-heading">
        <div>
          <h2>مكتبة التمارين</h2>
          <p>المصدر الموحد للتمارين المستخدمة في الكورسات والباركودات.</p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setShow(true);
          }}
          icon={<Plus size={17} />}
        >
          إضافة تمرين
        </Button>
      </section>
      <div className="library-layout">
        <aside className="muscle-list">
          <h3>الأقسام</h3>
          {muscles.map((m) => (
            <button
              className={m === muscle ? "selected" : ""}
              onClick={() => setMuscle(m)}
              key={m}
            >
              {m}
              <span>{exercises.filter((e) => e.muscle === m).length}</span>
            </button>
          ))}
        </aside>
        <section className="panel exercise-panel">
          <div className="panel-head">
            <div>
              <h2>{muscle}</h2>
              <p>{list.length} تمارين محفوظة</p>
            </div>
          </div>
          {list.length ? (
            <div className="exercise-grid">
              {list.map((e) => (
                <div className="exercise-card" key={e.id}>
                  <div className="exercise-thumb">
                    <Dumbbell size={24} />
                  </div>
                  <div className="exercise-card-body">
                    <b>{e.name}</b>
                    <span>{e.english || "اسم إنجليزي غير مضاف"}</span>
                    <small>
                      {e.sets} مجموعات · {e.reps} · راحة {e.rest}
                    </small>
                    <div className="row-actions">
                      <button
                        onClick={() => {
                          setEditing(e);
                          setShow(true);
                        }}
                      >
                        <Pencil size={14} />
                        تعديل
                      </button>
                      <button
                        onClick={() =>
                          setExercises((x) => x.filter((a) => a.id !== e.id))
                        }
                      >
                        <Trash2 size={14} />
                        حذف
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty
              icon={<Dumbbell size={28} />}
              title="لا توجد تمارين في هذا القسم"
              text="أضف تمريناً جديداً ليظهر هنا."
            />
          )}
        </section>
      </div>
      {show && (
        <ExerciseModal
          initial={editing}
          muscle={muscle}
          onClose={() => setShow(false)}
          onSave={save}
        />
      )}
    </>
  );
}
function ExerciseModal({
  initial,
  muscle,
  onClose,
  onSave,
}: {
  initial: Exercise | null;
  muscle: string;
  onClose: () => void;
  onSave: (e: Exercise) => void;
}) {
  const [e, setE] = useState<Exercise>(
    initial || {
      id: uid(),
      name: "",
      muscle,
      sets: 3,
      reps: "10–12",
      rest: "60 ثانية",
    },
  );
  const [error, setError] = useState("");
  const field = (key: keyof Exercise, label: string) => (
    <label>
      {label}
      <input
        value={String(e[key] ?? "")}
        onChange={(event) => {
          setError("");
          setE({
            ...e,
            [key]:
              key === "sets" ? Number(event.target.value) : event.target.value,
          });
        }}
      />
    </label>
  );
  const save = () => {
    if (!isSafeVideoUrl(e.video)) {
      setError(
        "يسمح فقط برابط HTTPS من YouTube أو Vimeo بدون مسافات أو إعادة توجيه.",
      );
      return;
    }
    onSave({ ...e, video: safeVideoUrl(e.video) || undefined });
  };
  return (
    <Modal title={initial ? "تعديل التمرين" : "إضافة تمرين"} onClose={onClose}>
      <div className="form-grid">
        <label>
          قسم العضلة
          <select
            value={e.muscle}
            onChange={(event) => setE({ ...e, muscle: event.target.value })}
          >
            {muscles.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        {field("name", "اسم التمرين بالعربية")}
        {field("english", "الاسم الإنجليزي (اختياري)")}
        {field("sets", "المجموعات الافتراضية")}
        {field("reps", "التكرارات الافتراضية")}
        {field("rest", "الراحة")}
        {field("video", "رابط شرح الفيديو (اختياري)")}
      </div>
      {error && (
        <p className="save-error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <Button secondary onClick={onClose}>
          إلغاء
        </Button>
        <Button onClick={save} icon={<Check size={16} />}>
          حفظ التمرين
        </Button>
      </div>
    </Modal>
  );
}
function exerciseUrl(id: string) {
  return `${location.origin}${location.pathname.replace(/admin\/?$/, "")}#/exercise/${encodeURIComponent(id)}`;
}
function exerciseTarget(exercise: Exercise) {
  return exerciseUrl(exercise.id);
}
function Barcodes({
  exercises,
  setExercises,
}: {
  exercises: Exercise[];
  setExercises: React.Dispatch<React.SetStateAction<Exercise[]>>;
}) {
  const [muscle, setMuscle] = useState(muscles[0]);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Exercise | null>(null);
  const [show, setShow] = useState(false);
  const [selected, setSelected] = useState<Exercise | undefined>();
  const list = exercises.filter(
    (e) =>
      e.muscle === muscle &&
      (!query.trim() ||
        `${e.name} ${e.english || ""}`
          .toLowerCase()
          .includes(query.trim().toLowerCase())),
  );
  useEffect(() => {
    setSelected((current) =>
      current && list.some((e) => e.id === current.id) ? current : list[0],
    );
  }, [muscle, query, exercises]);
  const save = (exercise: Exercise) => {
    setExercises((items) =>
      items.some((e) => e.id === exercise.id)
        ? items.map((e) => (e.id === exercise.id ? exercise : e))
        : [...items, exercise],
    );
    setSelected(exercise);
    setShow(false);
    setEditing(null);
  };
  const url = selected ? exerciseUrl(selected.id) : "";
  const download = () => {
    const svg = document.querySelector(
      ".qr-detail svg",
    ) as SVGSVGElement | null;
    if (!svg) return;
    const source = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${selected?.id || "exercise"}-qr.svg`;
    link.click();
    URL.revokeObjectURL(link.href);
  };
  return (
    <>
      <section className="section-heading">
        <div>
          <h2>باركودات التمارين</h2>
          <p>QR ثابت لكل تمرين؛ تغيير الفيديو يغيّر الوجهة دون تغيير الرمز.</p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setShow(true);
          }}
          icon={<Plus size={17} />}
        >
          إضافة تمرين
        </Button>
      </section>
      <div className="barcode-layout">
        <div className="panel barcode-picker">
          <label className="barcode-search">
            <Search size={15} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ابحث عن تمرين"
            />
          </label>
          <h3>الأقسام</h3>
          {muscles.map((m) => (
            <button
              className={m === muscle ? "selected" : ""}
              onClick={() => {
                setMuscle(m);
                setQuery("");
              }}
              key={m}
            >
              {m}
              <ChevronLeft size={15} />
            </button>
          ))}
          <hr />
          <h3>التمارين ({list.length})</h3>
          {list.map((e) => (
            <button
              className={selected?.id === e.id ? "selected" : ""}
              onClick={() => setSelected(e)}
              key={e.id}
            >
              {e.name}
              <small>{e.video ? "فيديو مرتبط" : "بدون فيديو"}</small>
            </button>
          ))}
        </div>
        <section className="panel qr-detail">
          {selected ? (
            <>
              <div className="exercise-thumb big">
                <Dumbbell size={34} />
              </div>
              <h2>{selected.name}</h2>
              <p>
                {selected.video
                  ? "رابط الفيديو الحالي محفوظ"
                  : "أضف رابط فيديو من تعديل التمرين"}
              </p>
              <div className="qr-box">
                <QRCodeSVG value={url} size={180} includeMargin level="M" />
              </div>
              <code>{url}</code>
              <div className="modal-actions">
                <Button
                  secondary
                  onClick={() => setEditing(selected)}
                  icon={<Pencil size={15} />}
                >
                  تعديل الرابط
                </Button>
                <Button
                  secondary
                  onClick={download}
                  icon={<QrCode size={15} />}
                >
                  تنزيل QR
                </Button>
                <Button
                  onClick={() => window.print()}
                  icon={<Printer size={16} />}
                >
                  طباعة الرمز
                </Button>
              </div>
              <a
                className="text-btn"
                href={url}
                target="_blank"
                rel="noreferrer"
              >
                فتح صفحة التمرين <ExternalLink size={14} />
              </a>
            </>
          ) : (
            <Empty
              icon={<QrCode size={28} />}
              title="لا توجد نتائج"
              text="أضف تمريناً أو غيّر البحث."
            />
          )}
        </section>
      </div>
      {(show || editing) && (
        <ExerciseModal
          initial={editing}
          muscle={editing?.muscle || muscle}
          onClose={() => {
            setShow(false);
            setEditing(null);
          }}
          onSave={save}
        />
      )}
    </>
  );
}
function Courses({
  exercises,
  courses,
  setCourses,
}: {
  exercises: Exercise[];
  courses: ReadyCourse[];
  setCourses: React.Dispatch<React.SetStateAction<ReadyCourse[]>>;
}) {
  const [editing, setEditing] = useState<ReadyCourse | null>(null);
  const [show, setShow] = useState(false);
  const save = (c: ReadyCourse) => {
    setCourses((x) =>
      x.some((a) => a.id === c.id)
        ? x.map((a) => (a.id === c.id ? c : a))
        : [...x, c],
    );
    setShow(false);
  };
  return (
    <>
      <section className="section-heading">
        <div>
          <h2>الكورسات الجاهزة</h2>
          <p>قوالب مستقلة، منظمة حسب اليوم والعضلة والتمرين.</p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setShow(true);
          }}
          icon={<Plus size={17} />}
        >
          إنشاء كورس جاهز
        </Button>
      </section>
      {courses.length ? (
        <div className="ready-course-grid">
          {courses.map((c) => (
            <article className="panel ready-course" key={c.id}>
              <div className="panel-head">
                <div>
                  <h3>{c.name}</h3>
                  <p>{c.days.length} أيام تدريب</p>
                </div>
                <div className="row-actions">
                  <button
                    onClick={() => {
                      setEditing(c);
                      setShow(true);
                    }}
                  >
                    <Pencil size={14} />
                    تعديل
                  </button>
                  <button
                    onClick={() =>
                      setCourses((x) => [
                        ...x,
                        {
                          ...c,
                          id: uid(),
                          name: `${c.name} — نسخة`,
                          days: cloneDays(c.days),
                        },
                      ])
                    }
                  >
                    <Copy size={14} />
                    نسخ
                  </button>
                  <button
                    onClick={() =>
                      setCourses((x) => x.filter((a) => a.id !== c.id))
                    }
                  >
                    <Trash2 size={14} />
                    حذف
                  </button>
                </div>
              </div>
              {c.days.map((day, i) => (
                <div className="ready-day" key={i}>
                  <h4>
                    اليوم {i + 1}{" "}
                    <small>
                      {[...new Set(day.map((e) => e.muscle))].join(" + ") ||
                        "—"}
                    </small>
                  </h4>
                  {day.length ? (
                    day.map((e, n) => (
                      <div className="ready-exercise" key={`${e.id}-${n}`}>
                        <span>{n + 1}</span>
                        <b>{e.name}</b>
                        <strong>
                          {e.sets} × {e.reps}
                        </strong>
                      </div>
                    ))
                  ) : (
                    <em>لم تتم إضافة تمارين</em>
                  )}
                </div>
              ))}
            </article>
          ))}
        </div>
      ) : (
        <Empty
          icon={<FileText size={30} />}
          title="لا توجد قوالب محفوظة"
          text="أنشئ أول قالب منظم حسب الأيام والعضلات."
        />
      )}
      {show && (
        <CourseWizard
          initial={editing}
          exercises={exercises}
          onClose={() => setShow(false)}
          onSave={save}
          title={editing ? "تعديل الكورس الجاهز" : "إنشاء كورس جاهز"}
        />
      )}
    </>
  );
}
function CourseWizard({
  initial,
  exercises,
  onClose,
  onSave,
  title,
}: {
  initial: ReadyCourse | null;
  exercises: Exercise[];
  onClose: () => void;
  onSave: (c: ReadyCourse) => void;
  title: string;
}) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState(initial?.name || "");
  const [days, setDays] = useState(initial?.days.length || 3);
  const [day, setDay] = useState(0);
  const [muscle, setMuscle] = useState(muscles[0]);
  const [selected, setSelected] = useState<DayPlan[]>(
    initial ? cloneDays(initial.days) : blankDays(3),
  );
  useEffect(
    () =>
      setSelected((x) => Array.from({ length: days }, (_, i) => x[i] || [])),
    [days],
  );
  const add = (e: Exercise) =>
    setSelected((x) =>
      x.map((list, i) =>
        i === day
          ? list.some((a) => a.id === e.id)
            ? list
            : [...list, { ...e }]
          : list,
      ),
    );
  const remove = (id: string) =>
    setSelected((x) =>
      x.map((list, i) => (i === day ? list.filter((e) => e.id !== id) : list)),
    );
  const update = (id: string, key: keyof MemberExercise, value: string) =>
    setSelected((x) =>
      x.map((list, i) =>
        i === day
          ? list.map((e) =>
              e.id === id
                ? { ...e, [key]: key === "sets" ? Number(value) : value }
                : e,
            )
          : list,
      ),
    );
  return (
    <Modal title={title} onClose={onClose} wide>
      <WizardSteps step={step} />
      {step === 1 && (
        <div className="wizard-pane">
          <h3>اسم الكورس</h3>
          <p>البيانات لا تحفظ حتى تضغط حفظ.</p>
          <label>
            اسم الكورس
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثال: كورس مبتدئين"
            />
          </label>
        </div>
      )}
      {step === 2 && (
        <div className="wizard-pane">
          <h3>كم يوم تمرين؟</h3>
          <p>
            الأيام مستقلة. عند تقليل العدد ستظهر رسالة تأكيد إذا احتوت الأيام
            المحذوفة تمارين.
          </p>
          <div className="days-choice">
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
              <button
                className={days === n ? "active" : ""}
                onClick={() => {
                  if (
                    n < days &&
                    selected.slice(n).some((x) => x.length) &&
                    !window.confirm(
                      "سيؤدي تقليل الأيام إلى حذف تمارين الأيام الزائدة. هل تريد المتابعة؟",
                    )
                  )
                    return;
                  setDays(n);
                  setDay(Math.min(day, n - 1));
                }}
                key={n}
              >
                {n}
                <small>أيام</small>
              </button>
            ))}
          </div>
        </div>
      )}
      {step === 3 && (
        <Picker
          days={days}
          day={day}
          setDay={setDay}
          muscle={muscle}
          setMuscle={setMuscle}
          exercises={exercises}
          selected={selected}
          add={add}
          update={update}
          remove={remove}
        />
      )}{" "}
      {step === 4 && <Review name={name} days={days} selected={selected} />}
      <WizardActions
        step={step}
        setStep={setStep}
        onClose={onClose}
        save={() =>
          onSave({
            id: initial?.id || uid(),
            name: name || "كورس بدون اسم",
            days: cloneDays(selected.slice(0, days)),
          })
        }
      />
    </Modal>
  );
}
function WizardSteps({ step }: { step: number }) {
  return (
    <div className="wizard-steps">
      {["اسم الكورس", "أيام التدريب", "اختيار التمارين", "مراجعة وحفظ"].map(
        (x, i) => (
          <span className={step === i + 1 ? "active" : ""} key={x}>
            <b>{i + 1}</b>
            {x}
          </span>
        ),
      )}
    </div>
  );
}
function Picker({
  days,
  day,
  setDay,
  muscle,
  setMuscle,
  exercises,
  selected,
  add,
  update,
  remove,
  disabled = false,
}: {
  days: number;
  day: number;
  setDay: (n: number) => void;
  muscle: string;
  setMuscle: (s: string) => void;
  exercises: Exercise[];
  selected: DayPlan[];
  add: (e: Exercise) => void;
  update: (id: string, key: keyof MemberExercise, value: string) => void;
  remove: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="wizard-pane">
      <h3>تمارين اليوم {day + 1}</h3>
      <div className="day-switch">
        {Array.from({ length: days }, (_, i) => (
          <button
            className={day === i ? "active" : ""}
            onClick={() => setDay(i)}
            key={i}
          >
            اليوم {i + 1}
            <small>{selected[i]?.length || 0} تمارين</small>
          </button>
        ))}
      </div>
      <div className="picker-layout">
        <div className="picker-muscles">
          {muscles.map((m) => (
            <button
              className={muscle === m ? "active" : ""}
              onClick={() => setMuscle(m)}
              key={m}
            >
              {m}
            </button>
          ))}
        </div>
        <div className="picker-exercises">
          {exercises
            .filter((e) => normalizeMuscle(e.muscle) === muscle)
            .map((e) => (
              <button
                disabled={disabled}
                className={
                  selected[day]?.some((x) => x.id === e.id) ? "picked" : ""
                }
                onClick={() => add(e)}
                key={e.id}
              >
                <span>
                  {selected[day]?.some((x) => x.id === e.id) ? (
                    <Check size={15} />
                  ) : (
                    <Plus size={15} />
                  )}
                </span>
                <b>{e.name}</b>
                <small>
                  {e.sets} × {e.reps} · راحة {e.rest} · {safeVideoUrl(e.video) ? "رابط شرح" : "QR عند الطباعة"}
                </small>
              </button>
            ))}
        </div>
      </div>
      {selected[day]?.length > 0 && (
        <div className="selected-exercises">
          {selected[day].map((e) => (
            <div key={e.id}>
              <div>
                <b>{e.name}</b>
                <small>
                  {e.sets} × {e.reps} · راحة {e.rest} · {safeVideoUrl(e.video) ? "رابط شرح" : "QR عند الطباعة"}
                </small>
              </div>
              <label>
                مجموعات
                <input
                  disabled={disabled}
                  value={e.sets}
                  onChange={(x) => update(e.id, "sets", x.target.value)}
                />
              </label>
              <label>
                تكرارات
                <input
                  disabled={disabled}
                  value={e.reps}
                  onChange={(x) => update(e.id, "reps", x.target.value)}
                />
              </label>
              <label>
                الراحة
                <input
                  disabled={disabled}
                  value={e.rest}
                  onChange={(x) => update(e.id, "rest", x.target.value)}
                />
              </label>
              <label>
                الوزن
                <input
                  disabled={disabled}
                  value={e.weight || ""}
                  onChange={(x) => update(e.id, "weight", x.target.value)}
                />
              </label>
              {!disabled && (
                <button className="row-icon" onClick={() => remove(e.id)}>
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
function Review({
  name,
  days,
  selected,
}: {
  name: string;
  days: number;
  selected: DayPlan[];
}) {
  return (
    <div className="wizard-pane">
      <h3>مراجعة الكورس</h3>
      <div className="review-summary">
        <b>{name || "كورس بدون اسم"}</b>
        <span>{days} أيام تدريب</span>
      </div>
      {selected.slice(0, days).map((list, i) => (
        <div className="review-day" key={i}>
          <h4>
            اليوم {i + 1} <small>{list.length} تمارين</small>
          </h4>
          {list.length ? (
            list.map((e) => (
              <span key={e.id}>
                {e.name} · {e.sets} × {e.reps}
              </span>
            ))
          ) : (
            <em>لم تتم إضافة تمارين</em>
          )}
        </div>
      ))}
    </div>
  );
}
function WizardActions({
  step,
  setStep,
  onClose,
  save,
}: {
  step: number;
  setStep: (n: number) => void;
  onClose: () => void;
  save: () => void;
}) {
  return (
    <div className="modal-actions">
      <Button
        secondary
        onClick={step === 1 ? onClose : () => setStep(step - 1)}
      >
        {step === 1 ? "إلغاء" : "السابق"}
      </Button>
      {step < 4 ? (
        <Button onClick={() => setStep(step + 1)}>
          التالي <ArrowLeft size={16} />
        </Button>
      ) : (
        <Button onClick={save} icon={<Check size={16} />}>
          حفظ الكورس
        </Button>
      )}
    </div>
  );
}
function requestMemberSave(payload: AppPayload) {
  return new Promise<boolean>((resolve) => {
    window.dispatchEvent(new CustomEvent("alasas-save-member", { detail: { payload, resolve } }));
  });
}
function requestMemberDelete(payload: AppPayload) {
  return requestMemberSave(payload);
}
function MembersWithPin({exercises,members,courses,setMembers,settings}:{exercises:Exercise[];members:Member[];courses:ReadyCourse[];setMembers:React.Dispatch<React.SetStateAction<Member[]>>;settings:SettingsData}){
  const [editing,setEditing]=useState<Member|null>(null);
  const [show,setShow]=useState(false);
  const [pin,setPin]=useState('');
  const [pinBusy,setPinBusy]=useState(false);
  const [pinError,setPinError]=useState('');
  const [deleteBusy,setDeleteBusy]=useState('');
  const [deleteError,setDeleteError]=useState('');
  const [issueTarget,setIssueTarget]=useState<Member|null>(null);
  const [issuePhone,setIssuePhone]=useState('');
  const save=async(m:Member)=>{
    const nextMembers = members.some(a=>a.id===m.id)
      ? members.map(a=>a.id===m.id?{...a,...m,photo:"",...(m.authUid||a.authUid?{authUid:m.authUid||a.authUid}:{}),...(m.phoneE164?{phoneE164:m.phoneE164,phoneDisplay:m.phoneDisplay}:{} )}:a)
      : [{...m,photo:""},...members];
    setMembers(nextMembers);
    const ok = await requestMemberSave({schemaVersion:1, settings, exercises, members:nextMembers, courses});
    if (ok) { setShow(false); setEditing(null); }
  };
  const openIssue=(m:Member)=>{setPin('');setPinError('');setIssueTarget(m);setIssuePhone(memberPhoneDisplay(m))};
  const issue=async(m:Member,requestedPhone:string)=>{setPinBusy(true);setPinError('');setPin('');try{const phone=normalizeIraqiPhone(requestedPhone);const remote=await readAdminData<AppPayload>();const persisted=normalizeMembers(remote?.members).find(item=>item.id===m.id);if(!persisted)throw new Error('احفظ المشترك أولاً ثم تحقق من ظهوره في Firebase قبل إصدار PIN');setPin(await issueMemberPin(persisted.id,phone,persisted.membershipId||persisted.id,true));setIssueTarget(null);setIssuePhone('')}catch(e){setPinError(e instanceof Error?e.message:'تعذر إصدار PIN من الخدمة الموثوقة')}finally{setPinBusy(false)}};
  const removeMember=async(m:Member)=>{if(deleteBusy)return;if(!window.confirm(`حذف المشترك ${m.name}؟ سيتم إبطال PIN والجلسات بعد تأكيد Firebase.`))return;setDeleteBusy(m.id);setDeleteError('');const nextMembers=members.filter(a=>a.id!==m.id);const ok=await requestMemberDelete({schemaVersion:1,settings,exercises,members:nextMembers,courses});if(ok){try{await revokeMemberAccess(m.id)}catch(error){console.warn('[member-delete] PIN revoke endpoint unavailable or failed',error)}setMembers(nextMembers)}else{setDeleteError('تعذر تأكيد حذف المشترك من Firebase؛ بقيت البيانات كما هي. حاول مرة أخرى.')}setDeleteBusy('')};
  return <><section className="section-heading"><div><h2>المشتركون</h2><p>لكل مشترك نسخة مستقلة من الكورس والبيانات والطباعة.</p></div><Button onClick={()=>{setEditing(null);setShow(true)}} icon={<Plus size={17}/>}>إضافة مشترك</Button></section>{issueTarget&&<section className="panel pin-issue-form" role="dialog" aria-label="إصدار PIN"><b>إصدار PIN لـ {issueTarget.name}</b><label>رقم هاتف المشترك<input inputMode="tel" autoComplete="tel" value={issuePhone} onChange={e=>setIssuePhone(e.target.value)}/></label><small>المعروض: {memberPhoneDisplay(issueTarget)||'لا يوجد رقم صالح'}</small><div><button className="secondary-btn" disabled={pinBusy} onClick={()=>issue(issueTarget,issuePhone)}>{pinBusy?'جارٍ الإصدار…':'إصدار PIN'}</button><button className="secondary-btn" disabled={pinBusy} onClick={()=>{setIssueTarget(null);setIssuePhone('')}}>إلغاء</button></div></section>}{pin&&<section className="panel pin-reveal" role="status"><b>PIN الصادر — اعرضه للمشترك الآن فقط</b><strong>{pin}</strong><div><button className="secondary-btn" onClick={()=>navigator.clipboard.writeText(pin)}>نسخ الرمز</button><button className="secondary-btn" onClick={()=>window.print()}>طباعة</button></div><small>لن يُعاد عرض هذا الرمز من Firebase أو المتصفح بعد إغلاق هذه الشاشة.</small></section>}{pinError&&<p className="auth-error" role="alert">{pinError}</p>}{members.length?<div className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>المشترك</th><th>الهاتف</th><th>تاريخ الإنشاء</th><th>الطول</th><th>الوزن</th><th>الأيام</th><th>الإجراءات</th></tr></thead><tbody>{members.map(m=><tr key={m.id}><td><div className="member-cell"><div className="avatar">{m.name.slice(0,1)}</div><b>{m.name}</b></div></td><td>{memberPhoneDisplay(m)||'يُدخل عند الإصدار'}</td><td>{m.createdAt}</td><td>{m.height||'—'} سم</td><td>{m.weight||'—'} كغم</td><td>{m.days.length}</td><td><div className="row-actions"><button onClick={()=>setEditing(m)}><ExternalLink size={14}/>عرض</button><button onClick={()=>{setEditing(m);setShow(true)}}><Pencil size={14}/>تعديل</button><button disabled={pinBusy} onClick={()=>openIssue(m)}><Check size={14}/>إصدار / إعادة إصدار PIN</button><button onClick={()=>printMember(m,settings)}><Printer size={14}/>طباعة</button><button disabled={Boolean(deleteBusy)} onClick={()=>void removeMember(m)}><Trash2 size={14}/>{deleteBusy===m.id?'جارٍ الحذف…':'حذف'}</button></div></td></tr>)}</tbody></table></div></div>:<Empty icon={<Users size={30}/>} title="ابدأ بإضافة مشترك" text="Wizard منظم لبناء كورس مستقل."/>}{deleteError&&<p className="auth-error" role="alert">{deleteError}</p>}{(show||editing)&&<MemberWizard initial={editing} exercises={exercises} onClose={()=>{setShow(false);setEditing(null)}} onSave={save} viewOnly={!show}/>}</>}
function Members({
  exercises,
  members,
  setMembers,
  settings,
}: {
  exercises: Exercise[];
  members: Member[];
  setMembers: React.Dispatch<React.SetStateAction<Member[]>>;
  settings: SettingsData;
}) {
  const [editing, setEditing] = useState<Member | null>(null);
  const [show, setShow] = useState(false);
  const save = (m: Member) => {
    setMembers((x) =>
      x.some((a) => a.id === m.id)
        ? x.map((a) => (a.id === m.id ? m : a))
        : [...x, m],
    );
    setShow(false);
    setEditing(null);
  };
  return (
    <>
      <section className="section-heading">
        <div>
          <h2>المشتركون</h2>
          <p>لكل مشترك نسخة مستقلة من الكورس والبيانات والطباعة.</p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setShow(true);
          }}
          icon={<Plus size={17} />}
        >
          إضافة مشترك
        </Button>
      </section>
      {members.length ? (
        <div className="panel table-panel">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>المشترك</th>
                  <th>تاريخ الإنشاء</th>
                  <th>الطول</th>
                  <th>الوزن</th>
                  <th>الأيام</th>
                  <th>الإجراءات</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <div className="member-cell">
                        <div className="avatar">{m.name.slice(0, 1)}</div>
                        <b>{m.name}</b>
                      </div>
                    </td>
                    <td>{m.createdAt}</td>
                    <td>{m.height || "—"} سم</td>
                    <td>{m.weight || "—"} كغم</td>
                    <td>{m.days.length}</td>
                    <td>
                      <div className="row-actions">
                        <button onClick={() => setEditing(m)}>
                          <ExternalLink size={14} />
                          عرض
                        </button>
                        <button
                          onClick={() => {
                            setEditing(m);
                            setShow(true);
                          }}
                        >
                          <Pencil size={14} />
                          تعديل
                        </button>
                        <button onClick={() => printMember(m, settings)}>
                          <Printer size={14} />
                          طباعة
                        </button>
                        <button
                          onClick={() => {
                            if (window.confirm(`حذف المشترك ${m.name}؟`))
                              setMembers((x) => x.filter((a) => a.id !== m.id));
                          }}
                        >
                          <Trash2 size={14} />
                          حذف
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <Empty
          icon={<Users size={30} />}
          title="ابدأ بإضافة مشترك"
          text="Wizard منظم لبناء كورس مستقل."
        />
      )}
      {(show || editing) && (
        <MemberWizard
          initial={editing}
          exercises={exercises}
          onClose={() => {
            setShow(false);
            setEditing(null);
          }}
          onSave={save}
          viewOnly={!show}
        />
      )}
    </>
  );
}
function MemberWizard({
  initial,
  exercises,
  onClose,
  onSave,
  viewOnly = false,
}: {
  initial: Member | null;
  exercises: Exercise[];
  onClose: () => void;
  onSave: (m: Member) => void | Promise<void>;
  viewOnly?: boolean;
}) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState(initial?.name || "");
  const [membershipId, setMembershipId] = useState(
    initial?.membershipId || `M-${Date.now().toString().slice(-6)}`,
  );
  const [authUid, setAuthUid] = useState(initial?.authUid || "");
  const [phone, setPhone] = useState(initial?.phoneDisplay || initial?.phoneE164 || initial?.phone || "");
  const [active, setActive] = useState(initial?.active !== false);
  const [height, setHeight] = useState(initial?.height || "");
  const [weight, setWeight] = useState(initial?.weight || "");
  const [validationError, setValidationError] = useState("");
  const [days, setDays] = useState(initial?.days.length || 3);
  const [day, setDay] = useState(0);
  const [muscle, setMuscle] = useState(muscles[0]);
  const [selected, setSelected] = useState<DayPlan[]>(
    initial ? cloneDays(initial.days) : blankDays(3),
  );
  useEffect(
    () =>
      setSelected((x) => Array.from({ length: days }, (_, i) => x[i] || [])),
    [days],
  );
  const add = (e: Exercise) =>
    setSelected((x) =>
      x.map((list, i) =>
        i === day
          ? list.some((a) => a.id === e.id)
            ? list
            : [...list, { ...e }]
          : list,
      ),
    );
  const remove = (id: string) =>
    setSelected((x) =>
      x.map((list, i) => (i === day ? list.filter((e) => e.id !== id) : list)),
    );
  const update = (id: string, key: keyof MemberExercise, value: string) =>
    setSelected((x) =>
      x.map((list, i) =>
        i === day
          ? list.map((e) =>
              e.id === id
                ? { ...e, [key]: key === "sets" ? Number(value) : value }
                : e,
            )
          : list,
      ),
    );
  return (
    <Modal
      title={
        viewOnly
          ? "عرض كورس المشترك"
          : initial
            ? "تعديل كورس المشترك"
            : "إنشاء مشترك جديد"
      }
      onClose={onClose}
      wide
    >
      <WizardSteps step={step} />
      {step === 1 && (
        <div className="wizard-pane">
          <h3>معلومات المشترك</h3>
          <div className="form-grid">
            <label>
              اسم المشترك
              <input
                disabled={viewOnly}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              رقم العضوية
              <input
                disabled={viewOnly}
                value={membershipId}
                onChange={(e) => setMembershipId(e.target.value)}
              />
            </label>
            <label>
              الطول بالسنتيمتر
              <input
                disabled={viewOnly}
                value={height}
                onChange={(e) => setHeight(e.target.value)}
              />
            </label>
            <label>
              الوزن بالكيلوغرام
              <input
                disabled={viewOnly}
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
              />
            </label>
            <label>
              رقم هاتف المشترك
              <input
                disabled={viewOnly}
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </label>
            {!viewOnly && (
              <>
                {initial?.authUid && (
                  <label>
                    UID قديم (للتوافق فقط)
                    <input value={authUid} readOnly />
                  </label>
                )}
                <label className="member-active">
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={(e) => setActive(e.target.checked)}
                  />
                  عضوية فعالة
                </label>
              </>
            )}
          </div>
          {!viewOnly && (
            <p>
              يصدر المدرب PIN رباعياً من زر الإصدار بعد حفظ المشترك. لا يُستخدم
              Google لتسجيل المشتركين.
            </p>
          )}
        </div>
      )}
      {step === 2 && (
        <div className="wizard-pane">
          <h3>عدد أيام الكورس</h3>
          <div className="days-choice">
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
              <button
                disabled={viewOnly}
                className={days === n ? "active" : ""}
                onClick={() => {
                  if (
                    n < days &&
                    selected.slice(n).some((x) => x.length) &&
                    !window.confirm("حذف تمارين الأيام الزائدة؟")
                  )
                    return;
                  setDays(n);
                  setDay(Math.min(day, n - 1));
                }}
                key={n}
              >
                {n}
                <small>أيام</small>
              </button>
            ))}
          </div>
        </div>
      )}
      {step === 3 && (
        <Picker
          days={days}
          day={day}
          setDay={setDay}
          muscle={muscle}
          setMuscle={setMuscle}
          exercises={exercises}
          selected={selected}
          add={add}
          update={update}
          remove={remove}
          disabled={viewOnly}
        />
      )}{" "}
      {step === 4 && <Review name={name} days={days} selected={selected} />}
      <div className="modal-actions">
        <Button
          secondary
          onClick={step === 1 ? onClose : () => setStep(step - 1)}
        >
          {step === 1 ? "إغلاق" : "السابق"}
        </Button>
        {!viewOnly && step < 4 && (
          <Button onClick={() => setStep(step + 1)}>
            التالي <ArrowLeft size={16} />
          </Button>
        )}
        {!viewOnly && step === 4 && (
          <Button
            onClick={async () => {
              try {
                const normalizedMemberName = cleanMemberName(name);
                const normalizedMemberPhone = phone.trim() ? normalizeIraqiPhone(phone) : "";
                setValidationError("");
                await onSave({
                  id: initial?.id || uid(),
                  membershipId: membershipId.trim(),
                  name: normalizedMemberName,
                  height,
                  weight,
                  createdAt: initial?.createdAt || new Date().toLocaleDateString("ar-IQ"),
                  ...(normalizedMemberPhone ? {
                    phoneE164: normalizedMemberPhone,
                    phoneDisplay: displayIraqiPhone(normalizedMemberPhone),
                  } : {}),
                  days: cloneDays(selected.slice(0, days)),
                  active,
                  ...(authUid.trim() ? { authUid: authUid.trim() } : {}),
                });
              } catch (error) {
                setValidationError(error instanceof Error ? error.message : "بيانات المشترك غير صالحة");
              }
            }}
            icon={<Check size={16} />}
          >
            حفظ
          </Button>
        )}
        {validationError && <p className="auth-error" role="alert">{validationError}</p>}
        {viewOnly && step < 4 && (
          <Button onClick={() => setStep(step + 1)}>
            التالي <ArrowLeft size={16} />
          </Button>
        )}
      </div>
    </Modal>
  );
}
function MemberPortal({
  s,
  member,
  onSignOut,
}: {
  s: SettingsData;
  member: Member;
  onSignOut: () => void;
}) {
  const m = member;
  const [day, setDay] = useState(0);
  const [done, setDone] = useState<string[]>([]);
  const list = m.days[day] || [];
  return (
    <main className="member-portal">
      <div className="portal-head">
        <Logo s={s} />
        <span>بوابة المشترك</span>
        <button className="text-btn" onClick={onSignOut}>
          تسجيل الخروج
        </button>
      </div>
      <section className="member-hero">
        <div>
          <span className="status active">
            <i />
            عضوية نشطة
          </span>
          <h1>{m.name}</h1>
          <p>
            رقم العضوية: {m.membershipId || "—"} · خطة التدريب الخاصة بك ·{" "}
            {m.height || "—"} سم · {m.weight || "—"} كغم
          </p>
        </div>
      </section>
      {m.days.length ? (
        <section className="panel portal-workout">
          <div className="day-tabs">
            {m.days.map((d, i) => (
              <button
                className={day === i ? "active" : ""}
                onClick={() => setDay(i)}
                key={i}
              >
                اليوم {i + 1}
                <span>{d.length} تمارين</span>
              </button>
            ))}
          </div>
          {list.map((e) => (
            <div className="portal-exercise" key={e.id}>
              <button
                className={done.includes(e.id) ? "check-btn done" : "check-btn"}
                onClick={() =>
                  setDone((x) =>
                    x.includes(e.id)
                      ? x.filter((i) => i !== e.id)
                      : [...x, e.id],
                  )
                }
              >
                {done.includes(e.id) && <Check size={15} />}
              </button>
              <div>
                <b>{e.name}</b>
                <span>{e.muscle}</span>
              </div>
              <strong>
                {e.sets} × {e.reps}
              </strong>
              <span>راحة {e.rest}</span>
              <a className="portal-exercise-link" href={exerciseUrl(e.id)} target="_blank" rel="noopener noreferrer" aria-label={`اضغط لعرض التمرين: ${e.name}`}>
                <QRCodeSVG value={exerciseUrl(e.id)} size={52} includeMargin level="M" />
                <span>اضغط لعرض التمرين <ExternalLink size={14}/></span>
              </a>
            </div>
          ))}
        </section>
      ) : (
        <section className="panel portal-workout">
          <Empty
            icon={<Dumbbell size={28} />}
            title="لم يتم تعيين كورس تدريبي لحسابك بعد."
            text="يرجى مراجعة إدارة القاعة."
          />
        </section>
      )}
    </main>
  );
}
function ExerciseDetail({
  s,
  exercise,
}: {
  s: SettingsData;
  exercise?: Exercise;
}) {
  const video = safeVideoUrl(exercise?.video);
  return (
    <main className="exercise-detail-page">
      <Logo s={s} />
      <section className="panel exercise-detail-card">
        {exercise ? (
          <>
            <div className="exercise-thumb big">
              <Dumbbell size={34} />
            </div>
            <h1>{exercise.name}</h1>
            <p>{exercise.english || "شرح التمرين"}</p>
            <div className="detail-grid">
              <span>
                المجموعات<strong>{exercise.sets}</strong>
              </span>
              <span>
                التكرارات<strong>{exercise.reps}</strong>
              </span>
              <span>
                الراحة<strong>{exercise.rest}</strong>
              </span>
            </div>
            {video ? (
              <a
                className="primary-btn"
                href={video}
                target="_blank"
                rel="noreferrer"
              >
                فتح فيديو الشرح <ExternalLink size={15} />
              </a>
            ) : (
              <span className="availability-badge">الشرح غير متوفر</span>
            )}
          </>
        ) : (
          <Empty
            icon={<Dumbbell size={28} />}
            title="التمرين غير موجود"
            text="تحقق من الرابط أو أعد إنشاء QR."
          />
        )}
      </section>
    </main>
  );
}
function PublicExerciseDetail({
  exerciseId,
  fallback,
}: {
  exerciseId: string;
  fallback?: Exercise;
}) {
  const [exercise, setExercise] = useState<Exercise | undefined>(fallback);
  const [loading, setLoading] = useState(!fallback);
  useEffect(
    () =>
      watchPublicExercise<Exercise>(exerciseId, (value) => {
        setExercise(value || undefined);
        setLoading(false);
      }),
    [exerciseId],
  );
  const video = safeVideoUrl(exercise?.video);
  return (
    <main className="exercise-detail-page">
      <div className="public-exercise-brand">
        <div className="brand-mark" style={{ background: defaults.accent }}>
          <Dumbbell size={19} />
        </div>
        <strong>AL ASAS FIT</strong>
      </div>
      <section className="panel exercise-detail-card">
        {exercise ? (
          <>
            <div className="exercise-thumb big">
              <Dumbbell size={34} />
            </div>
            <h1>{exercise.name}</h1>
            <p>{exercise.english || "شرح التمرين"}</p>
            <div className="detail-grid">
              <span>
                المجموعات<strong>{exercise.sets}</strong>
              </span>
              <span>
                التكرارات<strong>{exercise.reps}</strong>
              </span>
              <span>
                الراحة<strong>{exercise.rest}</strong>
              </span>
            </div>
            {video ? (
              <a
                className="primary-btn"
                href={video}
                target="_blank"
                rel="noreferrer"
              >
                فتح فيديو الشرح <ExternalLink size={15} />
              </a>
            ) : (
              <span className="availability-badge">
                لم تتم إضافة رابط فيديو بعد
              </span>
            )}
          </>
        ) : loading ? (
          <p>جارٍ تحميل بيانات التمرين…</p>
        ) : (
          <Empty
            icon={<Dumbbell size={28} />}
            title="التمرين غير موجود"
            text="قد يكون الرابط قديماً أو لم تتم مزامنته بعد."
          />
        )}
      </section>
    </main>
  );
}
function SettingsPage({
  s,
  setS,
}: {
  s: SettingsData;
  setS: React.Dispatch<React.SetStateAction<SettingsData>>;
}) {
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [saveMessage, setSaveMessage] = useState("");
  useEffect(() => {
    const report = (event: Event) => {
      const detail = String((event as CustomEvent<string>).detail);
      if (detail === "saving") {
        setSaveState("saving");
        setSaveMessage("جارٍ الحفظ والتحقق من القراءة…");
      } else if (detail === "saved") {
        setSaveState("saved");
        setSaveMessage("تم الحفظ وتأكيد القراءة من Firebase.");
      } else {
        setSaveState("error");
        setSaveMessage(detail);
      }
    };
    window.addEventListener("alasas-save-status", report);
    return () => window.removeEventListener("alasas-save-status", report);
  }, []);
  const update = (key: keyof SettingsData, value: string | boolean) => {
    setSaveState("idle");
    setS((x) => ({ ...x, [key]: value }));
  };
  const save = () => {
    if (saveState === "saving" || !firebaseConfigured) return;
    window.dispatchEvent(new Event("alasas-save-settings"));
  };
  return (
    <div className="settings-page">
      <section className="settings-block">
        <h2>هوية الموقع</h2>
        <p>هذه البيانات تظهر في لوحة الكابتن وقالب الطباعة.</p>
        <div className="form-grid">
          <label>
            اسم الكابتن
            <input
              value={s.coachName}
              onChange={(e) => update("coachName", e.target.value)}
            />
          </label>
          <label>
            اسم القاعة الرياضية
            <input
              value={s.gymName}
              onChange={(e) => update("gymName", e.target.value)}
            />
          </label>
          <label>
            رقم الهاتف
            <input
              value={s.phone}
              onChange={(e) => update("phone", e.target.value)}
            />
          </label>
          <label>
            رابط واتساب
            <input
              value={s.whatsapp}
              onChange={(e) => update("whatsapp", e.target.value)}
            />
          </label>
          <label>
            حساب إنستغرام
            <input
              value={s.instagram}
              onChange={(e) => update("instagram", e.target.value)}
            />
          </label>
          <label>
            عنوان القاعة
            <input
              value={s.address}
              onChange={(e) => update("address", e.target.value)}
            />
          </label>
        </div>
      </section>
      <section className="settings-block">
        <h2>الصور الثابتة</h2>
        <p>صور الكابتن والقاعة تُدار كملفات ثابتة داخل <code>public/assets/</code> وتُنشر عبر Firebase Hosting. لا يوجد رفع أو حفظ صور من لوحة الإدارة في هذا الإصدار.</p>
        <div className="upload-grid">
          <StaticAsset label="شعار القاعة" value={s.logo} />
          <StaticAsset label="صورة الكابتن (افتراضية مؤقتة)" value={s.coachPhoto} />
          <StaticAsset label="صورة القاعة (افتراضية مؤقتة)" value={s.hallPhoto} />
        </div>
      </section>
      <section className="settings-block">
        <h2>قالب الطباعة</h2>
        <div className="toggle-list">
          <label>
            <input
              type="checkbox"
              checked={s.showDate}
              onChange={(e) => update("showDate", e.target.checked)}
            />
            إظهار التاريخ
          </label>
          <label>
            <input
              type="checkbox"
              checked={s.showWeight}
              onChange={(e) => update("showWeight", e.target.checked)}
            />
            إظهار الوزن
          </label>
          <label>
            <input
              type="checkbox"
              checked={s.showHeight}
              onChange={(e) => update("showHeight", e.target.checked)}
            />
            إظهار الطول
          </label>
        </div>
        <label className="color-field">
          لون التمييز
          <input
            type="color"
            value={s.accent}
            onChange={(e) => update("accent", e.target.value)}
          />
        </label>
        <div className="print-preview">
          <strong>{s.gymName}</strong>
          <span>{s.coachName}</span>
          <h3>نموذج كورس تدريبي</h3>
          <p>معاينة مختصرة لقالب A4 قبل الطباعة.</p>
        </div>
        <div className="settings-save">
          <Button onClick={save} icon={<Check size={16} />}>
            {saveState === "saving" ? "جارٍ الحفظ…" : "حفظ التعديلات"}
          </Button>
          {saveMessage && (
            <p
              className={saveState === "error" ? "save-error" : "save-status"}
              role="status"
            >
              {saveMessage}
            </p>
          )}
          {!firebaseConfigured && (
            <p className="save-error">Firebase غير مهيأ؛ لا يمكن الحفظ.</p>
          )}
        </div>
      </section>
    </div>
  );
}
function StaticAsset({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="upload-box static-asset">
      {value && <img src={value} alt="" />}
      <span>{label}</span>
      <small>المسار: {value}</small>
    </div>
  );
}
function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <section
        className={wide ? "modal wide" : "modal"}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
function printMemberLegacy(m: Member, s: SettingsData) {
  const qrMarkup = (e: MemberExercise) => {
    const target = exerciseTarget(e);
    return target
      ? `<div class="qr">${renderToStaticMarkup(<QRCodeSVG value={target} size={58} includeMargin level="M" />)}</div>`
      : '<span class="qr-empty">الشرح غير متوفر</span>';
  };
  const html = `<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>${escapeHtml(m.name)} — ${escapeHtml(s.gymName)}</title><style>@page{size:A4 portrait;margin:12mm}*{box-sizing:border-box}body{font-family:Arial,Tahoma,sans-serif;color:#171917;margin:0;background:#fff}header{display:grid;grid-template-columns:72px 1fr 1fr;gap:12px;align-items:center;border-bottom:3px solid #b7ff2a;padding-bottom:12px;margin-bottom:14px}header img{max-height:58px;max-width:120px;object-fit:contain}h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:14px 0 6px;border-bottom:1px solid #ddd;padding-bottom:5px}.meta{font-size:10px;color:#525960}.day{break-inside:avoid;page-break-inside:avoid;border:1px solid #e5e7eb;border-radius:6px;padding:8px;margin:8px 0}.exercise-head,.exercise{display:grid;grid-template-columns:20px 1fr 90px 60px 66px;gap:6px;align-items:center}.exercise-head{font-weight:700;color:#525960;font-size:9px;padding:3px 0 6px;border-bottom:1px solid #ddd}.exercise{border-bottom:1px solid #eee;padding:7px 0;font-size:10px}.exercise:last-child{border:0}.exercise small{display:block;color:#525960}.qr{width:58px;height:58px;background:#fff;padding:4px;display:grid;place-items:center}.qr svg{width:50px;height:50px}.qr-empty{font-size:8px;color:#777;text-align:center}.footer{margin-top:15px;border-top:1px solid #ddd;padding-top:8px;font-size:9px;color:#525960;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}section{break-inside:avoid}</style></head><body><header><div></div><div><h1>${escapeHtml(m.name)}</h1><div class="meta">${s.showHeight ? `${escapeHtml(m.height || "—")} سم · ` : ""}${s.showWeight ? `${escapeHtml(m.weight || "—")} كغم` : ""}${s.showDate ? ` · ${escapeHtml(m.createdAt)}` : ""}</div></div><div><strong>${escapeHtml(s.gymName)}</strong>${s.logo ? `<br><img src="${s.logo}" alt="شعار القاعة">` : ""}<div class="meta">${escapeHtml(s.coachName)}</div></div></header>${m.days.map((day, i) => `<section class="day"><h2>اليوم ${i + 1}</h2>${day.length ? `<div class="exercise-head"><span>م</span><span>التمرين</span><span>المجاميع × التكرارات</span><span>الراحة</span><span>QR</span></div>${day.map((e, n) => `<div class="exercise"><b>${n + 1}</b><div><strong>${escapeHtml(e.name)}</strong><small>${escapeHtml(e.muscle)}</small></div><span>${escapeHtml(String(e.sets))} × ${escapeHtml(e.reps)}${e.weight ? ` · ${escapeHtml(e.weight)}` : ""}</span><span>${escapeHtml(e.rest || "—")}</span>${qrMarkup(e)}</div>`).join("")}` : '<div class="meta">لا توجد تمارين لهذا اليوم</div>'}</section>`).join("")}<div class="footer"><span>${escapeHtml(s.phone)}</span><span>${escapeHtml(s.instagram)}</span><span>${escapeHtml(s.address)}</span></div><script>async function ready(){if(document.fonts?.ready)await document.fonts.ready;await Promise.all([...document.images].map(i=>i.complete?Promise.resolve():new Promise(r=>{i.onload=i.onerror=r})));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));window.focus();window.print()}window.addEventListener('load',ready)</script></body></html>`;
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(html);
  w.document.close();
}
function printMember(m: Member, s: SettingsData) {
  const qrMarkup = (e: MemberExercise) => `<div class="qr">${renderToStaticMarkup(<QRCodeSVG value={exerciseTarget(e)} size={64} includeMargin level="M" />)}</div>`;
  const rows = (day: DayPlan) => day.map((e, n) => `<tr><td class="num">${n + 1}</td><td class="exercise-name"><strong>${escapeHtml(e.name)}</strong><small>${escapeHtml(e.muscle)}</small></td><td>${escapeHtml(String(e.sets))} × ${escapeHtml(e.reps)}${e.weight ? ` · ${escapeHtml(e.weight)}` : ""}</td><td>${escapeHtml(e.rest || "—")}</td><td>${qrMarkup(e)}</td></tr>`).join("");
  const coachPhoto = s.printCoachPhotoUrl || s.coachPhoto;
  const hallPhoto = s.printHallPhotoUrl || s.hallPhoto;
  const html = `<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>${escapeHtml(m.name)} — ${escapeHtml(s.gymName)}</title><style>
    @page{size:A4 portrait;margin:8mm}*{box-sizing:border-box}body{font-family:Arial,Tahoma,sans-serif;color:#171917;margin:0;background:#fff;direction:rtl}.header{display:grid;grid-template-columns:1fr 1.15fr 1fr;gap:12px;align-items:center;min-height:42mm;direction:ltr}.coach{text-align:left;direction:rtl}.coach img{width:39mm;height:39mm;border-radius:50%;object-fit:cover;object-position:top;border:1px solid #b7ff2a}.brand{text-align:center;direction:rtl}.brand img{max-width:45mm;max-height:34mm;object-fit:contain}.brand strong{display:block;font-size:11px;margin-top:2px}.member{text-align:right;font-size:14px;line-height:1.9;font-weight:700;direction:rtl}.member b{font-weight:400}.rule{height:2px;background:#b7ff2a;margin:2mm 0 5mm}.day{break-inside:avoid;page-break-inside:avoid;border:1px solid #222;border-radius:3mm;padding:0 0 2mm;margin:0 0 6mm;background:#fff url(${hallPhoto ? `'${hallPhoto}'` : "none"}) center/80mm auto no-repeat;background-blend-mode:soft-light}.day-title{width:52mm;margin:-4mm auto 2mm;background:#fff;border:1px solid #555;border-radius:2mm;text-align:center;padding:1.5mm 2mm;font-size:16px;font-weight:700}.day table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:10px;background:rgba(255,255,255,.94)}.day th,.day td{border:1px solid #cfd3d0;padding:1.6mm 1.5mm;vertical-align:middle;text-align:center}.day th{background:#f0f1f0;font-size:10px}.day th:nth-child(1),.day td:nth-child(1){width:8%}.day th:nth-child(2),.day td:nth-child(2){width:39%;text-align:right}.day th:nth-child(3),.day td:nth-child(3){width:25%}.day th:nth-child(4),.day td:nth-child(4){width:16%}.day th:nth-child(5),.day td:nth-child(5){width:12%}.exercise-name small{display:block;color:#555;font-size:8px;margin-top:1mm}.num{font-weight:700}.qr{width:15mm;height:15mm;margin:auto;display:grid;place-items:center}.qr svg{width:13mm;height:13mm}.footer{border-top:1px solid #222;background:#fff2c9;margin-top:3mm;padding:3mm 4mm;display:flex;justify-content:space-between;gap:4mm;font-size:9px;break-inside:avoid}.footer span{white-space:nowrap}.empty{padding:5mm;text-align:center;color:#666}section{break-inside:avoid}@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
  </style></head><body><header class="header"><div class="coach">${coachPhoto ? `<img src="${coachPhoto}" alt="صورة الكابتن">` : ""}</div><div class="brand">${s.logo ? `<img src="${s.logo}" alt="شعار ${escapeHtml(s.gymName)}">` : `<strong>${escapeHtml(s.gymName)}</strong>`}<strong>${escapeHtml(s.coachName)}</strong></div><div class="member">${s.showDate ? `<div><b>التاريخ:</b> ${escapeHtml(m.createdAt || "—")}</div>` : ""}<div><b>الاسم:</b> ${escapeHtml(m.name)}</div>${s.showWeight ? `<div><b>الوزن:</b> ${escapeHtml(m.weight || "—")}</div>` : ""}${s.showHeight ? `<div><b>الطول:</b> ${escapeHtml(m.height || "—")}</div>` : ""}</div></header><div class="rule"></div>${m.days.map((day, i) => `<section class="day"><h2 class="day-title">اليوم ${i + 1}</h2>${day.length ? `<table><thead><tr><th>م</th><th>التمرين</th><th>المجاميع × التكرارات</th><th>الراحة</th><th>QR</th></tr></thead><tbody>${rows(day)}</tbody></table>` : '<div class="empty">لا توجد تمارين لهذا اليوم</div>'}</section>`).join("")}<footer class="footer"><span>${escapeHtml(s.phone || "")}</span><span>${escapeHtml(s.instagram || "")}</span><span>${escapeHtml(s.address || "")}</span></footer><script>async function ready(){if(document.fonts?.ready)await document.fonts.ready;await Promise.all([...document.images].map(i=>i.complete?Promise.resolve():new Promise(r=>{i.onload=i.onerror=r})));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));window.focus();window.print()}window.addEventListener('load',ready)</script></body></html>`;
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(html);
  w.document.close();
}
function escapeHtml(value: string) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] || c,
  );
}
type UiErrorBoundaryState = { error: Error | null };
class UiErrorBoundary extends Component<
  { children: React.ReactNode },
  UiErrorBoundaryState
> {
  state: UiErrorBoundaryState = { error: null };
  static getDerivedStateFromError(error: Error): UiErrorBoundaryState {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ui-error-boundary]", {
      name: error.name,
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    });
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="error-boundary-page" dir="rtl">
        <section className="panel error-boundary-card" role="alert">
          <h1>تعذر عرض هذه الصفحة</h1>
          <p>حدث خطأ غير متوقع في بيانات العرض. لم تُحذف أي بيانات.</p>
          <small>يمكنك إعادة المحاولة أو العودة إلى لوحة الإدارة.</small>
          <div className="error-boundary-actions">
            <button className="primary-btn" onClick={() => window.location.reload()}>
              إعادة المحاولة
            </button>
            <button className="secondary-btn" onClick={() => window.location.assign("/admin/") }>
              العودة إلى لوحة الإدارة
            </button>
          </div>
        </section>
      </main>
    );
  }
}
const adminRoute = location.pathname.replace(/\/+$/, "").endsWith("/admin");
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <UiErrorBoundary>
      {adminRoute ? (
        <AdminGate />
      ) : location.hash.startsWith("#/exercise/") ? (
        <App role="MANAGER" onSignOut={() => {}} />
      ) : (
        <MemberPinGate />
      )}
    </UiErrorBoundary>
  </StrictMode>,
);
