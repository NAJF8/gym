import {useState} from 'react'
import {QRCodeSVG} from 'qrcode.react'
import './course-print.css'
import { safeVideoUrl } from './videoUrl'
type M={id:number;name:string;weight:number;height:number;plan:string}
type E={id:number;name:string;muscle:string;sets:number;reps:string;weight:string;video:string}
type C={id:number;name:string;days:{title:string;muscle:string;exercises:number[]}[]}
export default function CoursePrint({course,members,exercises}:{course:C;members:M[];exercises:E[]}){
 const [memberId,setMemberId]=useState(members[0]?.id||0)
 const [coach,setCoach]=useState('اسم الكابتن')
 const [gym,setGym]=useState('اسم القاعة')
 const [phone,setPhone]=useState('')
 const [instagram,setInstagram]=useState('')
 const [address,setAddress]=useState('')
 const [notes,setNotes]=useState('')
 const [date,setDate]=useState(new Date().toISOString().slice(0,10))
 const [qr,setQr]=useState(false)
 const member=members.find(m=>m.id===memberId)
 const coachPhoto=`${import.meta.env.BASE_URL}assets/coach.webp`
 const hallPhoto=`${import.meta.env.BASE_URL}assets/hall.svg`
 const logo=`${import.meta.env.BASE_URL}assets/logo.webp`
 return <div className="print-feature">
  <div className="print-controls">
   <div className="section-title"><div><h3>تصميم وطباعة الكورس</h3><p>نموذج A4 مشابه للورقة المرجعية، قابل للتخصيص قبل الطباعة.</p></div><button className="primary-btn" onClick={()=>window.print()}>طباعة A4 / حفظ PDF</button></div>
   <div className="print-fields">
    <label>المشترك<select value={memberId} onChange={e=>setMemberId(Number(e.target.value))}>{members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
    <label>التاريخ<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
    <label>اسم القاعة<input value={gym} onChange={e=>setGym(e.target.value)}/></label>
    <label>اسم الكابتن<input value={coach} onChange={e=>setCoach(e.target.value)}/></label>
    <label>الهاتف<input value={phone} onChange={e=>setPhone(e.target.value)}/></label>
    <label>إنستغرام<input value={instagram} onChange={e=>setInstagram(e.target.value)}/></label>
    <label>العنوان<input value={address} onChange={e=>setAddress(e.target.value)}/></label>
    <p className="print-static-assets">صور الكابتن والقاعة ثابتة من Firebase Hosting: {coachPhoto} و {hallPhoto}</p>
    <label className="print-notes">ملاحظات الكابتن<textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="مثلاً: 15 دقيقة مشي بعد التمرين"/></label>
    <label className="print-checkbox"><input type="checkbox" checked={qr} onChange={e=>setQr(e.target.checked)}/> أضف QR لروابط الشرح (قد يزيد عدد صفحات الطباعة)</label>
   </div>
  </div>
  <div className="print-sheet" dir="rtl" style={{backgroundImage:`linear-gradient(rgba(255,255,255,.94),rgba(255,255,255,.94)),url(${hallPhoto})`}}>
   <header className="sheet-header">
    <div className="sheet-profile"><img src={coachPhoto} alt="صورة كابتن افتراضية"/></div>
    <div className="sheet-brand"><img src={logo} alt="شعار القاعة"/><strong>{gym}</strong><strong>{coach}</strong></div>
    <div className="sheet-person"><div><b>الاسم:</b> {member?.name||'—'}</div><div><b>التاريخ:</b> {date}</div><div><b>الوزن:</b> {member?.weight??'—'} كغم</div><div><b>الطول:</b> {member?.height??'—'} سم</div></div>
   </header>
   <div className="sheet-rule"/>
   <h2 className="sheet-title">{course.name}</h2>
   {course.days.map((d,i)=><section className="sheet-day" key={i}>
    <h3>{d.title} <small>{d.muscle}</small></h3>
   <ol>{d.exercises.map((id,j)=>{const ex=exercises.find(e=>e.id===id);const video=ex&&safeVideoUrl(ex.video);return ex?<li key={j}><span className="sheet-exercise">{ex.name}</span><span className="sheet-prescription">{ex.sets} × {ex.reps}{ex.weight&&ex.weight!=='0'?' — '+ex.weight+' كغم':''}</span>{qr&&video&&<QRCodeSVG value={video} size={38}/>}</li>:null})}</ol>
    {!d.exercises.length&&<p className="sheet-empty">لم تتم إضافة تمارين لهذا اليوم.</p>}
   </section>)}
   {notes&&<div className="sheet-notes"><b>ملاحظات الكابتن</b><p>{notes}</p></div>}
   <footer className="sheet-footer"><strong>{coach}</strong><span>{phone}</span><span>{instagram}</span><span>{address}</span></footer>
  </div>
  <p className="print-help">الصور الثابتة لا تُرفع من المتصفح ولا تُحفظ في RTDB.</p>
 </div>
}
