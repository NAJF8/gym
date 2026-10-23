import { Component, StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Activity,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  CheckCircle2,
  ChevronLeft,
  CircleAlert,
  Copy,
  Dumbbell,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Folder,
  Home,
  LogOut,
  Menu,
  Pencil,
  Plus,
  Printer,
  Play,
  QrCode,
  RotateCcw,
  Search,
  Settings,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import {
  authStatusLabel,
  signInAdmin,
  signOutUser,
  readAdminRecord,
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
  readAdminDeletionConflicts,
  readAdminExercises,
  type SyncPayload,
  watchAdminData,
  watchPublicExercise,
  watchPublicCourse,
  writeAdminData,
  saveManagerPrintSettings,
  deleteAdminMember,
  reserveMemberPhone,
  releaseMemberPhone,
} from "./dataSync";
import {
  issueMemberPin,
  revealMemberPin,
  fetchPinAuditLogs,
  fetchMemberSession,
  loginMemberWithPin,
  revokeMemberSession,
  revokeMemberAccess,
  pinServiceConfigured,
  type PinAuditLogEntry,
} from "./memberPin";
import { firebaseAuth } from "./firebase";
import { acceptAdminInvitation, inviteAdmin, listManagedAdmins, updateManagedAdmin, type ManagedAdmin } from "./adminManagement";
import { isSafeVideoUrl, safeVideoUrl, youtubeEmbedUrl, youtubeVideoId } from "./videoUrl";
import { safeImageUrl } from "./imageUrl";
import { APP_VERSION } from "./release";
import { uploadPrintImage, waitForPrintImageDeployment, type PrintImageSlot } from "./imageUpload";
import { mergeExerciseLibrary } from "./exerciseLibrary";
import { displayIraqiPhone, normalizeIraqiPhone } from "./phone";
import "./styles.css";

const MEMBER_SESSION_STORAGE_KEY = "alasas-member-session-token";

function MemberPinGate(){
  const [member,setMember]=useState<Member|null>(null);
  const [sessionToken,setSessionToken]=useState(()=> {
    try { return sessionStorage.getItem(MEMBER_SESSION_STORAGE_KEY) || ''; } catch { return ''; }
  });
  const [restoring,setRestoring]=useState(()=> {
    try { return Boolean(sessionStorage.getItem(MEMBER_SESSION_STORAGE_KEY)); } catch { return false; }
  });
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [phone,setPhone]=useState('');
  const [pin,setPin]=useState('');
  const [showPin,setShowPin]=useState(false);
  const submittingRef=useRef(false);

  useEffect(()=>{
    const savedToken = (() => { try { return sessionStorage.getItem(MEMBER_SESSION_STORAGE_KEY) || ''; } catch { return ''; } })();
    if (!savedToken) { setRestoring(false); return; }
    let active = true;
    setRestoring(true);
    void fetchMemberSession(savedToken)
      .then((profile) => {
        if (!active) return;
        const normalized = normalizeMember(profile) || (profile as unknown as Member);
        setMember(normalized);
        setSessionToken(savedToken);
      })
      .catch(() => {
        if (!active) return;
        try { sessionStorage.removeItem(MEMBER_SESSION_STORAGE_KEY); } catch {}
        setSessionToken('');
        setMember(null);
        setError('انتهت صلاحية الجلسة السابقة، يرجى تسجيل الدخول مجدداً.');
      })
      .finally(() => {
        if (active) setRestoring(false);
      });
    return () => { active = false; };
  }, []);

  const signOut=async()=>{
    const token=sessionToken;
    try { sessionStorage.removeItem(MEMBER_SESSION_STORAGE_KEY); } catch {}
    setSessionToken('');
    setMember(null);
    setPin('');
    setError('');
    try{await revokeMemberSession(token)}catch{}
  };
  if(!pinServiceConfigured)return <AuthNotice title="بوابة المشترك متوقفة بأمان" text="لم يتم ضبط عنوان خدمة PIN الموثوقة. لا يمكن تسجيل الدخول من المتصفح مباشرة."/>;
  if(restoring)return <AuthNotice title="جارٍ استعادة جلسة المشترك" text="يتم التحقق من صلاحية الجلسة وتحميل كورسك التدريبي..." />;
  if(!member)return <main className="auth-page member-login-page"><div className="member-login-shell"><header className="member-login-brand"><Logo s={defaults}/><span>AL ASAS FIT · بوابة المشترك</span></header><section className="panel auth-card member-login-card"><div className="member-login-icon"><Dumbbell size={25}/></div><span className="status">دخول المشتركين</span><h1>أهلاً بعودتك</h1><p>ادخل رقم هاتفك ورمز الدخول المكوّن من 4 أرقام الذي استلمته من الكابتن حتى تشوف جدول تمارينك.</p><form className="member-login-form" onSubmit={async(e)=>{e.preventDefault();if(busy||submittingRef.current||pin.length!==4||!phone.trim())return;submittingRef.current=true;setBusy(true);setError('');try{const result=await loginMemberWithPin(phone,pin);if(result.customToken){if(!firebaseAuth)throw new Error('Firebase غير مهيأ');const signed=await (await import('firebase/auth')).signInWithCustomToken(firebaseAuth,result.customToken);const profile=await readMemberProfile<Member>(signed.user.uid);if(!profile)throw new Error('لم يتم العثور على ملف العضوية بعد التحقق');setMember(profile);setSessionToken(result.customToken);try{sessionStorage.setItem(MEMBER_SESSION_STORAGE_KEY,result.customToken)}catch{}}else if(result.member&&result.sessionToken){const normalized=normalizeMember(result.member)||(result.member as Member);setMember(normalized);setSessionToken(result.sessionToken);try{sessionStorage.setItem(MEMBER_SESSION_STORAGE_KEY,result.sessionToken)}catch{}}else throw new Error('جلسة المشترك غير صالحة')}catch(err){setError(err instanceof Error?err.message:'تعذر تسجيل الدخول')}finally{submittingRef.current=false;setBusy(false)}}}><label htmlFor="member-phone">رقم الهاتف</label><input id="member-phone" type="tel" inputMode="tel" autoComplete="tel" dir="ltr" placeholder="07XXXXXXXXX" required value={phone} onChange={e=>setPhone(e.target.value)} /><label htmlFor="member-pin">رمز الدخول (4 أرقام)</label><div className="pin-input-wrap"><input id="member-pin" type={showPin ? "text" : "password"} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{4}" maxLength={4} dir="ltr" placeholder="••••" required value={pin} onChange={e=>setPin(e.target.value.replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x6f0)).replace(/\D/g,'').slice(0,4))}/><button type="button" className="icon-btn pin-visibility-btn" aria-label={showPin ? "إخفاء الرمز" : "إظهار الرمز"} onClick={()=>setShowPin(v=>!v)}>{showPin ? <Eye size={17}/> : <EyeOff size={17}/>}</button></div><button className="member-login-submit" type="submit" disabled={busy||pin.length!==4||!phone.trim()}>{busy?'جارٍ التحقق…':'عرض كورسي التدريبي'} <ArrowLeft size={18}/></button>{error&&<p className="auth-error" role="alert">{error}</p>}</form><p className="auth-help">ما عندك رمز الدخول؟ تواصل ويا الكابتن حتى يفعّل عضويتك.</p></section><MemberCustomerFooter showLoginNote /></div></main>;
  return <MemberPortal s={defaults} member={member} onSignOut={signOut}/>;
}

function MemberCustomerFooter({ showLoginNote = false }: { showLoginNote?: boolean }) {
  return <footer className="member-login-footer member-customer-footer" aria-label="حقوق الشركة والإصدار">
    {showLoginNote && <span>الدخول برقم الهاتف والرمز فقط · حسابات Google للمدراء</span>}
    <span>جميع الحقوق محفوظة لشركة الأساس للحلول البرمجية</span>
    <span dir="ltr">Version 1.8.0</span>
  </footer>;
}
type CategoryItem = {
  id: string;
  name: string;
  image?: string;
};
type Exercise = {
  id: string;
  name: string;
  english?: string;
  muscle: string;
  sets: number | string;
  reps: string;
  rest: string;
  video?: string;
  description?: string;
  image?: string;
};
type MemberExercise = Exercise & { weight?: string; notes?: string };
type DayPlan = MemberExercise[];
type Member = {
  id: string;
  membershipId?: string;
  name: string;
  height: string;
  weight: string;
  createdAt: string;
  expiresAt?: string;
  courseName?: string;
  notes?: string;
  photo?: string;
  days: DayPlan[];
  active?: boolean;
  authUid?: string;
  /** Legacy field accepted on read only. New records use phoneE164/phoneDisplay. */
  phone?: string;
  phoneE164?: string;
  phoneDisplay?: string;
  /** Server CAS metadata; never compared as user-entered member data. */
  version?: number;
  /** Transient field for initial/reset PIN during member wizard save; never persisted to RTDB. */
  customPin?: string;
};
type ReadyCourse = { id: string; name: string; notes?: string; days: DayPlan[] };
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
  printFooterNote: string;
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

/** Optional library suggestions; imported explicitly, never written during initial hydration. */
const suggestedExercises: Exercise[] = [
  { id: "library-db-fly", name: "تفتيح دمبل مستوي", english: "Dumbbell Fly", muscle: muscles[0], sets: 3, reps: "10–12", rest: "60 ثانية" },
  { id: "library-chest-machine", name: "جهاز صدر", english: "Chest Press Machine", muscle: muscles[0], sets: 3, reps: "10–12", rest: "60 ثانية" },
  { id: "library-push-up", name: "ضغط صدر", english: "Push-Up", muscle: muscles[0], sets: 3, reps: "12–15", rest: "60 ثانية" },
  { id: "library-single-arm-row", name: "تجديف دمبل", english: "One Arm Dumbbell Row", muscle: muscles[1], sets: 3, reps: "10–12", rest: "60 ثانية" },
  { id: "library-tbar-row", name: "تي بار", english: "T-Bar Row", muscle: muscles[1], sets: 3, reps: "8–12", rest: "60 ثانية" },
  { id: "library-straight-pulldown", name: "سحب مستقيم", english: "Straight Arm Pulldown", muscle: muscles[1], sets: 3, reps: "12–15", rest: "60 ثانية" },
  { id: "library-leg-press", name: "ليج برس", english: "Leg Press", muscle: muscles[2], sets: 4, reps: "10–12", rest: "60 ثانية" },
  { id: "library-leg-extension", name: "تمديد الأرجل", english: "Leg Extension", muscle: muscles[2], sets: 3, reps: "12–15", rest: "60 ثانية" },
  { id: "library-leg-curl", name: "ثني الأرجل", english: "Leg Curl", muscle: muscles[2], sets: 3, reps: "10–12", rest: "60 ثانية" },
  { id: "library-rdl", name: "رومانيان ديدلفت", english: "Romanian Deadlift", muscle: muscles[2], sets: 3, reps: "8–12", rest: "60 ثانية" },
  { id: "library-db-shoulder-press", name: "ضغط كتف دمبل", english: "Dumbbell Shoulder Press", muscle: muscles[3], sets: 3, reps: "8–12", rest: "60 ثانية" },
  { id: "library-lateral-raise", name: "رفرفة جانبية", english: "Lateral Raise", muscle: muscles[3], sets: 3, reps: "12–15", rest: "60 ثانية" },
  { id: "library-rear-delt-fly", name: "رفرفة خلفية", english: "Rear Delt Fly", muscle: muscles[3], sets: 3, reps: "12–15", rest: "60 ثانية" },
  { id: "library-face-pull", name: "فيس بول", english: "Face Pull", muscle: muscles[3], sets: 3, reps: "12–15", rest: "60 ثانية" },
  { id: "library-barbell-curl", name: "بايسبس بار", english: "Barbell Curl", muscle: muscles[4], sets: 3, reps: "10–12", rest: "60 ثانية" },
  { id: "library-hammer-curl", name: "هامر", english: "Hammer Curl", muscle: muscles[4], sets: 3, reps: "10–12", rest: "60 ثانية" },
  { id: "library-preacher-curl", name: "بريتشر", english: "Preacher Curl", muscle: muscles[4], sets: 3, reps: "10–12", rest: "60 ثانية" },
  { id: "library-overhead-triceps", name: "تمديد فوق الرأس", english: "Overhead Triceps Extension", muscle: muscles[5], sets: 3, reps: "10–12", rest: "60 ثانية" },
  { id: "library-skull-crusher", name: "سكَل كراشر", english: "Skull Crusher", muscle: muscles[5], sets: 3, reps: "10–12", rest: "60 ثانية" },
  { id: "library-crunch", name: "كرنش", english: "Crunch", muscle: muscles[6], sets: 3, reps: "15–20", rest: "60 ثانية" },
  { id: "library-leg-raise", name: "رفع الأرجل", english: "Leg Raise", muscle: muscles[6], sets: 3, reps: "12–15", rest: "60 ثانية" },
  { id: "library-wrist-curl", name: "ثني المعصم", english: "Wrist Curl", muscle: muscles[7], sets: 3, reps: "12–15", rest: "60 ثانية" },
  { id: "library-standing-calf", name: "واقف سمانة", english: "Standing Calf Raise", muscle: muscles[8], sets: 4, reps: "12–20", rest: "60 ثانية" },
  { id: "library-seated-calf", name: "جالس سمانة", english: "Seated Calf Raise", muscle: muscles[8], sets: 4, reps: "12–20", rest: "60 ثانية" },
  { id: "library-decline-press", name: "بنش برس مائل للأسفل", english: "Decline Barbell Press", muscle: muscles[0], sets: 3, reps: "8–12", rest: "90 ثانية" },
  { id: "library-incline-cable-fly", name: "تفتيح كيبل مائل", english: "Incline Cable Fly", muscle: muscles[0], sets: 3, reps: "12–15", rest: "60 ثانية" },
  { id: "library-pec-deck", name: "بك ديك", english: "Pec Deck Fly", muscle: muscles[0], sets: 3, reps: "12–15", rest: "60 ثانية" },
  { id: "library-chest-dips", name: "متوازي للصدر", english: "Chest Dips", muscle: muscles[0], sets: 3, reps: "8–12", rest: "90 ثانية" },
  { id: "library-pull-up", name: "عقلة", english: "Pull-Up", muscle: muscles[1], sets: 3, reps: "6–12", rest: "90 ثانية" },
  { id: "library-chest-supported-row", name: "تجديف مدعوم للصدر", english: "Chest Supported Row", muscle: muscles[1], sets: 3, reps: "8–12", rest: "75 ثانية" },
  { id: "library-reverse-grip-pulldown", name: "سحب أمامي قبضة عكسية", english: "Reverse Grip Lat Pulldown", muscle: muscles[1], sets: 3, reps: "10–12", rest: "75 ثانية" },
  { id: "library-back-extension", name: "تمديد الظهر", english: "Back Extension", muscle: muscles[1], sets: 3, reps: "12–15", rest: "60 ثانية" },
  { id: "library-bulgarian-split-squat", name: "سكوات بلغاري", english: "Bulgarian Split Squat", muscle: muscles[2], sets: 3, reps: "8–12", rest: "90 ثانية" },
  { id: "library-walking-lunge", name: "لانج مشي", english: "Walking Lunge", muscle: muscles[2], sets: 3, reps: "10–12", rest: "75 ثانية" },
  { id: "library-hip-thrust", name: "هيب ثرست", english: "Barbell Hip Thrust", muscle: muscles[2], sets: 4, reps: "8–12", rest: "90 ثانية" },
  { id: "library-hack-squat", name: "هاك سكوات", english: "Hack Squat Machine", muscle: muscles[2], sets: 3, reps: "10–12", rest: "90 ثانية" },
  { id: "library-front-squat", name: "فرونت سكوات", english: "Front Squat", muscle: muscles[2], sets: 3, reps: "6–10", rest: "120 ثانية" },
  { id: "library-arnold-press", name: "أرنولد برس", english: "Arnold Press", muscle: muscles[3], sets: 3, reps: "8–12", rest: "75 ثانية" },
  { id: "library-upright-row", name: "تجديف عمودي", english: "Upright Row", muscle: muscles[3], sets: 3, reps: "10–12", rest: "60 ثانية" },
  { id: "library-cable-lateral-raise", name: "رفرفة جانبية كيبل", english: "Cable Lateral Raise", muscle: muscles[3], sets: 3, reps: "12–15", rest: "60 ثانية" },
  { id: "library-reverse-pec-deck", name: "بك ديك خلفي", english: "Reverse Pec Deck", muscle: muscles[3], sets: 3, reps: "12–15", rest: "60 ثانية" },
  { id: "library-cable-curl", name: "بايسبس كيبل", english: "Cable Curl", muscle: muscles[4], sets: 3, reps: "10–12", rest: "60 ثانية" },
  { id: "library-incline-curl", name: "بايسبس دمبل مائل", english: "Incline Dumbbell Curl", muscle: muscles[4], sets: 3, reps: "10–12", rest: "60 ثانية" },
  { id: "library-concentration-curl", name: "تركيز دمبل", english: "Concentration Curl", muscle: muscles[4], sets: 3, reps: "10–12", rest: "60 ثانية" },
  { id: "library-triceps-dips", name: "متوازي ترايسبس", english: "Triceps Dips", muscle: muscles[5], sets: 3, reps: "8–12", rest: "75 ثانية" },
  { id: "library-rope-pushdown", name: "ترايسبس حبل", english: "Rope Pushdown", muscle: muscles[5], sets: 3, reps: "12–15", rest: "60 ثانية" },
  { id: "library-close-grip-press", name: "بنش قبضة ضيقة", english: "Close Grip Bench Press", muscle: muscles[5], sets: 3, reps: "8–12", rest: "90 ثانية" },
  { id: "library-cable-crunch", name: "كرنش كيبل", english: "Cable Crunch", muscle: muscles[6], sets: 3, reps: "12–15", rest: "60 ثانية" },
  { id: "library-russian-twist", name: "لف روسي", english: "Russian Twist", muscle: muscles[6], sets: 3, reps: "16–24", rest: "45 ثانية" },
  { id: "library-ab-wheel", name: "عجلة البطن", english: "Ab Wheel Rollout", muscle: muscles[6], sets: 3, reps: "8–12", rest: "60 ثانية" },
  { id: "library-reverse-crunch", name: "كرنش عكسي", english: "Reverse Crunch", muscle: muscles[6], sets: 3, reps: "12–15", rest: "45 ثانية" },
  { id: "library-reverse-wrist-curl", name: "ثني معصم عكسي", english: "Reverse Wrist Curl", muscle: muscles[7], sets: 3, reps: "12–15", rest: "45 ثانية" },
  { id: "library-farmers-carry", name: "مشي المزارع", english: "Farmer Carry", muscle: muscles[7], sets: 3, reps: "30–45 ثانية", rest: "60 ثانية" },
  { id: "library-calf-press", name: "سمانة على الليج برس", english: "Leg Press Calf Raise", muscle: muscles[8], sets: 4, reps: "12–20", rest: "60 ثانية" },
  { id: "library-donkey-calf", name: "سمانة حمار", english: "Donkey Calf Raise", muscle: muscles[8], sets: 3, reps: "12–20", rest: "60 ثانية" },
  { id: "library-treadmill-walk", name: "مشي جهاز", english: "Treadmill Walk", muscle: muscles[9], sets: 1, reps: "15–30 دقيقة", rest: "—" },
  { id: "library-treadmill-run", name: "ركض جهاز", english: "Treadmill Run", muscle: muscles[9], sets: 1, reps: "10–20 دقيقة", rest: "—" },
  { id: "library-stationary-bike", name: "دراجة ثابتة", english: "Stationary Bike", muscle: muscles[9], sets: 1, reps: "15–30 دقيقة", rest: "—" },
  { id: "library-rowing-machine", name: "جهاز التجديف", english: "Rowing Machine", muscle: muscles[9], sets: 1, reps: "10–20 دقيقة", rest: "—" },
  { id: "library-elliptical", name: "إليبتكال", english: "Elliptical Trainer", muscle: muscles[9], sets: 1, reps: "15–30 دقيقة", rest: "—" },
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
  printFooterNote: "نتمنى لكم تمريناً آمناً ونتائج مستمرة.",
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
          .map((exercise) => {
            const item: MemberExercise = {
              id: String(exercise.id ?? uid()),
              name: String(exercise.name ?? "تمرين بدون اسم"),
              muscle: normalizeMuscle(exercise.muscle),
              sets: typeof exercise.sets === "number" || typeof exercise.sets === "string" ? exercise.sets : 0,
              reps: String(exercise.reps ?? "—"),
              rest: String(exercise.rest ?? "—"),
            };
            if (typeof exercise.english === "string" && exercise.english) item.english = exercise.english;
            if (typeof exercise.video === "string" && exercise.video) item.video = exercise.video;
            if (typeof exercise.description === "string" && exercise.description) item.description = exercise.description;
            if (typeof exercise.image === "string" && exercise.image) item.image = exercise.image;
            if (typeof exercise.weight === "string" && exercise.weight) item.weight = exercise.weight;
            if (typeof exercise.notes === "string" && exercise.notes) item.notes = exercise.notes;
            return item;
          })
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
    expiresAt: typeof raw.expiresAt === "string" && raw.expiresAt.trim() ? raw.expiresAt.trim() : undefined,
    courseName: typeof raw.courseName === "string" && raw.courseName.trim() ? raw.courseName.trim() : undefined,
    notes: typeof raw.notes === "string" && raw.notes.trim() ? raw.notes.trim() : undefined,
    // Member photos are intentionally unsupported in this release.
    photo: "",
    days: cloneDays(raw.days),
    active: raw.active !== false,
    authUid: raw.authUid == null ? undefined : String(raw.authUid),
    phoneE164,
    phoneDisplay,
    version: typeof raw.version === "number" && Number.isInteger(raw.version) ? raw.version : undefined,
  };
}

/**
 * Canonical form for the fields owned by the member wizard.
 * RTDB adds a version and may return keyed records in a different shape;
 * neither is part of the form's persisted contract.
 */
function memberPersistenceProjection(value: unknown) {
  const member = normalizeMember(value);
  if (!member) return null;
  return {
    id: member.id,
    membershipId: member.membershipId || "",
    name: member.name,
    height: member.height,
    weight: member.weight,
    createdAt: member.createdAt,
    ...(member.expiresAt ? { expiresAt: member.expiresAt } : {}),
    ...(member.courseName ? { courseName: member.courseName } : {}),
    ...(member.notes ? { notes: member.notes } : {}),
    phoneE164: member.phoneE164 || "",
    phoneDisplay: member.phoneDisplay || "",
    photo: "",
    days: member.days,
    active: member.active !== false,
    ...(member.authUid ? { authUid: member.authUid } : {}),
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
  const printableImage = (candidate: unknown, fallback: string) =>
    safeImageUrl(candidate) || fallback;
  const coachPhoto = printableImage(raw.coachPhoto, coachDefault);
  const hallPhoto = printableImage(raw.hallPhoto, hallDefault);
  const logo = printableImage(raw.logo, defaults.logo);
  return {
    ...defaults,
    ...raw,
    coachPhoto,
    hallPhoto,
    logo,
    printCoachPhotoUrl: printableImage(raw.printCoachPhotoUrl, coachPhoto),
    printHallPhotoUrl: printableImage(raw.printHallPhotoUrl, hallPhoto),
    printFooterNote: typeof raw.printFooterNote === "string" ? raw.printFooterNote.slice(0, 500) : defaults.printFooterNote,
  };
}
function normalizeMembers(value: unknown): Member[] {
  const items = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.values(value as Record<string, unknown>)
      : [];
  return dedupeById(items.map(normalizeMember).filter((member): member is Member => Boolean(member)));
}

function cleanMemberName(value: unknown) {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!name || name === "0" || /^\d+$/.test(name) || !/[A-Za-z\u0600-\u06FF]/.test(name))
    throw new Error("اسم المشترك إلزامي ويجب أن يحتوي على حروف، وليس رقماً فقط");
  return name;
}
const defaultCategories: CategoryItem[] = muscles.map((name, index) => ({
  id: `cat-${index + 1}`,
  name,
}));

function normalizeCategories(value: unknown): CategoryItem[] {
  const items = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.values(value as Record<string, unknown>)
      : [];
  const parsed = dedupeById<CategoryItem>(
    items
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
      .map((item, idx) => ({
        id: String(item.id || `cat-${idx + 1}`),
        name: String(item.name || "").trim(),
        ...(typeof item.image === "string" && item.image.trim() ? { image: item.image.trim() } : {}),
      }))
      .filter((item) => item.name),
  );
  return parsed.length ? parsed : defaultCategories;
}

function normalizeCourses(value: unknown): ReadyCourse[] {
  const items = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.values(value as Record<string, unknown>)
      : [];
  return dedupeById(
    items
      .filter((course): course is Record<string, unknown> => Boolean(course && typeof course === "object"))
      .map((course) => ({
        id: String(course.id ?? ""),
        name: String(course.name ?? "كورس بدون اسم"),
        ...(typeof course.notes === "string" && course.notes.trim() ? { notes: course.notes.trim() } : {}),
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
  | "settings"
  | "admins";
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
  disabled = false,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  secondary?: boolean;
  icon?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      className={secondary ? "secondary-btn" : "primary-btn"}
      onClick={onClick}
      disabled={disabled}
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
        {(
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
          <button className={`nav-item ${page === "admins" ? "active" : ""}`} type="button" onClick={() => { setPage("admins"); close(); }}>
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
function Topbar({
  title,
  onMenu,
  menuOpen,
  searchQuery,
  onSearchChange,
  onSearchNavigate,
}: {
  title: string;
  onMenu: () => void;
  menuOpen: boolean;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onSearchNavigate: (q: string) => void;
}) {
  return (
    <header className="topbar">
      <button className="icon-btn mobile-menu" type="button" aria-label={menuOpen ? "إغلاق قائمة الإدارة" : "فتح قائمة الإدارة"} aria-expanded={menuOpen} aria-controls="admin-mobile-drawer" onClick={onMenu}>
        <Menu size={20} />
      </button>
      <div>
        <p className="eyebrow">AL ASAS FIT · لوحة تحكم الكابتن</p>
        <h1>{title}</h1>
      </div>
      <div className="top-actions">
        <form
          className="search-top"
          onSubmit={(e) => {
            e.preventDefault();
            if (searchQuery.trim()) onSearchNavigate(searchQuery.trim());
          }}
        >
          <Search size={16} />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="البحث في المشتركين أو التمارين..."
            aria-label="البحث في المشتركين أو التمارين"
          />
          {searchQuery && (
            <button type="button" className="icon-btn search-clear-btn" aria-label="مسح البحث" onClick={() => onSearchChange("")}>
              <X size={14} />
            </button>
          )}
        </form>
        <Activity size={18} />
      </div>
    </header>
  );
}
type AppPayload = SyncPayload<SettingsData, Exercise, Member, ReadyCourse, CategoryItem>;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}
function CentralDataBridge({
  role,
  settings,
  exercises,
  members,
  courses,
  categories,
  setSettings,
  setExercises,
  setMembers,
  setCourses,
  setCategories,
}: {
  role: AdminRecord["role"];
  settings: SettingsData;
  exercises: Exercise[];
  members: Member[];
  courses: ReadyCourse[];
  categories: CategoryItem[];
  setSettings: React.Dispatch<React.SetStateAction<SettingsData>>;
  setExercises: React.Dispatch<React.SetStateAction<Exercise[]>>;
  setMembers: React.Dispatch<React.SetStateAction<Member[]>>;
  setCourses: React.Dispatch<React.SetStateAction<ReadyCourse[]>>;
  setCategories: React.Dispatch<React.SetStateAction<CategoryItem[]>>;
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
    categories,
  };
  const imageSource = (value: string, fallback = "") =>
    safeImageUrl(value) || (value.startsWith("/") ? value : fallback);
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
          if (remote.categories) setCategories(normalizeCategories(remote.categories));
          setRemotePresent(true);
        }
        setRemoteReady(true);
      }),
    [setSettings, setExercises, setMembers, setCourses, setCategories],
  );
  useEffect(() => {
    const save = async (requestedPayload: AppPayload = payload): Promise<boolean> => {
      if (busy) return false;
      const nextPayload = requestedPayload;
      // Always derive the compare-and-swap baseline from an authoritative
      // read immediately before writing. The realtime listener can still be
      // behind while an admin is completing the wizard.
      let previousForSave: AppPayload | null;
      try {
        previousForSave = await readAdminData<AppPayload>();
      } catch (error) {
        const message = error instanceof Error ? error.message : "تعذر قراءة Firebase قبل الحفظ";
        setError(message);
        window.dispatchEvent(new CustomEvent("alasas-save-status", { detail: message }));
        return false;
      }
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
        return !old || stableJson(memberPersistenceProjection(old)) !== stableJson(memberPersistenceProjection(member));
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
            stableJson(remoteById.get(exercise.id)) !== stableJson(exercise),
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
            const expected = memberPersistenceProjection(member);
            const actual = memberPersistenceProjection(persisted);
            if (!actual || actual.id !== member.id || stableJson(actual) !== stableJson(expected))
              throw firebaseSyncError("verify", "MEMBER_MISMATCH", `بيانات سجل المشترك ${member.id} لا تطابق المدخلات`);
          }
        }
        setRemotePresent(true);
        // Keep the authoritative server representation as the next baseline;
        // do not let a local optimistic object hide a failed normalization.
        lastRemote.current = check;
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
    const saveExercises = (event: Event) => {
      const detail = (event as CustomEvent<{ exercises?: Exercise[]; categories?: CategoryItem[]; courses?: ReadyCourse[]; members?: Member[] }>).detail;
      if (!detail || !Array.isArray(detail.exercises)) return;
      void save({
        ...payload,
        exercises: detail.exercises,
        ...(Array.isArray(detail.categories) ? { categories: detail.categories } : {}),
        ...(Array.isArray(detail.courses) ? { courses: detail.courses } : {}),
        ...(Array.isArray(detail.members) ? { members: detail.members } : {}),
      });
    };
    const saveCourses = (event: Event) => {
      const nextCourses = (event as CustomEvent<{ courses?: ReadyCourse[] }>).detail?.courses;
      if (!Array.isArray(nextCourses)) return;
      void save({ ...payload, courses: nextCourses });
    };
    const saveCategories = (event: Event) => {
      const detail = (event as CustomEvent<{ categories?: CategoryItem[]; exercises?: Exercise[]; courses?: ReadyCourse[]; members?: Member[] }>).detail;
      if (!detail || !Array.isArray(detail.categories)) return;
      void save({
        ...payload,
        categories: detail.categories,
        ...(Array.isArray(detail.exercises) ? { exercises: detail.exercises } : {}),
        ...(Array.isArray(detail.courses) ? { courses: detail.courses } : {}),
        ...(Array.isArray(detail.members) ? { members: detail.members } : {}),
      });
    };
    const deleteMember = (event: Event) => {
      const detail = (event as CustomEvent<{ memberId: string; resolve: (ok: boolean) => void }>).detail;
      void (async () => {
        try {
          if (busy) throw new Error("انتظر انتهاء عملية الحفظ الحالية ثم أعد المحاولة");
          setBusy(true);
          setError("");
          window.dispatchEvent(new CustomEvent("alasas-save-status", { detail: "saving" }));
          await deleteAdminMember(detail.memberId);
          await revokeMemberAccess(detail.memberId);
          const latest = await readAdminData<AppPayload>();
          if (latest?.members?.some((member) => member.id === detail.memberId))
            throw firebaseSyncError("verify", "DELETE_MISMATCH", "ما زال سجل المشترك موجوداً في Firebase");
          lastRemote.current = latest || { ...payload, members: payload.members.filter((member) => member.id !== detail.memberId) };
          window.dispatchEvent(new CustomEvent("alasas-save-status", { detail: "saved" }));
          detail.resolve(true);
        } catch (error) {
          const message = error instanceof Error ? error.message : "تعذر حذف المشترك";
          setError(message);
          window.dispatchEvent(new CustomEvent("alasas-save-status", { detail: message }));
          detail.resolve(false);
        } finally { setBusy(false); }
      })();
    };
    window.addEventListener("alasas-save-settings", saveSettings);
    window.addEventListener("alasas-save-exercises", saveExercises);
    window.addEventListener("alasas-save-courses", saveCourses);
    window.addEventListener("alasas-save-categories", saveCategories);
    window.addEventListener("alasas-save-member", saveMember);
    window.addEventListener("alasas-delete-member", deleteMember);
    return () => {
      window.removeEventListener("alasas-save-settings", saveSettings);
      window.removeEventListener("alasas-save-exercises", saveExercises);
      window.removeEventListener("alasas-save-courses", saveCourses);
      window.removeEventListener("alasas-save-categories", saveCategories);
      window.removeEventListener("alasas-save-member", saveMember);
      window.removeEventListener("alasas-delete-member", deleteMember);
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
  const [categories, setCategories] = useState<CategoryItem[]>(() =>
    normalizeCategories(read<unknown>("alasas-categories", defaultCategories)),
  );
  const [page, setPage] = useState<Page>("home");
  const [open, setOpen] = useState(false);
  const [globalSearch, setGlobalSearch] = useState("");
  const [currentHash, setCurrentHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onHash = () => setCurrentHash(window.location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const exerciseId = currentHash.startsWith("#/exercise/")
    ? decodeURIComponent(currentHash.slice(11))
    : "";
  const courseId = currentHash.startsWith("#/course/")
    ? decodeURIComponent(currentHash.slice(9))
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
  useEffect(
    () => localStorage.setItem("alasas-categories", JSON.stringify(categories)),
    [categories],
  );
  const muscleNames = categories.length ? categories.map((c) => c.name) : muscles;
  const title = {
    home: "الرئيسية",
    categories: "الأقسام",
    barcodes: "باركودات التمارين",
    courses: "الكورسات الجاهزة",
    members: "المشتركون",
    settings: "إعدادات الموقع",
    admins: "المدراء والصلاحيات",
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
            exercises.find((e) => e.id === exerciseId) ||
            seedExercises.find((e) => e.id === exerciseId) ||
            suggestedExercises.find((e) => e.id === exerciseId)
          }
        />
      ) : courseId ? (
        <PublicCourseDetail
          courseId={courseId}
          fallback={courses.find((c) => c.id === courseId)}
        />
      ) : (
        <>
          {createPortal(
            <div id="admin-mobile-drawer" className={open ? "sidebar-wrap open" : "sidebar-wrap"} onClick={() => setOpen(false)}>
              <div className="sidebar-drawer" onClick={(e) => e.stopPropagation()}>
                <Sidebar page={page} setPage={(next) => { setPage(next); setOpen(false); }} s={settings} role={role} onSignOut={onSignOut}/>
              </div>
              {open && <button type="button" className="sidebar-mobile-close" aria-label="إغلاق القائمة" onClick={() => setOpen(false)}><X size={21}/></button>}
            </div>,
            document.body
          )}
          <div className="main-area">
            <Topbar
              title={title}
              menuOpen={open}
              onMenu={() => setOpen((current) => !current)}
              searchQuery={globalSearch}
              onSearchChange={(q) => {
                setGlobalSearch(q);
                if (q.trim() && page === "home") setPage("members");
              }}
              onSearchNavigate={(q) => {
                const matchExercise = exercises.some((e) => `${e.name} ${e.english || ""}`.toLowerCase().includes(q.toLowerCase()));
                const matchMember = members.some((m) => `${m.name} ${m.membershipId || ""} ${m.phoneDisplay || ""}`.toLowerCase().includes(q.toLowerCase()));
                if (matchMember || !matchExercise) setPage("members");
                else setPage("barcodes");
              }}
            />
            <main className="content">
              <CentralDataBridge
                role={role}
                settings={settings}
                exercises={exercises}
                members={members}
                courses={courses}
                categories={categories}
                setSettings={setSettings}
                setExercises={setExercises}
                setMembers={setMembers}
                setCourses={setCourses}
                setCategories={setCategories}
              />
              {page === "home" && (
                <Dashboard
                  members={members}
                  exercises={exercises}
                  courses={courses}
                  onAdd={() => setPage("members")}
                />
              )}{" "}
              {page === "categories" && (
                <Categories
                  exercises={exercises}
                  setExercises={setExercises}
                  categories={categories}
                  setCategories={setCategories}
                  courses={courses}
                  setCourses={setCourses}
                  members={members}
                  setMembers={setMembers}
                />
              )}{" "}
              {page === "barcodes" && (
                <Barcodes
                  exercises={exercises}
                  setExercises={setExercises}
                  courses={courses}
                  muscleList={muscleNames}
                  initialQuery={globalSearch}
                />
              )}{" "}
              {page === "courses" && (
                <Courses
                  exercises={exercises}
                  courses={courses}
                  setCourses={setCourses}
                  muscleList={muscleNames}
                />
              )}{" "}
              {page === "members" && (
                <MembersWithPin
                  exercises={exercises}
                  members={members}
                  courses={courses}
                  setMembers={setMembers}
                  settings={settings}
                  muscleList={muscleNames}
                  initialSearch={globalSearch}
                />
              )}{" "}
              {page === "settings" && (
                role === "SUPER_ADMIN" ? (
                  <SettingsPage s={settings} setS={setSettings} />
                ) : (
                  <ManagerPrintSettings initial={settings} onSaved={setSettings} />
                )
              )}
              {page === "admins" && role === "SUPER_ADMIN" && <AdminManagementPage />}
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
  const [authReady, setAuthReady] = useState(false);
  const [record, setRecord] = useState<AdminRecord | null | undefined>(undefined);
  const [recordError, setRecordError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => watchAuth(nextUser => {
    setUser(nextUser);
    setAuthReady(true);
  }), []);
  useEffect(() => {
    if (!user) return;
    // A pending invitation is consumed only after Firebase has authenticated
    // the matching, verified Google identity. Existing admins skip the
    // invitation request so a normal session does not create a handled 400.
    void readAdminRecord(user.uid).then(existing => {
      if (existing) return null;
      return acceptAdminInvitation().then(() => user.getIdToken(true));
    }).catch(() => undefined);
  }, [user]);
  useEffect(
    () => {
      if (!user) {
        setRecord(undefined);
        setRecordError("");
        return undefined;
      }
      setRecord(undefined);
      setRecordError("");
      return watchAdminRecord(user.uid, setRecord, error => setRecordError(error.message));
    },
    [user],
  );
  if (!firebaseConfigured)
    return (
      <AuthNotice
        title="لوحة الإدارة غير مهيأة"
        text="تم منع عرض بيانات الإدارة لأن Firebase غير مهيأ في هذه النسخة. أضف إعدادات VITE_FIREBASE_* ثم أعد البناء."
      />
    );
  if (!authReady || (user && record === undefined && !recordError))
    return <AuthNotice title="جارٍ التحقق من جلسة المدير" text="انتظر اكتمال التحقق من Google وصلاحيات Firebase قبل عرض حالة الوصول." />;
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
  if (recordError)
    return <AuthNotice title="تعذر التحقق من الصلاحيات" text="لم تُعرض بيانات الإدارة لأن التحقق من سجل المدير لم يكتمل. أعد المحاولة بعد استقرار الاتصال." action={() => window.location.reload()} actionLabel="إعادة المحاولة" />;
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
function Dashboard({members,exercises,courses,onAdd}:{members:Member[];exercises:Exercise[];courses:ReadyCourse[];onAdd:()=>void}){
  const [auditLogs, setAuditLogs] = useState<PinAuditLogEntry[]>([]);
  useEffect(() => {
    let active = true;
    if (pinServiceConfigured) {
      void fetchPinAuditLogs().then((logs) => { if (active) setAuditLogs(logs.slice(0, 8)); }).catch(() => undefined);
    }
    return () => { active = false; };
  }, [members]);
  const activeMembersCount = members.filter((m) => m.active !== false).length;
  const totalCoursesCount = courses.length + members.filter((m) => m.days.some((d) => d.length > 0)).length;
  const auditActionLabel = (action: string) => {
    if (action === "PIN_ISSUED") return "إصدار رمز PIN";
    if (action === "PIN_REVEALED") return "كشف رمز PIN للكابتن";
    if (action === "PIN_RESET") return "إعادة تعيين رمز PIN";
    if (action === "PIN_REVOKED") return "إبطال وصول المشترك";
    return action;
  };
  return <>
    <section className="welcome-row"><div><h2>مرحباً بك في لوحة الإدارة</h2><p>أنشئ خططاً واضحة، وخصصها لكل مشترك من مكان واحد.</p></div><Button onClick={onAdd} icon={<Plus size={17}/>}>إضافة مشترك</Button></section>
    <section className="stats-grid">
      <Stat label="المشتركون" value={String(members.length)} icon={Users}/>
      <Stat label="المشتركون النشطون" value={String(activeMembersCount)} icon={Activity}/>
      <Stat label="الكورسات المنشأة" value={String(totalCoursesCount)} icon={FileText}/>
      <Stat label="تمارين المكتبة" value={String(exercises.length)} icon={Dumbbell}/>
    </section>
    <div className="dashboard-grid">
      <section className="panel table-panel">
        <div className="panel-head"><div><h2>آخر المشتركين</h2><p>البيانات المحفوظة في Firebase RTDB</p></div></div>
        {members.length?<table><thead><tr><th>الاسم</th><th>الحالة</th><th>الطول</th><th>الوزن</th><th>الأيام</th></tr></thead><tbody>{members.slice(0,5).map(m=><tr key={m.id}><td><div className="member-cell"><div className="avatar">{m.name.slice(0,1)}</div><b>{m.name}</b></div></td><td><span className="availability-badge">{m.active === false ? "غير نشط" : "نشط"}</span></td><td>{m.height||'—'} سم</td><td>{m.weight||'—'} كغم</td><td>{m.days.length} أيام</td></tr>)}</tbody></table>:<div className="empty-with-action"><Empty icon={<Users size={28}/>} title="لا يوجد مشتركون بعد" text="ابدأ بإضافة أول مشترك لبناء كورسه."/><Button onClick={onAdd} icon={<Plus size={16}/>}>إضافة أول مشترك</Button></div>}
      </section>
      <section className="panel quick-panel">
        <h2>مسار سريع</h2>
        <p>خطوات إنشاء كورس مخصص</p>
        <div className="steps"><span><b>1</b>أضف بيانات المشترك</span><span><b>2</b>حدد أيام التدريب</span><span><b>3</b>اختر العضلات والتمارين</span><span><b>4</b>راجع واطبع الكورس</span></div>
        <Button onClick={onAdd} icon={<Plus size={16}/>}>بدء إنشاء كورس</Button>
        {auditLogs.length > 0 && (
          <div className="audit-mini-box" aria-label="سجل عمليات PIN الأخيرة">
            <h3>سجل عمليات الأمان وPIN</h3>
            <ul>
              {auditLogs.slice(0, 5).map((log) => {
                const targetMember = members.find((m) => m.id === log.memberId);
                return (
                  <li key={log.id}>
                    <b>{auditActionLabel(log.action)}</b>
                    <span>{targetMember?.name || log.memberId}</span>
                    <small dir="ltr">{new Date(log.createdAt).toLocaleTimeString("ar-IQ", { hour: "2-digit", minute: "2-digit" })}</small>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>
    </div>
  </>;
}
function Categories({
  exercises,
  setExercises,
  categories,
  setCategories,
  courses,
  setCourses,
  members,
  setMembers,
}: {
  exercises: Exercise[];
  setExercises: React.Dispatch<React.SetStateAction<Exercise[]>>;
  categories: CategoryItem[];
  setCategories: React.Dispatch<React.SetStateAction<CategoryItem[]>>;
  courses: ReadyCourse[];
  setCourses: React.Dispatch<React.SetStateAction<ReadyCourse[]>>;
  members: Member[];
  setMembers: React.Dispatch<React.SetStateAction<Member[]>>;
}) {
  const muscleNames = categories.length ? categories.map((c) => c.name) : muscles;
  const [muscle, setMuscle] = useState(muscleNames[0] || muscles[0]);
  const [editing, setEditing] = useState<Exercise | null>(null);
  const [show, setShow] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<CategoryItem | null>(null);
  const [categoryNameInput, setCategoryNameInput] = useState("");
  const [categoryImageInput, setCategoryImageInput] = useState("");
  const [categoryError, setCategoryError] = useState("");
  const [importMessage, setImportMessage] = useState("");
  useEffect(() => {
    if (!muscleNames.includes(muscle) && muscleNames[0]) setMuscle(muscleNames[0]);
  }, [muscleNames, muscle]);
  useEffect(() => {
    const report = (event: Event) => {
      const detail = String((event as CustomEvent<string>).detail);
      if (detail === "saved") setImportMessage("تم حفظ التحديثات وتأكيد قراءتها من Firebase RTDB.");
      else if (detail !== "saving" && detail) setImportMessage(detail);
    };
    window.addEventListener("alasas-save-status", report);
    return () => window.removeEventListener("alasas-save-status", report);
  }, []);
  const currentCategory = categories.find((c) => c.name === muscle);
  const list = exercises.filter((e) => e.muscle === muscle);
  const importSuggestions = () => {
    setExercises((current) => {
      const result = mergeExerciseLibrary(current, suggestedExercises);
      if (result.added) {
        setImportMessage(`جارٍ حفظ ${result.added} تمريناً عربياً جديداً في Firebase دون تغيير الكورسات الحالية…`);
        window.dispatchEvent(new CustomEvent("alasas-save-exercises", { detail: { exercises: result.exercises } }));
      } else setImportMessage("المكتبة العربية موجودة بالفعل؛ لم تُكرر أي تمرين.");
      return result.exercises;
    });
  };
  const save = (e: Exercise) => {
    const nextExercises = exercises.some((a) => a.id === e.id)
      ? exercises.map((a) => (a.id === e.id ? e : a))
      : [...exercises, e];
    setExercises(nextExercises);
    setImportMessage("جارٍ حفظ التمرين في Firebase RTDB…");
    window.dispatchEvent(new CustomEvent("alasas-save-exercises", { detail: { exercises: nextExercises } }));
    setShow(false);
  };
  const removeExercise = (id: string) => {
    if (!window.confirm("حذف هذا التمرين من المكتبة؟")) return;
    const nextExercises = exercises.filter((a) => a.id !== id);
    setExercises(nextExercises);
    setImportMessage("جارٍ حذف التمرين وتحديث Firebase RTDB…");
    window.dispatchEvent(new CustomEvent("alasas-save-exercises", { detail: { exercises: nextExercises } }));
  };
  const openAddCategory = () => {
    setEditingCategory(null);
    setCategoryNameInput("");
    setCategoryImageInput("");
    setCategoryError("");
    setShowCategoryModal(true);
  };
  const openEditCategory = (cat: CategoryItem) => {
    setEditingCategory(cat);
    setCategoryNameInput(cat.name);
    setCategoryImageInput(cat.image || "");
    setCategoryError("");
    setShowCategoryModal(true);
  };
  const saveCategory = () => {
    const trimmed = categoryNameInput.trim();
    if (!trimmed) {
      setCategoryError("اسم القسم العضلي مطلوب");
      return;
    }
    const trimmedImage = categoryImageInput.trim();
    if (trimmedImage && !safeImageUrl(trimmedImage) && !trimmedImage.startsWith("/")) {
      setCategoryError("رابط صورة القسم يجب أن يبدأ بـ HTTPS أو /assets/");
      return;
    }
    if (categories.some((c) => c.name === trimmed && c.id !== editingCategory?.id)) {
      setCategoryError("يوجد قسم عضلي بهذا الاسم بالفعل");
      return;
    }
    let nextCategories: CategoryItem[];
    let nextExercises = exercises;
    let nextCourses = courses;
    let nextMembers = members;
    if (editingCategory) {
      const oldName = editingCategory.name;
      nextCategories = categories.map((c) =>
        c.id === editingCategory.id
          ? { id: c.id, name: trimmed, ...(trimmedImage ? { image: trimmedImage } : {}) }
          : c,
      );
      if (oldName !== trimmed) {
        nextExercises = exercises.map((ex) => (ex.muscle === oldName ? { ...ex, muscle: trimmed } : ex));
        nextCourses = courses.map((course) => ({
          ...course,
          days: course.days.map((day) => day.map((ex) => (ex.muscle === oldName ? { ...ex, muscle: trimmed } : ex))),
        }));
        nextMembers = members.map((member) => ({
          ...member,
          days: member.days.map((day) => day.map((ex) => (ex.muscle === oldName ? { ...ex, muscle: trimmed } : ex))),
        }));
        setExercises(nextExercises);
        setCourses(nextCourses);
        setMembers(nextMembers);
      }
    } else {
      nextCategories = [
        ...categories,
        { id: `cat-${uid()}`, name: trimmed, ...(trimmedImage ? { image: trimmedImage } : {}) },
      ];
    }
    setCategories(nextCategories);
    setMuscle(trimmed);
    setShowCategoryModal(false);
    setImportMessage("جارٍ حفظ الأقسام العضلية في Firebase RTDB…");
    window.dispatchEvent(
      new CustomEvent("alasas-save-categories", {
        detail: { categories: nextCategories, exercises: nextExercises, courses: nextCourses, members: nextMembers },
      }),
    );
  };
  const moveCategory = (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= categories.length) return;
    const nextCategories = [...categories];
    const [moved] = nextCategories.splice(index, 1);
    nextCategories.splice(targetIndex, 0, moved);
    setCategories(nextCategories);
    window.dispatchEvent(new CustomEvent("alasas-save-categories", { detail: { categories: nextCategories } }));
  };
  const deleteCategory = (cat: CategoryItem) => {
    const attached = exercises.filter((e) => e.muscle === cat.name);
    if (categories.length <= 1) {
      window.alert("لا يمكن حذف القسم الوحيد المتبقي.");
      return;
    }
    const fallbackCategory = categories.find((c) => c.id !== cat.id)?.name || muscles[0];
    const confirmMsg = attached.length
      ? `يحتوي قسم "${cat.name}" على ${attached.length} تمارين. عند الحذف سيتم نقل التمارين تلقائياً إلى "${fallbackCategory}" لمنع فقدان ارتباطاتها. هل تريد المتابعة؟`
      : `هل تريد حذف قسم "${cat.name}"؟`;
    if (!window.confirm(confirmMsg)) return;
    const nextCategories = categories.filter((c) => c.id !== cat.id);
    const nextExercises = attached.length
      ? exercises.map((ex) => (ex.muscle === cat.name ? { ...ex, muscle: fallbackCategory } : ex))
      : exercises;
    setCategories(nextCategories);
    if (attached.length) setExercises(nextExercises);
    if (muscle === cat.name) setMuscle(fallbackCategory);
    window.dispatchEvent(
      new CustomEvent("alasas-save-categories", {
        detail: { categories: nextCategories, exercises: nextExercises },
      }),
    );
  };
  return (
    <>
      <section className="section-heading">
        <div>
          <h2>الأقسام ومكتبة التمارين</h2>
          <p>المصدر الموحد للأقسام العضلية والتمارين المستخدمة في الكورسات والباركودات.</p>
        </div>
        <div className="exercise-library-actions">
          <Button secondary onClick={openAddCategory} icon={<Folder size={16} />}>إضافة قسم عضلي</Button>
          <Button secondary onClick={importSuggestions} icon={<Plus size={16} />}>إضافة/استكمال المكتبة العربية</Button>
          <Button
            onClick={() => {
              setEditing(null);
              setShow(true);
            }}
            icon={<Plus size={17} />}
          >
            إضافة تمرين
          </Button>
        </div>
      </section>
      {importMessage && <p className="save-status library-import-status" role="status">{importMessage}</p>}
      <div className="library-layout">
        <aside className="muscle-list">
          <h3>الأقسام ({categories.length})</h3>
          {categories.map((cat, idx) => (
            <div key={cat.id} className={`category-row-item ${cat.name === muscle ? "selected" : ""}`}>
              <button
                className={cat.name === muscle ? "selected" : ""}
                onClick={() => setMuscle(cat.name)}
              >
                <span className="category-label-wrap">
                  {cat.image && <img src={cat.image} alt="" className="category-mini-thumb" />}
                  {cat.name}
                </span>
                <span>{exercises.filter((e) => e.muscle === cat.name).length}</span>
              </button>
              <div className="category-mini-actions" aria-label={`إدارة ${cat.name}`}>
                <button type="button" className="icon-btn" title="ترتيب لأعلى" disabled={idx === 0} onClick={() => moveCategory(idx, -1)}><ArrowUp size={13} /></button>
                <button type="button" className="icon-btn" title="ترتيب لأسفل" disabled={idx === categories.length - 1} onClick={() => moveCategory(idx, 1)}><ArrowDown size={13} /></button>
                <button type="button" className="icon-btn" title="تعديل القسم" onClick={() => openEditCategory(cat)}><Pencil size={13} /></button>
                <button type="button" className="icon-btn" title="حذف القسم" onClick={() => deleteCategory(cat)}><Trash2 size={13} /></button>
              </div>
            </div>
          ))}
        </aside>
        <section className="panel exercise-panel">
          <div className="panel-head">
            <div className="category-head-info">
              {currentCategory?.image && <img src={currentCategory.image} alt={muscle} className="category-banner-thumb" />}
              <div>
                <h2>{muscle}</h2>
                <p>{list.length} تمارين محفوظة</p>
              </div>
            </div>
            {currentCategory && (
              <div className="row-actions">
                <button type="button" onClick={() => openEditCategory(currentCategory)}><Pencil size={14} /> تعديل القسم</button>
              </div>
            )}
          </div>
          {list.length ? (
            <div className="exercise-grid">
              {list.map((e) => (
                <div className="exercise-card" key={e.id}>
                  <div className="exercise-thumb">
                    {e.image ? <img src={e.image} alt={e.name} className="exercise-card-img" /> : <Dumbbell size={24} />}
                  </div>
                  <div className="exercise-card-body">
                    <b>{e.name}</b>
                    <span>{e.english || "اسم إنجليزي غير مضاف"}</span>
                    {e.description && <p className="exercise-desc-snippet">{e.description}</p>}
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
                      <a className="button-like-link" href={exerciseUrl(e.id)} target="_blank" rel="noreferrer">
                        <QrCode size={14} />
                        QR
                      </a>
                      <button onClick={() => removeExercise(e.id)}>
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
      {showCategoryModal && (
        <Modal title={editingCategory ? "تعديل القسم العضلي" : "إضافة قسم عضلي"} onClose={() => setShowCategoryModal(false)}>
          <div className="form-grid">
            <label>
              اسم القسم العضلي
              <input value={categoryNameInput} onChange={(e) => { setCategoryError(""); setCategoryNameInput(e.target.value); }} placeholder="مثال: تمارين الصدر" />
            </label>
            <label>
              صورة القسم (رابط HTTPS أو /assets/ اختياري)
              <input dir="ltr" value={categoryImageInput} onChange={(e) => { setCategoryError(""); setCategoryImageInput(e.target.value); }} placeholder="https://..." />
            </label>
          </div>
          {editingCategory && <small className="save-status">عند تعديل اسم القسم يتم تحديث جميع التمارين والكورسات المرتبطة به تلقائياً دون فقدان أي ارتباط.</small>}
          {categoryError && <p className="save-error" role="alert">{categoryError}</p>}
          <div className="modal-actions">
            <Button secondary onClick={() => setShowCategoryModal(false)}>إلغاء</Button>
            <Button onClick={saveCategory} icon={<Check size={16} />}>حفظ القسم</Button>
          </div>
        </Modal>
      )}
      {show && (
        <ExerciseModal
          initial={editing}
          muscle={muscle}
          muscleList={muscleNames}
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
  muscleList = muscles,
  onClose,
  onSave,
}: {
  initial: Exercise | null;
  muscle: string;
  muscleList?: string[];
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
      description: "",
      image: "",
    },
  );
  const [error, setError] = useState("");
  const field = (key: keyof Exercise, label: string, placeholder = "") => (
    <label>
      {label}
      <input
        placeholder={placeholder}
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
    if (!e.name.trim()) {
      setError("اسم التمرين بالعربية مطلوب.");
      return;
    }
    if (!isSafeVideoUrl(e.video)) {
      setError(
        "يسمح فقط برابط HTTPS من YouTube أو Vimeo بدون مسافات أو إعادة توجيه.",
      );
      return;
    }
    const trimmedImage = (e.image || "").trim();
    if (trimmedImage && !safeImageUrl(trimmedImage) && !trimmedImage.startsWith("/")) {
      setError("رابط صورة التمرين يجب أن يبدأ بـ HTTPS أو /assets/.");
      return;
    }
    const cleaned: Exercise = {
      id: e.id,
      name: e.name.trim(),
      muscle: e.muscle,
      sets: Number(e.sets) > 0 ? Number(e.sets) : 3,
      reps: String(e.reps || "10–12").trim(),
      rest: String(e.rest || "60 ثانية").trim(),
    };
    if (e.english?.trim()) cleaned.english = e.english.trim();
    const validVideo = safeVideoUrl(e.video);
    if (validVideo) cleaned.video = validVideo;
    if (e.description?.trim()) cleaned.description = e.description.trim();
    if (trimmedImage) cleaned.image = trimmedImage;
    onSave(cleaned);
  };
  const availableMuscles = muscleList.includes(e.muscle) ? muscleList : [...muscleList, e.muscle];
  return (
    <Modal title={initial ? "تعديل التمرين" : "إضافة تمرين"} onClose={onClose}>
      <div className="form-grid">
        <label>
          قسم العضلة
          <select
            value={e.muscle}
            onChange={(event) => setE({ ...e, muscle: event.target.value })}
          >
            {availableMuscles.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </label>
        {field("name", "اسم التمرين بالعربية", "مثال: بنش برس مستوي")}
        {field("english", "الاسم الإنجليزي (اختياري)", "Barbell Bench Press")}
        {field("sets", "المجموعات الافتراضية")}
        {field("reps", "التكرارات الافتراضية")}
        {field("rest", "الراحة")}
        {field("image", "صورة التمرين (رابط HTTPS أو /assets/ اختياري)", "https://...")}
        {field("video", "رابط شرح الفيديو (YouTube / Vimeo اختياري)", "https://www.youtube.com/watch?v=...")}
      </div>
      <div className="video-admin-status" aria-live="polite">
        {youtubeVideoId(e.video) ? <><CheckCircle2 size={17} /><span><b>رابط YouTube صالح</b><small>سيظهر كفيديو مضمّن في صفحة الشرح.</small></span></> : safeVideoUrl(e.video) ? <><CircleAlert size={17} /><span><b>الرابط مقبول لكن غير موثّق كفيديو YouTube</b><small>لا تستخدم رابط نتائج بحث أو رابطاً تخمينياً.</small></span></> : <><CircleAlert size={17} /><span><b>لم تتم إضافة فيديو موثّق</b><small>يمكن حفظ التمرين بدون فيديو، وستظهر حالة واضحة للمشترك.</small></span></>}
      </div>
      <label className="full-width-field">
        شرح التمرين وملاحظات الأداء (اختياري)
        <textarea
          rows={3}
          value={e.description || ""}
          onChange={(event) => setE({ ...e, description: event.target.value })}
          placeholder="خطوات الأداء الصحيح أو تنبيهات الكابتن..."
        />
      </label>
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
function courseUrl(id: string) {
  return `${location.origin}${location.pathname.replace(/admin\/?$/, "")}#/course/${encodeURIComponent(id)}`;
}
function memberLoginUrl() {
  return `${location.origin}${location.pathname.replace(/admin\/?$/, "")}`;
}
function exerciseTarget(exercise: Exercise) {
  return exerciseUrl(exercise.id);
}
function Barcodes({
  exercises,
  setExercises,
  courses = [],
  muscleList = muscles,
  initialQuery = "",
}: {
  exercises: Exercise[];
  setExercises: React.Dispatch<React.SetStateAction<Exercise[]>>;
  courses?: ReadyCourse[];
  muscleList?: string[];
  initialQuery?: string;
}) {
  const [mode, setMode] = useState<"exercises" | "courses">("exercises");
  const [muscle, setMuscle] = useState(muscleList[0] || muscles[0]);
  const [query, setQuery] = useState(initialQuery);
  const [editing, setEditing] = useState<Exercise | null>(null);
  const [show, setShow] = useState(false);
  const [selected, setSelected] = useState<Exercise | undefined>();
  const [selectedCourse, setSelectedCourse] = useState<ReadyCourse | undefined>(courses[0]);
  useEffect(() => {
    if (initialQuery) setQuery(initialQuery);
  }, [initialQuery]);
  const list = exercises.filter(
    (e) =>
      (query.trim() ? true : e.muscle === muscle) &&
      (!query.trim() ||
        `${e.name} ${e.english || ""} ${e.muscle}`
          .toLowerCase()
          .includes(query.trim().toLowerCase())),
  );
  useEffect(() => {
    setSelected((current) =>
      current && list.some((e) => e.id === current.id) ? current : list[0],
    );
  }, [muscle, query, exercises]);
  useEffect(() => {
    setSelectedCourse((current) =>
      current && courses.some((c) => c.id === current.id) ? current : courses[0],
    );
  }, [courses]);
  const save = (exercise: Exercise) => {
    const nextExercises = exercises.some((e) => e.id === exercise.id)
      ? exercises.map((e) => (e.id === exercise.id ? exercise : e))
      : [...exercises, exercise];
    setExercises(nextExercises);
    window.dispatchEvent(new CustomEvent("alasas-save-exercises", { detail: { exercises: nextExercises } }));
    setSelected(exercise);
    setShow(false);
    setEditing(null);
  };
  const url = mode === "exercises"
    ? (selected ? exerciseUrl(selected.id) : "")
    : (selectedCourse ? courseUrl(selectedCourse.id) : "");
  const download = () => {
    const svg = document.querySelector(
      ".qr-detail svg",
    ) as SVGSVGElement | null;
    if (!svg) return;
    const source = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${(mode === "exercises" ? selected?.id : selectedCourse?.id) || "item"}-qr.svg`;
    link.click();
    URL.revokeObjectURL(link.href);
  };
  return (
    <>
      <section className="section-heading">
        <div>
          <h2>باركودات التمارين والكورسات</h2>
          <p>QR ثابت لكل تمرين ولكل كورس؛ المسح بالكاميرا يفتح صفحة التمرين أو الكورس مباشرة.</p>
        </div>
        <div className="exercise-library-actions">
          <Button secondary={mode !== "exercises"} onClick={() => setMode("exercises")} icon={<Dumbbell size={16} />}>باركود التمارين</Button>
          <Button secondary={mode !== "courses"} onClick={() => setMode("courses")} icon={<FileText size={16} />}>باركود الكورسات ({courses.length})</Button>
          <Button
            onClick={() => {
              setEditing(null);
              setShow(true);
            }}
            icon={<Plus size={17} />}
          >
            إضافة تمرين
          </Button>
        </div>
      </section>
      <div className="barcode-layout">
        <div className="panel barcode-picker">
          {mode === "exercises" ? (
            <>
              <label className="barcode-search">
                <Search size={15} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="ابحث عن تمرين"
                />
              </label>
              <h3>الأقسام</h3>
              {muscleList.map((m) => (
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
                  <small>{youtubeVideoId(e.video) ? "YouTube موثّق" : "UNVERIFIED — لا يوجد فيديو موثّق"}</small>
                </button>
              ))}
            </>
          ) : (
            <>
              <h3>الكورسات الجاهزة ({courses.length})</h3>
              {courses.map((c) => (
                <button
                  className={selectedCourse?.id === c.id ? "selected" : ""}
                  onClick={() => setSelectedCourse(c)}
                  key={c.id}
                >
                  {c.name}
                  <small>{c.days.length} أيام تدريب</small>
                </button>
              ))}
            </>
          )}
        </div>
        <section className="panel qr-detail">
          {mode === "exercises" && selected ? (
            <>
              <div className="exercise-thumb big">
                {selected.image ? <img src={selected.image} alt={selected.name} className="exercise-card-img" /> : <Dumbbell size={34} />}
              </div>
              <h2>{selected.name}</h2>
              <p>
                {selected.description || (youtubeVideoId(selected.video)
                  ? "رابط YouTube صالح للحفظ والمعاينة"
                  : "UNVERIFIED: أضف رابط فيديو YouTube محدداً بعد التحقق من مطابقته للتمرين")}
              </p>
              <span className={youtubeVideoId(selected.video) ? "availability-badge video-status verified" : "availability-badge video-status"}>{youtubeVideoId(selected.video) ? "حالة التحقق: VERIFIED" : "حالة التحقق: UNVERIFIED"}</span>
              <div className="qr-box">
                <QRCodeSVG value={url} size={180} includeMargin level="M" />
              </div>
              <code dir="ltr">{url}</code>
              <div className="modal-actions">
                <Button
                  secondary
                  onClick={() => setEditing(selected)}
                  icon={<Pencil size={15} />}
                >
                  تعديل التمرين
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
          ) : mode === "courses" && selectedCourse ? (
            <>
              <div className="exercise-thumb big">
                <FileText size={34} />
              </div>
              <h2>{selectedCourse.name}</h2>
              <p>{selectedCourse.days.length} أيام تدريب{selectedCourse.notes ? ` · ${selectedCourse.notes}` : ""}</p>
              <div className="qr-box">
                <QRCodeSVG value={url} size={180} includeMargin level="M" />
              </div>
              <code dir="ltr">{url}</code>
              <div className="modal-actions">
                <Button secondary onClick={download} icon={<QrCode size={15} />}>
                  تنزيل QR الكورس
                </Button>
                <Button onClick={() => window.print()} icon={<Printer size={16} />}>
                  طباعة رمز الكورس
                </Button>
              </div>
              <a className="text-btn" href={url} target="_blank" rel="noreferrer">
                فتح صفحة الكورس <ExternalLink size={14} />
              </a>
            </>
          ) : (
            <Empty
              icon={<QrCode size={28} />}
              title="لا توجد نتائج"
              text={mode === "courses" ? "أنشئ كورساً جاهزاً أولاً لعرض باركود الكورس." : "أضف تمريناً أو غيّر البحث."}
            />
          )}
        </section>
      </div>
      {(show || editing) && (
        <ExerciseModal
          initial={editing}
          muscle={editing?.muscle || muscle}
          muscleList={muscleList}
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
  muscleList = muscles,
}: {
  exercises: Exercise[];
  courses: ReadyCourse[];
  setCourses: React.Dispatch<React.SetStateAction<ReadyCourse[]>>;
  muscleList?: string[];
}) {
  const [editing, setEditing] = useState<ReadyCourse | null>(null);
  const [show, setShow] = useState(false);
  const [qrCourse, setQrCourse] = useState<ReadyCourse | null>(null);
  const persistCourses = (nextCourses: ReadyCourse[]) => {
    setCourses(nextCourses);
    window.dispatchEvent(new CustomEvent("alasas-save-courses", { detail: { courses: nextCourses } }));
  };
  const save = (c: ReadyCourse) => {
    const nextCourses = courses.some((a) => a.id === c.id)
      ? courses.map((a) => (a.id === c.id ? c : a))
      : [...courses, c];
    persistCourses(nextCourses);
    setShow(false);
  };
  return (
    <>
      <section className="section-heading">
        <div>
          <h2>الكورسات الجاهزة</h2>
          <p>قوالب مستقلة، منظمة حسب اليوم والعضلة والتمرين، جاهزة للنسخ أو التعيين لأي مشترك.</p>
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
                  <p>{c.days.length} أيام تدريب{c.notes ? ` · ${c.notes}` : ""}</p>
                </div>
                <div className="row-actions">
                  <button onClick={() => setQrCourse(c)}>
                    <QrCode size={14} />
                    QR الكورس
                  </button>
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
                      persistCourses([
                        ...courses,
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
                    onClick={() => {
                      if (!window.confirm(`حذف القالب "${c.name}"؟ لن تتأثر كورسات المشتركين الحاليين.`)) return;
                      persistCourses(courses.filter((a) => a.id !== c.id));
                    }}
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
                        <b>{e.name}{e.notes ? ` (${e.notes})` : ""}</b>
                        <strong>
                          {e.sets} × {e.reps}{e.weight ? ` · ${e.weight}` : ""}
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
      {qrCourse && (
        <Modal title={`باركود الكورس — ${qrCourse.name}`} onClose={() => setQrCourse(null)}>
          <div className="qr-detail">
            <div className="qr-box">
              <QRCodeSVG value={courseUrl(qrCourse.id)} size={180} includeMargin level="M" />
            </div>
            <code dir="ltr">{courseUrl(qrCourse.id)}</code>
            <div className="modal-actions">
              <a className="primary-btn" href={courseUrl(qrCourse.id)} target="_blank" rel="noreferrer">
                فتح صفحة الكورس <ExternalLink size={14} />
              </a>
              <Button secondary onClick={() => setQrCourse(null)}>إغلاق</Button>
            </div>
          </div>
        </Modal>
      )}
      {show && (
        <CourseWizard
          initial={editing}
          exercises={exercises}
          muscleList={muscleList}
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
  muscleList = muscles,
  onClose,
  onSave,
  title,
}: {
  initial: ReadyCourse | null;
  exercises: Exercise[];
  muscleList?: string[];
  onClose: () => void;
  onSave: (c: ReadyCourse) => void;
  title: string;
}) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState(initial?.name || "");
  const [notes, setNotes] = useState(initial?.notes || "");
  const [days, setDays] = useState(initial?.days.length || 3);
  const [day, setDay] = useState(0);
  const [muscle, setMuscle] = useState(muscleList[0] || muscles[0]);
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
  const move = (index: number, direction: -1 | 1) =>
    setSelected((x) =>
      x.map((list, i) => {
        if (i !== day) return list;
        const target = index + direction;
        if (target < 0 || target >= list.length) return list;
        const copy = [...list];
        const [item] = copy.splice(index, 1);
        copy.splice(target, 0, item);
        return copy;
      }),
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
          <h3>اسم الكورس والملاحظات</h3>
          <p>البيانات لا تحفظ حتى تضغط حفظ.</p>
          <div className="form-grid">
            <label>
              اسم الكورس
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="مثال: كورس مبتدئين شامل"
              />
            </label>
            <label>
              ملاحظات الكورس (اختياري)
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="مثال: إحماء 10 دقائق قبل التمرين"
              />
            </label>
          </div>
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
          muscleList={muscleList}
          exercises={exercises}
          selected={selected}
          add={add}
          update={update}
          remove={remove}
          move={move}
        />
      )}{" "}
      {step === 4 && <Review name={name} notes={notes} days={days} selected={selected} />}
      <WizardActions
        step={step}
        setStep={setStep}
        onClose={onClose}
        save={() =>
          onSave({
            id: initial?.id || uid(),
            name: name.trim() || "كورس بدون اسم",
            ...(notes.trim() ? { notes: notes.trim() } : {}),
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
      {["البيانات الأساسية", "أيام التدريب", "اختيار التمارين", "مراجعة وحفظ"].map(
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
  muscleList = muscles,
  exercises,
  selected,
  add,
  update,
  remove,
  move,
  disabled = false,
}: {
  days: number;
  day: number;
  setDay: (n: number) => void;
  muscle: string;
  setMuscle: (s: string) => void;
  muscleList?: string[];
  exercises: Exercise[];
  selected: DayPlan[];
  add: (e: Exercise) => void;
  update: (id: string, key: keyof MemberExercise, value: string) => void;
  remove: (id: string) => void;
  move?: (index: number, direction: -1 | 1) => void;
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
          {muscleList.map((m) => (
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
            .filter((e) => normalizeMuscle(e.muscle) === muscle || e.muscle === muscle)
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
          {selected[day].map((e, idx) => (
            <div key={e.id} className="selected-exercise-row">
              <div>
                <b>{idx + 1}. {e.name}</b>
                <small>
                  {e.muscle} · {e.sets} × {e.reps} · راحة {e.rest}
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
                  placeholder="مثال: 20 كغم"
                  value={e.weight || ""}
                  onChange={(x) => update(e.id, "weight", x.target.value)}
                />
              </label>
              <label>
                ملاحظات
                <input
                  disabled={disabled}
                  placeholder="ملاحظة للتمرين"
                  value={e.notes || ""}
                  onChange={(x) => update(e.id, "notes", x.target.value)}
                />
              </label>
              {!disabled && (
                <div className="exercise-order-actions">
                  {move && (
                    <>
                      <button type="button" className="row-icon" title="تحريك لأعلى" disabled={idx === 0} onClick={() => move(idx, -1)}>
                        <ArrowUp size={14} />
                      </button>
                      <button type="button" className="row-icon" title="تحريك لأسفل" disabled={idx === selected[day].length - 1} onClick={() => move(idx, 1)}>
                        <ArrowDown size={14} />
                      </button>
                    </>
                  )}
                  <button type="button" className="row-icon" title="حذف التمرين من اليوم" onClick={() => remove(e.id)}>
                    <Trash2 size={14} />
                  </button>
                </div>
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
  notes,
  days,
  selected,
}: {
  name: string;
  notes?: string;
  days: number;
  selected: DayPlan[];
}) {
  return (
    <div className="wizard-pane">
      <h3>مراجعة الكورس</h3>
      <div className="review-summary">
        <b>{name || "كورس بدون اسم"}</b>
        <span>{days} أيام تدريب{notes ? ` · ${notes}` : ""}</span>
      </div>
      {selected.slice(0, days).map((list, i) => (
        <div className="review-day" key={i}>
          <h4>
            اليوم {i + 1} <small>{list.length} تمارين</small>
          </h4>
          {list.length ? (
            list.map((e) => (
              <span key={e.id}>
                {e.name} · {e.sets} × {e.reps}{e.weight ? ` (${e.weight})` : ""}{e.notes ? ` — ${e.notes}` : ""}
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
function PhonePreview({ value }: { value: string }) {
  if (!value.trim()) return <p className="phone-preview phone-preview-error" role="status">أدخل رقم هاتف عراقي لإصدار PIN بعد الحفظ.</p>;
  try {
    const canonical = normalizeIraqiPhone(value);
    return <p className="phone-preview" role="status">سيُحفظ الرقم بصيغة موحّدة: <b dir="ltr">{canonical}</b></p>;
  } catch {
    return <p className="phone-preview phone-preview-error" role="alert">رقم الهاتف العراقي غير صالح. استخدم 07XXXXXXXXX أو +9647XXXXXXXXX.</p>;
  }
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
function requestMemberDelete(memberId: string) {
  return new Promise<boolean>((resolve) => {
    window.dispatchEvent(new CustomEvent("alasas-delete-member", { detail: { memberId, resolve } }));
  });
}
function MembersWithPin({
  exercises,
  members,
  courses,
  setMembers,
  settings,
  muscleList = muscles,
  initialSearch = "",
}: {
  exercises: Exercise[];
  members: Member[];
  courses: ReadyCourse[];
  setMembers: React.Dispatch<React.SetStateAction<Member[]>>;
  settings: SettingsData;
  muscleList?: string[];
  initialSearch?: string;
}) {
  const [editing, setEditing] = useState<Member | null>(null);
  const [show, setShow] = useState(false);
  const [pin, setPin] = useState('');
  const [pinMember, setPinMember] = useState<Member | null>(null);
  const [pinBusy, setPinBusy] = useState(false);
  const [pinError, setPinError] = useState('');
  const [issueTarget, setIssueTarget] = useState<Member | null>(null);
  const [issuePhone, setIssuePhone] = useState('');
  const [issueCustomPin, setIssueCustomPin] = useState('');
  const [search, setSearch] = useState(initialSearch);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [revealedPin, setRevealedPin] = useState<{ memberId: string; pin: string } | null>(null);
  const [revealingId, setRevealingId] = useState('');
  const [copiedId, setCopiedId] = useState('');
  const [previewMember, setPreviewMember] = useState<Member | null>(null);
  const [deletingId, setDeletingId] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleteSuccess, setDeleteSuccess] = useState('');
  const [retryDeleteId, setRetryDeleteId] = useState('');
  const [deletionConflicts, setDeletionConflicts] = useState<Array<{ id: string; member: Record<string, unknown>; deletedAt: string }>>([]);
  useEffect(() => {
    if (initialSearch) setSearch(initialSearch);
  }, [initialSearch]);
  useEffect(() => {
    let active = true;
    void readAdminDeletionConflicts().then((conflicts) => { if (active) setDeletionConflicts(conflicts); }).catch(() => undefined);
    return () => { active = false; };
  }, [members]);
  useEffect(() => {
    if (!revealedPin) return;
    const timer = window.setTimeout(() => setRevealedPin(null), 15_000);
    const onVisibility = () => {
      if (document.hidden) setRevealedPin(null);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [revealedPin]);
  useEffect(() => () => setRevealedPin(null), []);
  const save = async (m: Member & { customPin?: string }) => {
    const isExisting = members.some(a => a.id === m.id);
    const { customPin, ...cleanMember } = m;
    const nextMembers = isExisting
      ? members.map(a => a.id === cleanMember.id ? { ...a, ...cleanMember, photo: '', ...(cleanMember.authUid || a.authUid ? { authUid: cleanMember.authUid || a.authUid } : {}), ...(cleanMember.phoneE164 ? { phoneE164: cleanMember.phoneE164, phoneDisplay: cleanMember.phoneDisplay } : {}) } : a)
      : [{ ...cleanMember, photo: '' }, ...members];
    const ok = await requestMemberSave({ schemaVersion: 1, settings, exercises, members: nextMembers, courses });
    if (ok) {
      setMembers(nextMembers);
      setShow(false);
      setEditing(null);
      if (pinServiceConfigured && cleanMember.phoneE164) {
        try {
          if (customPin && /^\d{4}$/.test(customPin)) {
            const issued = await issueMemberPin(cleanMember.id, cleanMember.phoneE164, cleanMember.membershipId || cleanMember.id, true, customPin);
            setPin(issued);
            setPinMember(cleanMember);
            setRevealedPin({ memberId: cleanMember.id, pin: issued });
          } else if (!isExisting) {
            const issued = await issueMemberPin(cleanMember.id, cleanMember.phoneE164, cleanMember.membershipId || cleanMember.id, false);
            setPin(issued);
            setPinMember(cleanMember);
            setRevealedPin({ memberId: cleanMember.id, pin: issued });
          } else {
            void revealMemberPin(cleanMember.id).catch(() => undefined);
          }
        } catch (err) {
          setPinError(err instanceof Error ? err.message : "تم حفظ المشترك، لكن تعذر مزامنة PIN تلقائياً");
        }
      }
    }
  };
  const openIssue = (m: Member) => { setPin(''); setPinError(''); setIssueTarget(m); setIssuePhone(memberPhoneDisplay(m)); setIssueCustomPin(''); };
  const issue = async (m: Member, requestedPhone: string, reset = false, customPinValue?: string) => {
    setPinBusy(true); setPinError(''); setPin('');
    try {
      const phone = normalizeIraqiPhone(requestedPhone);
      const remote = await readAdminData<AppPayload>();
      const persisted = normalizeMembers(remote?.members).find(item => item.id === m.id);
      if (!persisted) throw new Error('احفظ المشترك أولاً ثم تحقق من ظهوره في Firebase قبل إصدار PIN');
      const nextPin = await issueMemberPin(persisted.id, phone, persisted.membershipId || persisted.id, reset, customPinValue);
      setPin(nextPin); setPinMember(persisted);
      setRevealedPin({ memberId: persisted.id, pin: nextPin });
      setIssueTarget(null); setIssuePhone(''); setIssueCustomPin('');
    } catch (e) { setPinError(e instanceof Error ? e.message : 'تعذر إصدار PIN من الخدمة الموثوقة'); }
    finally { setPinBusy(false); }
  };
  const toggleRevealPin = async (m: Member) => {
    if (revealedPin?.memberId === m.id) {
      setRevealedPin(null);
      return;
    }
    if (revealingId) return;
    setRevealingId(m.id);
    setPinError('');
    try {
      const revealed = await revealMemberPin(m.id);
      setRevealedPin({ memberId: m.id, pin: revealed });
    } catch (e) {
      openIssue(m);
      setPinError(e instanceof Error ? e.message : "تعذر إظهار رمز PIN للمشترك");
    } finally {
      setRevealingId('');
    }
  };
  const copyPinForMember = async (m: Member) => {
    setPinError('');
    try {
      let currentPin = revealedPin?.memberId === m.id ? revealedPin.pin : "";
      if (!currentPin) {
        setRevealingId(m.id);
        currentPin = await revealMemberPin(m.id);
        setRevealedPin({ memberId: m.id, pin: currentPin });
      }
      await navigator.clipboard.writeText(currentPin);
      setCopiedId(m.id);
      window.setTimeout(() => setCopiedId((prev) => (prev === m.id ? "" : prev)), 2000);
    } catch (e) {
      openIssue(m);
      setPinError(e instanceof Error ? e.message : "تعذر نسخ الرمز");
    } finally {
      setRevealingId('');
    }
  };
  const quickResetPin = async (m: Member) => {
    const phoneSource = m.phoneE164 || m.phoneDisplay || m.phone || "";
    if (!phoneSource) {
      openIssue(m);
      return;
    }
    if (!window.confirm(`إعادة تعيين رمز PIN للمشترك ${m.name}؟ سيتم إصدار رمز رباعي جديد فوراً وإبطال الرمز السابق.`)) return;
    await issue(m, phoneSource, true);
  };
  const performDelete = async (memberId: string, memberName: string) => {
    if (deletingId) return;
    setDeletingId(memberId); setDeleteError(''); setDeleteSuccess('');
    if (revealedPin?.memberId === memberId) setRevealedPin(null);
    const ok = await requestMemberDelete(memberId);
    if (ok) {
      setMembers(current => current.filter(item => item.id !== memberId));
      setDeletionConflicts(current => current.filter(item => item.id !== memberId));
      setDeleteSuccess(`تم حذف ${memberName} من Firebase وإبطال وصوله.`);
      setRetryDeleteId('');
    } else {
      setDeleteError(`تعذر تأكيد حذف ${memberName}. قد يكون الوصول أُبطل جزئياً؛ أعد المحاولة لإكمال العملية.`);
      setRetryDeleteId(memberId);
    }
    setDeletingId('');
  };
  const remove = (member: Member) => {
    if (deletingId || !window.confirm(`حذف المشترك ${member.name}؟ سيتم إبطال PIN والجلسات أيضاً.`)) return;
    void performDelete(member.id, member.name);
  };
  const filteredMembers = members.filter((m) => {
    if (statusFilter === "active" && m.active === false) return false;
    if (statusFilter === "inactive" && m.active !== false) return false;
    if (!search.trim()) return true;
    const hay = `${m.name} ${m.membershipId || ""} ${m.phoneDisplay || ""} ${m.phoneE164 || ""} ${m.courseName || ""}`.toLowerCase();
    return hay.includes(search.trim().toLowerCase());
  });
  return <>
    <section className="section-heading"><div><h2>المشتركون</h2><p>لكل مشترك نسخة مستقلة من الكورس والبيانات ورمز PIN والطباعة.</p></div><Button onClick={() => { setEditing(null); setShow(true); }} icon={<Plus size={17} />}>إضافة مشترك</Button></section>
    <div className="panel members-filter-bar">
      <label className="barcode-search">
        <Search size={15} />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث بالاسم أو رقم الهاتف أو رقم العضوية..." />
      </label>
      <div className="filter-pills" role="group" aria-label="تصفية حسب الحالة">
        <button type="button" className={statusFilter === "all" ? "active" : ""} onClick={() => setStatusFilter("all")}>الكل ({members.length})</button>
        <button type="button" className={statusFilter === "active" ? "active" : ""} onClick={() => setStatusFilter("active")}>النشطون ({members.filter(m => m.active !== false).length})</button>
        <button type="button" className={statusFilter === "inactive" ? "active" : ""} onClick={() => setStatusFilter("inactive")}>غير النشطين ({members.filter(m => m.active === false).length})</button>
      </div>
    </div>
    {deletionConflicts.length > 0 && <section className="panel" role="region" aria-label="سجلات حذف غير مكتملة"><h3>سجلات تحتاج إكمال الحذف</h3><p>هذه السجلات تحمل Tombstone لكنها بقيت في RTDB بعد انقطاع أو سباق سابق. لا يمكن إصدار PIN لها.</p>{deletionConflicts.map(conflict => <div key={conflict.id} className="save-status"><b>{String(conflict.member.name || 'عضوية')}</b><span dir="ltr"> {conflict.id}</span><button className="text-btn" disabled={Boolean(deletingId)} onClick={() => remove({ id: conflict.id, name: String(conflict.member.name || 'العضوية') } as Member)}>إكمال الحذف</button></div>)}</section>}
    {deleteError && <p className="save-error" role="alert">{deleteError} {retryDeleteId && <button className="text-btn" disabled={Boolean(deletingId)} onClick={() => void performDelete(retryDeleteId, 'العضوية')}>{deletingId === retryDeleteId ? 'جارٍ إعادة المحاولة…' : 'إعادة المحاولة'}</button>}</p>}
    {deleteSuccess && <p className="save-status" role="status">{deleteSuccess}</p>}
    {issueTarget && <section className="panel pin-issue-form" role="dialog" aria-label="إصدار PIN"><b>بيانات الدخول — {issueTarget.name}</b><div className="form-grid"><label>رقم هاتف المشترك<input inputMode="tel" autoComplete="tel" value={issuePhone} onChange={e => setIssuePhone(e.target.value)} /></label><label>تعيين PIN رباعي محدد (اختياري)<input dir="ltr" inputMode="numeric" maxLength={4} placeholder="اتركه فارغاً للتوليد التلقائي" value={issueCustomPin} onChange={e => setIssueCustomPin(e.target.value.replace(/\D/g, '').slice(0, 4))} /></label></div><small>المعروض: {memberPhoneDisplay(issueTarget) || 'لا يوجد رقم صالح'} · الرمز يشفر بمعيار AES-256-GCM مع سجل تدقيق أمني.</small><div><button className="secondary-btn" disabled={pinBusy} onClick={() => issue(issueTarget, issuePhone, false, issueCustomPin || undefined)}>{pinBusy ? 'جارٍ التحقق…' : 'إصدار PIN لأول مرة'}</button><button className="secondary-btn danger-btn" disabled={pinBusy} onClick={() => { if (window.confirm('إعادة تعيين PIN ستبطل الرمز الحالي فوراً وتصدر رمزاً جديداً. هل تريد المتابعة؟')) void issue(issueTarget, issuePhone, true, issueCustomPin || undefined); }}>{pinBusy ? 'جارٍ المعالجة…' : 'إعادة تعيين PIN'}</button><button className="secondary-btn" disabled={pinBusy} onClick={() => { setIssueTarget(null); setIssuePhone(''); setIssueCustomPin(''); }}>إلغاء</button></div></section>}
    {pin && <section className="pin-card" role="status" aria-label="بطاقة رمز الدخول"><header><b>✓ تم إصدار رمز الدخول بنجاح</b><button className="icon-btn" aria-label="إغلاق بطاقة PIN" onClick={() => { setPin(''); setPinMember(null); }}><X size={17}/></button></header><div className="pin-card-meta"><span>المشترك: <b>{pinMember?.name || '—'}</b></span><span>رقم العضوية: <b>{pinMember?.membershipId || '—'}</b></span></div><p>رمز الدخول الخاص بك</p><strong dir="ltr">{pin.split('').join('  ')}</strong><div><button className="primary-btn" onClick={() => navigator.clipboard.writeText(pin)}>نسخ الرمز</button><button className="secondary-btn" onClick={() => window.print()}>طباعة البطاقة</button><button className="secondary-btn" onClick={() => { setPin(''); setPinMember(null); }}>إغلاق</button></div><small>🔒 يظهر هذا الرمز مرة واحدة فقط، ولا يُحفظ في المتصفح أو Firebase.</small></section>}
    {pinError && <p className="auth-error" role="alert">{pinError}</p>}
    {filteredMembers.length ? <div className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>المشترك</th><th>الهاتف</th><th>رمز المشترك (PIN)</th><th>الاشتراك</th><th>الطول / الوزن</th><th>الكورس</th><th>الإجراءات</th></tr></thead><tbody>{filteredMembers.map(m => {
      const isPinVisible = revealedPin?.memberId === m.id;
      const isRevealing = revealingId === m.id;
      return <tr key={m.id}>
        <td>
          <div className="member-cell">
            <div className="avatar">{m.name.slice(0, 1)}</div>
            <div>
              <b>{m.name}</b>
              <small style={{ display: "block", color: "var(--muted)" }}>{m.membershipId || m.id} · {m.active === false ? "غير نشط" : "نشط"}</small>
            </div>
          </div>
        </td>
        <td dir="ltr">{memberPhoneDisplay(m) || 'يُدخل عند الإصدار'}</td>
        <td>
          <div className="pin-cell-controls" aria-label={`رمز الدخول للمشترك ${m.name}`}>
            <code className={isPinVisible ? "pin-mask-code revealed" : "pin-mask-code"} dir="ltr">
              {isPinVisible ? revealedPin.pin : "••••"}
            </code>
            <button
              type="button"
              className="pin-action-icon"
              disabled={isRevealing || pinBusy || Boolean(deletingId)}
              aria-label={isPinVisible ? `إخفاء PIN المشترك ${m.name}` : `إظهار PIN المشترك ${m.name}`}
              title={isPinVisible ? "إخفاء الرمز" : "إظهار الرمز الحقيقي"}
              onClick={() => void toggleRevealPin(m)}
            >
              {isPinVisible ? <Eye size={15} /> : <EyeOff size={15} />}
            </button>
            <button
              type="button"
              className="pin-action-icon"
              disabled={isRevealing || pinBusy || Boolean(deletingId)}
              aria-label={`نسخ PIN المشترك ${m.name}`}
              title="نسخ الرمز"
              onClick={() => void copyPinForMember(m)}
            >
              <Copy size={14} />
              {copiedId === m.id && <span className="pin-copied-badge">تم النسخ</span>}
            </button>
            <button
              type="button"
              className="pin-action-icon"
              disabled={isRevealing || pinBusy || Boolean(deletingId)}
              aria-label={`إعادة تعيين PIN المشترك ${m.name}`}
              title="إعادة تعيين PIN"
              onClick={() => void quickResetPin(m)}
            >
              <RotateCcw size={14} />
            </button>
          </div>
        </td>
        <td>
          <div>{m.createdAt}</div>
          {m.expiresAt && <small style={{ color: "var(--muted)" }}>ينتهي: {m.expiresAt}</small>}
        </td>
        <td>{m.height || '—'} سم / {m.weight || '—'} كغم</td>
        <td>
          <div>{m.courseName || `${m.days.length} أيام`}</div>
          <small style={{ color: "var(--muted)" }}>{m.days.reduce((s, d) => s + d.length, 0)} تمرين</small>
        </td>
        <td>
          <div className="row-actions">
            <button disabled={Boolean(deletingId)} onClick={() => setEditing(m)}><ExternalLink size={14} />عرض</button>
            <button disabled={Boolean(deletingId)} onClick={() => { setEditing(m); setShow(true); }}><Pencil size={14} />تعديل</button>
            <button disabled={pinBusy || Boolean(deletingId)} onClick={() => openIssue(m)}><Check size={14} />إدارة PIN</button>
            <button disabled={Boolean(deletingId)} onClick={() => setPreviewMember(m)}><FileText size={14} />معاينة الطباعة</button>
            <button disabled={Boolean(deletingId)} onClick={() => printMember(m, settings)}><Printer size={14} />طباعة</button>
            <button disabled={Boolean(deletingId)} aria-busy={deletingId === m.id} onClick={() => remove(m)}><Trash2 size={14} />{deletingId === m.id ? 'جارٍ الحذف…' : 'حذف'}</button>
          </div>
        </td>
      </tr>;
    })}</tbody></table></div></div> : <Empty icon={<Users size={30} />} title="لا يوجد مشتركون مطابقون" text="أضف مشتركاً جديداً أو غيّر معايير البحث والتصفية." />}
    {(show || editing) && <MemberWizard initial={editing} exercises={exercises} courses={courses} muscleList={muscleList} onClose={() => { setShow(false); setEditing(null); }} onSave={save} viewOnly={!show} />}
    {previewMember && <PrintPreviewModal member={previewMember} settings={settings} onClose={() => setPreviewMember(null)} />}
  </>;
}

function MemberWizard({
  initial,
  exercises,
  courses = [],
  muscleList = muscles,
  onClose,
  onSave,
  viewOnly = false,
}: {
  initial: Member | null;
  exercises: Exercise[];
  courses?: ReadyCourse[];
  muscleList?: string[];
  onClose: () => void;
  onSave: (m: Member & { customPin?: string }) => void | Promise<void>;
  viewOnly?: boolean;
}) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState(initial?.name || "");
  const [membershipId, setMembershipId] = useState(
    initial?.membershipId || `M-${Date.now().toString().slice(-6)}`,
  );
  const [authUid] = useState(initial?.authUid || "");
  const [phone, setPhone] = useState(initial?.phoneDisplay || initial?.phoneE164 || initial?.phone || "");
  const [active, setActive] = useState(initial?.active !== false);
  const [height, setHeight] = useState(initial?.height || "");
  const [weight, setWeight] = useState(initial?.weight || "");
  const [createdAt, setCreatedAt] = useState(
    initial?.createdAt || new Date().toISOString().slice(0, 10),
  );
  const [expiresAt, setExpiresAt] = useState(initial?.expiresAt || "");
  const [courseName, setCourseName] = useState(initial?.courseName || "");
  const [notes, setNotes] = useState(initial?.notes || "");
  const [customPin, setCustomPin] = useState("");
  const [validationError, setValidationError] = useState("");
  const [saving, setSaving] = useState(false);
  const [days, setDays] = useState(initial?.days.length || 3);
  const [day, setDay] = useState(0);
  const [muscle, setMuscle] = useState(muscleList[0] || muscles[0]);
  const [selected, setSelected] = useState<DayPlan[]>(
    initial ? cloneDays(initial.days) : blankDays(3),
  );
  useEffect(
    () =>
      setSelected((x) => Array.from({ length: days }, (_, i) => x[i] || [])),
    [days],
  );
  const applyReadyCourse = (templateId: string) => {
    const found = courses.find((c) => c.id === templateId);
    if (!found) return;
    setCourseName(found.name);
    if (found.notes && !notes) setNotes(found.notes);
    const cloned = cloneDays(found.days);
    setDays(Math.max(1, cloned.length));
    setSelected(cloned);
    setDay(0);
  };
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
  const move = (index: number, direction: -1 | 1) =>
    setSelected((x) =>
      x.map((list, i) => {
        if (i !== day) return list;
        const target = index + direction;
        if (target < 0 || target >= list.length) return list;
        const copy = [...list];
        const [item] = copy.splice(index, 1);
        copy.splice(target, 0, item);
        return copy;
      }),
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
          <h3>معلومات المشترك والاشتراك</h3>
          <div className="form-grid">
            <label>
              اسم المشترك الكامل
              <input
                disabled={viewOnly}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="الاسم الثلاثي أو الكامل"
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
              رقم هاتف المشترك (مطلوب)
              <input
                disabled={viewOnly}
                inputMode="tel"
                autoComplete="tel"
                placeholder="0770 123 4567 أو +964 770 123 4567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </label>
            <label>
              رمز الدخول PIN (4 أرقام — اختياري)
              <input
                disabled={viewOnly}
                dir="ltr"
                inputMode="numeric"
                maxLength={4}
                placeholder={initial ? "اتركه فارغاً للإبقاء على الرمز الحالي" : "يُولّد تلقائياً إذا تُرك فارغاً"}
                value={customPin}
                onChange={(e) => setCustomPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
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
              تاريخ الاشتراك
              <input
                disabled={viewOnly}
                type="date"
                dir="ltr"
                value={/^\d{4}-\d{2}-\d{2}$/.test(createdAt) ? createdAt : ""}
                onChange={(e) => setCreatedAt(e.target.value || new Date().toISOString().slice(0, 10))}
              />
            </label>
            <label>
              تاريخ انتهاء الاشتراك (اختياري)
              <input
                disabled={viewOnly}
                type="date"
                dir="ltr"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            </label>
            <label>
              اسم الكورس المعيّن (اختياري)
              <input
                disabled={viewOnly}
                value={courseName}
                onChange={(e) => setCourseName(e.target.value)}
                placeholder="مثال: كورس تضخيم متقدم"
              />
            </label>
            {!viewOnly && courses.length > 0 && (
              <label>
                نسخ من كورس جاهز (اختياري)
                <select defaultValue="" onChange={(e) => applyReadyCourse(e.target.value)}>
                  <option value="">-- اختر قالباً جاهزاً لتعبئة الأيام والتمارين --</option>
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>{c.name} ({c.days.length} أيام)</option>
                  ))}
                </select>
              </label>
            )}
            <label className="full-width-field">
              ملاحظات الكابتن للمشترك (اختياري)
              <input
                disabled={viewOnly}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="توجيهات غذائية أو تدريبية..."
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
              يُحفظ رمز PIN مشفراً ويمكن للكابتن إظهاره أو نسخه من أيقونة العين بجانب المشترك.
            </p>
          )}
          {!viewOnly && <PhonePreview value={phone} />}
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
          muscleList={muscleList}
          exercises={exercises}
          selected={selected}
          add={add}
          update={update}
          remove={remove}
          move={move}
          disabled={viewOnly}
        />
      )}{" "}
      {step === 4 && <Review name={name} notes={notes} days={days} selected={selected} />}
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
            disabled={saving}
            onClick={async () => {
              try {
                const normalizedMemberName = cleanMemberName(name);
                if (!phone.trim()) throw new Error("رقم هاتف المشترك مطلوب قبل الحفظ");
                const normalizedMemberPhone = normalizeIraqiPhone(phone);
                if (customPin && !/^\d{4}$/.test(customPin)) {
                  throw new Error("رمز PIN المخصص يجب أن يتكون من 4 أرقام بالضبط");
                }
                setValidationError("");
                setSaving(true);
                await onSave({
                  id: initial?.id || uid(),
                  membershipId: membershipId.trim(),
                  name: normalizedMemberName,
                  height,
                  weight,
                  createdAt: createdAt.trim() || initial?.createdAt || new Date().toLocaleDateString("ar-IQ"),
                  ...(expiresAt.trim() ? { expiresAt: expiresAt.trim() } : {}),
                  ...(courseName.trim() ? { courseName: courseName.trim() } : {}),
                  ...(notes.trim() ? { notes: notes.trim() } : {}),
                  phoneE164: normalizedMemberPhone,
                  phoneDisplay: displayIraqiPhone(normalizedMemberPhone),
                  days: cloneDays(selected.slice(0, days)),
                  active,
                  ...(authUid.trim() ? { authUid: authUid.trim() } : {}),
                  ...(customPin ? { customPin } : {}),
                });
              } catch (error) {
                setValidationError(error instanceof Error ? error.message : "بيانات المشترك غير صالحة");
              } finally {
                setSaving(false);
              }
            }}
            icon={<Check size={16} />}
          >
            {saving ? "جارٍ حفظ Firebase…" : "حفظ المشترك والكورس"}
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
  const dayMuscles = [...new Set(list.map((e) => e.muscle))].filter(Boolean).join(" + ");
  const instagramUrl = socialUrl("instagram", s.instagram);
  const whatsappUrl = socialUrl("whatsapp", s.whatsapp || s.phone);
  return (
    <main className="member-portal" dir="rtl">
      <div className="member-portal-inner">
        <header className="member-portal-header">
          <Logo s={s} />
          <div className="member-portal-heading">
            <span>بوابة المشترك</span>
            <h1>جدول تماريني</h1>
          </div>
          <button className="member-logout" onClick={onSignOut}><LogOut size={17} /> تسجيل الخروج</button>
        </header>

        <section className="member-welcome" aria-labelledby="member-welcome-title">
          <div>
            <span className={m.active === false ? "member-status inactive" : "member-status"}>
              <i aria-hidden="true" /> {m.active === false ? "عضوية غير فعالة" : "عضوية نشطة"}
            </span>
            <h2 id="member-welcome-title">أهلاً {m.name}</h2>
            <p>{m.courseName || "خطتك التدريبية الشخصية"}</p>
          </div>
          <div className="member-welcome-mark" aria-hidden="true"><Dumbbell size={28} /></div>
        </section>

        <section className="member-info-card" aria-labelledby="member-info-title">
          <div className="member-section-heading"><div><span className="section-kicker">ملفك</span><h2 id="member-info-title">بيانات المشترك</h2></div><span className="member-id-badge" dir="ltr">{m.membershipId || m.id}</span></div>
          <div className="member-info-grid">
            <MemberFact label="الاسم الكامل" value={m.name} />
            <MemberFact label="رقم العضوية" value={m.membershipId || "—"} />
            <MemberFact label="الطول" value={m.height ? `${m.height} سم` : "—"} />
            <MemberFact label="الوزن" value={m.weight ? `${m.weight} كغم` : "—"} />
            <MemberFact label="تاريخ الاشتراك" value={m.createdAt || "—"} />
            <MemberFact label="تاريخ الانتهاء" value={m.expiresAt || "غير محدد"} />
          </div>
          {m.notes && <div className="member-notes"><CircleAlert size={17} /><span><b>ملاحظات الكابتن</b>{m.notes}</span></div>}
        </section>

        <section className="member-course-card" aria-labelledby="member-course-title">
          <div className="member-section-heading"><div><span className="section-kicker">الخطة الحالية</span><h2 id="member-course-title">{m.courseName || "الكورس التدريبي"}</h2></div><span className="course-status">{m.days.length} {m.days.length === 1 ? "يوم تدريب" : "أيام تدريب"}</span></div>
          <p className="course-description">اختر يوم التدريب لعرض تمارينك وتفاصيل الأداء والراحة.</p>
        </section>

        {m.days.length ? (
          <section className="member-workout-section" aria-labelledby="workout-title">
            <div className="member-section-heading workout-heading"><div><span className="section-kicker">الخطة الأسبوعية</span><h2 id="workout-title">جدول تماريني</h2></div><span className="exercise-count">{list.length} تمارين اليوم</span></div>
            <div className="member-day-tabs" role="tablist" aria-label="أيام التدريب">
              {m.days.map((d, i) => {
                const musclesForDay = [...new Set(d.map((e) => e.muscle))].filter(Boolean).join(" + ") || "تمارين متنوعة";
                return <button role="tab" aria-selected={day === i} aria-controls={`member-day-panel-${i}`} className={day === i ? "active" : ""} onClick={() => setDay(i)} key={i}><strong>اليوم {i + 1}</strong><span>{musclesForDay}</span></button>;
              })}
            </div>
            <div id={`member-day-panel-${day}`} role="tabpanel" className="member-day-panel" aria-label={`تمارين اليوم ${day + 1}`}>
              {dayMuscles && <div className="member-muscle-line"><span>العضلات المستهدفة</span><strong>{dayMuscles}</strong></div>}
              <div className="member-exercise-list">
                {list.length ? list.map((e, idx) => {
                  const videoId = youtubeVideoId(e.video);
                  const exerciseHref = exerciseUrl(e.id);
                  return <article className={done.includes(e.id) ? "member-exercise-card completed" : "member-exercise-card"} key={`${e.id}-${idx}`}>
                    <div className="exercise-card-header"><button aria-label={`تحديد إنجاز ${e.name}`} className={done.includes(e.id) ? "exercise-check checked" : "exercise-check"} onClick={() => setDone((x) => x.includes(e.id) ? x.filter((i) => i !== e.id) : [...x, e.id])}>{done.includes(e.id) && <Check size={16} />}</button><div><span className="exercise-number">تمرين {idx + 1}</span><h3>{e.name}</h3><p>{e.muscle}</p></div></div>
                    {e.image && <img className="member-exercise-image" src={e.image} alt={`صورة توضيحية لـ ${e.name}`} loading="lazy" />}
                    {(e.description || e.notes) && <p className="member-exercise-note">{e.notes && <b>ملاحظة: </b>}{e.notes || e.description}</p>}
                    <div className="member-exercise-metrics" aria-label={`تفاصيل ${e.name}`}><Metric label="المجموعات" value={e.sets} /><Metric label="التكرارات" value={e.reps} /><Metric label="الوزن" value={e.weight || "—"} /><Metric label="الراحة" value={e.rest || "—"} /></div>
                    <div className="member-exercise-actions"><a className="exercise-watch-button" href={exerciseHref} target="_blank" rel="noopener noreferrer"><Play size={15} fill="currentColor" /> {videoId ? "مشاهدة شرح التمرين" : "فتح بطاقة التمرين"}</a><a className="exercise-qr" href={exerciseHref} target="_blank" rel="noopener noreferrer" aria-label={`فتح QR شرح ${e.name}`}><QRCodeSVG value={exerciseHref} size={72} includeMargin level="M" /><span>امسح للشرح</span></a></div>
                  </article>;
                }) : <Empty icon={<Dumbbell size={28} />} title="لا توجد تمارين لهذا اليوم" text="يمكنك اختيار يوم آخر من الخطة." />}
              </div>
            </div>
          </section>
        ) : <section className="member-workout-section"><Empty icon={<Dumbbell size={28} />} title="لم يتم تعيين كورس تدريبي لحسابك بعد" text="يرجى مراجعة إدارة القاعة." /></section>}

        <footer className="member-portal-footer"><div className="member-social-links">{whatsappUrl && <a href={whatsappUrl} target="_blank" rel="noreferrer" aria-label="التواصل عبر WhatsApp"><WhatsAppMark /> WhatsApp</a>}{instagramUrl && <a href={instagramUrl} target="_blank" rel="noreferrer" aria-label="فتح حساب Instagram"><InstagramMark /> Instagram</a>}</div><span>© 2026 جميع الحقوق محفوظة لشركة الأساس للحلول البرمجية</span><strong>Version {APP_VERSION}</strong></footer>
      </div>
    </main>
  );
}

function MemberFact({ label, value }: { label: string; value: string }) {
  return <div className="member-fact"><span>{label}</span><strong>{value}</strong></div>;
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function socialUrl(kind: "instagram" | "whatsapp", value: string) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (kind === "instagram") {
    if (/^https:\/\/(www\.)?instagram\.com\/[A-Za-z0-9_.-]+\/?$/i.test(raw)) return raw;
    const handle = raw.replace(/^@/, "");
    return /^[A-Za-z0-9_.]{1,30}$/.test(handle) ? `https://instagram.com/${handle}` : "";
  }
  try {
    const phone = normalizeIraqiPhone(raw).replace(/^\+/, "");
    return `https://wa.me/${phone}`;
  } catch {
    return "";
  }
}

function InstagramMark() {
  return <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r=".8" fill="currentColor" stroke="none" /></svg>;
}

function WhatsAppMark() {
  return <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20.5 11.5a8.5 8.5 0 0 1-12.7 7.4L3.5 20l1.1-4.1A8.5 8.5 0 1 1 20.5 11.5Z" /><path d="M8.5 8.7c.2-.4.4-.4.7-.4h.5c.2 0 .4.1.5.4l.7 1.5c.1.2.1.4-.1.6l-.5.6c.5 1 1.3 1.8 2.4 2.3l.6-.5c.2-.2.4-.2.6-.1l1.5.7c.3.1.4.3.4.5v.5c0 .3-.1.5-.4.7-.4.3-1.2.4-2 .1-2.2-.7-4.4-2.7-5.3-4.5-.3-.7-.2-1.5.1-1.9Z" /></svg>;
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
    <main className="exercise-detail-page" dir="rtl">
      <Logo s={s} />
      <section className="panel exercise-detail-card">
        {exercise ? (
          <>
            <div className="exercise-thumb big">
              {exercise.image ? <img src={exercise.image} alt={exercise.name} className="exercise-card-img" /> : <Dumbbell size={34} />}
            </div>
            <h1>{exercise.name}</h1>
            <p>{exercise.description || exercise.english || "شرح التمرين"}</p>
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
              <span className="availability-badge">الشرح النصي متوفر أعلاه</span>
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
  const defaultFallback =
    fallback ||
    seedExercises.find((e) => e.id === exerciseId) ||
    suggestedExercises.find((e) => e.id === exerciseId);
  const [exercise, setExercise] = useState<Exercise | undefined>(defaultFallback);
  const [loading, setLoading] = useState(!defaultFallback);
  useEffect(
    () =>
      watchPublicExercise<Exercise>(exerciseId, (value) => {
        setExercise(value || defaultFallback || undefined);
        setLoading(false);
      }),
    [exerciseId],
  );
  const video = safeVideoUrl(exercise?.video);
  const embed = youtubeEmbedUrl(video);
  return (
    <main className="exercise-detail-page" dir="rtl">
      <header className="public-exercise-header"><Logo s={defaults} /><a className="public-login-link" href={window.location.origin + window.location.pathname}>دخول المشترك <ArrowLeft size={15} /></a></header>
      <section className="panel exercise-detail-card">
        {exercise ? (
          <>
            <div className="exercise-detail-intro"><div className="exercise-detail-icon">{exercise.image ? <img src={exercise.image} alt={`صورة توضيحية لـ ${exercise.name}`} /> : <Dumbbell size={32} />}</div><div><span className="section-kicker">شرح التمرين</span><h1>{exercise.name}</h1><p className="exercise-muscle-label">{exercise.muscle}{exercise.english ? ` · ${exercise.english}` : ""}</p></div></div>
            {embed ? <div className="exercise-video-frame"><iframe title={`فيديو شرح ${exercise.name}`} src={embed} loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen /></div> : <div className="exercise-video-unavailable" role="status"><CircleAlert size={20} /><div><strong>لا يوجد فيديو موثّق لهذا التمرين حالياً</strong><span>نعرض البيانات العامة فقط حتى تتم مراجعة رابط موثوق من الكابتن.</span></div></div>}
            {exercise.description && <div className="exercise-instructions"><h2>تعليمات الأداء</h2><p>{exercise.description}</p></div>}
            <div className="detail-grid"><span>المجموعات<strong>{exercise.sets}</strong></span><span>التكرارات<strong>{exercise.reps}</strong></span><span>الراحة<strong>{exercise.rest}</strong></span></div>
            <div className="exercise-detail-actions">{video && <a className="primary-btn" href={video} target="_blank" rel="noreferrer"><ExternalLink size={15} /> المشاهدة على YouTube</a>}<button className="secondary-btn" onClick={() => window.history.length > 1 ? window.history.back() : window.location.assign(window.location.origin + window.location.pathname)}>العودة إلى الدخول <ArrowRight size={15} /></button></div>
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
function PublicCourseDetail({
  courseId,
  fallback,
}: {
  courseId: string;
  fallback?: ReadyCourse;
}) {
  const [course, setCourse] = useState<ReadyCourse | undefined>(fallback);
  const [loading, setLoading] = useState(!fallback);
  useEffect(
    () =>
      watchPublicCourse<ReadyCourse>(courseId, (value) => {
        setCourse(value || fallback || undefined);
        setLoading(false);
      }),
    [courseId],
  );
  return (
    <main className="exercise-detail-page" dir="rtl">
      <div className="public-exercise-brand">
        <div className="brand-mark" style={{ background: defaults.accent }}>
          <Dumbbell size={19} />
        </div>
        <strong>AL ASAS FIT</strong>
      </div>
      <section className="panel exercise-detail-card" style={{ maxWidth: 680, width: "100%", textAlign: "right" }}>
        {course ? (
          <>
            <h1>{course.name}</h1>
            <p>{course.days.length} أيام تدريب{course.notes ? ` · ${course.notes}` : ""}</p>
            {course.days.map((day, idx) => (
              <div key={idx} className="ready-day" style={{ marginTop: 12 }}>
                <h4>
                  اليوم {idx + 1}{" "}
                  <small>{[...new Set(day.map((e) => e.muscle))].join(" + ") || "—"}</small>
                </h4>
                {day.length ? (
                  day.map((e, n) => (
                    <div className="ready-exercise" key={`${e.id}-${n}`}>
                      <span>{n + 1}</span>
                      <b>
                        <a href={exerciseUrl(e.id)} style={{ color: "inherit", textDecoration: "underline" }}>
                          {e.name}
                        </a>
                        {e.notes ? ` (${e.notes})` : ""}
                      </b>
                      <strong>{e.sets} × {e.reps}{e.weight ? ` · ${e.weight}` : ""}</strong>
                    </div>
                  ))
                ) : (
                  <em>لا توجد تمارين لهذا اليوم</em>
                )}
              </div>
            ))}
          </>
        ) : loading ? (
          <p>جارٍ تحميل بيانات الكورس…</p>
        ) : (
          <Empty
            icon={<FileText size={28} />}
            title="الكورس غير موجود"
            text="تحقق من رابط QR الكورس أو أعد حفظ الكورس لمزامنته."
          />
        )}
      </section>
    </main>
  );
}
function AdminManagementPage() {
  const [admins, setAdmins] = useState<ManagedAdmin[]>([]); const [email, setEmail] = useState(''); const [role, setRole] = useState<ManagedAdmin['role']>('MANAGER'); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [error, setError] = useState('');
  const refresh = () => void listManagedAdmins().then(result => setAdmins(result.admins)).catch(e => setError(e instanceof Error ? e.message : 'تعذر تحميل المدراء'));
  useEffect(() => { refresh(); }, []);
  const add = async () => { setBusy(true); setError(''); setMessage(''); try { await inviteAdmin(email, role); setEmail(''); setMessage('تم إنشاء دعوة محددة الصلاحية. لن تُفعّل قبل تسجيل Google بالبريد نفسه.'); refresh(); } catch (e) { setError(e instanceof Error ? e.message : 'تعذر إنشاء الدعوة'); } finally { setBusy(false); } };
  const update = async (item: ManagedAdmin, action: 'active' | 'remove' | 'role', value?: boolean) => { if (action === 'remove' && !window.confirm(`إزالة صلاحية ${item.email}؟`)) return; try { await updateManagedAdmin(item.uid || '', action, action === 'role' ? (item.role === 'MANAGER' ? 'SUPER_ADMIN' : 'MANAGER') : undefined, value); refresh(); } catch (e) { setError(e instanceof Error ? e.message : 'تعذر تعديل المدير'); } };
  return <div className="admin-management-page"><section className="section-heading"><div><h2>المدراء والصلاحيات</h2><p>الدعوات لا تمنح صلاحية قبل إثبات ملكية البريد عبر Google.</p></div></section><section className="panel admin-management-form"><h3>إضافة مدير</h3><div className="form-grid"><label>البريد الإلكتروني<input dir="ltr" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="manager@example.com" /></label><label>نوع الصلاحية<select value={role} onChange={e => setRole(e.target.value as ManagedAdmin['role'])}><option value="MANAGER">MANAGER</option><option value="SUPER_ADMIN">SUPER_ADMIN</option></select></label></div><Button onClick={add} icon={<Plus size={16} />}>{busy ? 'جارٍ الإنشاء…' : 'إضافة المدير'}</Button>{message && <p className="save-status" role="status">{message}</p>}{error && <p className="save-error" role="alert">{error}</p>}</section><section className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>المدير</th><th>الدور</th><th>الحالة</th><th>تاريخ الإضافة</th><th>الإجراءات</th></tr></thead><tbody>{admins.map((item, index) => <tr key={`${item.uid || item.email}-${index}`}><td><b>{item.displayName || '—'}</b><div dir="ltr">{item.email}</div></td><td>{item.role}</td><td><span className="availability-badge">{item.status === 'ACTIVE' ? 'فعال' : item.status === 'DISABLED' ? 'معطل' : 'الدعوة معلقة'}</span></td><td>{item.createdAt ? new Date(item.createdAt).toLocaleString('ar-IQ') : '—'}</td><td>{item.status !== 'PENDING' && item.uid && <div className="row-actions"><button onClick={() => update(item, 'active', !item.active)}>{item.active ? 'تعطيل' : 'تفعيل'}</button><button onClick={() => update(item, 'role')}>تبديل الدور</button><button onClick={() => update(item, 'remove')}>إزالة</button></div>}</td></tr>)}</tbody></table></div>{!admins.length && <Empty icon={<Users size={28} />} title="لا يوجد مدراء إضافيون" text="أنشئ دعوة اختبارية من النموذج أعلاه." />}</section></div>;
}
function ManagerPrintSettings({initial,onSaved}: {initial: SettingsData; onSaved: React.Dispatch<React.SetStateAction<SettingsData>>}) {
  const [values,setValues]=useState(()=>({
    logo:initial.logo, printCoachPhotoUrl:initial.printCoachPhotoUrl,
    printHallPhotoUrl:initial.printHallPhotoUrl, printFooterNote:initial.printFooterNote,
    phone:initial.phone, instagram:initial.instagram
  }));
  useEffect(() => {
    setValues({
      logo: initial.logo,
      printCoachPhotoUrl: initial.printCoachPhotoUrl,
      printHallPhotoUrl: initial.printHallPhotoUrl,
      printFooterNote: initial.printFooterNote,
      phone: initial.phone,
      instagram: initial.instagram,
    });
  }, [initial.logo, initial.printCoachPhotoUrl, initial.printHallPhotoUrl, initial.printFooterNote, initial.phone, initial.instagram]);
  const [status,setStatus]=useState("");
  const [saving,setSaving]=useState(false);
  const change=(key:keyof typeof values,value:string)=>{setValues(x=>({...x,[key]:value}));setStatus("");};
  const save=async()=>{
    if(saving)return;
    setSaving(true);setStatus("جارٍ الحفظ...");
    try{
      for(const url of [values.logo,values.printCoachPhotoUrl,values.printHallPhotoUrl]) {
        if(url && !safeImageUrl(url) && !(url.startsWith("/") && !url.startsWith("//") && !url.includes("..")))
          throw new Error("رابط الصورة غير صالح؛ استخدم HTTPS أو ملف الاستضافة الحالي.");
      }
      await saveManagerPrintSettings(values);
      onSaved(x=>({...x,...values}));
      setStatus("تم الحفظ والتحقق من Firebase.");
    }catch(e){setStatus(e instanceof Error?e.message:"فشل الحفظ");}
    finally{setSaving(false);}
  };
  const previewUrl=(value:string) => {
    const safe = safeImageUrl(value);
    if (safe) return safe;
    if (value.startsWith("/") && !value.startsWith("//") && !value.includes("..")) return value;
    return null;
  };
  const photo=(label:string,key:"logo"|"printCoachPhotoUrl"|"printHallPhotoUrl",slot:PrintImageSlot)=><ImageSetting key={key} label={label} value={values[key]} setting={slot} onChange={value=>change(key,value)} persist={async value=>{const next={...values,[key]:value};await saveManagerPrintSettings(next);setValues(next);onSaved(x=>({...x,...next}));}} />;
  return <div className="settings-page"><section className="settings-block">
    <h2>إعدادات الموقع وهوية الطباعة</h2>
    <p>يمكن للمدير تعديل هوية الطباعة وبيانات التواصل فقط. إعدادات النظام الأخرى محصورة بالمشرف العام.</p>
    <div className="form-grid">
      <label>اسم القاعة<input value={initial.gymName} readOnly /></label>
      <label>اسم الكابتن<input value={initial.coachName} readOnly /></label>
    </div>
    <div className="upload-grid">
      {photo("شعار القاعة للطباعة","logo","logo")}
      {photo("صورة/لوجو الكابتن للطباعة","printCoachPhotoUrl","coach")}
      {photo("صورة خلفية القاعة للطباعة","printHallPhotoUrl","hall")}
    </div>
    <div className="form-grid">
      <label>رقم الهاتف<input value={values.phone} onChange={e=>change("phone",e.target.value)} dir="ltr" /></label>
      <label>حساب الإنستغرام<input value={values.instagram} onChange={e=>change("instagram",e.target.value)} dir="ltr" /></label>
    </div>
    <label>معلومات نهاية ملف الطباعة<textarea rows={4} value={values.printFooterNote} maxLength={500} onChange={e=>change("printFooterNote",e.target.value)} /></label>
    <Button onClick={save} disabled={saving}>{saving?"جارٍ الحفظ…":"حفظ إعدادات الطباعة"}</Button>
    <p role="status">{status}</p>
  </section></div>;
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
    const images = [s.logo, s.printCoachPhotoUrl, s.printHallPhotoUrl];
    if (images.some((value) => value && !safeImageUrl(value) && !value.startsWith("/"))) {
      setSaveState("error");
      setSaveMessage("تحقق من روابط الصور: يُسمح برابط HTTPS مباشر أو ملف الاستضافة الحالي فقط.");
      return;
    }
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
        <h2>هوية الطباعة</h2>
        <p>ارفع PNG أو JPG أو WebP من الجهاز. الرفع يمر عبر Worker موثوق ثم GitHub Actions، ولا يُحدّث الرابط المحفوظ إلا بعد نجاح نشر الصورة على Staging.</p>
        <div className="upload-grid">
          <ImageSetting label="شعار القاعة للطباعة" value={s.logo} setting="logo" onChange={(value) => update("logo", value)} persist={async value => { const next={...s,logo:value}; await saveManagerPrintSettings(next); setS(next); }} />
          <ImageSetting label="صورة/لوجو الكابتن للطباعة" value={s.printCoachPhotoUrl} setting="coach" onChange={(value) => update("printCoachPhotoUrl", value)} persist={async value => { const next={...s,printCoachPhotoUrl:value}; await saveManagerPrintSettings(next); setS(next); }} />
          <ImageSetting label="صورة خلفية القاعة للطباعة" value={s.printHallPhotoUrl} setting="hall" onChange={(value) => update("printHallPhotoUrl", value)} persist={async value => { const next={...s,printHallPhotoUrl:value}; await saveManagerPrintSettings(next); setS(next); }} />
        </div>
        <label className="print-footer-note">النص الختامي للمشترك<textarea maxLength={500} value={s.printFooterNote} onChange={(e) => update("printFooterNote", e.target.value)} placeholder="تعليمات الكابتن أو رسالة ختامية" /></label>
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
function ImageSetting({
  label,
  value,
  setting,
  onChange,
  persist,
}: {
  label: string;
  value: string;
  setting: PrintImageSlot;
  onChange: (value: string) => void;
  persist?: (value: string) => Promise<void>;
}) {
  const [selected, setSelected] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const valid = !value || Boolean(safeImageUrl(value)) || (value.startsWith("/") && !value.startsWith("//") && !value.includes(".."));
  const choose = (file: File | null) => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(file ? URL.createObjectURL(file) : "");
    setSelected(file);
    setStatus(file ? "المعاينة جاهزة؛ اضغط رفع وحفظ." : "");
  };
  const upload = async () => {
    if (!selected || busy) return;
    setBusy(true); setStatus("جارٍ رفع الصورة إلى GitHub…");
    try {
      const result = await uploadPrintImage(setting, selected);
      const deployedUrl = await waitForPrintImageDeployment(result.commitSha, result.path, setStatus);
      if (persist) await persist(deployedUrl);
      onChange(deployedUrl);
      setSelected(null); setStatus("تم النشر والتحقق من الصورة على Staging.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "فشل رفع الصورة؛ بقيت الصورة القديمة.");
    } finally { setBusy(false); }
  };
  return (
    <div className="upload-box static-asset">
      {(preview || value) && <img src={preview || value} alt="" />}
      <span>{label}</span>
      <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => choose(event.target.files?.[0] || null)} />
      {selected && <button type="button" className="secondary-btn" disabled={busy} onClick={() => void upload()}>{busy ? "جارٍ النشر…" : "رفع وحفظ الصورة"}</button>}
      <small>{valid ? "PNG أو JPG أو WebP · الصورة القديمة تبقى حتى نجاح النشر" : "الرابط الحالي غير صالح"}</small>
      {status && <small role="status">{status}</small>}
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
        <div className="modal-scroll-content" tabIndex={0}>{children}</div>
      </section>
    </div>
  );
}
function buildPrintMemberHtml(m: Member, s: SettingsData, autoPrint = true) {
  const qrMarkup = (e: MemberExercise) => `<div class="qr">${renderToStaticMarkup(<QRCodeSVG value={exerciseTarget(e)} size={64} includeMargin level="M" />)}</div>`;
  const courseQrMarkup = `<div class="course-qr">${renderToStaticMarkup(<QRCodeSVG value={memberLoginUrl()} size={76} includeMargin level="M" />)}<strong>امسح الرمز للدخول إلى حسابك وعرض جدول تمارينك</strong></div>`;
  const rows = (day: DayPlan) => day.map((e, n) => `<tr><td class="exercise-name"><strong>${n + 1}. ${escapeHtml(e.name)}</strong><small>${escapeHtml(e.muscle)}${e.notes ? ` · ${escapeHtml(e.notes)}` : ""}</small></td><td class="num">${escapeHtml(String(e.sets))}</td><td>${escapeHtml(e.reps)}</td><td>${escapeHtml(e.weight || "—")}</td><td>${escapeHtml(e.rest || "—")}</td><td>${qrMarkup(e)}</td></tr>`).join("");
  const coachPhoto = s.printCoachPhotoUrl || s.coachPhoto;
  const hallPhoto = s.printHallPhotoUrl || s.hallPhoto;
  const footerNote = escapeHtml(s.printFooterNote || "").replace(/\n/g, "<br>");
  const memberNotes = escapeHtml(m.notes || "");
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${escapeHtml(m.name)} — ${escapeHtml(s.gymName)}</title><style>
    @page{size:210mm 297mm;margin:8mm}*{box-sizing:border-box}body{font-family:'IBM Plex Sans Arabic',Arial,Tahoma,sans-serif;color:#171917;margin:0;background:#fff;direction:rtl}.header{display:grid;grid-template-columns:1fr 1.15fr 1fr;gap:12px;align-items:center;min-height:42mm;direction:ltr}.coach{text-align:left;direction:rtl;display:flex;align-items:center;gap:8px}.coach img{width:32mm;height:32mm;border-radius:50%;object-fit:cover;object-position:top;border:1px solid #b7ff2a}.brand{text-align:center;direction:rtl}.brand img{max-width:45mm;max-height:30mm;object-fit:contain}.brand strong{display:block;font-size:11px;margin-top:2px}.member{text-align:right;font-size:12px;line-height:1.75;font-weight:700;direction:rtl}.member b{font-weight:400;color:#555}.rule{height:2px;background:#b7ff2a;margin:2mm 0 5mm}.day{border:1px solid #222;border-radius:3mm;padding:0 0 2mm;margin:0 0 6mm;background:#fff;break-inside:auto}.day-title{min-width:52mm;max-width:120mm;margin:-4mm auto 2mm;background:#fff;border:1px solid #555;border-radius:2mm;text-align:center;padding:1.5mm 3mm;font-size:15px;font-weight:700}.day table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:10px;background:#fff}.day thead{display:table-header-group}.day tr{break-inside:avoid;page-break-inside:avoid}.day th,.day td{border:1px solid #cfd3d0;padding:1.6mm 1.5mm;vertical-align:middle;text-align:center}.day th{background:#f0f1f0;font-size:10px}.day th:nth-child(1),.day td:nth-child(1){width:38%;text-align:right}.day th:nth-child(2),.day td:nth-child(2){width:12%}.day th:nth-child(3),.day td:nth-child(3){width:15%}.day th:nth-child(4),.day td:nth-child(4){width:13%}.day th:nth-child(5),.day td:nth-child(5){width:12%}.day th:nth-child(6),.day td:nth-child(6){width:10%}.exercise-name small{display:block;color:#555;font-size:8px;margin-top:1mm}.num{font-weight:700}.qr{width:15mm;height:15mm;margin:auto;display:grid;place-items:center}.qr svg{width:13mm;height:13mm}.course-qr{display:flex;align-items:center;gap:4mm;border:1px solid #cfd3d0;border-radius:3mm;padding:3mm;background:#fff}.course-qr svg{width:19mm;height:19mm}.course-qr strong{font-size:10px;max-width:55mm;line-height:1.7}.footer{border-top:1px solid #222;margin-top:3mm;padding:3mm 0;display:flex;align-items:center;justify-content:space-between;gap:4mm;font-size:9px;break-inside:avoid;flex-wrap:wrap}.footer span{white-space:nowrap}.empty{padding:5mm;text-align:center;color:#666}.login-qr{display:flex;justify-content:center;margin-top:4mm;break-inside:avoid}@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
  </style></head><body><header class="header"><div class="coach">${coachPhoto ? `<img src="${coachPhoto}" alt="صورة الكابتن">` : ""}</div><div class="brand">${s.logo ? `<img src="${s.logo}" alt="شعار ${escapeHtml(s.gymName)}">` : `<strong>${escapeHtml(s.gymName)}</strong>`}<strong>${escapeHtml(s.coachName)}</strong>${m.courseName ? `<small style="display:block;font-size:10px;color:#444">${escapeHtml(m.courseName)}</small>` : ""}</div><div class="member">${s.showDate ? `<div><b>تاريخ الاشتراك:</b> ${escapeHtml(m.createdAt || "—")}</div>` : ""}${m.expiresAt ? `<div><b>تاريخ الانتهاء:</b> ${escapeHtml(m.expiresAt)}</div>` : ""}<div><b>الاسم:</b> ${escapeHtml(m.name)}</div><div><b>رقم العضوية:</b> ${escapeHtml(m.membershipId || m.id)}</div>${s.showWeight ? `<div><b>الوزن:</b> ${escapeHtml(m.weight || "—")}</div>` : ""}${s.showHeight ? `<div><b>الطول:</b> ${escapeHtml(m.height || "—")}</div>` : ""}</div></header><div class="rule"></div>${memberNotes ? `<div style="margin:0 0 4mm;padding:2mm 3mm;border:1px dashed #666;border-radius:2mm;font-size:10px"><b>ملاحظات الكابتن:</b> ${memberNotes}</div>` : ""}${m.days.map((day, i) => {
    const dayMuscles = [...new Set(day.map((e) => e.muscle))].filter(Boolean).join(" + ");
    return `<section class="day"><h2 class="day-title">اليوم ${i + 1}${dayMuscles ? ` — ${escapeHtml(dayMuscles)}` : ""}</h2>${day.length ? `<table><thead><tr><th>التمرين</th><th>المجموعات</th><th>التكرارات</th><th>الوزن</th><th>الراحة</th><th>QR</th></tr></thead><tbody>${rows(day)}</tbody></table>` : '<div class="empty">لا توجد تمارين لهذا اليوم</div>'}</section>`;
  }).join("")}<div class="login-qr">${courseQrMarkup}</div><footer class="footer"><span>${escapeHtml(s.phone || "")}</span><span>${escapeHtml(s.whatsapp || "")}</span><span>${escapeHtml(s.instagram || "")}</span><span>${escapeHtml(s.address || "")}</span>${footerNote ? `<span>${footerNote}</span>` : ""}<strong>© 2026 جميع الحقوق محفوظة لشركة الأساس للحلول البرمجية · Version ${escapeHtml(APP_VERSION)}</strong></footer>${autoPrint ? `<script>async function ready(){if(document.fonts?.ready)await document.fonts.ready;await Promise.all([...document.images].map(i=>i.complete?Promise.resolve():new Promise(r=>{i.onload=i.onerror=r})));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));window.focus();window.print()}window.addEventListener('load',ready)</script>` : ""}</body></html>`;
}
function PrintPreviewModal({
  member,
  settings,
  onClose,
}: {
  member: Member;
  settings: SettingsData;
  onClose: () => void;
}) {
  const html = buildPrintMemberHtml(member, settings, false);
  return (
    <Modal title={`معاينة طباعة A4 — ${member.name}`} onClose={onClose} wide>
      <div className="print-preview-modal-body">
        <iframe
          title={`معاينة طباعة ${member.name}`}
          className="print-preview-frame"
          srcDoc={html}
        />
        <div className="modal-actions">
          <Button secondary onClick={onClose}>إغلاق</Button>
          <Button onClick={() => printMember(member, settings)} icon={<Printer size={16} />}>
            طباعة A4 الآن
          </Button>
        </div>
      </div>
    </Modal>
  );
}
function printMember(m: Member, s: SettingsData) {
  const html = buildPrintMemberHtml(m, s, true);
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
function RootRouter() {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const adminRoute = window.location.pathname.replace(/\/+$/, "").endsWith("/admin");
  if (hash.startsWith("#/exercise/")) {
    const id = decodeURIComponent(hash.slice(11));
    return <PublicExerciseDetail exerciseId={id} />;
  }
  if (hash.startsWith("#/course/")) {
    const id = decodeURIComponent(hash.slice(9));
    return <PublicCourseDetail courseId={id} />;
  }
  if (adminRoute) {
    return <AdminGate />;
  }
  return <MemberPinGate />;
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <UiErrorBoundary>
      <RootRouter />
    </UiErrorBoundary>
  </StrictMode>,
);
