import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
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
  readAdminData,
  type SyncPayload,
  watchAdminData,
  watchPublicExercise,
  writeAdminData,
} from "./dataSync";
import {
  issueMemberPin,
  loginMemberWithPin,
  revokeMemberSession,
  pinServiceConfigured,
} from "./memberPin";
import { isSafeVideoUrl, safeVideoUrl } from "./videoUrl";
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
  if(!member)return <main className="auth-page"><Logo s={defaults}/><section className="panel auth-card"><span className="status">● تسجيل المشترك: هاتف + PIN</span><h1>بوابة المشترك</h1><p>أدخل رقم الهاتف والرمز الرباعي الذي أصدره المدرب. الرمز لا يُخزّن في المتصفح أو Firebase.</p><label>رقم الهاتف<input inputMode="tel" autoComplete="tel" value={phone} onChange={e=>setPhone(e.target.value)}/></label><label>PIN من 4 أرقام<input inputMode="numeric" autoComplete="one-time-code" maxLength={4} value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,'').slice(0,4))}/></label><Button onClick={async()=>{setBusy(true);setError('');try{const result=await loginMemberWithPin(phone,pin);setMember(result.member as Member);setSessionToken(result.sessionToken)}catch(e){setError(e instanceof Error?e.message:'تعذر تسجيل الدخول')}finally{setBusy(false)}}}>{busy?'جارٍ التحقق…':'تسجيل الدخول'}</Button>{error&&<p className="auth-error" role="alert">{error}</p>}<p className="auth-help">Google مخصص للمدراء فقط. لا تحاول اختيار عضوية أو رقم هاتف آخر من الواجهة.</p></section></main>;
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
  phone?: string;
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
  coachPhoto: "",
  logo: "",
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
const cloneDays = (days: DayPlan[]) =>
  days.map((day) => day.map((ex) => ({ ...ex })));
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
      <button className="icon-btn mobile-menu" onClick={onMenu}>
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
  settings,
  exercises,
  members,
  courses,
  setSettings,
  setExercises,
  setMembers,
  setCourses,
}: {
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
  const localPayload: AppPayload = {
    schemaVersion: 1,
    settings,
    exercises,
    members,
    courses,
  };
  const remoteSettings = {
    ...settings,
    logo: /^https?:\/\//i.test(settings.logo) ? settings.logo : "",
    coachPhoto: /^https?:\/\//i.test(settings.coachPhoto)
      ? settings.coachPhoto
      : "",
  };
  const payload: AppPayload = { ...localPayload, settings: remoteSettings };
  useEffect(
    () =>
      watchAdminData<AppPayload>((remote) => {
        if (remote) {
          hydrating.current = true;
          setSettings(remote.settings || defaults);
          setExercises(dedupeById(remote.exercises || []));
          setMembers(dedupeById(remote.members || []));
          setCourses(dedupeById(remote.courses || []));
          setRemotePresent(true);
        }
        setRemoteReady(true);
      }),
    [setSettings, setExercises, setMembers, setCourses],
  );
  useEffect(() => {
    const save = async () => {
      if (busy) return;
      setBusy(true);
      setError("");
      window.dispatchEvent(
        new CustomEvent("alasas-save-status", { detail: "saving" }),
      );
      try {
        await writeAdminData(payload);
        const check = await readAdminData<AppPayload>();
        if (
          !check ||
          JSON.stringify(check.settings) !== JSON.stringify(remoteSettings)
        )
          throw new Error("تعذر تأكيد قراءة إعدادات Firebase بعد الحفظ");
        setRemotePresent(true);
        window.dispatchEvent(
          new CustomEvent("alasas-save-status", { detail: "saved" }),
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : "تعذر حفظ RTDB";
        setError(message);
        window.dispatchEvent(
          new CustomEvent("alasas-save-status", { detail: message }),
        );
      } finally {
        setBusy(false);
      }
    };
    window.addEventListener("alasas-save-settings", save);
    return () => window.removeEventListener("alasas-save-settings", save);
  }, [payload, busy, remoteSettings]);
  const migrate = async () => {
    setBusy(true);
    setError("");
    try {
      const backup = backupLocalSnapshot(localPayload);
      setBackupKey(backup);
      await writeAdminData({
        ...payload,
        migratedAt: new Date().toISOString(),
      });
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
    read("alasas-settings", defaults),
  );
  const [exercises, setExercises] = useState(() =>
    read<Exercise[]>("alasas-exercises", seedExercises),
  );
  const [members, setMembers] = useState(() =>
    read<Member[]>("alasas-members", []),
  );
  const [courses, setCourses] = useState(() =>
    read<ReadyCourse[]>("alasas-courses", []),
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
    () => localStorage.setItem("alasas-members", JSON.stringify(members)),
    [members],
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
          <div
            className={open ? "sidebar-wrap open" : "sidebar-wrap"}
            onClick={() => setOpen(false)}
          >
            <div onClick={(e) => e.stopPropagation()}>
              <Sidebar
                page={page}
                setPage={setPage}
                s={settings}
                role={role}
                onSignOut={onSignOut}
              />
            </div>
          </div>
          <div className="main-area">
            <Topbar title={title} onMenu={() => setOpen(true)} />
            <main className="content">
              <CentralDataBridge
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
      <AuthNotice
        title="تسجيل دخول الإدارة"
        text="الدخول متاح عبر Google فقط. لن تظهر أي بيانات قبل التحقق من UID وصلاحية فعالة في admins/{uid}."
        action={async () => {
          setBusy(true);
          setError("");
          try {
            await signInAdmin();
          } catch (e) {
            setError(e instanceof Error ? e.message : "تعذر تسجيل الدخول");
          } finally {
            setBusy(false);
          }
        }}
        actionLabel={
          busy ? "جارٍ تسجيل الدخول…" : error || "تسجيل الدخول بواسطة Google"
        }
      />
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
            .filter((e) => e.muscle === muscle)
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
                  {e.sets} × {e.reps}
                </small>
              </button>
            ))}
        </div>
      </div>
      {selected[day]?.length > 0 && (
        <div className="selected-exercises">
          {selected[day].map((e) => (
            <div key={e.id}>
              <b>{e.name}</b>
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
function MembersWithPin({exercises,members,setMembers,settings}:{exercises:Exercise[];members:Member[];setMembers:React.Dispatch<React.SetStateAction<Member[]>>;settings:SettingsData}){
  const [editing,setEditing]=useState<Member|null>(null);
  const [show,setShow]=useState(false);
  const [pin,setPin]=useState('');
  const [pinBusy,setPinBusy]=useState(false);
  const [pinError,setPinError]=useState('');
  const [issueTarget,setIssueTarget]=useState<Member|null>(null);
  const [issuePhone,setIssuePhone]=useState('');
  const save=(m:Member)=>{setMembers(x=>x.some(a=>a.id===m.id)?x.map(a=>a.id===m.id?m:a):[...x,m]);setShow(false);setEditing(null)};
  const openIssue=(m:Member)=>{setPin('');setPinError('');setIssueTarget(m);setIssuePhone(m.phone||'')};
  const issue=async(m:Member,requestedPhone:string)=>{const phone=requestedPhone.trim();if(!/^\+?[1-9]\d{7,14}$/.test(phone)){setPinError('أدخل رقم هاتف صحيحاً بصيغة دولية.');return}setPinBusy(true);setPinError('');setPin('');try{setPin(await issueMemberPin(m.id,phone));setIssueTarget(null);setIssuePhone('')}catch(e){setPinError(e instanceof Error?e.message:'تعذر إصدار PIN من الخدمة الموثوقة')}finally{setPinBusy(false)}};
  return <><section className="section-heading"><div><h2>المشتركون</h2><p>لكل مشترك نسخة مستقلة من الكورس والبيانات والطباعة.</p></div><Button onClick={()=>{setEditing(null);setShow(true)}} icon={<Plus size={17}/>}>إضافة مشترك</Button></section>{issueTarget&&<section className="panel pin-issue-form" role="dialog" aria-label="إصدار PIN"><b>إصدار PIN لـ {issueTarget.name}</b><label>رقم هاتف المشترك<input inputMode="tel" autoComplete="tel" value={issuePhone} onChange={e=>setIssuePhone(e.target.value)}/></label><div><button className="secondary-btn" disabled={pinBusy} onClick={()=>issue(issueTarget,issuePhone)}>{pinBusy?'جارٍ الإصدار…':'إصدار PIN'}</button><button className="secondary-btn" disabled={pinBusy} onClick={()=>{setIssueTarget(null);setIssuePhone('')}}>إلغاء</button></div></section>}{pin&&<section className="panel pin-reveal" role="status"><b>PIN الصادر — اعرضه للمشترك الآن فقط</b><strong>{pin}</strong><div><button className="secondary-btn" onClick={()=>navigator.clipboard.writeText(pin)}>نسخ الرمز</button><button className="secondary-btn" onClick={()=>window.print()}>طباعة</button></div><small>لن يُعاد عرض هذا الرمز من Firebase أو المتصفح بعد إغلاق هذه الشاشة.</small></section>}{pinError&&<p className="auth-error" role="alert">{pinError}</p>}{members.length?<div className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>المشترك</th><th>الهاتف</th><th>تاريخ الإنشاء</th><th>الطول</th><th>الوزن</th><th>الأيام</th><th>الإجراءات</th></tr></thead><tbody>{members.map(m=><tr key={m.id}><td><div className="member-cell"><div className="avatar">{m.name.slice(0,1)}</div><b>{m.name}</b></div></td><td>{m.phone||'يُدخل عند الإصدار'}</td><td>{m.createdAt}</td><td>{m.height||'—'} سم</td><td>{m.weight||'—'} كغم</td><td>{m.days.length}</td><td><div className="row-actions"><button onClick={()=>setEditing(m)}><ExternalLink size={14}/>عرض</button><button onClick={()=>{setEditing(m);setShow(true)}}><Pencil size={14}/>تعديل</button><button disabled={pinBusy} onClick={()=>openIssue(m)}><Check size={14}/>إصدار / إعادة إصدار PIN</button><button onClick={()=>printMember(m,settings)}><Printer size={14}/>طباعة</button><button onClick={()=>{if(window.confirm(`حذف المشترك ${m.name}؟`))setMembers(x=>x.filter(a=>a.id!==m.id))}}><Trash2 size={14}/>حذف</button></div></td></tr>)}</tbody></table></div></div>:<Empty icon={<Users size={30}/>} title="ابدأ بإضافة مشترك" text="Wizard منظم لبناء كورس مستقل."/>}{(show||editing)&&<MemberWizard initial={editing} exercises={exercises} onClose={()=>{setShow(false);setEditing(null)}} onSave={save} viewOnly={!show}/>}</>}
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
  onSave: (m: Member) => void;
  viewOnly?: boolean;
}) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState(initial?.name || "");
  const [membershipId, setMembershipId] = useState(
    initial?.membershipId || `M-${Date.now().toString().slice(-6)}`,
  );
  const [authUid, setAuthUid] = useState(initial?.authUid || "");
  const [phone, setPhone] = useState(initial?.phone || "");
  const [active, setActive] = useState(initial?.active !== false);
  const [height, setHeight] = useState(initial?.height || "");
  const [weight, setWeight] = useState(initial?.weight || "");
  const [photo, setPhoto] = useState(initial?.photo || "");
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
                <label>
                  صورة المشترك
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = () => setPhoto(String(reader.result));
                      reader.readAsDataURL(file);
                    }}
                  />
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
          {photo && (
            <img
              className="member-photo-preview"
              src={photo}
              alt="معاينة صورة المشترك"
            />
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
            onClick={() =>
              onSave({
                id: initial?.id || uid(),
                membershipId,
                name: name || "مشترك بدون اسم",
                height,
                weight,
                createdAt:
                  initial?.createdAt || new Date().toLocaleDateString("ar-IQ"),
                photo,
                days: cloneDays(selected.slice(0, days)),
                active,
                ...(phone.trim() ? { phone: phone.trim() } : {}),
                ...(authUid.trim() ? { authUid: authUid.trim() } : {}),
              })
            }
            icon={<Check size={16} />}
          >
            حفظ
          </Button>
        )}
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
              <a
                href={safeVideoUrl(e.video) || exerciseUrl(e.id)}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={15} />
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
  const upload = (key: "logo" | "coachPhoto", file: File) => {
    const reader = new FileReader();
    reader.onload = () => update(key, String(reader.result));
    reader.readAsDataURL(file);
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
        <h2>الشعار والصورة</h2>
        <div className="upload-grid">
          <Upload
            label="شعار القاعة"
            value={s.logo}
            onChange={(f) => upload("logo", f)}
          />
          <Upload
            label="صورة الكابتن"
            value={s.coachPhoto}
            onChange={(f) => upload("coachPhoto", f)}
          />
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
function Upload({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (file: File) => void;
}) {
  return (
    <label className="upload-box">
      {value && <img src={value} alt="" />}
      <span>{label}</span>
      <small>اضغط لاختيار صورة</small>
      <input
        type="file"
        accept="image/*"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onChange(file);
        }}
      />
    </label>
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
function printMember(m: Member, s: SettingsData) {
  const qrMarkup = (e: MemberExercise) => {
    const target = exerciseTarget(e);
    return target
      ? `<div class="qr">${renderToStaticMarkup(<QRCodeSVG value={target} size={58} includeMargin level="M" />)}</div>`
      : '<span class="qr-empty">الشرح غير متوفر</span>';
  };
  const html = `<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>${escapeHtml(m.name)} — ${escapeHtml(s.gymName)}</title><style>@page{size:A4 portrait;margin:12mm}*{box-sizing:border-box}body{font-family:Arial,Tahoma,sans-serif;color:#171917;margin:0;background:#fff}header{display:grid;grid-template-columns:72px 1fr 1fr;gap:12px;align-items:center;border-bottom:3px solid #b7ff2a;padding-bottom:12px;margin-bottom:14px}header img{max-height:58px;max-width:120px;object-fit:contain}.member-photo{width:72px;height:82px;border:1px solid #ddd;object-fit:cover}header>div:first-of-type{grid-column:1;grid-row:1}header>div:nth-of-type(2){grid-column:2;grid-row:1}header>.member-photo,header>.member-photo.placeholder{grid-column:3;grid-row:1}h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:14px 0 6px;border-bottom:1px solid #ddd;padding-bottom:5px}.meta{font-size:10px;color:#525960}.day{break-inside:avoid;page-break-inside:avoid;border:1px solid #e5e7eb;border-radius:6px;padding:8px;margin:8px 0}.exercise-head,.exercise{display:grid;grid-template-columns:20px 1fr 90px 60px 66px;gap:6px;align-items:center}.exercise-head{font-weight:700;color:#525960;font-size:9px;padding:3px 0 6px;border-bottom:1px solid #ddd}.exercise{border-bottom:1px solid #eee;padding:7px 0;font-size:10px}.exercise:last-child{border:0}.exercise small{display:block;color:#525960}.qr{width:58px;height:58px;background:#fff;padding:4px;display:grid;place-items:center}.qr svg{width:50px;height:50px}.qr-empty{font-size:8px;color:#777;text-align:center}.footer{margin-top:15px;border-top:1px solid #ddd;padding-top:8px;font-size:9px;color:#525960;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}section{break-inside:avoid}</style></head><body><header>${m.photo ? `<img class="member-photo" src="${m.photo}" alt="صورة المشترك">` : "<span></span>"}<div><h1>${escapeHtml(m.name)}</h1><div class="meta">${s.showHeight ? `${escapeHtml(m.height || "—")} سم · ` : ""}${s.showWeight ? `${escapeHtml(m.weight || "—")} كغم` : ""}${s.showDate ? ` · ${escapeHtml(m.createdAt)}` : ""}</div></div><div><strong>${escapeHtml(s.gymName)}</strong>${s.logo ? `<br><img src="${s.logo}" alt="شعار القاعة">` : ""}<div class="meta">${escapeHtml(s.coachName)}</div></div></header>${m.days.map((day, i) => `<section class="day"><h2>اليوم ${i + 1}</h2>${day.length ? `<div class="exercise-head"><span>م</span><span>التمرين</span><span>المجاميع × التكرارات</span><span>الراحة</span><span>QR</span></div>${day.map((e, n) => `<div class="exercise"><b>${n + 1}</b><div><strong>${escapeHtml(e.name)}</strong><small>${escapeHtml(e.muscle)}</small></div><span>${escapeHtml(String(e.sets))} × ${escapeHtml(e.reps)}${e.weight ? ` · ${escapeHtml(e.weight)}` : ""}</span><span>${escapeHtml(e.rest || "—")}</span>${qrMarkup(e)}</div>`).join("")}` : '<div class="meta">لا توجد تمارين لهذا اليوم</div>'}</section>`).join("")}<div class="footer"><span>${escapeHtml(s.phone)}</span><span>${escapeHtml(s.instagram)}</span><span>${escapeHtml(s.address)}</span></div><script>async function ready(){if(document.fonts?.ready)await document.fonts.ready;await Promise.all([...document.images].map(i=>i.complete?Promise.resolve():new Promise(r=>{i.onload=i.onerror=r})));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));window.focus();window.print()}window.addEventListener('load',ready)</script></body></html>`;
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(html);
  w.document.close();
}
function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] || c,
  );
}
const adminRoute = location.pathname.replace(/\/+$/, "").endsWith("/admin");
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {adminRoute ? (
      <AdminGate />
    ) : location.hash.startsWith("#/exercise/") ? (
      <App role="MANAGER" onSignOut={() => {}} />
    ) : (
      <MemberPinGate />
    )}
  </StrictMode>,
);
