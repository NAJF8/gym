import { StrictMode, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Activity, ArrowLeft, BarChart3, Bell, CalendarDays, Check, ChevronLeft, Dumbbell, FileText, LayoutDashboard, LogOut, Menu, Plus, Search, Settings, ShieldCheck, UserRound, Users, X, Trash2, Pencil, Play, Copy, Download, Clock, QrCode } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import './styles.css'

type Member = { id: number; name: string; phone: string; plan: string; status: 'نشط' | 'ينتهي قريباً' | 'منتهي'; goal: string; weight: number; height: number; started: string }
type Exercise = { id: number; name: string; muscle: string; sets: number; reps: string; weight: string; rest: string; video: string }
type Day = { title: string; muscle: string; exercises: number[] }
type Course = { id: number; name: string; days: Day[] }
type View = 'dashboard'|'members'|'courses'|'library'|'reports'|'settings'|'mycourse'|'history'|'profile'
const catalogSeed: Exercise[] = [
 {id:1,name:'ضغط صدر بالبار',muscle:'الصدر',sets:4,reps:'8–10',weight:'45',rest:'90',video:'https://www.youtube.com/results?search_query=barbell+bench+press+tutorial'},
 {id:2,name:'ضغط دمبل مائل',muscle:'الصدر',sets:3,reps:'10–12',weight:'18',rest:'75',video:'https://www.youtube.com/results?search_query=incline+dumbbell+press+tutorial'},
 {id:3,name:'تفتيح صدر بالكابل',muscle:'الصدر',sets:3,reps:'12',weight:'12',rest:'60',video:'https://www.youtube.com/results?search_query=cable+chest+fly+tutorial'},
 {id:4,name:'سحب أمامي',muscle:'الظهر',sets:4,reps:'12',weight:'35',rest:'90',video:'https://www.youtube.com/results?search_query=lat+pulldown+tutorial'},
 {id:5,name:'سحب كيبل جالس',muscle:'الظهر',sets:3,reps:'12',weight:'30',rest:'75',video:'https://www.youtube.com/results?search_query=seated+cable+row+tutorial'},
 {id:6,name:'سكوات',muscle:'الأرجل',sets:4,reps:'10',weight:'40',rest:'120',video:'https://www.youtube.com/results?search_query=barbell+squat+tutorial'},
 {id:7,name:'ضغط أرجل',muscle:'الأرجل',sets:3,reps:'12',weight:'70',rest:'90',video:'https://www.youtube.com/results?search_query=leg+press+tutorial'},
 {id:8,name:'بايسبس دمبل',muscle:'البايسبس',sets:3,reps:'12',weight:'10',rest:'60',video:'https://www.youtube.com/results?search_query=dumbbell+bicep+curl+tutorial'},
 {id:9,name:'ترايسبس كيبل',muscle:'الترايسبس',sets:3,reps:'12',weight:'20',rest:'60',video:'https://www.youtube.com/results?search_query=triceps+pushdown+tutorial'},
 {id:10,name:'ضغط كتف دمبل',muscle:'الأكتاف',sets:3,reps:'10',weight:'14',rest:'90',video:'https://www.youtube.com/results?search_query=dumbbell+shoulder+press+tutorial'},
 {id:11,name:'بلانك',muscle:'البطن',sets:3,reps:'30 ثانية',weight:'0',rest:'45',video:'https://www.youtube.com/results?search_query=plank+exercise+tutorial'}
]
const memberSeed:Member[]=[
 {id:1,name:'أحمد محمد',phone:'07700000001',plan:'بناء عضل — 4 أيام',status:'نشط',goal:'زيادة الكتلة العضلية',weight:78,height:176,started:'2026-10-01'},
 {id:2,name:'سارة علي',phone:'07700000002',plan:'لياقة — 3 أيام',status:'نشط',goal:'تحسين اللياقة',weight:62,height:164,started:'2026-10-05'},
 {id:3,name:'حسين كريم',phone:'07700000003',plan:'بناء عضل — 4 أيام',status:'ينتهي قريباً',goal:'زيادة القوة',weight:84,height:180,started:'2026-09-10'},
 {id:4,name:'نور الهدى',phone:'07700000004',plan:'لياقة — 3 أيام',status:'نشط',goal:'لياقة عامة',weight:58,height:161,started:'2026-10-11'}
]
const courseSeed:Course[]=[
 {id:1,name:'بناء عضل — 4 أيام',days:[{title:'اليوم الأول',muscle:'صدر + ترايسبس',exercises:[1,2,3,9]},{title:'اليوم الثاني',muscle:'ظهر + بايسبس',exercises:[4,5,8]},{title:'اليوم الثالث',muscle:'أرجل',exercises:[6,7]},{title:'اليوم الرابع',muscle:'أكتاف + بطن',exercises:[10,11]}]},
 {id:2,name:'لياقة — 3 أيام',days:[{title:'اليوم الأول',muscle:'جسم كامل',exercises:[6,1,11]},{title:'اليوم الثاني',muscle:'ظهر + أكتاف',exercises:[4,10]},{title:'اليوم الثالث',muscle:'أرجل + بطن',exercises:[7,11]}]}
]
function useDemoState<T>(key:string,initial:T):[T,(v:T|((prev:T)=>T))=>void]{
 const [value,setValue]=useState<T>(()=>{
  try {const stored=sessionStorage.getItem('alasas-fit-demo-'+key);return stored?JSON.parse(stored) as T:initial} catch{return initial}
 })
 useEffect(()=>{try{sessionStorage.setItem('alasas-fit-demo-'+key,JSON.stringify(value))}catch{}},[key,value])
 return [value,setValue]
}
function App(){
 const [portal,setPortal]=useState(window.location.hash.startsWith('#/member')?'member':'admin')
 const [view,setView]=useState<View>('dashboard')
 const [memberView,setMemberView]=useState<View>('mycourse')
 const [menu,setMenu]=useState(false)
 const [members,setMembers]=useDemoState('members',memberSeed)
 const [catalog,setCatalog]=useDemoState('catalog',catalogSeed)
 const [courses,setCourses]=useDemoState('courses',courseSeed)
 const [checks,setChecks]=useDemoState<Record<string,boolean>>('checks',{})
 const [selectedMember,setSelectedMember]=useState<Member|null>(null)
 const [selectedExercise,setSelectedExercise]=useState<Exercise|null>(null)
 const [dialog,setDialog]=useState<'member'|'exercise'|'course'|null>(null)
 const [editingMember,setEditingMember]=useState<Member|null>(null)
 const [editingExercise,setEditingExercise]=useState<Exercise|null>(null)
 const [editingCourse,setEditingCourse]=useState<Course|null>(null)
 const [query,setQuery]=useState('')
 const [filter,setFilter]=useState('الكل')
 const [muscle,setMuscle]=useState('الكل')
 const [dayIndex,setDayIndex]=useState(0)
 const [memberId,setMemberId]=useState(1)
 const [coachName,setCoachName]=useDemoState('coach','كابتن الأساس')
 const [gymName,setGymName]=useDemoState('gym','AL ASAS FIT')
 const [alert,setAlert]=useState('')
 const currentMember=members.find(m=>m.id===memberId)||members[0]
 const currentCourse=courses.find(c=>c.name===currentMember?.plan)||courses[0]
 const day=currentCourse?.days[dayIndex]
 const workout=day?.exercises.map(id=>catalog.find(e=>e.id===id)).filter((e):e is Exercise=>!!e)||[]
 const done=workout.filter(e=>checks[memberId+'-'+dayIndex+'-'+e.id]).length
 const adminItems:[View,string,typeof Users][]=[['dashboard','لوحة التحكم',LayoutDashboard],['members','المشتركون',Users],['courses','الكورسات',CalendarDays],['library','مكتبة التمارين',Dumbbell],['reports','التقارير',BarChart3],['settings','الإعدادات',Settings]]
 const memberItems:[View,string,typeof Users][]=[['mycourse','كورسي',Dumbbell],['history','سجل الإنجاز',Activity],['profile','ملفي الشخصي',UserRound]]
 function navigate(next:'admin'|'member'){
  setPortal(next);setView('dashboard');setMemberView('mycourse');setMenu(false);setDayIndex(0)
  window.location.hash=next== 'member'?'#/member':'#/admin'
 }
 useEffect(()=>{const sync=()=>{setPortal(window.location.hash.startsWith('#/member')?'member':'admin')};window.addEventListener('hashchange',sync);return()=>window.removeEventListener('hashchange',sync)},[])
 function notice(message:string){setAlert(message);window.setTimeout(()=>setAlert(''),3500)}
 function openMember(m?:Member){setEditingMember(m||null);setDialog('member')}
 function openExercise(e?:Exercise){setEditingExercise(e||null);setDialog('exercise')}
 function openCourse(c?:Course){setEditingCourse(c||null);setDialog('course')}
 function saveMember(fd:FormData){
  const name=String(fd.get('name')||'').trim();if(!name)return
  const id=editingMember?.id||Date.now()
  const m:Member={id,name,phone:String(fd.get('phone')||''),plan:String(fd.get('plan')||courses[0]?.name||''),status:String(fd.get('status')||'نشط') as Member['status'],goal:String(fd.get('goal')||''),height:Number(fd.get('height'))||0,weight:Number(fd.get('weight'))||0,started:editingMember?.started||new Date().toISOString().slice(0,10)}
  setMembers(old=>editingMember?old.map(x=>x.id===id?m:x):[...old,m]);setDialog(null);notice('تم حفظ المشترك في النسخة التجريبية')
 }
 function saveExercise(fd:FormData){
  const name=String(fd.get('name')||'').trim();if(!name)return
  const id=editingExercise?.id||Date.now()
  const e:Exercise={id,name,muscle:String(fd.get('muscle')||'الصدر'),sets:Number(fd.get('sets'))||3,reps:String(fd.get('reps')||'12'),weight:String(fd.get('weight')||'0'),rest:String(fd.get('rest')||'60'),video:String(fd.get('video')||'')}
  setCatalog(old=>editingExercise?old.map(x=>x.id===id?e:x):[...old,e]);setDialog(null);notice('تم حفظ التمرين تجريبياً')
 }
 function saveCourse(fd:FormData){
  const name=String(fd.get('name')||'').trim();if(!name)return
  const id=editingCourse?.id||Date.now()
  const num=Math.max(1,Math.min(7,Number(fd.get('days'))||3))
  const days=Array.from({length:num},(_,i)=>editingCourse?.days[i]||{title:'اليوم '+(i+1),muscle:'يوم التدريب '+(i+1),exercises:[]})
  const c:Course={id,name,days}
  setCourses(old=>editingCourse?old.map(x=>x.id===id?c:x):[...old,c]);setDialog(null);notice('تم حفظ الكورس، افتحه لإضافة التمارين')
 }
 const [openCourseId,setOpenCourseId]=useState<number|null>(null)
 const [courseDay,setCourseDay]=useState(0)
 const detailCourse=courses.find(c=>c.id===openCourseId)
 function changeCourseDay(courseId:number,index:number,patch:Partial<Day>){
  setCourses(old=>old.map(c=>c.id===courseId?{...c,days:c.days.map((d,i)=>i===index?{...d,...patch}:d)}:c))
 }
 function exportCourse(){
  window.print()
 }
 function renderWorkout(){
  return <div className="workout-list">{workout.length?workout.map(e=><div className="exercise-item" key={e.id}>
   <button aria-label="إنجاز التمرين" className={'round-check '+(checks[memberId+'-'+dayIndex+'-'+e.id]?'checked':'')} onClick={()=>setChecks(old=>({...old,[memberId+'-'+dayIndex+'-'+e.id]:!old[memberId+'-'+dayIndex+'-'+e.id]}))}>{checks[memberId+'-'+dayIndex+'-'+e.id]?<Check size={15}/>:null}</button>
   <div className="exercise-item-name"><b>{e.name}</b><span>{e.muscle}</span></div>
   <span>{e.sets} مجموعات</span><span>{e.reps} تكرار</span><span>{e.weight} كغم</span>
   <button className="small-link" onClick={()=>setSelectedExercise(e)}>شرح <ArrowLeft size={15}/></button>
  </div>):<div className="empty">لم يضف الكابتن تمارين لهذا اليوم بعد.</div>}</div>
 }
 function sectionTitle(title:string,subtitle:string,action?:React.ReactNode){return <div className="section-title"><div><h2>{title}</h2><p>{subtitle}</p></div>{action}</div>}
 return <div className="app-shell">
  <div className="mobile-header"><button className="icon-button" onClick={()=>setMenu(true)} aria-label="فتح القائمة"><Menu size={22}/></button><strong>{gymName}</strong><span className="demo-pill">نسخة تجريبية</span></div>
  <aside className={'sidebar '+(menu?'sidebar-open':'')}>
   <div className="brand"><div className="brand-mark"><Dumbbell size={19}/></div><div><strong>{gymName}</strong><span>TRAINING STUDIO</span></div><button className="menu-close icon-button" onClick={()=>setMenu(false)}><X size={19}/></button></div>
   <div className="role-switch"><button className={portal==='admin'?'active':''} onClick={()=>navigate('admin')}>الكابتن</button><button className={portal==='member'?'active':''} onClick={()=>navigate('member')}>المشترك</button></div>
   <div className="menu-label">القائمة الرئيسية</div>
   <nav>{(portal==='admin'?adminItems:memberItems).map(([id,label,Icon])=><button key={id} className={'nav-item '+((portal==='admin'?view:memberView)===id?'active':'')} onClick={()=>{portal==='admin'?setView(id):setMemberView(id);setMenu(false);setQuery('')}}><Icon size={18}/><span>{label}</span><ChevronLeft size={15} className="nav-chevron"/></button>)}</nav>
   <div className="sidebar-footer"><span className="demo-pill">DEMO · بدون قاعدة بيانات</span><p>التعديلات محفوظة مؤقتاً في هذا المتصفح فقط.</p></div>
  </aside>
  {menu&&<button className="mobile-overlay" aria-label="إغلاق القائمة" onClick={()=>setMenu(false)}/>}
  <div className="main-area">
   <header className="topbar"><div><p className="eyebrow">AL ASAS / {portal==='admin'?'COACH CONSOLE':'MEMBER SPACE'}</p><h1>{portal==='admin'?adminItems.find(x=>x[0]===view)?.[1]:memberItems.find(x=>x[0]===memberView)?.[1]}</h1></div><div className="topbar-right"><span className="demo-pill">وضع المعاينة</span><button className="icon-button" onClick={()=>notice('لا توجد إشعارات جديدة')} aria-label="الإشعارات"><Bell size={18}/></button><div className="avatar">أ</div></div></header>
   <main className="content">
    {portal==='admin'&&view==='dashboard'&&<>
     <div className="welcome"><div><span className="eyebrow">WORKSPACE OVERVIEW</span><h2>أهلاً، {coachName}</h2><p>إدارة برامجك ومتابعة مشتركيك من مكان واحد.</p></div><button className="primary-btn" onClick={()=>openMember()}><Plus size={17}/> مشترك جديد</button></div>
     <div className="stats-grid">
      {([['إجمالي المشتركين',members.length,Users],['اشتراكات نشطة',members.filter(m=>m.status==='نشط').length,ShieldCheck],['البرامج التدريبية',courses.length,Dumbbell],['تمارين المكتبة',catalog.length,Activity]] as [string,number,typeof Users][]).map(([label,value,Icon])=><div className="stat-card" key={String(label)}><div className="stat-icon"><Icon size={19}/></div><span>{label as string}</span><strong>{value as number}</strong><small>بيانات المعاينة الحالية</small></div>)}
     </div>
     <div className="two-cols"><section className="panel">{sectionTitle('المشتركون','آخر الأسماء في القائمة',<button className="small-link" onClick={()=>setView('members')}>عرض الكل <ArrowLeft size={15}/></button>)}<div className="compact-list">{members.slice(-5).map(m=><button className="compact-row" key={m.id} onClick={()=>setSelectedMember(m)}><span className="avatar">{m.name.slice(0,1)}</span><span><b>{m.name}</b><small>{m.plan}</small></span><em className="status">{m.status}</em><ChevronLeft size={16}/></button>)}</div></section>
     <section className="panel">{sectionTitle('البرامج','إدارة الجداول الحالية',<button className="small-link" onClick={()=>setView('courses')}>فتح البرامج <ArrowLeft size={15}/></button>)}<div className="compact-list">{courses.map(c=><button className="compact-row" key={c.id} onClick={()=>{setOpenCourseId(c.id);setView('courses')}}><span className="avatar"><CalendarDays size={17}/></span><span><b>{c.name}</b><small>{c.days.length} أيام تدريبية</small></span><ChevronLeft size={16}/></button>)}</div></section></div>
    </>}
    {portal==='admin'&&view==='members'&&<section className="panel">{sectionTitle('إدارة المشتركين','إضافة وتعديل المشتركين وربط البرامج التدريبية',<button className="primary-btn" onClick={()=>openMember()}><Plus size={16}/> إضافة مشترك</button>)}<div className="toolbar"><label className="search-box"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="ابحث بالاسم أو الهاتف..."/></label><select value={filter} onChange={e=>setFilter(e.target.value)}><option>الكل</option><option>نشط</option><option>ينتهي قريباً</option><option>منتهي</option></select></div><div className="table-wrap"><table><thead><tr><th>المشترك</th><th>الهاتف</th><th>البرنامج</th><th>الحالة</th><th>الإجراءات</th></tr></thead><tbody>{members.filter(m=>(filter==='الكل'||m.status===filter)&&(m.name.includes(query)||m.phone.includes(query))).map(m=><tr key={m.id}><td><button className="name-link" onClick={()=>setSelectedMember(m)}>{m.name}</button></td><td>{m.phone}</td><td>{m.plan}</td><td><span className="status">{m.status}</span></td><td><div className="actions"><button className="icon-button" title="تعديل" onClick={()=>openMember(m)}><Pencil size={16}/></button><button className="icon-button danger" title="حذف" onClick={()=>{if(confirm('حذف هذا المشترك من بيانات المعاينة؟'))setMembers(old=>old.filter(x=>x.id!==m.id))}}><Trash2 size={16}/></button></div></td></tr>)}</tbody></table></div></section>}
    {portal==='admin'&&view==='courses'&&<section className="panel">{sectionTitle('الكورسات التدريبية','أنشئ جدولاً وحدد أيامه وعضلاته وتمارينه',<button className="primary-btn" onClick={()=>openCourse()}><Plus size={16}/> كورس جديد</button>)}<div className="course-grid">{courses.map(c=><article className={'course-card '+(openCourseId===c.id?'selected':'')} key={c.id}><div className="course-symbol"><CalendarDays size={21}/></div><h3>{c.name}</h3><p>{c.days.length} أيام · {c.days.reduce((n,d)=>n+d.exercises.length,0)} تمارين</p><div className="actions"><button className="outline-btn" onClick={()=>{setOpenCourseId(c.id);setCourseDay(0)}}>إدارة الجدول</button><button className="icon-button" title="تعديل" onClick={()=>openCourse(c)}><Pencil size={16}/></button><button className="icon-button" title="نسخ" onClick={()=>setCourses(old=>[...old,{...c,id:Date.now(),name:c.name+' — نسخة',days:c.days.map(d=>({...d,exercises:[...d.exercises]}))}])}><Copy size={16}/></button></div></article>)}</div>
    {detailCourse&&<div className="builder"><div className="section-title"><div><h3>محرر: {detailCourse.name}</h3><p>اختَر اليوم، ثم أضف التمارين المطلوبة من المكتبة.</p></div><button className="outline-btn" onClick={()=>setOpenCourseId(null)}>إغلاق</button></div><div className="day-tabs">{detailCourse.days.map((d,i)=><button className={courseDay===i?'active':''} key={i} onClick={()=>setCourseDay(i)}>{d.title}</button>)}</div><label className="field"><span>اسم العضلات أو وصف اليوم</span><input value={detailCourse.days[courseDay]?.muscle||''} onChange={e=>changeCourseDay(detailCourse.id,courseDay,{muscle:e.target.value})}/></label><h4>تمارين اليوم</h4><div className="assigned-list">{detailCourse.days[courseDay]?.exercises.map((id,i)=>{const e=catalog.find(x=>x.id===id);return <div className="assigned-row" key={i}><span>{i+1}. {e?.name||'تمرين محذوف'}</span><button className="icon-button danger" onClick={()=>changeCourseDay(detailCourse.id,courseDay,{exercises:detailCourse.days[courseDay].exercises.filter((_,n)=>i!==n)})}><X size={16}/></button></div>})}</div><div className="add-exercise">{catalog.map(e=><button key={e.id} onClick={()=>changeCourseDay(detailCourse.id,courseDay,{exercises:[...detailCourse.days[courseDay].exercises,e.id]})}><Plus size={14}/> {e.name}</button>)}</div></div>}</section>}
    {portal==='admin'&&view==='library'&&<section className="panel">{sectionTitle('مكتبة التمارين','ابحث حسب العضلة وأضف تمارينك الخاصة',<button className="primary-btn" onClick={()=>openExercise()}><Plus size={16}/> إضافة تمرين</button>)}<div className="toolbar"><label className="search-box"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="ابحث عن تمرين..."/></label><select value={muscle} onChange={e=>setMuscle(e.target.value)}>{['الكل',...new Set(catalog.map(e=>e.muscle))].map(m=><option key={m}>{m}</option>)}</select></div><div className="library-grid">{catalog.filter(e=>(muscle==='الكل'||e.muscle===muscle)&&e.name.includes(query)).map(e=><div className="exercise-card" key={e.id}><div className="exercise-art"><Dumbbell size={27}/></div><div className="exercise-info"><span className="eyebrow">{e.muscle}</span><h3>{e.name}</h3><p>{e.sets} مجموعات · {e.reps} تكرار</p></div><div className="actions"><button className="outline-btn" onClick={()=>setSelectedExercise(e)}><Play size={14}/> شرح / QR</button><button className="icon-button" onClick={()=>openExercise(e)} title="تعديل"><Pencil size={16}/></button><button className="icon-button danger" onClick={()=>{if(confirm('حذف التمرين التجريبي؟'))setCatalog(old=>old.filter(x=>x.id!==e.id))}} title="حذف"><Trash2 size={16}/></button></div></div>)}</div></section>}
    {portal==='admin'&&view==='reports'&&<section className="panel">{sectionTitle('التقارير','إحصائيات مستخرجة من بيانات المعاينة')}<div className="stats-grid"><div className="stat-card"><span>إجمالي المشتركين</span><strong>{members.length}</strong></div><div className="stat-card"><span>مشتركون نشطون</span><strong>{members.filter(m=>m.status==='نشط').length}</strong></div><div className="stat-card"><span>كورسات متاحة</span><strong>{courses.length}</strong></div><div className="stat-card"><span>تمارين مسجلة كمكتملة</span><strong>{Object.values(checks).filter(Boolean).length}</strong></div></div><p className="info-note">لا توجد بيانات مالية أو سجلات تدريب فعلية. هذه المؤشرات تتغير حسب استخدام نسخة المعاينة.</p><button className="outline-btn" onClick={()=>window.print()}><Download size={16}/> طباعة التقرير</button></section>}
    {portal==='admin'&&view==='settings'&&<section className="panel">{sectionTitle('إعدادات العرض','تخصيص الاسم المعروض في نسخة المعاينة')}<form className="settings-form" onSubmit={e=>{e.preventDefault();notice('تم حفظ إعدادات العرض مؤقتاً')}}><label className="field"><span>اسم القاعة / العلامة</span><input value={gymName} onChange={e=>setGymName(e.target.value)} required/></label><label className="field"><span>اسم الكابتن</span><input value={coachName} onChange={e=>setCoachName(e.target.value)} required/></label><button className="primary-btn">حفظ التعديلات</button></form><p className="info-note">تسجيل الدخول الحقيقي، الصلاحيات، وحفظ البيانات بين الأجهزة ستتوفر عند ربط Backend.</p></section>}
    {portal==='member'&&<div className="member-banner"><div><span className="eyebrow">YOUR TRAINING SPACE</span><h2>أهلاً، {currentMember?.name}</h2><p>{currentMember?.plan} · بإشراف {coachName}</p></div><div className="member-switch"><label>معاينة حساب</label><select value={memberId} onChange={e=>{setMemberId(Number(e.target.value));setDayIndex(0)}}>{members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></div></div>}
    {portal==='member'&&memberView==='mycourse'&&<section className="panel">{sectionTitle('جدولي التدريبي','اختر اليوم وشاهد التمارين والتعليمات',<button className="outline-btn" onClick={exportCourse}><Download size={16}/> طباعة</button>)}<div className="day-tabs">{currentCourse?.days.map((d,i)=><button key={i} onClick={()=>setDayIndex(i)} className={dayIndex===i?'active':''}>{d.title}<small>{d.muscle}</small></button>)}</div>{sectionTitle(day?.muscle||'لا يوجد كورس','التمارين المكتملة: '+done+' من '+workout.length)}{renderWorkout()}</section>}
    {portal==='member'&&memberView==='history'&&<section className="panel">{sectionTitle('سجل الإنجاز','التمارين المؤشرة كمكتملة في هذه المعاينة')}<div className="compact-list">{currentCourse?.days.flatMap((d,i)=>d.exercises.filter(id=>checks[memberId+'-'+i+'-'+id]).map(id=>({day:d.title,name:catalog.find(e=>e.id===id)?.name||'تمرين'}))).map((x,i)=><div className="compact-row" key={i}><span className="avatar"><Check size={15}/></span><span><b>{x.name}</b><small>{x.day}</small></span></div>)}{!Object.keys(checks).some(k=>k.startsWith(memberId+'-')&&checks[k])&&<p className="empty">ماكو تمارين مكتملة لحد الآن. افتح كورسي وعلّم التمارين المنجزة.</p>}</div></section>}
    {portal==='member'&&memberView==='profile'&&<section className="panel">{sectionTitle('الملف الشخصي','البيانات المسجلة من قبل الكابتن')}<div className="profile-grid">{[['الاسم',currentMember?.name],['رقم الهاتف',currentMember?.phone],['الهدف',currentMember?.goal],['الطول',currentMember?.height+' سم'],['الوزن',currentMember?.weight+' كغم'],['تاريخ البدء',currentMember?.started],['الكورس',currentMember?.plan],['الحالة',currentMember?.status]].map(([label,value])=><div className="detail-tile" key={label}><span>{label}</span><b>{value}</b></div>)}</div></section>}
   </main>
  </div>
  {selectedMember&&<div className="modal-backdrop" onMouseDown={()=>setSelectedMember(null)}><aside className="drawer" onMouseDown={e=>e.stopPropagation()}><div className="section-title"><h2>ملف المشترك</h2><button className="icon-button" onClick={()=>setSelectedMember(null)}><X size={19}/></button></div><div className="profile-grid">{[['الاسم',selectedMember.name],['الهاتف',selectedMember.phone],['البرنامج',selectedMember.plan],['الهدف',selectedMember.goal],['الوزن',selectedMember.weight+' كغم'],['الطول',selectedMember.height+' سم']].map(([l,v])=><div className="detail-tile" key={l}><span>{l}</span><b>{v}</b></div>)}</div><button className="primary-btn" onClick={()=>{openMember(selectedMember);setSelectedMember(null)}}><Pencil size={16}/> تعديل بياناته</button></aside></div>}
  {selectedExercise&&<div className="modal-backdrop" onMouseDown={()=>setSelectedExercise(null)}><div className="dialog exercise-dialog" onMouseDown={e=>e.stopPropagation()}><div className="section-title"><div><span className="eyebrow">{selectedExercise.muscle}</span><h2>{selectedExercise.name}</h2></div><button className="icon-button" onClick={()=>setSelectedExercise(null)}><X size={19}/></button></div><div className="exercise-detail-grid"><div><p>{selectedExercise.sets} مجموعات · {selectedExercise.reps} تكرار · راحة {selectedExercise.rest} ثانية</p><p className="info-note">راجع أسلوب الأداء مع كابتنك. روابط المكتبة الحالية للبحث عن شروحات وليست فيديوهات تم التحقق منها.</p>{selectedExercise.video&&<a className="primary-btn" href={selectedExercise.video} target="_blank" rel="noopener noreferrer"><Play size={16}/> فتح شرح التمرين</a>}</div><div className="qr-area"><QRCodeSVG value={selectedExercise.video||window.location.origin+window.location.pathname+'#/member'} size={140}/><small>امسح لفتح رابط الشرح</small></div></div></div></div>}
  {dialog&&<div className="modal-backdrop" onMouseDown={()=>setDialog(null)}><div className="dialog" onMouseDown={e=>e.stopPropagation()}><div className="section-title"><h2>{dialog==='member'?(editingMember?'تعديل المشترك':'إضافة مشترك'):dialog==='exercise'?(editingExercise?'تعديل تمرين':'تمرين جديد'):(editingCourse?'تعديل كورس':'كورس جديد')}</h2><button className="icon-button" onClick={()=>setDialog(null)}><X size={19}/></button></div><form key={dialog+'-'+(editingMember?.id||editingExercise?.id||editingCourse?.id||'new')} className="dialog-form" onSubmit={e=>{e.preventDefault();const fd=new FormData(e.currentTarget);if(dialog==='member')saveMember(fd);else if(dialog==='exercise')saveExercise(fd);else saveCourse(fd)}}>
   {dialog==='member'&&<><label className="field"><span>الاسم الكامل *</span><input name="name" defaultValue={editingMember?.name} required/></label><label className="field"><span>الهاتف</span><input name="phone" defaultValue={editingMember?.phone}/></label><label className="field"><span>الهدف</span><input name="goal" defaultValue={editingMember?.goal}/></label><div className="form-grid"><label className="field"><span>الوزن (كغم)</span><input type="number" min="0" name="weight" defaultValue={editingMember?.weight||70}/></label><label className="field"><span>الطول (سم)</span><input type="number" min="0" name="height" defaultValue={editingMember?.height||170}/></label></div><label className="field"><span>الكورس</span><select name="plan" defaultValue={editingMember?.plan}>{courses.map(c=><option key={c.id}>{c.name}</option>)}</select></label><label className="field"><span>حالة الاشتراك</span><select name="status" defaultValue={editingMember?.status||'نشط'}><option>نشط</option><option>ينتهي قريباً</option><option>منتهي</option></select></label></>}
   {dialog==='exercise'&&<><label className="field"><span>اسم التمرين *</span><input name="name" required defaultValue={editingExercise?.name}/></label><label className="field"><span>العضلة</span><select name="muscle" defaultValue={editingExercise?.muscle||'الصدر'}>{['الصدر','الظهر','الأرجل','الأكتاف','البايسبس','الترايسبس','البطن','السمانة','السواعد','كارديو'].map(x=><option key={x}>{x}</option>)}</select></label><div className="form-grid"><label className="field"><span>المجموعات</span><input type="number" min="1" max="20" name="sets" defaultValue={editingExercise?.sets||3}/></label><label className="field"><span>التكرارات</span><input name="reps" defaultValue={editingExercise?.reps||'12'}/></label><label className="field"><span>الوزن كغم</span><input name="weight" defaultValue={editingExercise?.weight||'0'}/></label><label className="field"><span>الراحة بالثواني</span><input name="rest" defaultValue={editingExercise?.rest||'60'}/></label></div><label className="field"><span>رابط الفيديو أو الشرح</span><input name="video" type="url" defaultValue={editingExercise?.video}/></label></>}
   {dialog==='course'&&<><label className="field"><span>اسم الكورس *</span><input name="name" required defaultValue={editingCourse?.name}/></label><label className="field"><span>عدد أيام التدريب (1–7)</span><input type="number" min="1" max="7" name="days" defaultValue={editingCourse?.days.length||3}/></label></>}
   <div className="form-actions"><button className="outline-btn" type="button" onClick={()=>setDialog(null)}>إلغاء</button><button className="primary-btn" type="submit"><Check size={16}/> حفظ</button></div></form></div></div>}
  {alert&&<div className="toast" role="status">{alert}</div>}
 </div>
}
createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>)
