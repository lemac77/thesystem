import { useState, useEffect, useCallback, useRef } from "react";

// ─── STORAGE ──────────────────────────────────────────────────────────────────
const LS = {
  get: (k, d) => { try { const v = localStorage.getItem(k); return v !== null ? JSON.parse(v) : d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
// ─── SUPABASE SYNC ────────────────────────────────────────────────────────────
const getSB = () => {
  try {
    const url = localStorage.getItem("ts_sb_url");
    const key = localStorage.getItem("ts_sb_key");
    if(!url||!key) return null;
    return {url,key};
  } catch { return null; }
};

const sbReq = async (path, opts={}) => {
  const sb = getSB();
  if(!sb) return null;
  try {
    const res = await fetch(`${sb.url}/rest/v1/${path}`, {
      headers: {"apikey":sb.key,"Authorization":`Bearer ${sb.key}`,"Content-Type":"application/json","Prefer":opts.prefer||"return=representation",...(opts.headers||{})},
      method: opts.method||"GET",
      body: opts.body,
    });
    if(!res.ok) return null;
    const t = await res.text();
    return t ? JSON.parse(t) : [];
  } catch { return null; }
};

const DB = {
  upsert: async (table, rows) => {
    if(!rows?.length) return;
    await sbReq(table, {method:"POST", prefer:"return=minimal", headers:{"Prefer":"resolution=merge-duplicates,return=minimal"}, body:JSON.stringify(rows.map(r=>({...r,user_id:"andrea"})))});
  },
  setSetting: async (key, value) => {
    await sbReq("settings", {method:"POST", headers:{"Prefer":"resolution=merge-duplicates,return=minimal"}, body:JSON.stringify({key, value:JSON.stringify(value), user_id:"andrea"})});
  },
  getSetting: async (key, def) => {
    const rows = await sbReq(`settings?key=eq.${encodeURIComponent(key)}&user_id=eq.andrea&select=value`);
    if(!rows?.length) return def;
    try { return JSON.parse(rows[0].value); } catch { return def; }
  },
  getAll: async (table, def=[]) => {
    const rows = await sbReq(`${table}?user_id=eq.andrea`);
    return rows||def;
  },
  pushAll: async (s) => {
    if(!getSB()) return;
    await Promise.allSettled([
      DB.upsert("clients",s.clients), DB.upsert("leads",s.leads),
      DB.upsert("quests",s.quests), DB.upsert("tasks",s.tasks),
      DB.upsert("ideas",s.ideas), DB.upsert("goals",s.goals),
      DB.upsert("notes",s.notes), DB.upsert("payments",s.payments),
      DB.setSetting("workout_log",s.workoutLog), DB.setSetting("diet_log",s.dietLog),
      DB.setSetting("mood_log",s.moodLog), DB.setSetting("weight_log",s.weightLog),
      DB.setSetting("habit_log",s.habitLog), DB.setSetting("habits",s.habits),
      DB.setSetting("slot_days",s.slotDays), DB.setSetting("slot_start",s.slotStart),
      DB.setSetting("last_reset",s.lastReset), DB.setSetting("api_keys",s.apiKeys),
    ]);
  },
  pullAll: async () => {
    if(!getSB()) return null;
    try {
      const [clients,leads,quests,tasks,ideas,goals,notes,payments,
        workoutLog,dietLog,moodLog,weightLog,habitLog,habits,
        slotDays,slotStart,lastReset,apiKeys] = await Promise.all([
        DB.getAll("clients",[]), DB.getAll("leads",[]), DB.getAll("quests",[]),
        DB.getAll("tasks",[]), DB.getAll("ideas",[]), DB.getAll("goals",[]),
        DB.getAll("notes",[]), DB.getAll("payments",[]),
        DB.getSetting("workout_log",{}), DB.getSetting("diet_log",{}),
        DB.getSetting("mood_log",{}), DB.getSetting("weight_log",[]),
        DB.getSetting("habit_log",{}), DB.getSetting("habits",[]),
        DB.getSetting("slot_days",0), DB.getSetting("slot_start",""),
        DB.getSetting("last_reset",""), DB.getSetting("api_keys",{apify:"",anthropic:""}),
      ]);
      return {clients,leads,quests,tasks,ideas,goals,notes,payments,
        workoutLog,dietLog,moodLog,weightLog,habitLog,habits,
        slotDays,slotStart,lastReset,apiKeys};
    } catch { return null; }
  },
};



// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const PROJECT_STAGES = ["Contatto","Proposta","In corso","Revisione","Consegnato","Pagato"];
const LEAD_STAGES = ["Da contattare","Contattato","In trattativa","Perso","Convertito"];
const SECTORS = ["E-commerce","Ristorazione","Professionale","Retail","Fitness","Luxury","Altro"];
const PENALTY = [{e:"Addominali",n:20},{e:"Flessioni",n:15},{e:"Squat",n:25},{e:"Burpees",n:10},{e:"Plank",n:"60 sec"}];
const DEFAULT_FIXED = [
  {id:"f1",text:"Controlla email e rispondi ai clienti",done:false,fixed:true},
  {id:"f2",text:"Almeno 1 outreach a nuovo lead",done:false,fixed:true},
  {id:"f3",text:"Aggiorna lo stato di almeno 1 progetto",done:false,fixed:true},
];
const RANKS = [
  {r:"E",label:"Rookie Hunter",min:0,color:"#6b7280"},
  {r:"D",label:"Iron Hunter",min:100,color:"#cd7f32"},
  {r:"C",label:"Bronze Hunter",min:300,color:"#9ca3af"},
  {r:"B",label:"Silver Hunter",min:600,color:"#60a5fa"},
  {r:"A",label:"Gold Hunter",min:1000,color:"#e2b96f"},
  {r:"S",label:"Shadow Hunter",min:1500,color:"#a855f7"},
];
const MOOD_METRICS = [
  {k:"energia",label:"Energia",icons:["💀","😴","😐","⚡","🔥"]},
  {k:"umore",label:"Umore",icons:["😤","😔","😑","🙂","😄"]},
  {k:"stress",label:"Stress",icons:["🌋","😰","😬","😌","🧘"]},
  {k:"sonno",label:"Sonno",icons:["👻","😵","😪","😴","💤"]},
];
const MOOD_EMOJIS = ["😤","😔","😑","😐","🙂","😄","🤩","🔥","💪","⚡","🧘","😴","🤒","😰","🧠"];
const WORKOUT_TYPES = ["Palestra","Corsa","Ciclismo","Nuoto","Calisthenics","Sport","Altro"];
const FORFETTARIO_CAP = 85000;

const uid = () => Math.random().toString(36).slice(2,10);
const todayStr = () => new Date().toISOString().slice(0,10);
const getRank = xp => { let r=RANKS[0]; for(const x of RANKS){if(xp>=x.min)r=x;} return r; };
const getXP = (clients,leads,quests,tasks=[]) =>
  quests.filter(q=>q.done).length*20 +
  leads.filter(l=>l.stage==="Convertito").length*100 +
  clients.filter(c=>c.stage==="Pagato").length*50 +
  tasks.filter(t=>t.done).length*15;
const fmtEur = n => `€${Number(n||0).toLocaleString("it-IT")}`;

// ─── THEME ───────────────────────────────────────────────────────────────────
const C = {
  bg:"#03030a", panel:"#07071a", panelAlt:"#09091f",
  border:"#14142a", borderHi:"#28285a",
  accent:"#4fc3f7", accentDim:"#0b2030",
  gold:"#e2b96f", goldDim:"#251500",
  danger:"#ef4444", dangerDim:"#1a0505",
  success:"#22c55e", successDim:"#051a0a",
  purple:"#a855f7", orange:"#f97316",
  text:"#ccd6f0", textDim:"#40506a", textMuted:"#1e2a40",
};

// ─── GLOBAL STYLES ────────────────────────────────────────────────────────────
const GS = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700;900&family=Rajdhani:wght@400;500;600;700&family=Share+Tech+Mono&display=swap');
    *{box-sizing:border-box;margin:0;padding:0;}
    body{background:#03030a;overflow-x:hidden;}
    ::-webkit-scrollbar{width:3px;}
    ::-webkit-scrollbar-thumb{background:#28285a;border-radius:2px;}
    input,textarea,select{outline:none;}
    select option{background:#07071a;color:#ccd6f0;}
    @keyframes rpulse{0%,100%{text-shadow:0 0 10px currentColor}50%{text-shadow:0 0 30px currentColor,0 0 60px currentColor}}
    @keyframes fadein{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
    @keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
    .rp{animation:rpulse 2.5s ease-in-out infinite;}
    .fi{animation:fadein 0.22s ease forwards;}
    .blink::after{content:"▋";animation:blink 1s step-end infinite;color:#4fc3f7;}
    @media(max-width:600px){
      body{font-size:14px;}
      input,select,textarea{font-size:16px!important;}
    }
    @media(min-width:768px){
      body{font-size:16px!important;}
      input,select,textarea{font-size:15px!important;}
    }
    @media(min-width:1100px){
      body{font-size:18px!important;}
      input,select,textarea{font-size:16px!important;}
    }
    @media(min-width:1400px){
      body{font-size:20px!important;}
    }
  `}</style>
);

// ─── LAYOUT PRIMITIVES ───────────────────────────────────────────────────────
const Section = ({title, action, subtitle, children}) => (
  <div style={{marginBottom:28}}>
    {(title||action) && (
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:14}}>
        <div>
          {title && <div style={{fontFamily:"'Cinzel',serif",fontSize:15,color:C.accent,letterSpacing:"0.12em",textTransform:"uppercase",lineHeight:1}}>{title}</div>}
          {subtitle && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:8,color:C.textDim,marginTop:5,letterSpacing:"0.08em"}}>{subtitle}</div>}
        </div>
        {action && <div style={{flexShrink:0,marginLeft:12}}>{action}</div>}
      </div>
    )}
    {children}
  </div>
);

const Card = ({children, style={}, glow=false, color=null}) => (
  <div style={{
    background: C.panel,
    border: `1px solid ${glow ? (color||C.borderHi) : C.border}`,
    borderRadius: 10,
    padding: "16px 18px",
    position:"relative",
    overflow:"hidden",
    boxShadow: glow ? `0 0 24px ${(color||C.accent)}0e` : "none",
    ...style
  }}>
    {glow && <div style={{position:"absolute",top:0,left:0,right:0,height:1,background:`linear-gradient(90deg,transparent,${color||C.accent}66,transparent)`}}/>}
    {children}
  </div>
);

const Row = ({children, gap=8, style={}}) => (
  <div style={{display:"flex",gap,alignItems:"center",...style}}>{children}</div>
);

const Grid = ({cols=2, children, gap=8}) => (
  <div style={{display:"grid",gridTemplateColumns:`repeat(${cols},1fr)`,gap}}>{children}</div>
);

const Chip = ({children, color=C.textDim, borderColor}) => (
  <span style={{fontFamily:"'Rajdhani',sans-serif",fontSize:9,color,border:`1px solid ${borderColor||color}`,borderRadius:3,padding:"2px 8px",letterSpacing:"0.08em",textTransform:"uppercase",whiteSpace:"nowrap"}}>{children}</span>
);

const Dot = ({color}) => (
  <div style={{width:6,height:6,borderRadius:"50%",background:color,flexShrink:0,boxShadow:`0 0 5px ${color}88`}}/>
);

// ─── FORM PRIMITIVES ─────────────────────────────────────────────────────────
const Label = ({children, color}) => (
  <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:10,color:color||C.textDim,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:4,fontWeight:600}}>{children}</div>
);

const Input = ({style={},...p}) => (
  <input style={{
    width:"100%",background:"#060612",border:`1px solid ${C.border}`,borderRadius:6,
    color:C.text,padding:"11px 13px",fontSize:13,fontFamily:"'Share Tech Mono',monospace",
    marginBottom:10,transition:"border-color .2s",letterSpacing:"0.02em",...style
  }} onFocus={e=>e.target.style.borderColor=C.borderHi} onBlur={e=>e.target.style.borderColor=C.border} {...p}/>
);

const Select = ({children,style={},...p}) => (
  <select style={{
    width:"100%",background:"#060612",border:`1px solid ${C.border}`,borderRadius:6,
    color:C.text,padding:"9px 12px",fontSize:12,fontFamily:"'Share Tech Mono',monospace",
    marginBottom:10,cursor:"pointer",...style
  }} {...p}>{children}</select>
);

const Textarea = ({style={},...p}) => (
  <textarea style={{
    width:"100%",background:"#060612",border:`1px solid ${C.border}`,borderRadius:6,
    color:C.text,padding:"9px 12px",fontSize:12,fontFamily:"'Share Tech Mono',monospace",
    resize:"vertical",marginBottom:10,lineHeight:1.65,...style
  }} onFocus={e=>e.target.style.borderColor=C.borderHi} onBlur={e=>e.target.style.borderColor=C.border} {...p}/>
);

// ─── BUTTONS ─────────────────────────────────────────────────────────────────
const Btn = ({children, variant="primary", style={}, size="md", ...p}) => {
  const sizes = {sm:"6px 10px",md:"9px 16px",lg:"12px 20px"};
  const variants = {
    primary:{bg:`linear-gradient(135deg,${C.accentDim},#050f18)`,border:C.accent,color:C.accent},
    gold:{bg:`linear-gradient(135deg,${C.goldDim},#0a0700)`,border:C.gold,color:C.gold},
    danger:{bg:"transparent",border:C.border,color:C.textDim},
    ghost:{bg:"transparent",border:C.border,color:C.textDim},
    success:{bg:C.successDim,border:C.success,color:C.success},
  };
  const v = variants[variant]||variants.primary;
  return (
    <button style={{
      background:v.bg,border:`1px solid ${v.border}`,borderRadius:5,color:v.color,
      padding:sizes[size]||sizes.md,cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",
      fontWeight:700,fontSize:size==="sm"?10:12,letterSpacing:"0.1em",textTransform:"uppercase",
      transition:"all .2s",display:"inline-flex",alignItems:"center",gap:5,...style
    }}
    onMouseEnter={e=>{if(variant==="primary")e.currentTarget.style.boxShadow=`0 0 14px ${C.accent}44`;if(variant==="danger"){e.currentTarget.style.borderColor=C.danger;e.currentTarget.style.color=C.danger;}}}
    onMouseLeave={e=>{e.currentTarget.style.boxShadow="";if(variant==="danger"){e.currentTarget.style.borderColor=C.border;e.currentTarget.style.color=C.textDim;}}}
    {...p}>{children}</button>
  );
};

// ─── MODAL ────────────────────────────────────────────────────────────────────
const Modal = ({title, subtitle, onClose, children}) => (
  <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.92)",backdropFilter:"blur(10px)",zIndex:300,display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"10px"}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div style={{background:C.panel,border:`1px solid ${C.borderHi}`,borderRadius:10,width:"100%",maxWidth:520,maxHeight:"calc(100dvh - 20px)",display:"flex",flexDirection:"column",boxShadow:`0 0 40px ${C.accent}10`}} onClick={e=>e.stopPropagation()}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 16px",borderBottom:`1px solid ${C.border}`,flexShrink:0}}>
        <div style={{fontFamily:"'Cinzel',serif",fontSize:12,color:C.accent,letterSpacing:"0.15em",textTransform:"uppercase"}}>{title}</div>
        <button onClick={onClose} style={{background:"none",border:"none",color:C.textDim,cursor:"pointer",fontSize:20,lineHeight:1,padding:"0 2px",flexShrink:0}}>×</button>
      </div>
      <div style={{overflowY:"auto",overflowX:"hidden",padding:"14px 16px 20px",flex:"1 1 auto",minHeight:0}}>{children}</div>
    </div>
  </div>
);

// ─── STAT BOX ─────────────────────────────────────────────────────────────────
const StatBox = ({label, value, sub, color=C.accent, style={}}) => (
  <Card style={style}>
    <Label>{label}</Label>
    <div style={{fontFamily:"'Cinzel',serif",fontSize:26,fontWeight:700,color,lineHeight:1,marginBottom:sub?4:0}}>{value}</div>
    {sub && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:8,color:C.textMuted}}>{sub}</div>}
  </Card>
);

// ─── PROGRESS BAR ─────────────────────────────────────────────────────────────
const ProgressBar = ({pct, color=C.accent, height=5, style={}}) => (
  <div style={{background:C.bg,borderRadius:3,height,border:`1px solid ${C.border}`,overflow:"hidden",...style}}>
    <div style={{width:`${Math.min(pct,100)}%`,height:"100%",background:`linear-gradient(90deg,${color},${color}cc)`,borderRadius:3,transition:"width .6s ease",boxShadow:pct>0?`0 0 6px ${color}66`:"none"}}/>
  </div>
);

// ─── XP BAR ──────────────────────────────────────────────────────────────────
const XPBar = ({xp}) => {
  const rank = getRank(xp);
  const next = RANKS[RANKS.indexOf(rank)+1];
  const pct = next ? Math.round((xp-rank.min)/(next.min-rank.min)*100) : 100;
  return (
    <Card glow style={{marginBottom:16}}>
      <Row style={{justifyContent:"space-between",marginBottom:10}}>
        <div>
          <div style={{fontFamily:"'Cinzel',serif",fontSize:22,fontWeight:900,color:rank.color,lineHeight:1}} className="rp">{rank.r}-Rank</div>
          <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:9,color:C.textDim,letterSpacing:"0.12em",textTransform:"uppercase",marginTop:3}}>{rank.label}</div>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:16,color:C.accent}}>{xp} <span style={{fontSize:8,color:C.textDim}}>XP</span></div>
          {next && <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:8,color:C.textDim,marginTop:2}}>→ {next.r}: {next.min} XP</div>}
        </div>
      </Row>
      <ProgressBar pct={pct} color={rank.color}/>
      <Row style={{justifyContent:"space-between",marginTop:4}}>
        <span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:7,color:C.textMuted}}>{rank.min}</span>
        <span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:7,color:C.textDim}}>{pct}%</span>
        {next && <span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:7,color:C.textMuted}}>{next.min}</span>}
      </Row>
    </Card>
  );
};

// ─── PENALTY MODAL ───────────────────────────────────────────────────────────
const PenaltyModal = ({quest, onClose}) => {
  const [p] = useState(PENALTY[Math.floor(Math.random()*PENALTY.length)]);
  const [done, setDone] = useState(false);
  return (
    <Modal title="Quest Failed — Penalty" onClose={onClose}>
      <div style={{textAlign:"center",padding:"8px 0 4px"}}>
        <div style={{fontFamily:"'Cinzel',serif",fontSize:28,color:C.danger,textShadow:`0 0 20px ${C.danger}`,marginBottom:16}}>FAILED</div>
        <Card style={{marginBottom:14,textAlign:"left"}}><div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:11,color:C.text}}>"{quest.text}"</div></Card>
        <Card glow style={{marginBottom:18,padding:"20px 16px"}}>
          <Label>Physical Penalty</Label>
          <div style={{fontFamily:"'Cinzel',serif",fontSize:48,fontWeight:900,color:C.accent,lineHeight:1}}>{p.n}</div>
          <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:16,color:C.text,fontWeight:700,marginTop:4,letterSpacing:"0.05em"}}>{p.e.toUpperCase()}</div>
          <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:8,color:C.textDim,marginTop:8}}>// execute now. no exceptions.</div>
        </Card>
        {!done
          ? <Btn style={{width:"100%",justifyContent:"center",padding:"13px"}} onClick={()=>setDone(true)}>[ COMPLETED ]</Btn>
          : <>
              <div style={{fontFamily:"'Cinzel',serif",color:C.success,marginBottom:12,fontSize:12}}>Good. Remember this.</div>
              <Btn style={{width:"100%",justifyContent:"center"}} onClick={onClose}>[ CLOSE ]</Btn>
            </>
        }
      </div>
    </Modal>
  );
};

// ─── DASHBOARD ───────────────────────────────────────────────────────────────
const Dashboard = ({clients,leads,quests,tasks,workoutLog,dietLog,moodLog,goals,payments}) => {
  const xp = getXP(clients,leads,quests,tasks);
  const today = todayStr();
  const active = clients.filter(c=>!["Consegnato","Pagato"].includes(c.stage)).length;
  const hot = leads.filter(l=>l.stage==="In trattativa").length;
  const questDone = quests.filter(q=>q.done).length;
  const questPct = quests.length ? Math.round(questDone/quests.length*100) : 0;

  const yearPayments = payments.filter(p=>p.date?.startsWith(new Date().getFullYear().toString()));
  const yearTotal = yearPayments.reduce((s,p)=>s+(parseFloat(p.amount)||0),0);
  const pendingClients = clients.filter(c=>!["Pagato"].includes(c.stage)&&c.income);
  const pendingTotal = pendingClients.reduce((s,c)=>s+(parseFloat(c.income)||0),0);

  const todayMood = moodLog[today];
  const todayWorkout = workoutLog[today];
  const todayDiet = dietLog[today];
  const moodAvg = todayMood?.scores ? (Object.values(todayMood.scores).reduce((a,b)=>a+b,0)/Object.values(todayMood.scores).length).toFixed(1) : null;

  return (
    <div className="fi">
      <XPBar xp={xp}/>

      <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:8,color:C.textMuted,marginBottom:16,letterSpacing:"0.1em"}}>
        // {new Date().toLocaleDateString("it-IT",{weekday:"long",day:"numeric",month:"long","year":"numeric"}).toUpperCase()}
      </div>

      {/* Business */}
      <Section title="Business">
        <Grid cols={3} gap={8} style={{marginBottom:7}}>
          <StatBox label="Clienti" value={active} sub="progetti attivi"/>
          <StatBox label="Lead" value={hot} color={C.gold} sub="in trattativa"/>
          <StatBox label="Quest" value={`${questDone}/${quests.length}`} color={questPct===100?C.success:questPct>50?C.gold:C.danger} sub={`${questPct}% done`}/>
        </Grid>
        <Card>
          <Row style={{justifyContent:"space-between",alignItems:"flex-end"}}>
            <div>
              <Label>Incassato {new Date().getFullYear()}</Label>
              <div style={{fontFamily:"'Cinzel',serif",fontSize:22,color:C.gold,lineHeight:1}}>{fmtEur(yearTotal)}</div>
            </div>
            <div style={{textAlign:"right"}}>
              <Label>Da incassare</Label>
              <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:14,color:pendingTotal>0?C.orange:C.textDim}}>{fmtEur(pendingTotal)}</div>
            </div>
            <div style={{textAlign:"right"}}>
              <Label>Forfettario</Label>
              <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:11,color:yearTotal/FORFETTARIO_CAP>0.8?C.danger:C.success}}>
                {Math.round(yearTotal/FORFETTARIO_CAP*100)}%
              </div>
            </div>
          </Row>
          <ProgressBar pct={yearTotal/FORFETTARIO_CAP*100} color={yearTotal/FORFETTARIO_CAP>0.8?C.danger:C.gold} style={{marginTop:10}}/>
        </Card>
      </Section>

      {/* Oggi */}
      <Section title="Oggi">
        <Grid cols={3} gap={8} style={{marginBottom:7}}>
          <Card style={{textAlign:"center",padding:"12px 8px"}}>
            <div style={{fontSize:22,marginBottom:5}}>{todayWorkout?.done?"💪":"🛋️"}</div>
            <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:8,color:todayWorkout?.done?C.success:C.textDim,letterSpacing:"0.1em",textTransform:"uppercase"}}>{todayWorkout?.done?"Allenato":"No WO"}</div>
            {todayWorkout?.type && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:7,color:C.textMuted,marginTop:2}}>{todayWorkout.type}</div>}
          </Card>
          <Card style={{textAlign:"center",padding:"12px 8px"}}>
            <div style={{fontSize:22,marginBottom:5}}>{todayDiet?.ok===true?"✅":todayDiet?.ok===false?"🍕":"🍽️"}</div>
            <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:8,color:todayDiet?.ok===true?C.success:todayDiet?.ok===false?C.danger:C.textDim,letterSpacing:"0.1em",textTransform:"uppercase"}}>
              {todayDiet?.ok===true?"Dieta ok":todayDiet?.ok===false?"Sgarro":"No log"}
            </div>
            {todayDiet?.cheat && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:7,color:C.textMuted,marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{todayDiet.cheat}</div>}
          </Card>
          <Card style={{textAlign:"center",padding:"12px 8px"}}>
            <div style={{fontSize:22,marginBottom:5}}>{todayMood?.emoji||"❓"}</div>
            <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:8,color:moodAvg>=4?C.success:moodAvg>=3?C.gold:moodAvg?C.danger:C.textDim,letterSpacing:"0.1em",textTransform:"uppercase"}}>
              {moodAvg?`Media ${moodAvg}`:"No check"}
            </div>
          </Card>
        </Grid>
      </Section>

      {/* Goals preview */}
      {goals.filter(g=>!g.done).length > 0 && (
        <Section title="Goals attivi">
          <div style={{display:"flex",flexDirection:"column",gap:7}}>
            {goals.filter(g=>!g.done).slice(0,3).map(g=>{
              const pct = Math.min(Math.round((g.current||0)/(g.target||1)*100),100);
              return (
                <Card key={g.id}>
                  <Row style={{justifyContent:"space-between",marginBottom:7}}>
                    <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:12,color:C.text,fontWeight:600}}>{g.title}</div>
                    <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:10,color:C.accent}}>{pct}%</div>
                  </Row>
                  <ProgressBar pct={pct} color={C.purple}/>
                  {g.target && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:8,color:C.textMuted,marginTop:5}}>{g.current||0} / {g.target} {g.unit||""}</div>}
                </Card>
              );
            })}
          </div>
        </Section>
      )}

      {/* Tasks preview in home */}
      {tasks.filter(t=>!t.done).length > 0 && (
        <Section title="Task da fare">
          <Card>
            <div style={{display:"flex",flexDirection:"column",gap:7}}>
              {tasks.filter(t=>!t.done).slice(0,5).map(t=>(
                <Row key={t.id} gap={10}>
                  <Dot color={C.purple}/>
                  <span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:10,color:C.text,flex:1,lineHeight:1.4}}>{t.text}</span>
                  {t.xp && <Chip color={C.purple}>+{t.xp}xp</Chip>}
                </Row>
              ))}
              {tasks.filter(t=>!t.done).length>5 && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:8,color:C.textMuted}}>+{tasks.filter(t=>!t.done).length-5} altri</div>}
            </div>
          </Card>
        </Section>
      )}

      {/* Alert banners */}
      {(() => {
        const alerts = [];
        const now2 = new Date();
        const ym = `${now2.getFullYear()}-${String(now2.getMonth()+1).padStart(2,"0")}`;
        // Overdue payments
        const overdueLeads = leads.filter(l=>l.stage==="In trattativa").length;
        if(overdueLeads>0) alerts.push({color:C.gold,icon:"💰",msg:`${overdueLeads} lead in trattativa — hai seguito up?`});
        // Quest not done end of day
        const questLeft = quests.filter(q=>!q.done).length;
        if(questLeft>0 && now2.getHours()>=18) alerts.push({color:C.danger,icon:"⚡",msg:`${questLeft} quest non completate — pena in arrivo`});
        // Tasks old >7 days
        const oldTasks = tasks.filter(t=>!t.done&&t.createdAt&&((new Date()-new Date(t.createdAt))/(1000*60*60*24))>7).length;
        if(oldTasks>0) alerts.push({color:C.orange,icon:"📌",msg:`${oldTasks} task aperto da più di 7 giorni`});
        if(alerts.length===0) return null;
        return (
          <div style={{marginBottom:16,display:"flex",flexDirection:"column",gap:6}}>
            {alerts.map((a,i)=>(
              <div key={i} style={{background:`${a.color}11`,border:`1px solid ${a.color}44`,borderRadius:7,padding:"9px 13px",display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:14,flexShrink:0}}>{a.icon}</span>
                <span style={{fontFamily:"'Rajdhani',sans-serif",fontSize:11,color:a.color,fontWeight:600}}>{a.msg}</span>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Quest log */}
      <Section title="Quest Log">
        <Card>
          {quests.length===0 && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:9,color:C.textMuted}}>// no quests assigned</div>}
          <div style={{display:"flex",flexDirection:"column",gap:7}}>
            {quests.map(q=>(
              <Row key={q.id} gap={10}>
                <Dot color={q.done?C.success:C.borderHi}/>
                <span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:10,color:q.done?C.textMuted:C.text,textDecoration:q.done?"line-through":"none",flex:1,lineHeight:1.4}}>{q.text}</span>
                {q.fixed && <Chip color={C.textMuted}>fixed</Chip>}
              </Row>
            ))}
          </div>
        </Card>
      </Section>
    </div>
  );
};


// ─── QUESTS ──────────────────────────────────────────────────────────────────
const QuestsView = ({quests, setQuests, moodLog, anthropicKey, onNeedKey}) => {
  const [newText, setNewText] = useState("");
  const [penalty, setPenalty] = useState(null);
  const [editFixed, setEditFixed] = useState(false);
  const [fixedDraft, setFixedDraft] = useState("");
  const [showAI, setShowAI] = useState(false);
  const [resoconto, setResoconto] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState(null);
  const fixed = quests.filter(q=>q.fixed);
  const variable = quests.filter(q=>!q.fixed);
  const done = quests.filter(q=>q.done).length;
  const pct = quests.length ? Math.round(done/quests.length*100) : 0;
  const toggle = id => setQuests(quests.map(q=>q.id===id?{...q,done:!q.done}:q));
  const addV = () => { if(!newText.trim())return; setQuests([...quests,{id:uid(),text:newText.trim(),done:false,fixed:false}]); setNewText(""); };
  const addF = () => { if(!fixedDraft.trim())return; setQuests([...quests,{id:uid(),text:fixedDraft.trim(),done:false,fixed:true}]); setFixedDraft(""); };

  const today = todayStr();
  const todayMood = moodLog[today];

  const askAI = async () => {
    if(!anthropicKey){onNeedKey();return;}
    setAiLoading(true); setAiSuggestions(null);
    try {
      const moodNote = todayMood?.note||"";
      const moodAvg = todayMood?.scores ? (Object.values(todayMood.scores).reduce((a,b)=>a+b,0)/Object.values(todayMood.scores).length).toFixed(1) : null;
      const prompt = `Sei The System, l'AI di Andrea (freelance web design, Vicenza, Studio Brillo).
Quest attuali:
FISSE: ${fixed.map(q=>q.text).join(" | ")||"nessuna"}
VARIABILI: ${variable.map(q=>q.text).join(" | ")||"nessuna"}
Umore oggi: ${todayMood?.emoji||"N/D"} media ${moodAvg||"N/D"}/5
Nota umore: "${moodNote||"nessuna"}"
Resoconto: "${resoconto||"nessuno"}"

Analizza e suggerisci modifiche CONCRETE. Rispondi SOLO con JSON:
{"analisi":"2-3 frasi su come sta andando","rimuovi":["testo esatto quest da togliere"],"aggiungi_fisse":["nuove quest fisse"],"aggiungi_variabili":["nuove quest per oggi"],"modifica":[{"da":"testo originale","a":"testo nuovo"}]}`;
      const res = await fetch("https://apify-worker.luciettiandrea.workers.dev/anthropic/v1/messages",{method:"POST",headers:{"Content-Type":"application/json","x-api-key":anthropicKey},body:JSON.stringify({model:"claude-sonnet-4-5",max_tokens:600,messages:[{role:"user",content:prompt}]})});
      const d = await res.json();
      const parsed = JSON.parse((d.content?.[0]?.text||"{}").replace(/```json|```/g,"").trim());
      setAiSuggestions(parsed);
    } catch { setAiSuggestions({analisi:"Errore nell'analisi. Riprova.",rimuovi:[],aggiungi_fisse:[],aggiungi_variabili:[],modifica:[]}); }
    finally { setAiLoading(false); }
  };

  const applyAI = () => {
    if(!aiSuggestions) return;
    let updated = [...quests];
    if(aiSuggestions.rimuovi?.length) updated = updated.filter(q=>!aiSuggestions.rimuovi.includes(q.text));
    if(aiSuggestions.modifica?.length) updated = updated.map(q=>{const m=aiSuggestions.modifica.find(x=>x.da===q.text);return m?{...q,text:m.a}:q;});
    if(aiSuggestions.aggiungi_fisse?.length) updated = [...updated,...aiSuggestions.aggiungi_fisse.map(t=>({id:uid(),text:t,done:false,fixed:true}))];
    if(aiSuggestions.aggiungi_variabili?.length) updated = [...updated,...aiSuggestions.aggiungi_variabili.map(t=>({id:uid(),text:t,done:false,fixed:false}))];
    setQuests(updated); setAiSuggestions(null); setShowAI(false); setResoconto("");
  };

  const QRow = ({q, canDel}) => (
    <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:C.bg,border:`1px solid ${q.done?C.success+"55":C.border}`,borderRadius:6,transition:"border-color .2s"}}>
      <button onClick={()=>toggle(q.id)} style={{width:17,height:17,borderRadius:3,border:`1px solid ${q.done?C.success:C.borderHi}`,background:q.done?C.success:"transparent",cursor:"pointer",flexShrink:0,fontSize:9,color:C.bg,display:"flex",alignItems:"center",justifyContent:"center",transition:"all .2s"}}>
        {q.done&&"✓"}
      </button>
      <span style={{flex:1,fontFamily:"'Share Tech Mono',monospace",fontSize:10,color:q.done?C.textDim:C.text,textDecoration:q.done?"line-through":"none",lineHeight:1.4}}>{q.text}</span>
      {!q.done && <button onClick={()=>setPenalty(q)} style={{background:"none",border:`1px solid ${C.border}`,borderRadius:3,color:C.danger,cursor:"pointer",fontSize:8,fontFamily:"'Rajdhani',sans-serif",padding:"2px 6px",opacity:.8}}>FAIL</button>}
      {canDel && <button onClick={()=>setQuests(quests.filter(x=>x.id!==q.id))} style={{background:"none",border:"none",color:C.textMuted,cursor:"pointer",fontSize:15,lineHeight:1,padding:"0 2px"}}>×</button>}
    </div>
  );

  return (
    <div className="fi">
      <Section title="Daily Quests" action={
        <Row gap={6}>
          {pct===100 && <Chip color={C.success} borderColor={C.success}>ALL CLEAR ✦</Chip>}
          <Btn size="sm" variant="gold" onClick={()=>setShowAI(!showAI)}>⚡ AI Quest</Btn>
        </Row>
      }>
        <Card glow style={{marginBottom:16}}>
          <Row style={{justifyContent:"space-between",marginBottom:8}}>
            <span style={{fontFamily:"'Rajdhani',sans-serif",fontSize:9,color:C.textDim,letterSpacing:"0.15em",textTransform:"uppercase"}}>Progress</span>
            <span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:10,color:pct===100?C.success:pct>50?C.gold:C.danger}}>{done}/{quests.length} — {pct}%</span>
          </Row>
          <ProgressBar pct={pct} color={pct===100?C.success:pct>50?C.gold:C.danger} height={6}/>
        </Card>

        {showAI && (
          <Card style={{marginBottom:16,borderColor:C.gold+"55",background:`${C.goldDim}88`}}>
            <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:9,color:C.gold,letterSpacing:"0.15em",textTransform:"uppercase",marginBottom:10}}>⚡ The System — Analisi Quest</div>
            {todayMood && (
              <div style={{background:C.bg,borderRadius:4,padding:"6px 10px",marginBottom:10,fontFamily:"'Share Tech Mono',monospace",fontSize:8,color:C.textDim}}>
                Umore letto: {todayMood.emoji||"—"} {todayMood.note?`"${todayMood.note.slice(0,50)}..."`:""} 
              </div>
            )}
            <Label>Resoconto libero (opzionale)</Label>
            <Textarea value={resoconto} onChange={e=>setResoconto(e.target.value)} placeholder="Com'è andata? Hai procrastinato? Cosa ti ha bloccato? Sei stato in forma? Scrivi quello che vuoi..." style={{minHeight:70,marginBottom:10}}/>
            <Btn variant="gold" style={{width:"100%",justifyContent:"center",opacity:aiLoading?.6:1}} onClick={askAI} disabled={aiLoading}>
              {aiLoading?"[ Analisi in corso... ]":"[ ANALIZZA E SUGGERISCI ]"}
            </Btn>
            {aiSuggestions && (
              <div style={{marginTop:14}}>
                <div style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:5,padding:12,marginBottom:12}}>
                  <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:9,color:C.gold,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:6}}>Analisi</div>
                  <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:12,color:C.text,lineHeight:1.6}}>{aiSuggestions.analisi}</div>
                </div>
                {aiSuggestions.rimuovi?.length>0 && (
                  <div style={{marginBottom:7}}>
                    <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:8,color:C.danger,letterSpacing:"0.1em",marginBottom:5}}>— DA RIMUOVERE</div>
                    {aiSuggestions.rimuovi.map((t,i)=><div key={i} style={{fontFamily:"'Share Tech Mono',monospace",fontSize:9,color:C.textDim,padding:"4px 8px",background:C.dangerDim,borderRadius:3,marginBottom:3}}>{t}</div>)}
                  </div>
                )}
                {aiSuggestions.modifica?.length>0 && (
                  <div style={{marginBottom:7}}>
                    <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:8,color:C.orange,letterSpacing:"0.1em",marginBottom:5}}>~ DA MODIFICARE</div>
                    {aiSuggestions.modifica.map((m,i)=><div key={i} style={{fontFamily:"'Share Tech Mono',monospace",fontSize:8,color:C.textDim,padding:"4px 8px",background:C.bg,border:`1px solid ${C.border}`,borderRadius:3,marginBottom:3}}>"{m.da}" → "{m.a}"</div>)}
                  </div>
                )}
                {(aiSuggestions.aggiungi_fisse?.length>0||aiSuggestions.aggiungi_variabili?.length>0) && (
                  <div style={{marginBottom:12}}>
                    <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:8,color:C.success,letterSpacing:"0.1em",marginBottom:5}}>+ DA AGGIUNGERE</div>
                    {[...(aiSuggestions.aggiungi_fisse||[]).map(t=>({t,f:true})),...(aiSuggestions.aggiungi_variabili||[]).map(t=>({t,f:false}))].map(({t,f},i)=>(
                      <div key={i} style={{fontFamily:"'Share Tech Mono',monospace",fontSize:9,color:C.text,padding:"4px 8px",background:C.successDim,borderRadius:3,marginBottom:3}}>
                        {t} <span style={{color:C.textMuted,fontSize:7}}>{f?"[fixed]":"[oggi]"}</span>
                      </div>
                    ))}
                  </div>
                )}
                <Row gap={8}>
                  <Btn variant="ghost" size="sm" style={{flex:1,justifyContent:"center"}} onClick={()=>setAiSuggestions(null)}>Annulla</Btn>
                  <Btn variant="gold" size="sm" style={{flex:2,justifyContent:"center"}} onClick={applyAI}>[ APPLICA ]</Btn>
                </Row>
              </div>
            )}
          </Card>
        )}

        <div style={{marginBottom:20}}>
          <Row style={{justifyContent:"space-between",marginBottom:10}}>
            <Label>🔒 Fixed</Label>
            <Btn variant="ghost" size="sm" onClick={()=>setEditFixed(!editFixed)}>{editFixed?"DONE":"MANAGE"}</Btn>
          </Row>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {fixed.map(q=><QRow key={q.id} q={q} canDel={editFixed}/>)}
          </div>
          {editFixed && (
            <Row gap={6} style={{marginTop:8}}>
              <Input style={{marginBottom:0,flex:1,fontSize:11}} value={fixedDraft} onChange={e=>setFixedDraft(e.target.value)} placeholder="New fixed quest..." onKeyDown={e=>e.key==="Enter"&&addF()}/>
              <Btn size="sm" onClick={addF}>+</Btn>
            </Row>
          )}
        </div>
        <div>
          <Label style={{marginBottom:10}}>📌 Variable</Label>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {variable.map(q=><QRow key={q.id} q={q} canDel={true}/>)}
          </div>
          <Row gap={6} style={{marginTop:8}}>
            <Input style={{marginBottom:0,flex:1,fontSize:11}} value={newText} onChange={e=>setNewText(e.target.value)} placeholder="Add today's quest..." onKeyDown={e=>e.key==="Enter"&&addV()}/>
            <Btn size="sm" onClick={addV}>+</Btn>
          </Row>
        </div>
      </Section>
      {penalty && <PenaltyModal quest={penalty} onClose={()=>setPenalty(null)}/>}
    </div>
  );
};

// ─── CLIENTS ─────────────────────────────────────────────────────────────────
// Client schema:
// { id, name, contact, sector, stage, type: "ricorrente"|"spot",
//   monthlyFee (se ricorrente),
//   installments: [{id, amount, dueDate, label}] (se spot),
//   notes, createdAt }

const EMPTY_FORM = {name:"",contact:"",sector:"Altro",stage:"In corso",type:"ricorrente",monthlyFee:"",installments:[],notes:""};

const ClientsView = ({clients, setClients}) => {
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [instForm, setInstForm] = useState({amount:"",dueDate:"",label:""});

  const [search, setSearch] = useState("");
  const [logClient, setLogClient] = useState(null);
  const [logText, setLogText] = useState("");
  const addLog = () => { if(!logText.trim()||!logClient) return; setClients(clients.map(c=>c.id===logClient.id?{...c,activityLog:[...(c.activityLog||[]),{id:uid(),date:todayStr(),text:logText.trim()}]}:c)); setLogText(""); setLogClient(null); };
  const open = c => {
    setEditing(c?c.id:null);
    setForm(c ? {
      name:c.name||"", contact:c.contact||"", sector:c.sector||"Altro",
      stage:c.stage||"In corso", type:c.type||"ricorrente",
      monthlyFee:c.monthlyFee||"", installments:c.installments||[], notes:c.notes||""
    } : EMPTY_FORM);
    setModal(true);
  };

  const saveC = () => {
    if(!form.name.trim()) return;
    const client = {
      ...form,
      installments: form.type==="spot" ? form.installments : [],
      monthlyFee: form.type==="ricorrente" ? form.monthlyFee : "",
    };
    if(editing) setClients(clients.map(c=>c.id===editing?{...c,...client}:c));
    else setClients([...clients,{id:uid(),...client,createdAt:todayStr()}]);
    setModal(false);
  };

  const addInst = () => {
    if(!instForm.amount||!instForm.dueDate) return;
    setForm({...form, installments:[...form.installments,{id:uid(),...instForm}]});
    setInstForm({amount:"",dueDate:"",label:""});
  };

  const typeColor = {ricorrente:C.accent, spot:C.gold};
  const sc = {"Contatto":C.textDim,"Proposta":C.gold,"In corso":C.accent,"Revisione":C.purple,"Consegnato":C.success,"Pagato":C.success};

  return (
    <div className="fi">
      <Section title="Clienti" action={<Btn size="sm" onClick={()=>open(null)}>+ Nuovo</Btn>}>
        {clients.length===0 && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:9,color:C.textMuted,padding:"24px 0",textAlign:"center"}}>// Nessun cliente ancora.</div>}
        {/* Search */}
        <Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Cerca cliente..." style={{marginBottom:10}}/>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {clients.filter(c=>!search||c.name.toLowerCase().includes(search.toLowerCase())||c.contact?.toLowerCase().includes(search.toLowerCase())).map(c=>(
            <Card key={c.id}>
              <Row style={{alignItems:"flex-start",justifyContent:"space-between"}}>
                <div style={{flex:1,minWidth:0}}>
                  <Row gap={8} style={{marginBottom:5,flexWrap:"wrap"}}>
                    <span style={{fontFamily:"'Rajdhani',sans-serif",fontWeight:700,color:C.text,fontSize:14}}>{c.name}</span>
                    <Chip color={typeColor[c.type]||C.textDim} borderColor={typeColor[c.type]||C.border}>{c.type||"spot"}</Chip>
                    <Chip color={sc[c.stage]||C.textDim} borderColor={sc[c.stage]||C.border}>{c.stage}</Chip>
                  </Row>
                  <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:9,color:C.textDim,marginBottom:4}}>{c.contact} · {c.sector}</div>
                  {c.type==="ricorrente" && c.monthlyFee && (
                    <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:10,color:C.accent}}>{fmtEur(c.monthlyFee)}<span style={{fontSize:8,color:C.textDim}}>/mese</span></div>
                  )}
                  {c.type==="spot" && c.installments?.length>0 && (
                    <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:9,color:C.gold}}>{c.installments.length} rata{c.installments.length>1?"e":""} — tot. {fmtEur(c.installments.reduce((s,i)=>s+(parseFloat(i.amount)||0),0))}</div>
                  )}
                  {c.notes && <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:10,color:C.textMuted,marginTop:3,fontStyle:"italic"}}>{c.notes}</div>}
                  {/* Activity log preview */}
                  {(c.activityLog||[]).length>0 && (
                    <div style={{marginTop:6,borderTop:`1px solid ${C.border}`,paddingTop:6}}>
                      <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:7,color:C.textMuted,marginBottom:3}}>Ultimo contatto: {(c.activityLog||[]).slice(-1)[0]?.date} — {(c.activityLog||[]).slice(-1)[0]?.text}</div>
                    </div>
                  )}
                </div>
                <Row gap={5} style={{flexShrink:0}}>
                  <button onClick={()=>setLogClient(c)} style={{background:"none",border:`1px solid ${C.border}`,borderRadius:4,color:C.textDim,cursor:"pointer",padding:"3px 7px",fontSize:8,fontFamily:"'Rajdhani',sans-serif"}}>Log</button>
                  <Btn variant="ghost" size="sm" onClick={()=>open(c)}>Edit</Btn>
                  <Btn variant="danger" size="sm" onClick={()=>setClients(clients.filter(x=>x.id!==c.id))}>Del</Btn>
                </Row>
              </Row>
            </Card>
          ))}
        </div>
      </Section>

      {logClient && (
        <Modal title={`Log attività — ${logClient.name}`} onClose={()=>setLogClient(null)}>
          <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:12,maxHeight:180,overflowY:"auto"}}>
            {(logClient.activityLog||[]).length===0 && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:9,color:C.textMuted}}>// Nessuna attività registrata.</div>}
            {[...(clients.find(c=>c.id===logClient.id)?.activityLog||[])].reverse().map(a=>(
              <div key={a.id} style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:5,padding:"7px 10px"}}>
                <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:7,color:C.textMuted,marginBottom:2}}>{a.date}</div>
                <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:12,color:C.text}}>{a.text}</div>
              </div>
            ))}
          </div>
          <Label>Nuova nota</Label>
          <Textarea value={logText} onChange={e=>setLogText(e.target.value)} placeholder="Es. Chiamata fatta, inviato preventivo, riunione..." style={{minHeight:55,marginBottom:8}}/>
          <Row gap={8}>
            <Btn variant="ghost" style={{flex:1,justifyContent:"center"}} onClick={()=>setLogClient(null)}>Chiudi</Btn>
            <Btn style={{flex:2,justifyContent:"center"}} onClick={addLog}>[ AGGIUNGI ]</Btn>
          </Row>
        </Modal>
      )}
      {modal && (
        <Modal title={editing?"Modifica Cliente":"Nuovo Cliente"} onClose={()=>setModal(false)}>
          <Grid cols={2} gap={8}>
            <div><Label>Nome</Label><Input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Es. Vitamin Store"/></div>
            <div><Label>Contatto</Label><Input value={form.contact} onChange={e=>setForm({...form,contact:e.target.value})} placeholder="email / tel"/></div>
          </Grid>
          <Grid cols={2} gap={8}>
            <div><Label>Settore</Label><Select value={form.sector} onChange={e=>setForm({...form,sector:e.target.value})}>{SECTORS.map(s=><option key={s}>{s}</option>)}</Select></div>
            <div><Label>Fase</Label><Select value={form.stage} onChange={e=>setForm({...form,stage:e.target.value})}>{PROJECT_STAGES.map(s=><option key={s}>{s}</option>)}</Select></div>
          </Grid>

          {/* Tipo pagamento */}
          <Label>Tipo pagamento</Label>
          <Grid cols={2} gap={8} style={{marginBottom:12}}>
            <button onClick={()=>setForm({...form,type:"ricorrente"})} style={{background:form.type==="ricorrente"?`${C.accent}18`:C.bg,border:`2px solid ${form.type==="ricorrente"?C.accent:C.border}`,borderRadius:7,color:form.type==="ricorrente"?C.accent:C.textDim,padding:"10px 8px",cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",fontWeight:700,fontSize:11,textTransform:"uppercase",transition:"all .2s",textAlign:"center"}}>
              🔄 Ricorrente<div style={{fontSize:8,fontWeight:400,marginTop:2,opacity:.7}}>canone mensile fisso</div>
            </button>
            <button onClick={()=>setForm({...form,type:"spot"})} style={{background:form.type==="spot"?`${C.gold}18`:C.bg,border:`2px solid ${form.type==="spot"?C.gold:C.border}`,borderRadius:7,color:form.type==="spot"?C.gold:C.textDim,padding:"10px 8px",cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",fontWeight:700,fontSize:11,textTransform:"uppercase",transition:"all .2s",textAlign:"center"}}>
              ⚡ Spot<div style={{fontSize:8,fontWeight:400,marginTop:2,opacity:.7}}>una tantum o a rate</div>
            </button>
          </Grid>

          {form.type==="ricorrente" && (
            <>
              <Label>Canone mensile (€)</Label>
              <Input type="number" value={form.monthlyFee} onChange={e=>setForm({...form,monthlyFee:e.target.value})} placeholder="Es. 300"/>
            </>
          )}

          {form.type==="spot" && (
            <>
              <Label>Rate / Scadenze</Label>
              {form.installments.map((inst,i)=>(
                <Row key={inst.id} gap={6} style={{marginBottom:6,background:C.bg,border:`1px solid ${C.border}`,borderRadius:5,padding:"7px 10px"}}>
                  <div style={{flex:1}}>
                    <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:10,color:C.gold}}>{fmtEur(inst.amount)}</div>
                    <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:8,color:C.textDim}}>{inst.dueDate} {inst.label?`— ${inst.label}`:""}</div>
                  </div>
                  <button onClick={()=>setForm({...form,installments:form.installments.filter(x=>x.id!==inst.id)})} style={{background:"none",border:"none",color:C.textMuted,cursor:"pointer",fontSize:15}}>×</button>
                </Row>
              ))}
              <div style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:6,padding:10,marginBottom:10}}>
                <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:8,color:C.textDim,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8}}>+ Aggiungi rata</div>
                <Grid cols={2} gap={6}>
                  <div><Label>Importo €</Label><Input type="number" value={instForm.amount} onChange={e=>setInstForm({...instForm,amount:e.target.value})} placeholder="Es. 500" style={{marginBottom:6}}/></div>
                  <div><Label>Scadenza</Label><Input type="date" value={instForm.dueDate} onChange={e=>setInstForm({...instForm,dueDate:e.target.value})} style={{marginBottom:6}}/></div>
                </Grid>
                <Input value={instForm.label} onChange={e=>setInstForm({...instForm,label:e.target.value})} placeholder="Es. Acconto, Saldo, Rata 1..." style={{marginBottom:6}}/>
                <Btn size="sm" style={{width:"100%",justifyContent:"center"}} onClick={addInst}>+ Aggiungi</Btn>
              </div>
            </>
          )}

          <Label>Note</Label>
          <Textarea value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} style={{minHeight:40,marginBottom:10}}/>
          <Row gap={8}>
            <Btn variant="ghost" style={{flex:1,justifyContent:"center"}} onClick={()=>setModal(false)}>Annulla</Btn>
            <Btn style={{flex:2,justifyContent:"center"}} onClick={saveC}>{editing?"[ SALVA ]":"[ AGGIUNGI ]"}</Btn>
          </Row>
        </Modal>
      )}
    </div>
  );
};

// ─── FINANCE ─────────────────────────────────────────────────────────────────
const FinanceView = ({clients, payments, setPayments}) => {
  const now = new Date();
  const todayISO = todayStr();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  const thisYear = String(now.getFullYear());
  const monthName = now.toLocaleDateString("it-IT",{month:"long",year:"numeric"});

  // Build ALL expected payments from clients (past + present + future)
  const allExpected = [];
  clients.forEach(c => {
    if(c.type==="ricorrente" && c.monthlyFee) {
      // Generate for every month from createdAt to 12 months ahead
      const start = new Date(c.createdAt||todayISO);
      for(let i=0; i<24; i++) {
        const d = new Date(start.getFullYear(), start.getMonth()+i, 1);
        const ym = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
        if(d.getFullYear() > now.getFullYear()+1) break;
        const mn = d.toLocaleDateString("it-IT",{month:"long",year:"numeric"});
        allExpected.push({
          id:`exp-${c.id}-${ym}`,
          clientId:c.id, clientName:c.name,
          amount:parseFloat(c.monthlyFee)||0,
          label:`Canone ${mn}`, type:"ricorrente",
          dueDate:`${ym}-01`, month:ym,
        });
      }
    }
    if(c.type==="spot" && c.installments?.length) {
      c.installments.forEach(inst => {
        const ym = inst.dueDate?.slice(0,7)||thisMonth;
        allExpected.push({
          id:`exp-${c.id}-${inst.id}`,
          clientId:c.id, clientName:c.name,
          amount:parseFloat(inst.amount)||0,
          label:inst.label||"Rata", type:"spot",
          dueDate:inst.dueDate, month:ym, instId:inst.id,
        });
      });
    }
  });

  const isReceived = (expId) => payments.some(p=>p.expectedId===expId);
  const markReceived = (exp) => {
    if(isReceived(exp.id)) return;
    setPayments([...payments,{id:uid(),expectedId:exp.id,clientId:exp.clientId,amount:exp.amount,date:todayISO,note:exp.label}]);
  };
  const unmark = (expId) => setPayments(payments.filter(p=>p.expectedId!==expId));

  // This month expected
  const thisMonthExp = allExpected.filter(e=>e.month===thisMonth);
  const monthExpectedTotal = thisMonthExp.reduce((s,e)=>s+e.amount,0);
  const monthReceivedTotal = thisMonthExp.filter(e=>isReceived(e.id)).reduce((s,e)=>s+e.amount,0);

  // Overdue = past months, not received
  const overdue = allExpected.filter(e=>e.month<thisMonth);
  const overdueTotal = overdue.reduce((s,e)=>s+e.amount,0);

  // Future = next months
  const future = allExpected.filter(e=>e.month>thisMonth);

  // Manual payments
  const manualPayments = payments.filter(p=>!p.expectedId);
  const yearPayments = payments.filter(p=>p.date?.startsWith(thisYear));
  const yearTotal = yearPayments.reduce((s,p)=>s+(parseFloat(p.amount)||0),0);
  const forfPct = Math.min(Math.round(yearTotal/FORFETTARIO_CAP*100),100);

  const [manualModal, setManualModal] = useState(false);
  const [manualForm, setManualForm] = useState({clientId:"",amount:"",date:todayISO,note:""});
  const saveManual = () => {
    if(!manualForm.amount) return;
    setPayments([...payments,{id:uid(),...manualForm}]);
    setManualModal(false);
    setManualForm({clientId:"",amount:"",date:todayISO,note:""});
  };

  // Payment row component
  const PayRow = ({exp}) => {
    const received = isReceived(exp.id);
    const isPast = exp.dueDate < todayISO;
    const borderCol = received ? C.success+"66" : isPast ? C.orange+"66" : C.border;
    const bgCol = received ? `${C.success}0a` : isPast ? `${C.orange}08` : C.panel;
    const amtCol = received ? C.success : isPast ? C.orange : C.gold;
    return (
      <div style={{background:bgCol,border:`1px solid ${borderCol}`,borderRadius:8,padding:"11px 14px",display:"flex",alignItems:"center",gap:10,transition:"all .3s"}}>
        {/* Status dot */}
        <div style={{width:8,height:8,borderRadius:"50%",background:received?C.success:isPast?C.orange:C.textDim,flexShrink:0,boxShadow:received?`0 0 6px ${C.success}`:isPast?`0 0 6px ${C.orange}`:""}}/>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontFamily:"'Rajdhani',sans-serif",fontWeight:700,color:received?C.success:C.text,fontSize:13}}>{exp.clientName}</div>
          <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:8,color:C.textDim}}>{exp.label} · {exp.dueDate}</div>
        </div>
        <div style={{fontFamily:"'Cinzel',serif",fontSize:14,color:amtCol,fontWeight:700,flexShrink:0}}>{fmtEur(exp.amount)}</div>
        {!received
          ? <button onClick={()=>markReceived(exp)} style={{background:isPast?`${C.orange}18`:C.successDim,border:`1px solid ${isPast?C.orange:C.success}`,borderRadius:5,color:isPast?C.orange:C.success,cursor:"pointer",fontSize:9,padding:"5px 9px",fontFamily:"'Rajdhani',sans-serif",fontWeight:700,letterSpacing:"0.05em",flexShrink:0,textTransform:"uppercase"}}>
              ✓ Ricevuto
            </button>
          : <button onClick={()=>unmark(exp.id)} style={{background:"none",border:`1px solid ${C.success}44`,borderRadius:4,color:C.success,cursor:"pointer",fontSize:8,padding:"4px 8px",fontFamily:"'Rajdhani',sans-serif",flexShrink:0}}>✓ Annulla</button>
        }
      </div>
    );
  };

  return (
    <div className="fi">
      {/* Header stats */}
      <Section title="Finanze" action={<Btn size="sm" variant="gold" onClick={()=>setManualModal(true)}>+ Extra</Btn>}>
        <Card glow color={forfPct>80?C.danger:C.gold} style={{marginBottom:14}}>
          <Grid cols={3} gap={10} style={{marginBottom:10}}>
            <div>
              <Label>Incassato {thisYear}</Label>
              <div style={{fontFamily:"'Cinzel',serif",fontSize:17,color:C.gold,lineHeight:1}}>{fmtEur(yearTotal)}</div>
            </div>
            <div>
              <Label>Questo mese</Label>
              <div style={{fontFamily:"'Cinzel',serif",fontSize:17,color:C.accent,lineHeight:1}}>{fmtEur(monthReceivedTotal)}<span style={{fontSize:9,color:C.textDim}}>/{fmtEur(monthExpectedTotal)}</span></div>
            </div>
            <div>
              <Label>Forfettario</Label>
              <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:14,color:forfPct>80?C.danger:forfPct>60?C.gold:C.success}}>{forfPct}%</div>
            </div>
          </Grid>
          <ProgressBar pct={forfPct} color={forfPct>80?C.danger:C.gold} height={5}/>
          <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:7,color:C.textMuted,marginTop:5}}>{fmtEur(yearTotal)} / {fmtEur(FORFETTARIO_CAP)} — rimangono {fmtEur(FORFETTARIO_CAP-yearTotal)}</div>
        </Card>

        {/* Overdue — pagamenti scaduti non ricevuti */}
        {overdue.filter(e=>!isReceived(e.id)).length>0 && (
          <div style={{marginBottom:20}}>
            <Row gap={8} style={{marginBottom:10}}>
              <div style={{width:8,height:8,borderRadius:"50%",background:C.orange,boxShadow:`0 0 6px ${C.orange}`,flexShrink:0}}/>
              <div style={{fontFamily:"'Cinzel',serif",fontSize:11,color:C.orange,letterSpacing:"0.12em",textTransform:"uppercase"}}>In sospeso — {fmtEur(overdueTotal)}</div>
            </Row>
            <div style={{display:"flex",flexDirection:"column",gap:7}}>
              {overdue.filter(e=>!isReceived(e.id)).sort((a,b)=>a.dueDate.localeCompare(b.dueDate)).map(exp=><PayRow key={exp.id} exp={exp}/>)}
            </div>
          </div>
        )}

        {/* Questo mese */}
        <div style={{marginBottom:20}}>
          <div style={{fontFamily:"'Cinzel',serif",fontSize:11,color:C.accent,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:10}}>
            {monthName}
          </div>
          {thisMonthExp.length===0
            ? <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:9,color:C.textMuted,padding:"10px 0"}}>// Nessun pagamento atteso questo mese.</div>
            : <div style={{display:"flex",flexDirection:"column",gap:7}}>{thisMonthExp.filter(e=>!isReceived(e.id)).map(exp=><PayRow key={exp.id} exp={exp}/>)}</div>
          }
        </div>

        {/* Prossimi mesi */}
        {future.length>0 && (
          <div style={{marginBottom:20}}>
            <div style={{fontFamily:"'Cinzel',serif",fontSize:11,color:C.textDim,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:10}}>Prossimi mesi</div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {future.slice(0,6).map(exp=>(
                <div key={exp.id} style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:7,padding:"9px 14px",display:"flex",alignItems:"center",gap:10,opacity:.7}}>
                  <div style={{flex:1}}>
                    <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:12,color:C.textDim,fontWeight:600}}>{exp.clientName}</div>
                    <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:8,color:C.textMuted}}>{exp.label} · {exp.dueDate}</div>
                  </div>
                  <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:11,color:C.textDim,flexShrink:0}}>{fmtEur(exp.amount)}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Storico ricevuti anno corrente */}
        {(() => {
          const received = payments.filter(p=>p.date?.startsWith(thisYear));
          if(received.length===0) return null;
          return (
            <div>
              <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:9,color:C.textDim,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:8}}>Storico incassato {thisYear}</div>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {[...received].sort((a,b)=>b.date.localeCompare(a.date)).map(p=>(
                  <Row key={p.id} style={{background:C.successDim,border:`1px solid ${C.success}33`,borderRadius:6,padding:"9px 12px",justifyContent:"space-between"}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:12,color:C.text,fontWeight:600}}>
                        {clients.find(c=>c.id===p.clientId)?.name||"Entrata"}
                      </div>
                      {p.note && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:8,color:C.textDim}}>{p.note}</div>}
                      <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:7,color:C.textMuted}}>{p.date}</div>
                    </div>
                    <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:12,color:C.success,flexShrink:0,marginRight:6}}>{fmtEur(p.amount)}</div>
                    <button onClick={()=>setPayments(payments.filter(x=>x.id!==p.id))} style={{background:"none",border:"none",color:C.textMuted,cursor:"pointer",fontSize:14}}>×</button>
                  </Row>
                ))}
              </div>
            </div>
          );
        })()}
      </Section>

      {manualModal && (
        <Modal title="Entrata Extra" onClose={()=>setManualModal(false)}>
          <Label>Cliente (opz.)</Label>
          <Select value={manualForm.clientId} onChange={e=>setManualForm({...manualForm,clientId:e.target.value})}>
            <option value="">Nessuno / Altro</option>
            {clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Label>Importo (€)</Label><Input type="number" value={manualForm.amount} onChange={e=>setManualForm({...manualForm,amount:e.target.value})} placeholder="Es. 500"/>
          <Label>Data</Label><Input type="date" value={manualForm.date} onChange={e=>setManualForm({...manualForm,date:e.target.value})}/>
          <Label>Descrizione</Label><Input value={manualForm.note} onChange={e=>setManualForm({...manualForm,note:e.target.value})} placeholder="Es. consulenza extra..."/>
          <Row gap={8}>
            <Btn variant="ghost" style={{flex:1,justifyContent:"center"}} onClick={()=>setManualModal(false)}>Annulla</Btn>
            <Btn variant="gold" style={{flex:2,justifyContent:"center"}} onClick={saveManual}>[ REGISTRA ]</Btn>
          </Row>
        </Modal>
      )}
    </div>
  );
};


// ─── LEADS ───────────────────────────────────────────────────────────────────
const LeadsView = ({leads, setLeads, apiKeys={}, onNeedKey=()=>{}}) => {
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({name:"",contact:"",sector:"Altro",stage:"Da contattare",source:"",website:"",notes:""});
  const open = l => { setEditing(l?l.id:null); setForm(l?{name:l.name||"",contact:l.contact||"",sector:l.sector||"Altro",stage:l.stage||"Da contattare",source:l.source||"",website:l.website||"",notes:l.notes||""}:{name:"",contact:"",sector:"Altro",stage:"Da contattare",source:"",website:"",notes:""}); setModal(true); };
  const saveL = () => { if(!form.name.trim())return; editing?setLeads(leads.map(l=>l.id===editing?{...l,...form}:l)):setLeads([...leads,{id:uid(),...form,createdAt:todayStr()}]); setModal(false); };
  const sc = {"Da contattare":C.textDim,"Contattato":C.accent,"In trattativa":C.gold,"Perso":C.danger,"Convertito":C.success};
  const grouped = LEAD_STAGES.reduce((a,s)=>{a[s]=leads.filter(l=>l.stage===s);return a;},{});
  const [subtab, setSubtab] = useState("pipeline");

  return (
    <div className="fi">
      <div style={{display:"flex",gap:6,marginBottom:16}}>
        {[["pipeline","Pipeline"],["hunter","Cerca"]].map(([k,l])=>(
          <button key={k} onClick={()=>setSubtab(k)} style={{flex:1,background:subtab===k?C.accentDim:"transparent",border:`1px solid ${subtab===k?C.accent:C.border}`,borderRadius:5,color:subtab===k?C.accent:C.textDim,padding:"9px",cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",fontWeight:700,fontSize:11,letterSpacing:"0.1em",textTransform:"uppercase",transition:"all .2s"}}>
            {l}
          </button>
        ))}
      </div>
      {subtab==="hunter" && <HunterView onAddToLeads={lead=>{setLeads(p=>[...p,lead]);setSubtab("pipeline");}} apiKeys={apiKeys} onNeedKey={onNeedKey}/>}
      {subtab==="pipeline" && (
        <Section title="Pipeline" action={<Btn size="sm" onClick={()=>open(null)}>+ New</Btn>}>
          {leads.length===0 && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:9,color:C.textMuted,padding:"20px 0",textAlign:"center"}}>// Pipeline vuota. Inizia la caccia.</div>}
          {LEAD_STAGES.map(stage=>grouped[stage].length>0&&(
            <div key={stage} style={{marginBottom:18}}>
              <Row gap={7} style={{marginBottom:7}}>
                <Dot color={sc[stage]}/>
                <span style={{fontFamily:"'Rajdhani',sans-serif",fontSize:8,color:sc[stage],letterSpacing:"0.15em",textTransform:"uppercase"}}>{stage}</span>
                <span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:8,color:C.textMuted}}>({grouped[stage].length})</span>
              </Row>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {grouped[stage].map(l=>(
                  <Card key={l.id}>
                    <Row style={{alignItems:"flex-start",justifyContent:"space-between"}}>
                      <div style={{flex:1,minWidth:0}}>
                        <Row gap={8} style={{marginBottom:4,flexWrap:"wrap"}}>
                          <span style={{fontFamily:"'Rajdhani',sans-serif",fontWeight:700,color:C.text,fontSize:13}}>{l.name}</span>
                          {l.contacted && <Chip color={C.success} borderColor={C.success}>Contattato</Chip>}
                        </Row>
                        <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:8,color:C.textDim}}>{l.contact} · {l.sector}</div>
                        {l.website && <a href={l.website} target="_blank" rel="noopener noreferrer" style={{display:"block",fontFamily:"'Share Tech Mono',monospace",fontSize:9,color:C.accent,marginTop:4,wordBreak:"break-all",textDecoration:"none"}}>🌐 {l.website}</a>}
                        {l.source && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:7,color:C.textMuted,marginTop:2}}>src: {l.source}</div>}
                        {l.notes && <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:9,color:C.textMuted,marginTop:3,fontStyle:"italic"}}>{l.notes}</div>}
                      </div>
                      <Row gap={5} style={{flexShrink:0}}>
                        <button onClick={()=>setLeads(leads.map(x=>x.id===l.id?{...x,contacted:!x.contacted}:x))} style={{background:l.contacted?C.successDim:"transparent",border:`1px solid ${l.contacted?C.success:C.border}`,borderRadius:4,color:l.contacted?C.success:C.textDim,cursor:"pointer",padding:"3px 7px",fontSize:8,fontFamily:"'Rajdhani',sans-serif",transition:"all .2s"}}>{l.contacted?"✓":"Contatta"}</button>
                        <Btn variant="ghost" size="sm" onClick={()=>open(l)}>Edit</Btn>
                        <Btn variant="danger" size="sm" onClick={()=>setLeads(leads.filter(x=>x.id!==l.id))}>Del</Btn>
                      </Row>
                    </Row>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </Section>
      )}
      {modal && (
        <Modal title={editing?"Modifica Lead":"Nuovo Lead"} onClose={()=>setModal(false)}>
          <Grid cols={2} gap={8}>
            <div><Label>Nome</Label><Input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Es. Ristorante X"/></div>
            <div><Label>Contatto</Label><Input value={form.contact} onChange={e=>setForm({...form,contact:e.target.value})} placeholder="email / tel"/></div>
          </Grid>
          <Grid cols={2} gap={8}>
            <div><Label>Settore</Label><Select value={form.sector} onChange={e=>setForm({...form,sector:e.target.value})}>{SECTORS.map(s=><option key={s}>{s}</option>)}</Select></div>
            <div><Label>Stato</Label><Select value={form.stage} onChange={e=>setForm({...form,stage:e.target.value})}>{LEAD_STAGES.map(s=><option key={s}>{s}</option>)}</Select></div>
          </Grid>
          <Label>Sito web</Label><Input value={form.website||""} onChange={e=>setForm({...form,website:e.target.value})} placeholder="https://..."/>
          <Label>Fonte</Label><Input value={form.source} onChange={e=>setForm({...form,source:e.target.value})} placeholder="Google Maps, passaparola..."/>
          <Label>Note</Label><Textarea value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} style={{minHeight:44,marginBottom:10}}/>
          <Row gap={8}>
            <Btn variant="ghost" style={{flex:1,justifyContent:"center"}} onClick={()=>setModal(false)}>Annulla</Btn>
            <Btn style={{flex:2,justifyContent:"center"}} onClick={saveL}>{editing?"[ SALVA ]":"[ AGGIUNGI ]"}</Btn>
          </Row>
        </Modal>
      )}
    </div>
  );
};

// ─── GOALS ───────────────────────────────────────────────────────────────────
const GoalsView = ({goals, setGoals}) => {
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({title:"",target:"",unit:"",current:"",deadline:"",category:"Business"});
  const cats = ["Business","Salute","Finanze","Personale"];
  const catColor = {Business:C.accent,Salute:C.success,Finanze:C.gold,Personale:C.purple};

  const save = () => {
    if(!form.title.trim())return;
    setGoals([...goals,{id:uid(),...form,current:parseFloat(form.current)||0,target:parseFloat(form.target)||100,done:false,createdAt:todayStr()}]);
    setModal(false);
    setForm({title:"",target:"",unit:"",current:"",deadline:"",category:"Business"});
  };
  const updateCurrent = (id, val) => setGoals(goals.map(g=>g.id===id?{...g,current:parseFloat(val)||0,done:(parseFloat(val)||0)>=(g.target||100)}:g));
  const active = goals.filter(g=>!g.done);
  const completed = goals.filter(g=>g.done);

  return (
    <div className="fi">
      <Section title="Goals" action={<Btn size="sm" onClick={()=>setModal(true)}>+ New Goal</Btn>}>
        {active.length===0 && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:9,color:C.textMuted,padding:"20px 0",textAlign:"center"}}>// No active goals. Set your targets.</div>}
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {active.map(g=>{
            const pct = Math.min(Math.round((g.current||0)/(g.target||1)*100),100);
            const col = catColor[g.category]||C.accent;
            return (
              <Card key={g.id} glow color={col}>
                <Row style={{justifyContent:"space-between",marginBottom:5}}>
                  <div>
                    <Row gap={7} style={{marginBottom:3}}>
                      <span style={{fontFamily:"'Rajdhani',sans-serif",fontWeight:700,color:C.text,fontSize:13}}>{g.title}</span>
                      <Chip color={col} borderColor={col}>{g.category}</Chip>
                    </Row>
                    {g.deadline && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:8,color:C.textMuted}}>deadline: {g.deadline}</div>}
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontFamily:"'Cinzel',serif",fontSize:18,color:col,fontWeight:700}}>{pct}%</div>
                    <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:7,color:C.textMuted}}>{g.current}/{g.target} {g.unit}</div>
                  </div>
                </Row>
                <ProgressBar pct={pct} color={col} height={6} style={{marginBottom:10}}/>
                <Row gap={8}>
                  <Input type="number" value={g.current||""} onChange={e=>updateCurrent(g.id,e.target.value)} placeholder="Aggiorna valore..." style={{marginBottom:0,flex:1,fontSize:11}}/>
                  <Btn variant="danger" size="sm" onClick={()=>setGoals(goals.filter(x=>x.id!==g.id))}>Del</Btn>
                </Row>
              </Card>
            );
          })}
        </div>

        {completed.length>0 && (
          <div style={{marginTop:20}}>
            <Label>Completati ✦</Label>
            <div style={{display:"flex",flexDirection:"column",gap:6,marginTop:8}}>
              {completed.map(g=>(
                <Card key={g.id} style={{borderColor:C.success+"33"}}>
                  <Row style={{justifyContent:"space-between"}}>
                    <span style={{fontFamily:"'Rajdhani',sans-serif",fontSize:12,color:C.textDim,textDecoration:"line-through"}}>{g.title}</span>
                    <Row gap={6}>
                      <span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:9,color:C.success}}>✓ Done</span>
                      <button onClick={()=>setGoals(goals.filter(x=>x.id!==g.id))} style={{background:"none",border:"none",color:C.textMuted,cursor:"pointer",fontSize:14}}>×</button>
                    </Row>
                  </Row>
                </Card>
              ))}
            </div>
          </div>
        )}
      </Section>

      {modal && (
        <Modal title="New Goal" onClose={()=>setModal(false)}>
          <Label>Titolo</Label><Input value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder="Es. Arrivare a €3k/mese"/>
          <Label>Categoria</Label>
          <div style={{display:"flex",gap:6,marginBottom:12,flexWrap:"wrap"}}>
            {cats.map(c=>(
              <button key={c} onClick={()=>setForm({...form,category:c})} style={{background:form.category===c?`${catColor[c]}22`:"transparent",border:`1px solid ${form.category===c?catColor[c]:C.border}`,borderRadius:4,color:form.category===c?catColor[c]:C.textDim,padding:"5px 10px",cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",fontSize:9,letterSpacing:"0.1em",textTransform:"uppercase"}}>
                {c}
              </button>
            ))}
          </div>
          <Grid cols={2} gap={10}>
            <div><Label>Target</Label><Input type="number" value={form.target} onChange={e=>setForm({...form,target:e.target.value})} placeholder="Es. 3000"/></div>
            <div><Label>Unità</Label><Input value={form.unit} onChange={e=>setForm({...form,unit:e.target.value})} placeholder="€, kg, clienti..."/></div>
          </Grid>
          <Label>Valore attuale</Label><Input type="number" value={form.current} onChange={e=>setForm({...form,current:e.target.value})} placeholder="Da dove parti?"/>
          <Label>Deadline (opz.)</Label><Input type="date" value={form.deadline} onChange={e=>setForm({...form,deadline:e.target.value})} style={{marginBottom:4}}/>
          <Row gap={8} style={{marginTop:10}}>
            <Btn variant="ghost" style={{flex:1,justifyContent:"center"}} onClick={()=>setModal(false)}>Cancel</Btn>
            <Btn style={{flex:2,justifyContent:"center"}} onClick={save}>[ CREATE GOAL ]</Btn>
          </Row>
        </Modal>
      )}
    </div>
  );
};

// ─── TASKS ───────────────────────────────────────────────────────────────────
const TasksView = ({tasks, setTasks, anthropicKey, onNeedKey}) => {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("todo"); // todo | done | all

  const parseAndAdd = async () => {
    if(!input.trim()) return;
    if(!anthropicKey) {
      // Add as plain task without AI
      setTasks([...tasks, {id:uid(), text:input.trim(), done:false, xp:15, createdAt:todayStr()}]);
      setInput("");
      return;
    }
    setLoading(true);
    const raw = input.trim();
    setInput("");
    try {
      const res = await fetch("https://apify-worker.luciettiandrea.workers.dev/anthropic/v1/messages",{method:"POST",headers:{"Content-Type":"application/json","x-api-key":anthropicKey},body:JSON.stringify({model:"claude-sonnet-4-5",max_tokens:400,messages:[{role:"user",content:`Sei l'AI di Studio Brillo (freelance web design, Vicenza). L'utente scrive questo testo libero che contiene uno o più task da fare:
"${raw}"

Estrai i task e rispondi SOLO con JSON:
{"tasks":[{"text":"testo chiaro e actionable del task","xp":10}]}
XP da 5 a 25 in base alla difficoltà/importanza. Max 5 task. Niente altro oltre al JSON.`}]})});
      const d = await res.json();
      const p = JSON.parse((d.content?.[0]?.text||"{}").replace(/\`\`\`json|\`\`\`/g,"").trim());
      const newTasks = (p.tasks||[{text:raw,xp:15}]).map(t=>({id:uid(),text:t.text,xp:t.xp||15,done:false,createdAt:todayStr()}));
      setTasks([...tasks,...newTasks]);
    } catch {
      setTasks([...tasks,{id:uid(),text:raw,done:false,xp:15,createdAt:todayStr()}]);
    } finally { setLoading(false); }
  };

  const toggle = (id) => setTasks(tasks.map(t=>t.id===id?{...t,done:!t.done,doneAt:!t.done?todayStr():null}:t));
  const del = (id) => setTasks(tasks.filter(t=>t.id!==id));

  const todo = tasks.filter(t=>!t.done);
  const done = tasks.filter(t=>t.done);
  const shown = filter==="todo"?todo:filter==="done"?done:tasks;
  const totalXP = done.reduce((s,t)=>s+(t.xp||15),0);

  return (
    <div className="fi">
      <Section title="Task" action={
        <Row gap={6}>
          <Chip color={C.purple} borderColor={C.purple}>+{totalXP} XP guadagnati</Chip>
        </Row>
      }>
        <Card glow color={C.purple} style={{marginBottom:14}}>
          <Label>Scrivi in modo libero — AI converte in task</Label>
          <Textarea
            value={input}
            onChange={e=>setInput(e.target.value)}
            onKeyDown={e=>{if(e.key==="Enter"&&(e.metaKey||e.ctrlKey))parseAndAdd();}}
            placeholder="Es. devo mandare preventivo a Marco, sistemare il sito Vitamin Store, rispondere alle mail..."
            style={{minHeight:65,marginBottom:8}}
          />
          <Btn style={{width:"100%",justifyContent:"center",opacity:loading?.6:1,borderColor:C.purple,color:C.purple,background:`${C.purple}15`}} onClick={parseAndAdd} disabled={loading}>
            {loading?"[ AI sta elaborando... ]":"[ + AGGIUNGI TASK — ⌘+Enter ]"}
          </Btn>
        </Card>

        {/* Filter tabs */}
        <Row gap={6} style={{marginBottom:12}}>
          {[["todo","Da fare",todo.length],["done","Fatti",done.length],["all","Tutti",tasks.length]].map(([k,l,n])=>(
            <button key={k} onClick={()=>setFilter(k)} style={{background:filter===k?`${C.purple}22`:"transparent",border:`1px solid ${filter===k?C.purple:C.border}`,borderRadius:4,color:filter===k?C.purple:C.textDim,padding:"5px 12px",cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",fontSize:9,letterSpacing:"0.1em",textTransform:"uppercase"}}>
              {l} {n>0&&<span style={{opacity:.7}}>({n})</span>}
            </button>
          ))}
        </Row>

        {shown.length===0 && (
          <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:9,color:C.textMuted,padding:"16px 0",textAlign:"center"}}>
            {filter==="todo"?"// Nessun task da fare. Ottimo.":"// Nessun task qui."}
          </div>
        )}

        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {shown.map(t=>(
            <div key={t.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:t.done?`${C.purple}08`:C.bg,border:`1px solid ${t.done?C.purple+"44":C.border}`,borderRadius:6,transition:"all .2s"}}>
              <button onClick={()=>toggle(t.id)} style={{width:17,height:17,borderRadius:3,border:`1px solid ${t.done?C.purple:C.borderHi}`,background:t.done?C.purple:"transparent",cursor:"pointer",flexShrink:0,fontSize:9,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",transition:"all .2s"}}>
                {t.done&&"✓"}
              </button>
              <span style={{flex:1,fontFamily:"'Share Tech Mono',monospace",fontSize:10,color:t.done?C.textDim:C.text,textDecoration:t.done?"line-through":"none",lineHeight:1.4}}>{t.text}</span>
              <span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:8,color:t.done?C.purple:C.textMuted,flexShrink:0}}>+{t.xp||15}xp</span>
              <button onClick={()=>del(t.id)} style={{background:"none",border:"none",color:C.textMuted,cursor:"pointer",fontSize:14,lineHeight:1,padding:"0 2px",flexShrink:0}}>×</button>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
};

// ─── NOTES ───────────────────────────────────────────────────────────────────
const NotesView = ({notes, setNotes}) => {
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [pinned, setPinned] = useState({});

  const add = () => {
    if(!input.trim())return;
    setNotes([{id:uid(),text:input.trim(),createdAt:todayStr(),time:new Date().toLocaleTimeString("it-IT",{hour:"2-digit",minute:"2-digit"})},...notes]);
    setInput("");
  };

  const filtered = notes.filter(n=>!search||n.text.toLowerCase().includes(search.toLowerCase()));
  const sorted = [...filtered].sort((a,b)=>(pinned[b.id]?1:0)-(pinned[a.id]?1:0));

  return (
    <div className="fi">
      <Section title="Quick Notes">
        <Card glow style={{marginBottom:16}}>
          <Textarea value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&(e.metaKey||e.ctrlKey))add();}} placeholder="Scrivi qualcosa da ricordare... ⌘+Enter per salvare" style={{minHeight:70,marginBottom:8}}/>
          <Btn style={{width:"100%",justifyContent:"center"}} onClick={add}>[ SALVA NOTA ]</Btn>
        </Card>
        <Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Cerca nelle note..." style={{marginBottom:12}}/>
        {sorted.length===0 && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:9,color:C.textMuted,padding:"20px 0",textAlign:"center"}}>// No notes yet.</div>}
        <div style={{display:"flex",flexDirection:"column",gap:7}}>
          {sorted.map(n=>(
            <Card key={n.id} style={{borderColor:pinned[n.id]?C.gold+"66":C.border}}>
              <Row style={{justifyContent:"space-between",marginBottom:6}}>
                <Row gap={6}>
                  {pinned[n.id] && <span style={{fontSize:10}}>📌</span>}
                  <span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:7,color:C.textMuted}}>{n.createdAt} {n.time}</span>
                </Row>
                <Row gap={6}>
                  <button onClick={()=>setPinned(p=>({...p,[n.id]:!p[n.id]}))} style={{background:"none",border:"none",cursor:"pointer",fontSize:11,opacity:.7}}>{pinned[n.id]?"📌":"📍"}</button>
                  <button onClick={()=>{navigator.clipboard.writeText(n.text);}} style={{background:"none",border:"none",color:C.textDim,cursor:"pointer",fontSize:10,fontFamily:"'Rajdhani',sans-serif"}}>COPY</button>
                  <button onClick={()=>setNotes(notes.filter(x=>x.id!==n.id))} style={{background:"none",border:"none",color:C.textMuted,cursor:"pointer",fontSize:15,lineHeight:1}}>×</button>
                </Row>
              </Row>
              <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:12,color:C.text,lineHeight:1.6,whiteSpace:"pre-wrap"}}>{n.text}</div>
            </Card>
          ))}
        </div>
      </Section>
    </div>
  );
};

// ─── WORKOUT ─────────────────────────────────────────────────────────────────
const WorkoutView = ({workoutLog, setWorkoutLog}) => {
  const today = todayStr();
  const log = workoutLog[today]||{};
  const upd = patch => setWorkoutLog({...workoutLog,[today]:{...log,...patch}});
  const last7 = Array.from({length:7},(_,i)=>{const d=new Date();d.setDate(d.getDate()-i);const k=d.toISOString().slice(0,10);return {k,d:d.toLocaleDateString("it-IT",{weekday:"short",day:"numeric"}),log:workoutLog[k]};}).reverse();
  const streak = (()=>{let s=0,d=new Date();while(true){const k=d.toISOString().slice(0,10);if(workoutLog[k]?.done){s++;d.setDate(d.getDate()-1);}else break;}return s;})();

  return (
    <div className="fi">
      <Section title="Workout Tracker">
        <Card glow style={{marginBottom:16}}>
          <Label>Oggi — {new Date().toLocaleDateString("it-IT",{weekday:"long",day:"numeric",month:"long"})}</Label>
          <Grid cols={2} gap={8} style={{marginBottom:log.done?12:0}}>
            <button onClick={()=>upd({done:true})} style={{background:log.done?"#051a08":C.bg,border:`2px solid ${log.done?C.success:C.border}`,borderRadius:7,color:log.done?C.success:C.textDim,padding:"16px 8px",cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",fontWeight:700,fontSize:13,letterSpacing:"0.05em",transition:"all .2s",textAlign:"center"}}>
              <div style={{fontSize:26,marginBottom:5}}>💪</div>ALLENATO
            </button>
            <button onClick={()=>upd({done:false,type:"",note:""})} style={{background:log.done===false&&workoutLog[today]!==undefined?"#1a0505":C.bg,border:`2px solid ${log.done===false&&workoutLog[today]!==undefined?C.danger:C.border}`,borderRadius:7,color:log.done===false&&workoutLog[today]!==undefined?C.danger:C.textDim,padding:"16px 8px",cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",fontWeight:700,fontSize:13,letterSpacing:"0.05em",transition:"all .2s",textAlign:"center"}}>
              <div style={{fontSize:26,marginBottom:5}}>🛋️</div>SALTATO
            </button>
          </Grid>
          {log.done && <>
            <Label>Tipo</Label>
            <Select value={log.type||""} onChange={e=>upd({type:e.target.value})} style={{marginBottom:7}}>
              <option value="">Seleziona...</option>
              {WORKOUT_TYPES.map(t=><option key={t}>{t}</option>)}
            </Select>
            <Label>Note</Label>
            <Input value={log.note||""} onChange={e=>upd({note:e.target.value})} placeholder="Es. chest day, nuovo PR..." style={{marginBottom:0}}/>
          </>}
        </Card>

        <Grid cols={2} gap={8} style={{marginBottom:16}}>
          <Card style={{textAlign:"center",padding:"16px 8px"}}>
            <div style={{fontFamily:"'Cinzel',serif",fontSize:34,color:streak>0?C.success:C.textDim,fontWeight:700,lineHeight:1}} className={streak>0?"rp":""}>
              {streak}
            </div>
            <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:8,color:C.textDim,letterSpacing:"0.12em",textTransform:"uppercase",marginTop:5}}>Streak giorni</div>
          </Card>
          <Card style={{textAlign:"center",padding:"16px 8px"}}>
            <div style={{fontFamily:"'Cinzel',serif",fontSize:34,color:C.accent,fontWeight:700,lineHeight:1}}>
              {last7.filter(x=>x.log?.done).length}
            </div>
            <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:8,color:C.textDim,letterSpacing:"0.12em",textTransform:"uppercase",marginTop:5}}>Su 7 giorni</div>
          </Card>
        </Grid>

        <Card>
          <Label>Ultimi 7 giorni</Label>
          <Row gap={5} style={{justifyContent:"space-between",marginTop:8}}>
            {last7.map(({k,d,log})=>(
              <div key={k} style={{flex:1,textAlign:"center"}}>
                <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:7,color:C.textMuted,marginBottom:6}}>{d.split(" ")[0]}</div>
                <div style={{aspectRatio:"1",borderRadius:5,background:log?.done?C.successDim:log?C.dangerDim:C.bg,border:`1px solid ${log?.done?C.success:log?C.danger:C.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14}}>
                  {log?.done?"💪":log?"🛋️":""}
                </div>
              </div>
            ))}
          </Row>
        </Card>
      </Section>
    </div>
  );
};

// ─── DIET ─────────────────────────────────────────────────────────────────────
const DietView = ({dietLog, setDietLog}) => {
  const today = todayStr();
  const log = dietLog[today]||{};
  const upd = patch => setDietLog({...dietLog,[today]:{...log,...patch}});
  const last7 = Array.from({length:7},(_,i)=>{const d=new Date();d.setDate(d.getDate()-i);const k=d.toISOString().slice(0,10);return {k,d:d.toLocaleDateString("it-IT",{weekday:"short"}),log:dietLog[k]};}).reverse();
  const ok7 = last7.filter(x=>x.log?.ok===true).length;
  const bad7 = last7.filter(x=>x.log?.ok===false).length;

  return (
    <div className="fi">
      <Section title="Diet Tracker">
        <Card glow style={{marginBottom:16}}>
          <Label>Oggi — hai mangiato secondo la dieta?</Label>
          <Grid cols={2} gap={8} style={{marginBottom:log.ok===false?12:0}}>
            <button onClick={()=>upd({ok:true,cheat:""})} style={{background:log.ok===true?C.successDim:C.bg,border:`2px solid ${log.ok===true?C.success:C.border}`,borderRadius:7,color:log.ok===true?C.success:C.textDim,padding:"16px 8px",cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",fontWeight:700,fontSize:12,letterSpacing:"0.05em",transition:"all .2s",textAlign:"center"}}>
              <div style={{fontSize:26,marginBottom:5}}>✅</div>DIETA OK
            </button>
            <button onClick={()=>upd({ok:false})} style={{background:log.ok===false?C.dangerDim:C.bg,border:`2px solid ${log.ok===false?C.danger:C.border}`,borderRadius:7,color:log.ok===false?C.danger:C.textDim,padding:"16px 8px",cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",fontWeight:700,fontSize:12,letterSpacing:"0.05em",transition:"all .2s",textAlign:"center"}}>
              <div style={{fontSize:26,marginBottom:5}}>🍕</div>HO SGARRATO
            </button>
          </Grid>
          {log.ok===false && <>
            <Label>Con cosa hai sgarrato?</Label>
            <Input value={log.cheat||""} onChange={e=>upd({cheat:e.target.value})} placeholder="Es. pizza, gelato, kebab..." style={{marginBottom:7}}/>
          </>}
          {log.ok!==null&&log.ok!==undefined && <>
            <Label>Note</Label>
            <Input value={log.note||""} onChange={e=>upd({note:e.target.value})} placeholder="Opzionale..." style={{marginBottom:0}}/>
          </>}
        </Card>

        <Grid cols={2} gap={8} style={{marginBottom:16}}>
          <Card style={{textAlign:"center",padding:"16px 8px"}}>
            <div style={{fontFamily:"'Cinzel',serif",fontSize:34,color:C.success,fontWeight:700,lineHeight:1}}>{ok7}</div>
            <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:8,color:C.textDim,letterSpacing:"0.12em",textTransform:"uppercase",marginTop:5}}>Giorni clean</div>
          </Card>
          <Card style={{textAlign:"center",padding:"16px 8px"}}>
            <div style={{fontFamily:"'Cinzel',serif",fontSize:34,color:bad7>2?C.danger:C.gold,fontWeight:700,lineHeight:1}}>{bad7}</div>
            <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:8,color:C.textDim,letterSpacing:"0.12em",textTransform:"uppercase",marginTop:5}}>Sgarri 7gg</div>
          </Card>
        </Grid>

        <Card>
          <Label>Ultimi 7 giorni</Label>
          <Row gap={5} style={{justifyContent:"space-between",marginTop:8}}>
            {last7.map(({k,d,log})=>(
              <div key={k} style={{flex:1,textAlign:"center"}}>
                <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:7,color:C.textMuted,marginBottom:6}}>{d}</div>
                <div style={{aspectRatio:"1",borderRadius:5,background:log?.ok===true?C.successDim:log?.ok===false?C.dangerDim:C.bg,border:`1px solid ${log?.ok===true?C.success:log?.ok===false?C.danger:C.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14}}>
                  {log?.ok===true?"✅":log?.ok===false?"🍕":""}
                </div>
                {log?.cheat && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:6,color:C.textMuted,marginTop:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{log.cheat}</div>}
              </div>
            ))}
          </Row>
        </Card>
      </Section>
    </div>
  );
};

// ─── MOOD ─────────────────────────────────────────────────────────────────────
const MoodView = ({moodLog, setMoodLog}) => {
  const today = todayStr();
  const log = moodLog[today]||{scores:{},emoji:"",note:""};
  const upd = patch => setMoodLog({...moodLog,[today]:{...log,...patch}});
  const setScore = (k,v) => upd({scores:{...log.scores,[k]:v}});
  const avg = Object.values(log.scores||{}).length ? (Object.values(log.scores).reduce((a,b)=>a+b,0)/Object.values(log.scores).length).toFixed(1) : null;
  const last7 = Array.from({length:7},(_,i)=>{const d=new Date();d.setDate(d.getDate()-i);const k=d.toISOString().slice(0,10);const l=moodLog[k];const a=l?.scores?Object.values(l.scores).reduce((x,y)=>x+y,0)/Object.values(l.scores).length:null;return {k,d:d.toLocaleDateString("it-IT",{weekday:"short"}),avg:a,emoji:l?.emoji};}).reverse();

  return (
    <div className="fi">
      <Section title="Daily Check-in">
        <Card style={{marginBottom:12}}>
          <Label>Come ti senti oggi?</Label>
          <div style={{display:"flex",flexWrap:"wrap",gap:7,marginTop:4}}>
            {MOOD_EMOJIS.map(e=>(
              <button key={e} onClick={()=>upd({emoji:e})} style={{background:log.emoji===e?C.borderHi:"transparent",border:`1px solid ${log.emoji===e?C.borderHi:C.border}`,borderRadius:6,padding:"7px 9px",cursor:"pointer",fontSize:20,transition:"all .2s",lineHeight:1}}>
                {e}
              </button>
            ))}
          </div>
        </Card>

        <Card glow style={{marginBottom:12}}>
          <Label>Rating (1-5)</Label>
          <div style={{display:"flex",flexDirection:"column",gap:12,marginTop:8}}>
            {MOOD_METRICS.map(({k,label,icons})=>(
              <div key={k}>
                <Row style={{justifyContent:"space-between",marginBottom:7}}>
                  <span style={{fontFamily:"'Rajdhani',sans-serif",fontSize:10,color:C.textDim,letterSpacing:"0.1em",textTransform:"uppercase"}}>{label}</span>
                  <span style={{fontSize:18}}>{icons[(log.scores?.[k]||1)-1]}</span>
                </Row>
                <Row gap={5}>
                  {[1,2,3,4,5].map(v=>(
                    <button key={v} onClick={()=>setScore(k,v)} style={{flex:1,background:log.scores?.[k]===v?C.accentDim:C.bg,border:`1px solid ${log.scores?.[k]===v?C.accent:C.border}`,borderRadius:4,color:log.scores?.[k]===v?C.accent:C.textDim,padding:"7px 2px",cursor:"pointer",fontFamily:"'Share Tech Mono',monospace",fontSize:10,transition:"all .2s"}}>
                      {v}
                    </button>
                  ))}
                </Row>
              </div>
            ))}
          </div>
          {avg && (
            <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:C.bg,borderRadius:5,border:`1px solid ${C.border}`,marginTop:14}}>
              <div style={{fontFamily:"'Cinzel',serif",fontSize:24,color:avg>=4?C.success:avg>=3?C.gold:C.danger,fontWeight:700}}>{avg}</div>
              <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:9,color:C.textDim,letterSpacing:"0.1em",textTransform:"uppercase"}}>Media giornaliera</div>
            </div>
          )}
        </Card>

        <Card style={{marginBottom:12}}>
          <Label>Nota libera</Label>
          <Textarea value={log.note||""} onChange={e=>upd({note:e.target.value})} placeholder="Come stai davvero? Cosa ti pesa? Cosa ti carica?" style={{minHeight:70,marginBottom:0}}/>
        </Card>

        <Card>
          <Label>Ultimi 7 giorni</Label>
          <Row gap={5} style={{justifyContent:"space-between",marginTop:8}}>
            {last7.map(({k,d,avg,emoji})=>(
              <div key={k} style={{flex:1,textAlign:"center"}}>
                <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:7,color:C.textMuted,marginBottom:5}}>{d}</div>
                <div style={{fontSize:18,marginBottom:4}}>{emoji||"—"}</div>
                {avg!==null && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:7,color:avg>=4?C.success:avg>=3?C.gold:C.danger}}>{avg.toFixed(1)}</div>}
              </div>
            ))}
          </Row>
        </Card>
      </Section>
    </div>
  );
};

// ─── SLOT ─────────────────────────────────────────────────────────────────────
const SlotView = ({slotDays, slotStart, onReset}) => {
  const ms = [1,3,7,14,30,60,90,180,365];
  const next = ms.find(m=>m>slotDays)||365;
  const prev = [...ms].reverse().find(m=>m<=slotDays)||0;
  const pct = prev===next?100:Math.round((slotDays-prev)/(next-prev)*100);
  const col = slotDays>=365?C.gold:slotDays>=90?C.purple:slotDays>=30?C.accent:slotDays>=7?C.success:C.danger;
  return (
    <div className="fi">
      <Section title="Discipline Tracker">
        <Card glow style={{textAlign:"center",padding:"28px 16px",marginBottom:14}}>
          <Label>Giorni senza slot</Label>
          <div style={{fontFamily:"'Cinzel',serif",fontSize:64,fontWeight:900,color:col,lineHeight:1,textShadow:`0 0 24px ${col}55`,marginTop:8}} className="rp">{slotDays}</div>
          {slotStart && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:8,color:C.textMuted,marginTop:8}}>dal {new Date(slotStart).toLocaleDateString("it-IT")}</div>}
          <div style={{marginTop:16}}>
            <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:8,color:C.textDim,letterSpacing:"0.15em",marginBottom:6}}>NEXT MILESTONE: {next}d</div>
            <ProgressBar pct={pct} color={col}/>
            <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:7,color:C.textMuted,marginTop:4}}>{pct}% to {next}d</div>
          </div>
        </Card>
        <Card style={{marginBottom:14}}>
          <Label>Milestones</Label>
          <div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:8}}>
            {ms.map(m=>(
              <div key={m} style={{padding:"5px 10px",borderRadius:4,border:`1px solid ${slotDays>=m?col:C.border}`,background:slotDays>=m?`${col}11`:"transparent",fontFamily:"'Share Tech Mono',monospace",fontSize:9,color:slotDays>=m?col:C.textMuted}}>
                {m}d{slotDays>=m?" ✓":""}
              </div>
            ))}
          </div>
        </Card>
        <div style={{background:C.dangerDim,border:`1px solid ${C.danger}33`,borderRadius:8,padding:14}}>
          <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:9,color:C.danger,marginBottom:6,letterSpacing:"0.1em"}}>⚠ RESET</div>
          <button onClick={onReset} style={{width:"100%",background:"none",border:`1px solid ${C.danger}`,borderRadius:5,color:C.danger,padding:"10px",cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",fontSize:11,letterSpacing:"0.1em",textTransform:"uppercase"}}>
            [ Ho giocato — Reset ]
          </button>
        </div>
      </Section>
    </div>
  );
};

// ─── BRAINSTORM ───────────────────────────────────────────────────────────────
const BrainstormView = ({ideas, setIdeas, anthropicKey, onNeedKey}) => {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("all");
  const cats = ["all",...[...new Set(ideas.map(i=>i.category).filter(Boolean))]];

  const submit = async () => {
    if(!input.trim())return;
    if(!anthropicKey){onNeedKey();return;}
    setLoading(true);
    const raw = input.trim(); setInput("");
    try {
      const res = await fetch("https://apify-worker.luciettiandrea.workers.dev/anthropic/v1/messages",{method:"POST",headers:{"Content-Type":"application/json","x-api-key":anthropicKey},body:JSON.stringify({model:"claude-sonnet-4-5",max_tokens:400,messages:[{role:"user",content:`Sei l'AI di Studio Brillo (freelance web design, Vicenza). L'utente scrive:\n"${raw}"\nRispondi SOLO con JSON:\n{"refined":"idea chiarita in 1-2 frasi","category":"Marketing|Prodotto|Lead Gen|Workflow|Contenuti|Business|Tech","tags":["a","b"],"score":5,"action":"azione concreta da fare ora"}`}]})});
      const d = await res.json();
      const p = JSON.parse((d.content?.[0]?.text||"{}").replace(/```json|```/g,"").trim());
      setIdeas(prev=>[{id:uid(),raw,refined:p.refined||raw,category:p.category||"Altro",tags:p.tags||[],score:p.score||5,action:p.action||"",createdAt:todayStr()},...prev]);
    } catch { setIdeas(prev=>[{id:uid(),raw,refined:raw,category:"Altro",tags:[],score:5,action:"",createdAt:todayStr()},...prev]); }
    finally { setLoading(false); }
  };

  const sorted = [...(filter==="all"?ideas:ideas.filter(i=>i.category===filter))].sort((a,b)=>b.score-a.score);

  return (
    <div className="fi">
      <Section title="Idea Vault">
        <Card glow style={{marginBottom:14}}>
          <Label>Lancia un'idea — The System la raffina</Label>
          <Textarea value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&(e.metaKey||e.ctrlKey))submit();}} placeholder="Qualsiasi cosa: idea, problema, intuizione..." style={{minHeight:70}}/>
          <Btn style={{width:"100%",justifyContent:"center",opacity:loading?.6:1}} onClick={submit} disabled={loading}>
            {loading?"[ processing... ]":"[ PROCESS — ⌘+Enter ]"}
          </Btn>
        </Card>
        {ideas.length>0 && (
          <Row gap={5} style={{marginBottom:12,flexWrap:"wrap"}}>
            {cats.map(c=>(
              <button key={c} onClick={()=>setFilter(c)} style={{background:filter===c?C.accentDim:"transparent",border:`1px solid ${filter===c?C.accent:C.border}`,borderRadius:4,color:filter===c?C.accent:C.textDim,padding:"4px 9px",cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",fontSize:8,letterSpacing:"0.1em",textTransform:"uppercase"}}>
                {c}
              </button>
            ))}
          </Row>
        )}
        {sorted.length===0 && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:9,color:C.textMuted,padding:"16px 0",textAlign:"center"}}>// Vault empty.</div>}
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {sorted.map(idea=>(
            <Card key={idea.id}>
              <Row style={{justifyContent:"space-between",marginBottom:8}}>
                <Row gap={8}>
                  <div style={{fontFamily:"'Cinzel',serif",fontSize:18,fontWeight:700,color:idea.score>=8?C.gold:idea.score>=6?C.accent:C.textDim,lineHeight:1}}>{idea.score}</div>
                  <Chip color={C.accent}>{idea.category}</Chip>
                </Row>
                <button onClick={()=>setIdeas(ideas.filter(x=>x.id!==idea.id))} style={{background:"none",border:"none",color:C.textMuted,cursor:"pointer",fontSize:16,padding:"0 2px"}}>×</button>
              </Row>
              <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:12,color:C.text,marginBottom:8,lineHeight:1.6}}>{idea.refined}</div>
              {idea.action && (
                <div style={{background:C.accentDim,border:`1px solid ${C.borderHi}`,borderRadius:4,padding:"6px 10px",marginBottom:8}}>
                  <span style={{fontFamily:"'Rajdhani',sans-serif",fontSize:7,color:C.accent,letterSpacing:"0.1em",textTransform:"uppercase"}}>ACTION → </span>
                  <span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:9,color:C.text}}>{idea.action}</span>
                </div>
              )}
              <Row gap={5} style={{flexWrap:"wrap",alignItems:"center"}}>
                {idea.tags.map(t=><Chip key={t} color={C.textMuted}>#{t}</Chip>)}
                <span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:7,color:C.textMuted,marginLeft:"auto"}}>{idea.createdAt}</span>
              </Row>
            </Card>
          ))}
        </div>
      </Section>
    </div>
  );
};

// ─── AGENT ────────────────────────────────────────────────────────────────────
const AgentView = ({clients,leads,quests,tasks=[],ideas,workoutLog,dietLog,moodLog,anthropicKey,onNeedKey}) => {
  const [msgs, setMsgs] = useState([{role:"sys",content:"System online. Ho accesso a tutti i tuoi dati live. Cosa vuoi sapere, Player?"}]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);
  useEffect(()=>endRef.current?.scrollIntoView({behavior:"smooth"}),[msgs]);

  const send = async () => {
    if(!input.trim()||loading)return;
    if(!anthropicKey){onNeedKey();return;}
    const txt = input.trim(); setInput("");
    const next = [...msgs,{role:"user",content:txt}];
    setMsgs(next); setLoading(true);
    const xp = getXP(clients,leads,quests,tasks||[]);
    const today = todayStr();
    const ctx = `Sei The System — AI di Andrea (il Player), freelance web design a Vicenza con Studio Brillo.
RANK: ${getRank(xp).r} — ${xp} XP
CLIENTI: ${clients.map(c=>`${c.name}[${c.stage}${c.income?",€"+c.income:""}]`).join(",")||"nessuno"}
PIPELINE: ${leads.map(l=>`${l.name}[${l.stage}]`).join(",")||"vuota"}
QUEST: ${quests.filter(q=>q.done).length}/${quests.length} — aperte: ${quests.filter(q=>!q.done).map(q=>q.text).join(",")||"nessuna"}
OGGI: workout=${workoutLog[today]?.done?"sì":"no"} | dieta=${dietLog[today]?.ok===true?"ok":dietLog[today]?.ok===false?"sgarro":"N/D"} | umore=${moodLog[today]?.emoji||"N/D"}
IDEAS: ${ideas.slice(0,3).map(i=>`"${(i.refined||"").slice(0,40)}"[${i.score}/10]`).join(",")||"vuoto"}
Tono: diretto, da mentore, italiano. Conciso e utile.`;
    try {
      const apiMsgs = next.filter(m=>m.role!=="sys").map(m=>({role:m.role,content:m.content}));
      const res = await fetch("https://apify-worker.luciettiandrea.workers.dev/anthropic/v1/messages",{method:"POST",headers:{"Content-Type":"application/json","x-api-key":anthropicKey},body:JSON.stringify({model:"claude-sonnet-4-5",max_tokens:600,system:ctx,messages:apiMsgs})});
      const d = await res.json();
      setMsgs(p=>[...p,{role:"assistant",content:d.content?.[0]?.text||"Errore."}]);
    } catch { setMsgs(p=>[...p,{role:"assistant",content:"Errore connessione."}]); }
    finally { setLoading(false); }
  };

  return (
    <div className="fi" style={{display:"flex",flexDirection:"column",height:"calc(100dvh - 200px)",minHeight:380}}>
      <div style={{fontFamily:"'Cinzel',serif",fontSize:13,color:C.accent,letterSpacing:"0.15em",marginBottom:12}}>THE SYSTEM — AI AGENT</div>
      <div style={{flex:1,overflow:"auto",display:"flex",flexDirection:"column",gap:8,paddingBottom:8}}>
        {msgs.map((m,i)=>(
          <Row key={i} style={{justifyContent:m.role==="user"?"flex-end":"flex-start",alignItems:"flex-end"}}>
            <div style={{maxWidth:"88%",padding:"10px 14px",borderRadius:8,background:m.role==="user"?C.accentDim:C.panel,border:`1px solid ${m.role==="user"?C.accent:C.border}`,fontFamily:"'Rajdhani',sans-serif",fontSize:13,color:C.text,lineHeight:1.65}}>
              {m.role!=="user" && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:7,color:C.accent,marginBottom:5,letterSpacing:"0.12em"}}>THE SYSTEM://</div>}
              <div style={{whiteSpace:"pre-wrap"}}>{m.content}</div>
            </div>
          </Row>
        ))}
        {loading && <div style={{display:"flex"}}><div style={{padding:"10px 14px",borderRadius:8,background:C.panel,border:`1px solid ${C.border}`,fontFamily:"'Share Tech Mono',monospace",fontSize:9,color:C.textDim}} className="blink">processing</div></div>}
        <div ref={endRef}/>
      </div>
      <Row gap={7} style={{paddingTop:10,borderTop:`1px solid ${C.border}`}}>
        <Input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send()} placeholder="Chiedimi qualcosa..." style={{marginBottom:0,flex:1}}/>
        <Btn onClick={send} disabled={loading} style={{flexShrink:0,padding:"9px 14px"}}>→</Btn>
      </Row>
    </div>
  );
};

// ─── HUNTER ──────────────────────────────────────────────────────────────────
const HunterView = ({onAddToLeads, apiKeys, onNeedKey}) => {
  const [zona, setZona] = useState("Vicenza");
  const [settore, setSettore] = useState("Ristorazione");
  const [qty, setQty] = useState(10);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState("");
  const [error, setError] = useState("");

  const hunt = async () => {
    if(!apiKeys.apify){onNeedKey();return;}
    setLoading(true);setError("");setResults([]);
    try {
      setStep("Avvio scraping...");
      const PROXY = "https://apify-worker.luciettiandrea.workers.dev/proxy";
      const r1 = await fetch(`${PROXY}/v2/acts/compass~crawler-google-places/runs?token=${apiKeys.apify}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({searchStringsArray:[`${settore} ${zona} Italia`],maxCrawledPlacesPerSearch:qty,language:"it",countryCode:"it"})});
      if(!r1.ok)throw new Error(`Apify ${r1.status}`);
      const {data:{id:runId}} = await r1.json();
      let ok=false,att=0;
      while(!ok&&att<35){
        await new Promise(r=>setTimeout(r,5000));
        const s=await(await fetch(`${PROXY}/v2/actor-runs/${runId}?token=${apiKeys.apify}`)).json();
        setStep(`${s.data?.status} (${att*5}s)`);
        if(s.data?.status==="SUCCEEDED")ok=true;
        else if(["FAILED","ABORTED","TIMED-OUT"].includes(s.data?.status))throw new Error(`Run ${s.data?.status}`);
        att++;
      }
      if(!ok)throw new Error("Timeout");
      const items=await(await fetch(`${PROXY}/v2/actor-runs/${runId}/dataset/items?token=${apiKeys.apify}&limit=${qty}`)).json();
      setResults((Array.isArray(items)?items:[]).map(i=>({id:uid(),name:i.title||"N/D",address:i.address||"",phone:i.phone||"",website:i.website||"",rating:i.totalScore||null,reviewsCount:i.reviewsCount||0,category:i.categoryName||settore,generatedEmail:null,added:false})));
    } catch(e){setError(e.message);}
    finally{setLoading(false);setStep("");}
  };

  return (
    <div className="fi">
      <Section title="Lead Hunter">
        <Card glow style={{marginBottom:14}}>
          <Grid cols={2} gap={8}>
            <div><Label>Zona</Label><Input value={zona} onChange={e=>setZona(e.target.value)} placeholder="Vicenza, Bassano..."/></div>
            <div><Label>Settore</Label>
              <Select value={settore} onChange={e=>setSettore(e.target.value)}>
                {["Ristorazione","Retail","Fitness","Professionale","Hotel","Artigianato","E-commerce","Luxury","Benessere","Automotive"].map(s=><option key={s}>{s}</option>)}
              </Select>
            </div>
          </Grid>
          <div style={{marginBottom:12}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
              <Label>Numero risultati</Label>
              <span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:10,color:C.accent,fontWeight:700}}>{qty}</span>
            </div>
            <input type="range" min={5} max={50} step={5} value={qty} onChange={e=>setQty(Number(e.target.value))}
              style={{width:"100%",accentColor:C.accent,cursor:"pointer"}}/>
            <div style={{display:"flex",justifyContent:"space-between",fontFamily:"'Share Tech Mono',monospace",fontSize:7,color:C.textMuted,marginTop:3}}>
              <span>5</span><span>50</span>
            </div>
          </div>
          <Btn style={{width:"100%",justifyContent:"center",padding:"11px",opacity:loading?.6:1}} onClick={hunt} disabled={loading}>
            {loading?`[ ${step||"..."} ]`:`[ 🎯 CERCA ${qty} AZIENDE ]`}
          </Btn>
          {loading && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:8,color:C.textMuted,textAlign:"center",marginTop:7}}>// Apify Google Maps — attendere 30-90s</div>}
        </Card>
        {error && <Card style={{borderColor:C.danger+"55",marginBottom:10}}><div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:9,color:C.danger}}>{error}</div></Card>}
        {results.length>0 && (
          <>
            <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:9,color:C.textDim,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:10}}>{results.length} aziende trovate</div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {results.map(r=>(
                <Card key={r.id} style={{borderColor:r.added?C.success+"55":C.border}}>
                  <Row style={{justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontFamily:"'Rajdhani',sans-serif",fontWeight:700,color:C.text,fontSize:14,marginBottom:4}}>{r.name}</div>
                      <Chip color={C.textDim}>{r.category}</Chip>
                    </div>
                    {r.rating && <div style={{textAlign:"right",flexShrink:0,marginLeft:8}}>
                      <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:11,color:C.gold}}>⭐ {r.rating}</div>
                      <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:7,color:C.textMuted}}>{r.reviewsCount} rec.</div>
                    </div>}
                  </Row>
                  {/* Website sempre in evidenza */}
                  {r.website
                    ? <a href={r.website} target="_blank" rel="noopener noreferrer" style={{display:"block",fontFamily:"'Share Tech Mono',monospace",fontSize:10,color:C.accent,marginBottom:6,wordBreak:"break-all",textDecoration:"none",padding:"6px 10px",background:C.accentDim,borderRadius:4,border:`1px solid ${C.borderHi}`}}>
                        🌐 {r.website}
                      </a>
                    : <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:9,color:C.danger,marginBottom:6,padding:"5px 10px",background:`${C.danger}08`,borderRadius:4}}>⚠ Nessun sito web — ottimo target</div>
                  }
                  {r.address && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:8,color:C.textDim,marginBottom:2}}>📍 {r.address}</div>}
                  {r.phone && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:8,color:C.textDim,marginBottom:8}}>📞 {r.phone}</div>}
                  <Row gap={7}>
                    {!r.added
                      ? <Btn variant="ghost" size="sm" style={{flex:1,justifyContent:"center"}} onClick={()=>{onAddToLeads({id:uid(),name:r.name,contact:r.phone||r.website||"",sector:r.category,stage:"Da contattare",source:"Lead Hunter",notes:r.address,createdAt:todayStr()});setResults(p=>p.map(x=>x.id===r.id?{...x,added:true}:x));}}>+ Pipeline</Btn>
                      : <span style={{flex:1,fontFamily:"'Share Tech Mono',monospace",fontSize:8,color:C.success,padding:"6px"}}>✓ in pipeline</span>
                    }

                  </Row>

                </Card>
              ))}
            </div>
          </>
        )}
      </Section>
    </div>
  );
};

// ─── WEIGHT ──────────────────────────────────────────────────────────────────

const WeightView = ({weightLog, setWeightLog}) => {
  const [val, setVal] = useState("");
  const [note, setNote] = useState("");
  const entries = [...weightLog].sort((a,b)=>b.date.localeCompare(a.date));
  const add = () => {
    if(!val) return;
    setWeightLog([...weightLog,{id:uid(),date:todayStr(),weight:parseFloat(val),note}]);
    setVal(""); setNote("");
  };
  const last = entries[0];
  const prev = entries[1];
  const diff = last&&prev ? (last.weight-prev.weight).toFixed(1) : null;
  const min7 = entries.slice(0,7);
  const maxW = Math.max(...min7.map(e=>e.weight),0);
  const minW = Math.min(...min7.map(e=>e.weight),999);
  const range = maxW-minW||1;

  return (
    <div className="fi">
      <Section title="Peso Corporeo">
        {last && (
          <Card glow style={{marginBottom:14,textAlign:"center",padding:"20px 16px"}}>
            <Label>Ultimo rilevato — {last.date}</Label>
            <div style={{fontFamily:"'Cinzel',serif",fontSize:52,fontWeight:900,color:C.accent,lineHeight:1}} className="rp">{last.weight}<span style={{fontSize:16,color:C.textDim}}> kg</span></div>
            {diff!==null && (
              <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:11,color:parseFloat(diff)<0?C.success:parseFloat(diff)>0?C.danger:C.textDim,marginTop:6}}>
                {parseFloat(diff)>0?"+":""}{diff} kg rispetto alla misurazione precedente
              </div>
            )}
          </Card>
        )}
        <Card glow={false} style={{marginBottom:14}}>
          <Label>Aggiungi misurazione</Label>
          <Grid cols={2} gap={8}>
            <div><Label>Peso (kg)</Label><Input type="number" step="0.1" value={val} onChange={e=>setVal(e.target.value)} placeholder="Es. 78.5" onKeyDown={e=>e.key==="Enter"&&add()}/></div>
            <div><Label>Nota (opz.)</Label><Input value={note} onChange={e=>setNote(e.target.value)} placeholder="Es. mattina a digiuno"/></div>
          </Grid>
          <Btn style={{width:"100%",justifyContent:"center"}} onClick={add}>[ SALVA ]</Btn>
        </Card>
        {min7.length>1 && (
          <Card style={{marginBottom:14}}>
            <Label>Andamento (ultime {min7.length} misurazioni)</Label>
            <div style={{display:"flex",alignItems:"flex-end",gap:4,height:60,marginTop:10}}>
              {[...min7].reverse().map(e=>{
                const h = Math.max(Math.round(((e.weight-minW)/range)*50)+10,10);
                return (
                  <div key={e.id} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
                    <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:6,color:C.textDim}}>{e.weight}</div>
                    <div style={{width:"100%",height:h,background:C.accent,borderRadius:"3px 3px 0 0",opacity:.8}}/>
                    <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:6,color:C.textMuted}}>{e.date.slice(5)}</div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}
        {entries.length>0 && (
          <Card>
            <Label>Storico</Label>
            <div style={{display:"flex",flexDirection:"column",gap:6,marginTop:8}}>
              {entries.slice(0,10).map(e=>(
                <Row key={e.id} style={{justifyContent:"space-between"}}>
                  <div>
                    <span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:11,color:C.text}}>{e.weight} kg</span>
                    {e.note && <span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:8,color:C.textDim,marginLeft:8}}>{e.note}</span>}
                  </div>
                  <Row gap={8}>
                    <span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:8,color:C.textMuted}}>{e.date}</span>
                    <button onClick={()=>setWeightLog(weightLog.filter(x=>x.id!==e.id))} style={{background:"none",border:"none",color:C.textMuted,cursor:"pointer",fontSize:13}}>×</button>
                  </Row>
                </Row>
              ))}
            </div>
          </Card>
        )}
      </Section>
    </div>
  );
};

// ─── HABITS ───────────────────────────────────────────────────────────────────
const HabitsView = ({habits, setHabits, habitLog, setHabitLog}) => {
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({name:"",icon:"⭐",target:1,unit:"volta"});
  const today = todayStr();
  const ICONS = ["⭐","📚","🧘","🏃","💧","🎨","🎸","✍️","🛌","🥤","🌿","🔥"];

  const addHabit = () => {
    if(!form.name.trim()) return;
    setHabits([...habits,{id:uid(),...form,createdAt:today}]);
    setForm({name:"",icon:"⭐",target:1,unit:"volta"});
    setModal(false);
  };

  const logHabit = (habitId) => {
    const key = `${habitId}-${today}`;
    const curr = habitLog[key]||0;
    const habit = habits.find(h=>h.id===habitId);
    const next = curr+1 > (habit?.target||1) ? 0 : curr+1;
    setHabitLog({...habitLog,[key]:next});
  };

  const getStreak = (habitId) => {
    let s=0, d=new Date();
    while(s<365) {
      const k = `${habitId}-${d.toISOString().slice(0,10)}`;
      const habit = habits.find(h=>h.id===habitId);
      if((habitLog[k]||0) >= (habit?.target||1)) { s++; d.setDate(d.getDate()-1); } else break;
    }
    return s;
  };

  const last7 = Array.from({length:7},(_,i)=>{const d=new Date();d.setDate(d.getDate()-i);return d.toISOString().slice(0,10);}).reverse();

  return (
    <div className="fi">
      <Section title="Abitudini" action={<Btn size="sm" onClick={()=>setModal(true)}>+ Nuova</Btn>}>
        {habits.length===0 && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:9,color:C.textMuted,padding:"20px 0",textAlign:"center"}}>// Nessuna abitudine. Aggiungine una.</div>}
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {habits.map(h=>{
            const todayVal = habitLog[`${h.id}-${today}`]||0;
            const done = todayVal >= (h.target||1);
            const streak = getStreak(h.id);
            return (
              <Card key={h.id} style={{borderColor:done?C.success+"55":C.border}}>
                <Row style={{justifyContent:"space-between",marginBottom:10}}>
                  <Row gap={10}>
                    <span style={{fontSize:22}}>{h.icon}</span>
                    <div>
                      <div style={{fontFamily:"'Rajdhani',sans-serif",fontWeight:700,color:done?C.success:C.text,fontSize:14}}>{h.name}</div>
                      <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:8,color:C.textDim}}>🔥 {streak}d streak</div>
                    </div>
                  </Row>
                  <Row gap={8}>
                    <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:11,color:done?C.success:C.textDim}}>{todayVal}/{h.target} {h.unit}</div>
                    <button onClick={()=>setHabits(habits.filter(x=>x.id!==h.id))} style={{background:"none",border:"none",color:C.textMuted,cursor:"pointer",fontSize:13}}>×</button>
                  </Row>
                </Row>
                <button onClick={()=>logHabit(h.id)} style={{width:"100%",background:done?C.successDim:C.bg,border:`2px solid ${done?C.success:C.border}`,borderRadius:6,color:done?C.success:C.textDim,padding:"10px",cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",fontWeight:700,fontSize:12,letterSpacing:"0.08em",textTransform:"uppercase",transition:"all .2s"}}>
                  {done ? "✓ Fatto oggi" : `Segna (+1)`}
                </button>
                <div style={{display:"flex",gap:4,marginTop:10,justifyContent:"space-between"}}>
                  {last7.map(d=>{
                    const v = habitLog[`${h.id}-${d}`]||0;
                    const ok = v>=(h.target||1);
                    return (
                      <div key={d} style={{flex:1,textAlign:"center"}}>
                        <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:6,color:C.textMuted,marginBottom:3}}>{d.slice(8)}</div>
                        <div style={{aspectRatio:"1",borderRadius:3,background:ok?C.successDim:C.bg,border:`1px solid ${ok?C.success:C.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:8}}>
                          {ok?"✓":""}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </div>
      </Section>
      {modal && (
        <Modal title="Nuova Abitudine" onClose={()=>setModal(false)}>
          <Label>Nome</Label><Input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Es. Lettura, Meditazione..."/>
          <Label>Icona</Label>
          <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:12}}>
            {ICONS.map(i=>(
              <button key={i} onClick={()=>setForm({...form,icon:i})} style={{background:form.icon===i?C.borderHi:"transparent",border:`1px solid ${form.icon===i?C.borderHi:C.border}`,borderRadius:5,padding:"6px 8px",cursor:"pointer",fontSize:18,lineHeight:1}}>{i}</button>
            ))}
          </div>
          <Grid cols={2} gap={8}>
            <div><Label>Target giornaliero</Label><Input type="number" value={form.target} onChange={e=>setForm({...form,target:parseInt(e.target.value)||1})} placeholder="1"/></div>
            <div><Label>Unità</Label><Input value={form.unit} onChange={e=>setForm({...form,unit:e.target.value})} placeholder="volta, km, min..."/></div>
          </Grid>
          <Row gap={8} style={{marginTop:4}}>
            <Btn variant="ghost" style={{flex:1,justifyContent:"center"}} onClick={()=>setModal(false)}>Annulla</Btn>
            <Btn style={{flex:2,justifyContent:"center"}} onClick={addHabit}>[ AGGIUNGI ]</Btn>
          </Row>
        </Modal>
      )}
    </div>
  );
};

// ─── TASK + NOTE (merged) ─────────────────────────────────────────────────────
const TaskNotesView = ({tasks,setTasks,notes,setNotes,anthropicKey,onNeedKey}) => {
  const [subtab, setSubtab] = useState("tasks");
  return (
    <div className="fi">
      <div style={{display:"flex",gap:6,marginBottom:16}}>
        {[["tasks","Task"],["notes","Note"]].map(([k,l])=>(
          <button key={k} onClick={()=>setSubtab(k)} style={{flex:1,background:subtab===k?C.accentDim:"transparent",border:`1px solid ${subtab===k?C.accent:C.border}`,borderRadius:5,color:subtab===k?C.accent:C.textDim,padding:"8px",cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",fontWeight:700,fontSize:11,letterSpacing:"0.1em",textTransform:"uppercase",transition:"all .2s"}}>
            {l}
          </button>
        ))}
      </div>
      {subtab==="tasks" && <TasksView tasks={tasks} setTasks={setTasks} anthropicKey={anthropicKey} onNeedKey={onNeedKey}/>}
      {subtab==="notes" && <NotesView notes={notes} setNotes={setNotes}/>}
    </div>
  );
};

// ─── SALUTE (workout + diet + weight merged) ───────────────────────────────────
const SaluteView = ({workoutLog,setWorkoutLog,dietLog,setDietLog,weightLog,setWeightLog}) => {
  const [subtab, setSubtab] = useState("workout");
  return (
    <div className="fi">
      <div style={{display:"flex",gap:6,marginBottom:16}}>
        {[["workout","Workout"],["diet","Dieta"],["weight","Peso"]].map(([k,l])=>(
          <button key={k} onClick={()=>setSubtab(k)} style={{flex:1,background:subtab===k?C.accentDim:"transparent",border:`1px solid ${subtab===k?C.accent:C.border}`,borderRadius:5,color:subtab===k?C.accent:C.textDim,padding:"8px",cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",fontWeight:700,fontSize:10,letterSpacing:"0.08em",textTransform:"uppercase",transition:"all .2s"}}>
            {l}
          </button>
        ))}
      </div>
      {subtab==="workout" && <WorkoutView workoutLog={workoutLog} setWorkoutLog={setWorkoutLog}/>}
      {subtab==="diet" && <DietView dietLog={dietLog} setDietLog={setDietLog}/>}
      {subtab==="weight" && <WeightView weightLog={weightLog} setWeightLog={setWeightLog}/>}
    </div>
  );
};

// ─── CHECK-IN (mood + habits merged) ──────────────────────────────────────────
const CheckinView = ({moodLog,setMoodLog,habits,setHabits,habitLog,setHabitLog}) => {
  const [subtab, setSubtab] = useState("mood");
  return (
    <div className="fi">
      <div style={{display:"flex",gap:6,marginBottom:16}}>
        {[["mood","Mood"],["habits","Abitudini"]].map(([k,l])=>(
          <button key={k} onClick={()=>setSubtab(k)} style={{flex:1,background:subtab===k?C.accentDim:"transparent",border:`1px solid ${subtab===k?C.accent:C.border}`,borderRadius:5,color:subtab===k?C.accent:C.textDim,padding:"8px",cursor:"pointer",fontFamily:"'Rajdhani',sans-serif",fontWeight:700,fontSize:11,letterSpacing:"0.1em",textTransform:"uppercase",transition:"all .2s"}}>
            {l}
          </button>
        ))}
      </div>
      {subtab==="mood" && <MoodView moodLog={moodLog} setMoodLog={setMoodLog}/>}
      {subtab==="habits" && <HabitsView habits={habits} setHabits={setHabits} habitLog={habitLog} setHabitLog={setHabitLog}/>}
    </div>
  );
};

// ─── SETTINGS VIEW ────────────────────────────────────────────────────────────
const SettingsView = ({quests,setQuests,clients,leads,tasks,ideas,goals,notes,payments,workoutLog,dietLog,moodLog,weightLog,habits,habitLog,slotDays,slotStart,apiKeys,keyDraft,setKeyDraft,saveKeys}) => {
  return (
    <div className="fi">
      <Section title="Configurazione">
        <Card style={{marginBottom:10}}>
          <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:10,color:C.accent,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:12}}>API Keys</div>
          <Label>Anthropic API Key</Label>
          <Input type="password" value={keyDraft.anthropic||""} onChange={e=>setKeyDraft({...keyDraft,anthropic:e.target.value})} placeholder="sk-ant-..."/>
          <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:7,color:C.textMuted,marginTop:-10,marginBottom:10}}>console.anthropic.com › API Keys</div>
          <Label>Apify API Key</Label>
          <Input type="password" value={keyDraft.apify||""} onChange={e=>setKeyDraft({...keyDraft,apify:e.target.value})} placeholder="apify_api_..."/>
          <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:7,color:C.textMuted,marginTop:-10,marginBottom:0}}>console.apify.com › Settings › Integrations</div>
        </Card>

        <Card style={{marginBottom:10,borderColor:C.success+"33",background:`${C.success}05`}}>
          <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:10,color:C.success,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:12}}>🗄 Supabase Sync</div>
          <Label>Project URL</Label>
          <Input value={keyDraft.sbUrl||""} onChange={e=>setKeyDraft({...keyDraft,sbUrl:e.target.value})} placeholder="https://xxxx.supabase.co"/>
          <Label>Anon Public Key</Label>
          <Input type="password" value={keyDraft.sbKey||""} onChange={e=>setKeyDraft({...keyDraft,sbKey:e.target.value})} placeholder="eyJ..."/>
        </Card>

        <Btn style={{width:"100%",justifyContent:"center",marginBottom:20}} onClick={saveKeys}>[ SALVA CONFIGURAZIONE ]</Btn>
      </Section>

      <Section title="Reset & Export">
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          <Row style={{justifyContent:"space-between",alignItems:"center",background:C.bg,border:`1px solid ${C.border}`,borderRadius:6,padding:"12px 14px"}}>
            <div>
              <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:12,color:C.text,fontWeight:600}}>Reset Quest giornaliere</div>
              <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:8,color:C.textDim,marginTop:2}}>Segna tutte le quest come non fatte</div>
            </div>
            <button onClick={()=>setQuests(q=>q.map(x=>({...x,done:false})))} style={{background:"none",border:`1px solid ${C.orange}`,borderRadius:4,color:C.orange,cursor:"pointer",padding:"6px 12px",fontFamily:"'Rajdhani',sans-serif",fontSize:9,letterSpacing:"0.08em",textTransform:"uppercase",flexShrink:0}}>Reset</button>
          </Row>

          <Row style={{justifyContent:"space-between",alignItems:"center",background:C.bg,border:`1px solid ${C.border}`,borderRadius:6,padding:"12px 14px"}}>
            <div>
              <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:12,color:C.text,fontWeight:600}}>Esporta dati (JSON)</div>
              <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:8,color:C.textDim,marginTop:2}}>Backup completo di tutti i dati</div>
            </div>
            <button onClick={()=>{
              const data={clients,leads,quests,tasks,ideas,goals,notes,payments,workoutLog,dietLog,moodLog,weightLog,habits,habitLog,slotDays,slotStart,exportedAt:new Date().toISOString()};
              const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
              const url=URL.createObjectURL(blob);
              const a=document.createElement("a");
              a.href=url;a.download=`the-system-${todayStr()}.json`;a.click();
              URL.revokeObjectURL(url);
            }} style={{background:"none",border:`1px solid ${C.accent}`,borderRadius:4,color:C.accent,cursor:"pointer",padding:"6px 12px",fontFamily:"'Rajdhani',sans-serif",fontSize:9,letterSpacing:"0.08em",textTransform:"uppercase",flexShrink:0}}>Export</button>
          </Row>

          <Row style={{justifyContent:"space-between",alignItems:"center",background:`${C.danger}08`,border:`1px solid ${C.danger}33`,borderRadius:6,padding:"12px 14px"}}>
            <div>
              <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:12,color:C.danger,fontWeight:600}}>Reset TUTTO</div>
              <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:8,color:C.textDim,marginTop:2}}>Cancella tutti i dati locali permanentemente</div>
            </div>
            <button onClick={()=>{if(!window.confirm("Sicuro? Cancella TUTTI i dati locali."))return;localStorage.clear();window.location.reload();}} style={{background:"none",border:`1px solid ${C.danger}`,borderRadius:4,color:C.danger,cursor:"pointer",padding:"6px 12px",fontFamily:"'Rajdhani',sans-serif",fontSize:9,letterSpacing:"0.08em",textTransform:"uppercase",flexShrink:0}}>RESET</button>
          </Row>
        </div>
      </Section>

      <Section title="Info">
        <Card>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {[
              ["Versione","The System v1.0"],
              ["Player","Andrea // Studio Brillo"],
              ["Clienti",clients.length],
              ["Lead",leads.length],
              ["Task totali",tasks.length],
              ["Idee in vault",ideas.length],
            ].map(([k,v])=>(
              <Row key={k} style={{justifyContent:"space-between"}}>
                <span style={{fontFamily:"'Rajdhani',sans-serif",fontSize:11,color:C.textDim}}>{k}</span>
                <span style={{fontFamily:"'Share Tech Mono',monospace",fontSize:10,color:C.text}}>{v}</span>
              </Row>
            ))}
          </div>
        </Card>
      </Section>
    </div>
  );
};

// ─── APP ROOT ─────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [loaded, setLoaded] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [sbConnected, setSbConnected] = useState(!!getSB());

  const [clients, setClients] = useState(()=>LS.get("ts_clients",[]));
  const [leads, setLeads] = useState(()=>LS.get("ts_leads",[]));
  const [ideas, setIdeas] = useState(()=>LS.get("ts_ideas",[]));
  const [goals, setGoals] = useState(()=>LS.get("ts_goals",[]));
  const [notes, setNotes] = useState(()=>LS.get("ts_notes",[]));
  const [payments, setPayments] = useState(()=>LS.get("ts_payments",[]));
  const [apiKeys, setApiKeys] = useState(()=>LS.get("ts_api_keys",{apify:"",anthropic:""}));
  const [slotDays, setSlotDays] = useState(()=>LS.get("ts_slot_days",0));
  const [slotStart, setSlotStart] = useState(()=>{const s=LS.get("ts_slot_start","");if(!s){const t=todayStr();LS.set("ts_slot_start",t);return t;}return s;});
  const [workoutLog, setWorkoutLog] = useState(()=>LS.get("ts_workout",{}));
  const [dietLog, setDietLog] = useState(()=>LS.get("ts_diet",{}));
  const [moodLog, setMoodLog] = useState(()=>LS.get("ts_mood",{}));
  const [quests, setQuests] = useState(()=>{
    const saved=LS.get("ts_quests",DEFAULT_FIXED);
    const lr=LS.get("ts_last_reset","");
    const t=todayStr();
    if(lr!==t){const r=(saved.length?saved:DEFAULT_FIXED).filter(q=>q.fixed).map(q=>({...q,done:false}));LS.set("ts_last_reset",t);return r;}
    return saved.length?saved:DEFAULT_FIXED;
  });
  const [tasks, setTasks] = useState(()=>LS.get("ts_tasks",[]));
  const [weightLog, setWeightLog] = useState(()=>LS.get("ts_weight",[]));
  const [habits, setHabits] = useState(()=>LS.get("ts_habits",[]));
  const [habitLog, setHabitLog] = useState(()=>LS.get("ts_habitlog",{}));
  const [showKeys, setShowKeys] = useState(false);
  const [keyDraft, setKeyDraft] = useState({apify:"",anthropic:"",sbUrl:"",sbKey:""});
  const [aiQuestModal, setAiQuestModal] = useState(false);
  const [aiQuestSuggestions, setAiQuestSuggestions] = useState(null);
  const [aiQuestLoading, setAiQuestLoading] = useState(false);
  const stateRef = useRef({});

  // On mount: pull from Supabase if configured
  useEffect(()=>{
    (async()=>{
      if(getSB()){
        setSyncing(true);
        try {
          const data = await DB.pullAll();
          if(data){
            if(data.clients?.length) setClients(data.clients);
            if(data.leads?.length) setLeads(data.leads);
            if(data.tasks?.length) setTasks(data.tasks);
            if(data.ideas?.length) setIdeas(data.ideas);
            if(data.goals?.length) setGoals(data.goals);
            if(data.notes?.length) setNotes(data.notes);
            if(data.payments?.length) setPayments(data.payments);
            if(data.habits?.length) setHabits(data.habits);
            if(Object.keys(data.workoutLog||{}).length) setWorkoutLog(data.workoutLog);
            if(Object.keys(data.dietLog||{}).length) setDietLog(data.dietLog);
            if(Object.keys(data.moodLog||{}).length) setMoodLog(data.moodLog);
            if(data.weightLog?.length) setWeightLog(data.weightLog);
            if(Object.keys(data.habitLog||{}).length) setHabitLog(data.habitLog);
            if(data.slotDays) setSlotDays(data.slotDays);
            if(data.slotStart) setSlotStart(data.slotStart);
            if(data.quests?.length){
              const t=todayStr(); const lr=data.lastReset||"";
              if(lr!==t){setQuests(data.quests.filter(q=>q.fixed).map(q=>({...q,done:false})));DB.setSetting("last_reset",t);}
              else setQuests(data.quests);
            }
            setSbConnected(true);
          }
        } catch(e){ console.log("Supabase pull failed:",e); }
        setSyncing(false);
      }
      setLoaded(true);
    })();
  },[]);

  // Generate AI quests on first open of the day
  useEffect(()=>{
    if(!loaded) return;
    const today = todayStr();
    const lastAiQuest = LS.get("ts_ai_quest_date","");
    if(lastAiQuest === today) return; // already done today
    const key = LS.get("ts_api_keys",{})?.anthropic || apiKeys.anthropic;
    if(!key) return;
    // Generate after 1s delay to let data load
    const timer = setTimeout(async()=>{
      setAiQuestLoading(true);
      try {
        const ctx = `Sei The System, l'AI di Andrea (freelance web design, Studio Brillo, Vicenza).
Oggi è ${today}. Genera 3-5 quest variabili personalizzate per la giornata di Andrea basandoti su:
- Task aperti: ${tasks.filter(t=>!t.done).slice(0,5).map(t=>t.text).join(", ")||"nessuno"}
- Lead in trattativa: ${leads.filter(l=>l.stage==="In trattativa").map(l=>l.name).join(", ")||"nessuno"}
- Clienti attivi: ${clients.filter(c=>!["Consegnato","Pagato"].includes(c.stage)).map(c=>c.name).join(", ")||"nessuno"}
- Idee recenti: ${ideas.slice(0,3).map(i=>i.refined?.slice(0,40)).join(", ")||"nessuna"}
- Goals attivi: ${goals.filter(g=>!g.done).map(g=>g.title).join(", ")||"nessuno"}

Le quest devono essere SPECIFICHE e ACTIONABLE per oggi, non generiche. Rispondi SOLO con JSON:
{"quests":["testo quest 1","testo quest 2","testo quest 3"]}`;

        const res = await fetch("https://apify-worker.luciettiandrea.workers.dev/anthropic/v1/messages",{
          method:"POST",
          headers:{"Content-Type":"application/json","x-api-key":key},
          body:JSON.stringify({model:"claude-sonnet-4-5",max_tokens:300,messages:[{role:"user",content:ctx}]})
        });
        const d = await res.json();
        const parsed = JSON.parse((d.content?.[0]?.text||"{}").replace(/```json|```/g,"").trim());
        if(parsed.quests?.length){
          setAiQuestSuggestions(parsed.quests);
          setAiQuestModal(true);
          LS.set("ts_ai_quest_date", today);
        }
      } catch(e){ console.log("AI quest gen failed:", e); }
      setAiQuestLoading(false);
    }, 1500);
    return ()=>clearTimeout(timer);
  },[loaded]);

  // Persist to localStorage
  useEffect(()=>LS.set("ts_clients",clients),[clients]);
  useEffect(()=>LS.set("ts_leads",leads),[leads]);
  useEffect(()=>LS.set("ts_quests",quests),[quests]);
  useEffect(()=>LS.set("ts_tasks",tasks),[tasks]);
  useEffect(()=>LS.set("ts_weight",weightLog),[weightLog]);
  useEffect(()=>LS.set("ts_habits",habits),[habits]);
  useEffect(()=>LS.set("ts_habitlog",habitLog),[habitLog]);
  useEffect(()=>LS.set("ts_ideas",ideas),[ideas]);
  useEffect(()=>LS.set("ts_goals",goals),[goals]);
  useEffect(()=>LS.set("ts_notes",notes),[notes]);
  useEffect(()=>LS.set("ts_payments",payments),[payments]);
  useEffect(()=>LS.set("ts_api_keys",apiKeys),[apiKeys]);
  useEffect(()=>LS.set("ts_slot_days",slotDays),[slotDays]);
  useEffect(()=>LS.set("ts_slot_start",slotStart),[slotStart]);
  useEffect(()=>LS.set("ts_workout",workoutLog),[workoutLog]);
  useEffect(()=>LS.set("ts_diet",dietLog),[dietLog]);
  useEffect(()=>LS.set("ts_mood",moodLog),[moodLog]);

  // Sync to Supabase 1.5s after any change
  stateRef.current = {clients,leads,quests,tasks,ideas,goals,notes,payments,workoutLog,dietLog,moodLog,weightLog,habitLog,habits,slotDays,slotStart,apiKeys};
  useEffect(()=>{
    if(!loaded||!getSB()) return;
    const t = setTimeout(()=>DB.pushAll(stateRef.current),1500);
    return ()=>clearTimeout(t);
  },[clients,leads,quests,tasks,ideas,goals,notes,payments,workoutLog,dietLog,moodLog,weightLog,habitLog,habits,slotDays,slotStart,loaded]);

  const addToLeads = useCallback(lead=>setLeads(p=>[...p,lead]),[]);
  const openKeys = ()=>{setKeyDraft({...apiKeys,sbUrl:localStorage.getItem("ts_sb_url")||"",sbKey:localStorage.getItem("ts_sb_key")||""});setShowKeys(true);};
  const saveKeys = ()=>{
    setApiKeys({apify:keyDraft.apify,anthropic:keyDraft.anthropic});
    if(keyDraft.sbUrl) localStorage.setItem("ts_sb_url",keyDraft.sbUrl);
    else localStorage.removeItem("ts_sb_url");
    if(keyDraft.sbKey) localStorage.setItem("ts_sb_key",keyDraft.sbKey);
    else localStorage.removeItem("ts_sb_key");
    setSbConnected(!!(keyDraft.sbUrl&&keyDraft.sbKey));
    setShowKeys(false);
  };
  const resetSlot = ()=>{setSlotDays(0);setSlotStart(todayStr());};

  const NAV_ICONS = {
    dashboard: "M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z",
    quests: "M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11",
    clients: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zm8 2l2 2 4-4",
    finance: "M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6",
    leads: "M22 12h-4l-3 9L9 3l-3 9H2",
    goals: "M13 2L3 14h9l-1 8 10-12h-9l1-8z",
    tasks: "M9 11l3 3L22 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7",
    notes: "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8",
    workout: "M6.5 6.5h11M6.5 17.5h11M3 12h3M18 12h3M6 8.5v7M18 8.5v7",
    diet: "M18 8h1a4 4 0 010 8h-1M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8zM6 1v3M10 1v3M14 1v3",
    mood: "M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01",
    weight: "M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z",
    habits: "M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z",
    slot: "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z",
    brainstorm: "M9 18h6M10 22h4M12 2a7 7 0 017 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 01-2 2h-4a2 2 0 01-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 017-7z",
    agent: "M12 2a10 10 0 100 20 10 10 0 000-20zM2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z",
    hunter: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
    tasknotes: "M9 11l3 3L22 4M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z",
    salute: "M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78L12 21.23l7.78-7.78a5.5 5.5 0 000-7.78z",
    checkin: "M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01",
    settings: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z",
  };
  const NavIcon = ({id,active}) => (
    <svg width={active?15:13} height={active?15:13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active?2.5:2} strokeLinecap="round" strokeLinejoin="round" style={{transition:"all .2s"}}>
      <path d={NAV_ICONS[id]||NAV_ICONS.notes}/>
    </svg>
  );
  const nav = [
    {id:"dashboard",label:"Home"},
    {id:"quests",label:"Quest"},
    {id:"clients",label:"Clienti"},
    {id:"finance",label:"Finanze"},
    {id:"leads",label:"Pipeline"},
    {id:"goals",label:"Goals"},
    {id:"tasknotes",label:"Task"},
    {id:"salute",label:"Salute"},
    {id:"checkin",label:"Check-in"},
    {id:"slot",label:"Slot"},
    {id:"brainstorm",label:"Ideas"},
    {id:"agent",label:"Agent"},

    {id:"settings",label:"Setup"},
  ];

  return (
    <div className="app-shell" style={{minHeight:"100dvh",background:C.bg,color:C.text}}>
      <GS/>
      <div style={{position:"fixed",top:0,left:0,right:0,zIndex:50,background:C.bg,borderBottom:`1px solid ${C.border}`}}>
        <Row style={{padding:"10px clamp(14px,4vw,60px) 0",justifyContent:"space-between"}}>
          <div>
            <div style={{fontFamily:"'Cinzel',serif",fontSize:12,fontWeight:900,color:C.accent,letterSpacing:"0.25em",textShadow:`0 0 16px ${C.accent}44`}}>THE SYSTEM</div>
            <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:6,color:C.textMuted,letterSpacing:"0.15em",marginTop:2}}>PLAYER: ANDREA // STUDIO BRILLO</div>
          </div>
          <Row gap={8}>
            {syncing && <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:6,color:C.gold}}>⟳ sync</div>}
            <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:7,color:sbConnected?C.success:apiKeys.anthropic?C.accent:C.danger}}>
              {sbConnected?"● DB SYNC":apiKeys.anthropic?"● ONLINE":"○ OFFLINE"}
            </div>
            <Btn variant="ghost" size="sm" onClick={openKeys} style={{fontSize:7,padding:"3px 8px"}}>API</Btn>
          </Row>
        </Row>
        <div style={{display:"flex",overflowX:"auto",scrollbarWidth:"none",marginTop:8,borderTop:`1px solid ${C.border}`,padding:"0 clamp(14px,4vw,60px)"}}>
          {nav.map(item=>{
            const active=tab===item.id;
            return (
              <button key={item.id} onClick={()=>setTab(item.id)} style={{flexShrink:0,background:"none",border:"none",borderBottom:`2px solid ${active?C.accent:"transparent"}`,color:active?C.accent:"#384560",cursor:"pointer",padding:"7px 11px",fontFamily:"'Rajdhani',sans-serif",fontSize:active?8:7,letterSpacing:"0.08em",textTransform:"uppercase",transition:"all .2s",display:"flex",flexDirection:"column",alignItems:"center",gap:3,fontWeight:active?700:400}}>
                <NavIcon id={item.id} active={active}/>
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{padding:"96px clamp(14px,4vw,60px) 50px",maxWidth:860,margin:"0 auto"}}>
        {!loaded ? (
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"60vh",gap:12}}>
            <div style={{fontFamily:"'Cinzel',serif",fontSize:18,fontWeight:900,color:C.accent,letterSpacing:"0.2em"}} className="rp">THE SYSTEM</div>
            <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:10,color:C.textDim}}>
              {getSB()?"Connecting to database...":"initializing..."}
            </div>
          </div>
        ) : (
          <>
            {tab==="dashboard" && <Dashboard clients={clients} leads={leads} quests={quests} tasks={tasks} workoutLog={workoutLog} dietLog={dietLog} moodLog={moodLog} goals={goals} payments={payments}/>}
            {tab==="quests" && <QuestsView quests={quests} setQuests={setQuests} moodLog={moodLog} anthropicKey={apiKeys.anthropic} onNeedKey={openKeys}/>}
            {tab==="clients" && <ClientsView clients={clients} setClients={setClients}/>}
            {tab==="finance" && <FinanceView clients={clients} payments={payments} setPayments={setPayments}/>}
            {tab==="leads" && <LeadsView leads={leads} setLeads={setLeads} apiKeys={apiKeys} onNeedKey={openKeys}/>}
            {tab==="goals" && <GoalsView goals={goals} setGoals={setGoals}/>}
            {tab==="tasknotes" && <TaskNotesView tasks={tasks} setTasks={setTasks} notes={notes} setNotes={setNotes} anthropicKey={apiKeys.anthropic} onNeedKey={openKeys}/>}
            {tab==="salute" && <SaluteView workoutLog={workoutLog} setWorkoutLog={setWorkoutLog} dietLog={dietLog} setDietLog={setDietLog} weightLog={weightLog} setWeightLog={setWeightLog}/>}
            {tab==="checkin" && <CheckinView moodLog={moodLog} setMoodLog={setMoodLog} habits={habits} setHabits={setHabits} habitLog={habitLog} setHabitLog={setHabitLog}/>}
            {tab==="slot" && <SlotView slotDays={slotDays} slotStart={slotStart} onReset={resetSlot}/>}
            {tab==="brainstorm" && <BrainstormView ideas={ideas} setIdeas={setIdeas} anthropicKey={apiKeys.anthropic} onNeedKey={openKeys}/>}
            {tab==="agent" && <AgentView clients={clients} leads={leads} quests={quests} tasks={tasks} ideas={ideas} workoutLog={workoutLog} dietLog={dietLog} moodLog={moodLog} anthropicKey={apiKeys.anthropic} onNeedKey={openKeys}/>}
            
            {tab==="settings" && <SettingsView quests={quests} setQuests={setQuests} clients={clients} leads={leads} tasks={tasks} ideas={ideas} goals={goals} notes={notes} payments={payments} workoutLog={workoutLog} dietLog={dietLog} moodLog={moodLog} weightLog={weightLog} habits={habits} habitLog={habitLog} slotDays={slotDays} slotStart={slotStart} apiKeys={apiKeys} keyDraft={keyDraft} setKeyDraft={setKeyDraft} saveKeys={saveKeys}/>}
          </>
        )}
      </div>

      {aiQuestModal && aiQuestSuggestions && (
        <Modal title="⚡ Quest del Giorno — Suggerite dall'AI" onClose={()=>setAiQuestModal(false)}>
          <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:12,color:C.textDim,marginBottom:14,lineHeight:1.6}}>
            The System ha analizzato il tuo contesto e suggerisce queste quest per oggi:
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:16}}>
            {aiQuestSuggestions.map((q,i)=>(
              <div key={i} style={{background:C.bg,border:`1px solid ${C.borderHi}`,borderRadius:6,padding:"10px 14px",fontFamily:"'Share Tech Mono',monospace",fontSize:11,color:C.text,lineHeight:1.5}}>
                <span style={{color:C.accent,marginRight:8}}>{i+1}.</span>{q}
              </div>
            ))}
          </div>
          <Row gap={8}>
            <Btn variant="ghost" style={{flex:1,justifyContent:"center"}} onClick={()=>setAiQuestModal(false)}>Ignora</Btn>
            <Btn style={{flex:2,justifyContent:"center"}} onClick={()=>{
              const newVariableQuests = aiQuestSuggestions.map(text=>({id:uid(),text,done:false,fixed:false}));
              setQuests(q=>[...q.filter(x=>x.fixed),...newVariableQuests]);
              setAiQuestModal(false);
            }}>[ AGGIUNGI ALLE QUEST ]</Btn>
          </Row>
        </Modal>
      )}
      {showKeys && (
        <Modal title="System Configuration" onClose={()=>setShowKeys(false)}>
          <Card style={{marginBottom:12,borderColor:C.accent+"22"}}>
            <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:8,color:C.textDim}}>Keys stored locally in your browser only.</div>
          </Card>
          <Label>Anthropic API Key</Label>
          <Input type="password" value={keyDraft.anthropic} onChange={e=>setKeyDraft({...keyDraft,anthropic:e.target.value})} placeholder="sk-ant-..."/>
          <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:7,color:C.textMuted,marginTop:-6,marginBottom:12}}>console.anthropic.com › API Keys</div>
          <Label>Apify API Key</Label>
          <Input type="password" value={keyDraft.apify} onChange={e=>setKeyDraft({...keyDraft,apify:e.target.value})} placeholder="apify_api_..."/>
          <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:7,color:C.textMuted,marginTop:-6,marginBottom:16}}>console.apify.com › Settings › Integrations</div>
          <div style={{background:`${C.success}0a`,border:`1px solid ${C.success}33`,borderRadius:6,padding:12,marginBottom:12}}>
            <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:10,color:C.success,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8}}>🗄 Supabase Sync</div>
            <Label>Project URL</Label>
            <Input value={keyDraft.sbUrl} onChange={e=>setKeyDraft({...keyDraft,sbUrl:e.target.value})} placeholder="https://xxxx.supabase.co" style={{marginBottom:8}}/>
            <Label>Anon Public Key</Label>
            <Input type="password" value={keyDraft.sbKey} onChange={e=>setKeyDraft({...keyDraft,sbKey:e.target.value})} placeholder="eyJ..." style={{marginBottom:0}}/>
          </div>
          <Row gap={8} style={{marginBottom:16}}>
            <Btn variant="ghost" style={{flex:1,justifyContent:"center"}} onClick={()=>setShowKeys(false)}>Cancel</Btn>
            <Btn style={{flex:2,justifyContent:"center"}} onClick={saveKeys}>[ SAVE CONFIG ]</Btn>
          </Row>

          <div style={{borderTop:`1px solid ${C.border}`,paddingTop:14}}>
            <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:10,color:C.danger,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:10}}>⚠ Impostazioni</div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              <Row style={{justifyContent:"space-between",alignItems:"center",background:C.bg,border:`1px solid ${C.border}`,borderRadius:6,padding:"10px 12px"}}>
                <div>
                  <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:11,color:C.text,fontWeight:600}}>Reset Quest giornaliere</div>
                  <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:8,color:C.textDim}}>Segna tutte le quest come non fatte</div>
                </div>
                <button onClick={()=>{setQuests(q=>q.map(x=>({...x,done:false})));setShowKeys(false);}} style={{background:"none",border:`1px solid ${C.orange}`,borderRadius:4,color:C.orange,cursor:"pointer",padding:"5px 10px",fontFamily:"'Rajdhani',sans-serif",fontSize:9,letterSpacing:"0.08em",textTransform:"uppercase",flexShrink:0}}>Reset</button>
              </Row>
              <Row style={{justifyContent:"space-between",alignItems:"center",background:C.bg,border:`1px solid ${C.border}`,borderRadius:6,padding:"10px 12px"}}>
                <div>
                  <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:11,color:C.text,fontWeight:600}}>Esporta dati (JSON)</div>
                  <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:8,color:C.textDim}}>Scarica backup completo di tutti i dati</div>
                </div>
                <button onClick={()=>{
                  const data={clients,leads,quests,tasks,ideas,goals,notes,payments,workoutLog,dietLog,moodLog,weightLog,habits,habitLog,slotDays,slotStart,exportedAt:new Date().toISOString()};
                  const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
                  const url=URL.createObjectURL(blob);
                  const a=document.createElement("a");
                  a.href=url;a.download=`the-system-backup-${todayStr()}.json`;a.click();
                  URL.revokeObjectURL(url);
                }} style={{background:"none",border:`1px solid ${C.accent}`,borderRadius:4,color:C.accent,cursor:"pointer",padding:"5px 10px",fontFamily:"'Rajdhani',sans-serif",fontSize:9,letterSpacing:"0.08em",textTransform:"uppercase",flexShrink:0}}>Export</button>
              </Row>
              <Row style={{justifyContent:"space-between",alignItems:"center",background:`${C.danger}08`,border:`1px solid ${C.danger}33`,borderRadius:6,padding:"10px 12px"}}>
                <div>
                  <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:11,color:C.danger,fontWeight:600}}>Reset TUTTO</div>
                  <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:8,color:C.textDim}}>Cancella tutti i dati locali</div>
                </div>
                <button onClick={()=>{if(!window.confirm("Sicuro? Cancella TUTTI i dati locali."))return;localStorage.clear();window.location.reload();}} style={{background:"none",border:`1px solid ${C.danger}`,borderRadius:4,color:C.danger,cursor:"pointer",padding:"5px 10px",fontFamily:"'Rajdhani',sans-serif",fontSize:9,letterSpacing:"0.08em",textTransform:"uppercase",flexShrink:0}}>RESET</button>
              </Row>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
